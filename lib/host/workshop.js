/*
 * The workshop API, on the host side.
 *
 * Two different upstreams serve this plugin, and both are anonymous:
 *
 *   · `steamcommunity.com/workshop/browse/` — the server-rendered listing.
 *     This is the only way to *discover* items without an API key: Steam's
 *     `IPublishedFileService/QueryFiles` answers 403 without one, and the page
 *     an API key is issued from lives on the same host this plugin already
 *     reaches. The listing carries the id and title of each card.
 *
 *   · `api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails` —
 *     public, keyless metadata for up to 100 ids per POST: subscriptions,
 *     views, tags (including the `Adult only` audience marker), description
 *     and file size. Anonymous callers get all of it for public items.
 *
 * Downloads are a third thing entirely and deliberately absent here: Steam
 * answers `{"success":15,"message":"No user"}` for an anonymous download, so
 * that path needs a real Steam session. See `docs/` for the honest boundary.
 */

import { APPID, API_BASE, PAGE_SIZE, buildBrowseUrl, mergeItems, parseFileDetails, parseTotalEntries, parseWorkshopPage } from '../shared/constants.js';
import { get, post, readText, resolveProxyUrl } from './net.js';

/** How long one upstream request may take. */
const FETCH_TIMEOUT_MS = 25000;

/** How many ids one metadata POST carries; Steam's own documented ceiling. */
const DETAILS_BATCH = 100;

/**
 * Read the proxy this plugin should use.
 *
 * @param store - the configuration store.
 * @param env - environment to fall back to; injected for tests.
 * @returns a proxy URL, or `''` to connect directly.
 */
function proxyFrom(store, env) {
  return resolveProxyUrl(store.get().proxy, env);
}

/**
 * Fetch one text document, retrying the transport.
 *
 * The route to `steamcommunity.com` is the fragile part of this plugin: behind
 * a residential proxy it frequently resets mid-handshake, and a single attempt
 * reports that as "the workshop is down" when the next one would succeed. Only
 * transport failures are retried — a 4xx is an answer, not a hiccup.
 *
 * @param url - the absolute URL.
 * @param options - `{ proxy, headers, attempts, timeoutMs }`.
 * @returns `{ status, text }`.
 */
async function fetchText(url, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await get(url, {
        proxy: options.proxy ?? '',
        headers: options.headers ?? {},
        timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
      });
      const text = await readText(response.stream);
      return { status: response.status, text };
    } catch (error) {
      lastError = error;
      // Back off a little: an immediate retry against a resetting proxy just
      // resets again.
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('请求失败');
}

/**
 * Fetch anonymous metadata for a batch of workshop ids.
 *
 * Steam's public metadata API is a form-encoded POST, so this uses `post`
 * rather than `get`.
 *
 * @param ids - workshop file ids.
 * @param options - `{ proxy }`.
 * @returns the parsed records; empty when the API is unreachable.
 */
async function fetchDetails(ids, options) {
  if (ids.length === 0) return [];
  const body = [`itemcount=${String(ids.length)}`]
    .concat(ids.map((id, index) => `publishedfileids[${String(index)}]=${encodeURIComponent(id)}`))
    .join('&');

  try {
    const response = await post(`${API_BASE}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
      proxy: options.proxy,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (response.status !== 200) return [];
    const text = await readText(response.stream);
    return parseFileDetails(text);
  } catch {
    // Metadata is enrichment: a listing that rendered is still worth showing.
    return [];
  }
}

/**
 * Create the workshop client bound to one configuration store.
 *
 * @param options - `{ store, logger, env }`.
 * @returns the client this plugin's routes call.
 */
export function createWorkshop({ store, logger, env }) {
  const environment = env ?? process.env;

  /**
   * Browse or search one page of the workshop.
   *
   * @param input - `{ query, sort, page, showAdult }`.
   * @returns the wire result; `ok: false` carries an actionable reason.
   */
  async function browse(input = {}) {
    const proxy = proxyFrom(store, environment);
    const url = buildBrowseUrl(input);

    let page;
    try {
      page = await fetchText(url, { proxy, headers: { accept: 'text/html' } });
    } catch (error) {
      return {
        ok: false,
        reason: `连不上 Steam 创意工坊：${error.message}`,
        proxy,
        hint: proxy === ''
          ? '本机没有可用代理。steamcommunity.com 在部分网络下需要代理，请在「访问」里填写。'
          : '代理已配置但仍然失败，请确认代理能访问 steamcommunity.com（TUN 模式通常需要开启）。',
      };
    }

    if (page.status === 403 || page.status === 401) {
      return {
        ok: false,
        reason: `Steam 拒绝了这次请求（HTTP ${String(page.status)}）。`,
        proxy,
        hint: '这是访问受限页面的常见结果；公开的创意工坊列表通常不需要登录。',
      };
    }
    if (page.status !== 200) {
      return {
        ok: false,
        reason: `创意工坊返回 HTTP ${String(page.status)}。`,
        proxy,
        hint: '请确认代理可用，且没有被 Steam 限流。',
      };
    }

    const cards = parseWorkshopPage(page.text);
    const details = await fetchDetails(cards.slice(0, DETAILS_BATCH).map((card) => card.id), { proxy });
    const items = mergeItems(cards, details);

    // The pager needs the whole count, not just this page's slice.
    const total = parseTotalEntries(page.text);
    const lastPage = total > 0 ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 0;

    return {
      ok: true,
      items,
      page: Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 1,
      lastPage,
      total,
      query: typeof input.query === 'string' ? input.query.trim() : '',
      sort: typeof input.sort === 'string' ? input.sort : 'trend',
      tag: typeof input.tag === 'string' ? input.tag : '',
      requestUrl: url,
      proxy,
      appid: APPID,
    };
  }

  /**
   * Fetch full metadata for one item, for a detail view.
   *
   * @param id - the workshop file id.
   * @returns the wire result.
   */
  async function detail(id) {
    const proxy = proxyFrom(store, environment);
    if (!/^\d+$/.test(String(id ?? ''))) {
      return { ok: false, reason: '无效的创意工坊 id。', proxy };
    }
    const rows = await fetchDetails([String(id)], { proxy });
    if (rows.length === 0) {
      return {
        ok: false,
        reason: '没有取到这个条目的公开信息。',
        proxy,
        hint: '条目可能已下架、被禁止，或仅对已登录账号可见。',
      };
    }
    return { ok: true, item: rows[0], proxy };
  }

  /**
   * Report reachability of both upstreams, without changing any state.
   *
   * @returns the wire result.
   */
  async function status() {
    const proxy = proxyFrom(store, environment);
    const probe = { ok: false, latencyMs: 0, reason: '', proxy };

    const startedAt = Date.now();
    try {
      const response = await fetchText(buildBrowseUrl({ page: 1 }), {
        proxy,
        headers: { accept: 'text/html' },
        attempts: 1,
      });
      probe.latencyMs = Date.now() - startedAt;
      probe.ok = response.status === 200;
      probe.reason = probe.ok ? '' : `HTTP ${String(response.status)}`;
      if (probe.ok) {
        probe.itemsOnFirstPage = parseWorkshopPage(response.text).length;
      }
    } catch (error) {
      probe.latencyMs = Date.now() - startedAt;
      probe.reason = error.message;
    }

    return { ok: true, proxy, probe };
  }

  return { browse, detail, status };
}

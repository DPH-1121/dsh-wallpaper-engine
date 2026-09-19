/*
 * The host routes the wallpaper panel talks to.
 *
 * One prefix registration, dispatched internally: `register()` treats a
 * duplicate `(kind, path)` as a composition error, so claiming the shortest
 * correct prefix once and routing beneath it keeps this plugin's surface
 * auditable in a single place.
 *
 * Every response is JSON. This plugin deliberately does not stream images: the
 * browser fetches previews from Steam's own CDN directly, because proxying
 * hundreds of thumbnails through the host would spend the user's proxy
 * bandwidth twice and make the panel's scroll performance the host's problem.
 */

import { PKG, ROUTE_BASE } from '../shared/constants.js';

/** Largest JSON body accepted from the page, in bytes. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Write one JSON response.
 *
 * @param res - the server response.
 * @param status - the HTTP status.
 * @param payload - a JSON-serializable value.
 */
function sendJson(res, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Send `405` for a method this route does not implement.
 *
 * @param res - the server response.
 * @param allowed - the methods that would have worked.
 */
function sendMethodNotAllowed(res, allowed) {
  res.writeHead(405, { allow: allowed.join(', '), 'content-type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
}

/**
 * Read and decode a JSON request body, refusing anything oversized.
 *
 * Throws a `body`-tagged error: the difference between "the caller sent
 * nonsense" (400) and "this plugin broke" (500) is worth keeping, because only
 * one of them is the user's to fix.
 *
 * @param req - the incoming request.
 * @returns the decoded value, or `undefined` when it was absent.
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw taggedBodyError(`请求体超过 ${String(MAX_BODY_BYTES)} 字节`);
    chunks.push(chunk);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw taggedBodyError('请求体不是合法 JSON');
  }
}

/** Mark an error as the caller's fault rather than this plugin's. */
function taggedBodyError(message) {
  const error = new Error(message);
  error.dshBodyError = true;
  return error;
}

/**
 * Decide whether a request may change this plugin's settings.
 *
 * The web server carries no authentication of its own, by design, and is
 * loopback-only unless somebody deliberately widened it. This plugin therefore
 * adds the one check it can make honestly: a browser request must come from the
 * GUI's own origin. That stops a random page the user visits from silently
 * POSTing a new proxy into this plugin — which would be a request-forgery
 * primitive aimed at every host the proxy can reach — without pretending to be
 * an authentication layer it is not.
 *
 * @param req - the incoming request.
 * @returns `true` when the request may write.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true; // Non-browser client.
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Build the request handler for this plugin's route prefix.
 *
 * @param options - `{ store, workshop, logger, ready, describeSteam }`, where
 *   `ready` is the first-load promise every request waits on so no request is
 *   ever answered from a half-loaded configuration.
 * @returns a handler matching `WebRoute['handler']`.
 */
export function createRouteHandler(options) {
  const store = options.store;
  const workshop = options.workshop;
  const logger = options.logger;
  const ready = options.ready;
  const describeSteam = options.describeSteam;

  return async function handle(req, res) {
    if (ready !== undefined) await ready;

    let pathname = '/';
    let search = new URLSearchParams();
    try {
      const parsed = new URL(req.url ?? '/', 'http://dsh.invalid');
      pathname = parsed.pathname.slice(ROUTE_BASE.length);
      search = parsed.searchParams;
    } catch {
      sendJson(res, 400, { ok: false, reason: '请求 URL 无法解析。' });
      return;
    }

    try {
      if (pathname === '/config') {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, config: store.get() });
          return;
        }
        if (req.method === 'POST') {
          if (!isSameOrigin(req)) {
            sendJson(res, 403, { ok: false, reason: '跨站请求被拒绝。' });
            return;
          }
          const body = await readJsonBody(req);
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            sendJson(res, 400, { ok: false, reason: '请求体必须是配置对象。' });
            return;
          }
          const patch = body['patch'] ?? body;
          const config = await store.update(patch);
          sendJson(res, 200, { ok: true, config });
          return;
        }
        sendMethodNotAllowed(res, ['GET', 'POST']);
        return;
      }

      if (pathname === '/browse') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        const config = store.get();
        const result = await workshop.browse({
          query: search.get('q') ?? config.query,
          sort: search.get('sort') ?? config.sort,
          tag: search.get('tag') ?? config.tag,
          page: Number(search.get('page') ?? '1') || 1,
        });
        sendJson(res, 200, result);
        return;
      }

      if (pathname === '/detail') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        const result = await workshop.detail(search.get('id') ?? '');
        sendJson(res, 200, result);
        return;
      }

      if (pathname === '/status') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, ['GET']);
          return;
        }
        const probe = search.get('probe') === '1';
        // Steam login state is read from a local file and must stay cheap: it
        // is polled for the "log in now" hint, so it must not drag a network
        // fetch into every refresh. The heavier workshop probe stays opt-in.
        const result = probe ? await workshop.status() : { ok: true };
        const steam = typeof describeSteam === 'function' ? await describeSteam() : null;
        sendJson(res, 200, {
          ...result,
          probe: probe ? result.probe : null,
          steam,
          configFile: store.describe().file,
          appid: '431960',
        });
        return;
      }

      sendJson(res, 404, { ok: false, reason: `未知路由：${pathname}` });
    } catch (error) {
      if (error?.dshBodyError === true) {
        sendJson(res, 400, { ok: false, reason: error.message });
        return;
      }
      logger?.warn?.(`${PKG}: 处理 ${pathname} 失败：${error.message}`);
      sendJson(res, 500, { ok: false, reason: `插件内部错误：${error.message}` });
    }
  };
}

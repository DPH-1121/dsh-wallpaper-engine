/*
 * Shared vocabulary for `dsh-wallpaper-engine`.
 *
 * Both halves import this file, and it must stay free of Node and DOM globals:
 * the build inlines it into the browser bundle verbatim (with `export`
 * stripped), so anything platform-specific here would break one of the two.
 *
 * What lives here is exactly the part that would otherwise exist twice:
 * the Steam app id, the workshop URL builders, and the one HTML parser that
 * turns a server-rendered workshop page into wallpaper records.
 */

/** The package name, which is also this plugin's loader row id. */
export const PKG = 'dsh-wallpaper-engine';

/** Wallpaper Engine's Steam application id. */
export const APPID = '431960';

/** The Steam Community origin every workshop request goes through. */
export const COMMUNITY_BASE = 'https://steamcommunity.com';

/** The public WebAPI origin used for anonymous metadata. */
export const API_BASE = 'https://api.steampowered.com';

/** This plugin's route prefix on the host's web server. */
export const ROUTE_BASE = '/plugins/dsh-wallpaper-engine';

/**
 * The browse sorts wallhaven-style UIs expose for a workshop listing.
 *
 * These are Steam's own `browsesort` values; `textsearch` is added by the
 * builder below when a query is present, because Steam requires the pair.
 */
export const SORTS = Object.freeze([
  Object.freeze({ key: 'trend', label: '热门' }),
  Object.freeze({ key: 'mostrecent', label: '最新' }),
  Object.freeze({ key: 'toprated', label: '评分' }),
  Object.freeze({ key: 'mostsubscribed', label: '订阅' }),
]);

/** Every sort key, for validation on the host side. */
export const SORT_KEYS = Object.freeze(SORTS.map((s) => s.key));

/**
 * The tag filters the panel offers, keyed to Steam's own workshop tags.
 *
 * These are the browse facets Steam exposes on the listing itself; anything
 * rarer is reachable through the keyword search. Chinese labels are what the
 * page shows under `l=schinese`, and they are what the panel reuses.
 */
export const TAG_FILTERS = Object.freeze([
  Object.freeze({ key: '', label: '全部类型' }),
  Object.freeze({ key: 'Scene', label: '场景' }),
  Object.freeze({ key: 'Video', label: '视频' }),
  Object.freeze({ key: 'Application', label: '应用' }),
  Object.freeze({ key: 'Web', label: '网页' }),
  Object.freeze({ key: 'Anime', label: '动漫' }),
  Object.freeze({ key: 'Game', label: '游戏' }),
  Object.freeze({ key: 'Cartoon', label: '卡通' }),
  Object.freeze({ key: 'Sci-Fi', label: '科幻' }),
  Object.freeze({ key: 'Fantasy', label: '奇幻' }),
  Object.freeze({ key: 'Nature', label: '自然' }),
  Object.freeze({ key: 'Cyberpunk', label: '赛博朋克' }),
  Object.freeze({ key: 'Anime (Mature)', label: '动漫（成人）' }),
  Object.freeze({ key: 'Adult only', label: '仅成人' }),
]);

/** Every tag filter key, for validation on the host side. */
export const TAG_KEYS = Object.freeze(TAG_FILTERS.map((t) => t.key));

/**
 * Items per browse page — Steam's own page size for a workshop listing.
 *
 * Used to turn the total entry count into a last-page number for the pager.
 */
export const PAGE_SIZE = 30;

/**
 * Read the total entry count out of a browse page.
 *
 * Steam renders it as "2,892,355 个条目符合筛选条件" (or the English
 * equivalent), with thousands separators. The number is the only thing this
 * plugin wants from that string.
 *
 * @param html - the page body.
 * @returns the total, or `0` when the marker was absent.
 */
export function parseTotalEntries(html) {
  if (typeof html !== 'string' || html === '') return 0;
  const zh = /([\d,，]+)\s*个条目/.exec(html);
  if (zh !== null) return toCount(zh[1]);
  const en = /of\s+([\d,]+)\s+entries/i.exec(html);
  if (en !== null) return toCount(en[1]);
  return 0;
}

/** "2,892,355" → 2892355; returns 0 when it is not all digits and separators. */
function toCount(text) {
  const digits = text.replace(/[,，\s]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : 0;
}

/**
 * Build the workshop browse URL for one page of results.
 *
 * @param input - `{ query, sort, page, tag }`; `query` may be empty to browse.
 * @returns the absolute `steamcommunity.com` URL to fetch.
 */
export function buildBrowseUrl(input) {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  const sort = SORT_KEYS.includes(input?.sort) ? input.sort : 'trend';
  const tag = TAG_KEYS.includes(input?.tag) ? input.tag : '';
  const page = Number.isFinite(input?.page) && input.page > 0 ? Math.floor(input.page) : 1;

  const params = [`appid=${APPID}`, 'section=readytouseitems', 'l=schinese'];
  if (query !== '') {
    params.push(`searchtext=${encodeURIComponent(query)}`);
    // Steam pairs a keyword search with this sort; sending a different one
    // returns the plain listing and silently ignores the keyword.
    params.push('browsesort=textsearch');
  } else {
    params.push(`browsesort=${encodeURIComponent(sort)}`);
  }
  if (tag !== '') params.push(`requiredtags[]=${encodeURIComponent(tag)}`);
  if (page > 1) params.push(`p=${page}`);
  return `${COMMUNITY_BASE}/workshop/browse/?${params.join('&')}`;
}

/** Decode the five entities Steam actually emits in `alt` and `src`. */
export function decodeEntities(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Collapse an HTML fragment to trimmed text, dropping Steam's BBCode. */
export function stripTags(value) {
  return decodeEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\[\/?[^\]]+\]/g, '')
      .replace(/<[^>]*>/g, ''),
  ).trim();
}

/**
 * One workshop card, as it appears in the server-rendered listing page.
 *
 * Steam renders each card as an anchor carrying the item id in its href and the
 * title in the preview image's `alt`; there is no JSON payload on the page, so
 * this regex is the whole extraction surface. It is deliberately anchored on
 * the two attributes that must both be present for a card to be a card.
 */
const CARD_RE = /<a href="https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=(\d+)"[^>]*>\s*<img src="([^"]+)"\s+alt="([^"]*)"/g;

/**
 * Parse one workshop browse page into wallpaper records.
 *
 * @param html - the page body as text.
 * @returns one record per card, in page order, with duplicates removed.
 */
export function parseWorkshopPage(html) {
  if (typeof html !== 'string' || html === '') return [];
  const items = [];
  const seen = new Set();
  CARD_RE.lastIndex = 0;
  let match;
  while ((match = CARD_RE.exec(html)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title: decodeEntities(match[3]) || `Workshop item ${id}`,
      preview: decodeEntities(match[2]),
      pageUrl: `${COMMUNITY_BASE}/sharedfiles/filedetails/?id=${id}`,
    });
  }
  return items;
}

/**
 * Normalize one `GetPublishedFileDetails` row into this plugin's record shape.
 *
 * The anonymous WebAPI returns the full public metadata — subscriptions, views,
 * tags, description — for every item that is publicly visible. `result !== 1`
 * means the item is private, banned, or otherwise not accessible without a
 * session, and those rows are dropped rather than shown half-empty.
 *
 * @param row - one element of `response.publishedfiledetails`.
 * @returns a normalized record, or `null` when the row is unusable.
 */
export function publishedFileToWallpaper(row) {
  if (typeof row !== 'object' || row === null) return null;
  if (row['result'] !== 1) return null;
  const id = String(row['publishedfileid'] ?? '');
  if (!/^\d+$/.test(id)) return null;

  const rawTags = Array.isArray(row['tags']) ? row['tags'] : [];
  const tags = rawTags
    .map((entry) => (typeof entry === 'object' && entry !== null ? String(entry['tag'] ?? '') : ''))
    .filter((tag) => tag !== '');

  return {
    id,
    title: String(row['title'] ?? '') || `Workshop item ${id}`,
    description: stripTags(row['description'] ?? '').slice(0, 800),
    preview: String(row['preview_url'] ?? ''),
    pageUrl: `${COMMUNITY_BASE}/sharedfiles/filedetails/?id=${id}`,
    sizeBytes: Number(row['file_size'] ?? 0) || 0,
    subscriptions: Number(row['subscriptions'] ?? 0) || 0,
    favorited: Number(row['favorited'] ?? 0) || 0,
    views: Number(row['views'] ?? 0) || 0,
    tags,
    // Steam marks an item's audience with the `Adult only` tag; that is the only
    // machine-readable adult signal available anonymously.
    adult: tags.includes('Adult only'),
    banned: Number(row['banned'] ?? 0) === 1,
    timeCreated: Number(row['time_created'] ?? 0) || 0,
    timeUpdated: Number(row['time_updated'] ?? 0) || 0,
    hasFileHandle: Boolean(row['hcontent_file']),
  };
}

/**
 * Parse a `GetPublishedFileDetails` response body into records.
 *
 * @param payload - the decoded JSON body, or the raw text.
 * @returns the usable records; an empty array when nothing parsed.
 */
export function parseFileDetails(payload) {
  let body = payload;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return [];
    }
  }
  if (typeof body !== 'object' || body === null) return [];
  const list = body['response']?.['publishedfiledetails'];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    const item = publishedFileToWallpaper(row);
    if (item !== null) out.push(item);
  }
  return out;
}

/**
 * Merge listing cards with their metadata, keeping card order.
 *
 * The listing is the authority on what is on the page; the API only enriches.
 * An item the API omitted still appears, with its card fields intact.
 *
 * @param cards - records from {@link parseWorkshopPage}.
 * @param details - records from {@link parseFileDetails}.
 * @returns the merged list.
 */
export function mergeItems(cards, details) {
  const byId = new Map();
  for (const detail of details) byId.set(detail.id, detail);
  return cards.map((card) => {
    const detail = byId.get(card.id);
    if (detail === undefined) return card;
    // The card's preview is already sized for a grid; the API's original is
    // larger, so keep the card's when both exist.
    return { ...card, ...detail, preview: card.preview || detail.preview, pageUrl: card.pageUrl };
  });
}

/**
 * Whether an item should be shown given the adult-content preference.
 *
 * @param item - a wallpaper record.
 * @param showAdult - the user's preference.
 * @returns true when the item passes the filter.
 */
export function passesAdultFilter(item, showAdult) {
  if (showAdult === true) return true;
  return item?.adult !== true;
}

/** Clamp a number into `[min, max]`, falling back when it is not finite. */
export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * This plugin's configuration, with every field at its default.
 *
 * `proxy` empty means "read the environment", which is what almost every user
 * wants: whoever had to configure a proxy for DSH has already exported it.
 * `downloadDir` empty means "ask the host for the pictures directory".
 */
export const CONFIG_DEFAULTS = Object.freeze({
  query: '',
  sort: 'trend',
  tag: '',
  page: 1,
  showAdult: false,
  enabled: false,
  proxy: '',
  downloadDir: '',
  /** The wallhaven-style grid size, in CSS pixels per tile. */
  tileSize: 200,
  /** The last wallpaper applied as the shell background, if any. */
  wallpaper: null,
});

/** Sanitize a string field: non-strings become the fallback, trimmed. */
function stringField(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

/**
 * Merge a partial patch onto a base configuration, forcing every field's type.
 *
 * Mutating a configuration document by hand must never be able to put this
 * plugin into a state it cannot render — so every field is re-derived here
 * rather than spread in.
 *
 * @param patch - the fields to change; may be absent or not an object.
 * @param base - the configuration to merge onto.
 * @returns a fresh, fully-populated configuration.
 */
export function normalizeConfig(patch, base) {
  const source = typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? patch : {};
  const previous = typeof base === 'object' && base !== null ? base : CONFIG_DEFAULTS;

  const pick = (key) => (Object.hasOwn(source, key) ? source[key] : previous[key]);

  const sort = pick('sort');
  const tag = pick('tag');
  const wallpaper = pick('wallpaper');

  return {
    query: stringField(pick('query'), String(previous.query ?? '')),
    sort: SORT_KEYS.includes(sort) ? sort : CONFIG_DEFAULTS.sort,
    tag: TAG_KEYS.includes(tag) ? tag : CONFIG_DEFAULTS.tag,
    page: clampNumber(pick('page'), 1, 100000, 1),
    showAdult: pick('showAdult') === true,
    enabled: pick('enabled') === true,
    proxy: stringField(pick('proxy'), ''),
    downloadDir: stringField(pick('downloadDir'), ''),
    tileSize: clampNumber(pick('tileSize'), 96, 480, CONFIG_DEFAULTS.tileSize),
    // The applied wallpaper is a record or nothing; a malformed one is dropped
    // rather than repaired, because a half-valid background is worse than none.
    wallpaper:
      typeof wallpaper === 'object' && wallpaper !== null && typeof wallpaper['id'] === 'string'
        ? { id: wallpaper['id'], full: String(wallpaper['full'] ?? ''), pageUrl: String(wallpaper['pageUrl'] ?? '') }
        : null,
  };
}

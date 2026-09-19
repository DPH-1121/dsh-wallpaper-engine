/*
 * Client half of `dsh-wallpaper-engine`.
 *
 * One sidebar panel: a grid of Wallpaper Engine workshop wallpapers with a
 * keyword search, a tag filter, four sorts and a jump-to-page pager. Everything
 * is fetched from this plugin's own host route, never from Steam directly — the
 * browser has no business reaching steamcommunity.com, and behind a
 * poisoned-DNS network it cannot.
 *
 * The module is evaluated as a function body inside DSH's module carrier, so
 * there is no top-level `import` here; the shared vocabulary it uses is inlined
 * ahead of it by `scripts/build.mjs`. The carrier hands the body exactly one
 * thing — a `require` — so React is asked for rather than assumed global.
 */

const React = require('react');

const h = React.createElement;

/** The sidebar id and main-panel key. They must match, or the panel never opens. */
const PANEL_ID = 'wpe-workshop';

/** Where this plugin's host routes live. */
const ROUTE = '/plugins/dsh-wallpaper-engine';

/** Steam app id, used for the steam:// subscribe link. */
const STEAM_APPID = '431960';

const CSS = `
.wpe-wrap{display:flex;flex-direction:column;gap:14px;padding:18px;font-size:13px;height:100%;box-sizing:border-box;overflow:auto;color:var(--dsw-alias-label-primary,inherit)}
.wpe-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.wpe-h1{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary,inherit)}
.wpe-subtle{font-size:11.5px;color:var(--dsw-alias-label-tertiary,inherit)}
.wpe-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.wpe-input{flex:1;min-width:170px;padding:8px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font-size:13px;outline:none}
.wpe-input::placeholder{color:var(--dsw-alias-label-caption,rgba(128,128,128,.6))}
.wpe-input:focus{border-color:var(--dsw-alias-state-business-primary,rgba(90,140,255,.7))}
.wpe-select{padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font-size:13px;outline:none;cursor:pointer}
.wpe-select:focus{border-color:var(--dsw-alias-state-business-primary,rgba(90,140,255,.7))}
.wpe-btn{padding:8px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font-size:13px;white-space:nowrap}
.wpe-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.wpe-btn[data-active="1"]{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(90,140,255,.16));border-color:var(--dsw-alias-state-business-primary,rgba(90,140,255,.5))}
.wpe-btn:disabled{opacity:.5;cursor:default}
.wpe-btn.primary{background:var(--dsw-alias-state-business-primary,#4176e6);border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-label-primary-foreground,#fff)}
.wpe-btn.primary:hover{background:var(--dsw-alias-button-info-hover,#679efe)}
.wpe-page-input{width:64px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font-size:13px;text-align:center;outline:none}
.wpe-page-input:focus{border-color:var(--dsw-alias-state-business-primary,rgba(90,140,255,.7))}
.wpe-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;padding:2px 2px 0;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-banner{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-accent,rgba(90,140,255,.1));border:1px solid var(--dsw-alias-border-l2,rgba(90,140,255,.35));line-height:1.55}
.wpe-banner .wpe-bt{font-weight:600;margin-bottom:2px;color:var(--dsw-alias-label-primary,inherit)}
.wpe-banner .wpe-bd{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-banner .wpe-bd a{color:var(--dsw-alias-link,#4176e6)}
.wpe-banner .wpe-bx{margin-left:auto;flex-shrink:0;align-self:flex-start;padding:4px 8px;border-radius:7px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);cursor:pointer;font-size:15px;line-height:1}
.wpe-banner .wpe-bx:hover{color:var(--dsw-alias-label-primary,inherit)}
.wpe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:14px}
.wpe-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:11px;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,transparent);cursor:pointer;padding:0;text-align:left;font:inherit;color:var(--dsw-alias-label-primary,inherit)}
.wpe-card:hover{border-color:var(--dsw-alias-state-business-primary,rgba(90,140,255,.6));background:var(--dsw-alias-interactive-bg-hover,rgba(90,140,255,.08))}
.wpe-thumbbox{position:relative;width:100%;aspect-ratio:16/9;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.18));overflow:hidden}
.wpe-thumb{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s ease}
.wpe-card:hover .wpe-thumb{transform:scale(1.04)}
.wpe-typechip{position:absolute;left:8px;top:8px;padding:2px 7px;border-radius:6px;font-size:10.5px;font-weight:600;letter-spacing:.02em;background:rgba(15,18,24,.72);color:#fff}
.wpe-typechip.video{background:rgba(120,90,220,.9)}
.wpe-typechip.scene{background:rgba(40,140,120,.9)}
.wpe-adultchip{position:absolute;right:8px;top:8px;padding:2px 7px;border-radius:6px;font-size:10.5px;font-weight:600;background:rgba(200,60,60,.9);color:#fff}
.wpe-meta{padding:9px 10px;display:flex;flex-direction:column;gap:5px;flex:1}
.wpe-title{font-weight:600;line-height:1.35;max-height:2.7em;overflow:hidden;word-break:break-word;color:var(--dsw-alias-label-primary,inherit)}
.wpe-sub{font-size:11px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:var(--dsw-alias-label-tertiary,inherit)}
.wpe-tags{font-size:10.5px;display:flex;gap:4px;flex-wrap:wrap;margin-top:auto}
.wpe-tag{padding:1px 6px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-secondary,inherit)}
.wpe-tag.adult{background:rgba(220,80,80,.25);color:var(--dsw-alias-label-primary,inherit)}
.wpe-msg{padding:12px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));line-height:1.6;color:var(--dsw-alias-label-primary,inherit)}
.wpe-msg.err{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,80,80,.14))}
.wpe-note{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,inherit)}
.wpe-spin{color:var(--dsw-alias-label-tertiary,inherit);padding:20px;text-align:center}
.wpe-foot{display:flex;gap:8px;align-items:center;padding-top:2px;flex-wrap:wrap}
.wpe-pagemeta{font-size:11.5px;white-space:nowrap;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-skel{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:11px;overflow:hidden}
.wpe-skel .a{aspect-ratio:16/9;background:linear-gradient(100deg,var(--dsw-alias-bg-skeleton,rgba(128,128,128,.08)) 40%,var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16)) 50%,var(--dsw-alias-bg-skeleton,rgba(128,128,128,.08)) 60%);background-size:200% 100%;animation:wpe-shimmer 1.2s infinite}
.wpe-skel .b{height:12px;margin:10px;border-radius:4px;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.1))}
@keyframes wpe-shimmer{to{background-position:-200% 0}}
.wpe-modal-scrim{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-3,rgba(8,10,14,.55));display:flex;align-items:center;justify-content:center;z-index:90;padding:24px}
.wpe-modal{width:min(860px,100%);max-height:min(86vh,780px);overflow:auto;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 24px 70px rgba(0,0,0,.5))}
.wpe-modal-hero{position:relative;aspect-ratio:16/9;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.15))}
.wpe-modal-hero img{width:100%;height:100%;object-fit:cover;display:block}
.wpe-modal-x{position:absolute;right:12px;top:12px;width:32px;height:32px;border-radius:9px;border:none;background:rgba(8,10,14,.65);color:#fff;font-size:17px;cursor:pointer;line-height:1}
.wpe-modal-x:hover{background:rgba(8,10,14,.85)}
.wpe-modal-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px}
.wpe-modal-title{font-size:16px;font-weight:700;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.wpe-modal-desc{font-size:12.5px;line-height:1.7;white-space:pre-wrap;max-height:180px;overflow:auto;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-modal-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.wpe-stat{padding:9px 11px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.09))}
.wpe-stat .k{font-size:10.5px;margin-bottom:3px;color:var(--dsw-alias-label-tertiary,inherit)}
.wpe-stat .v{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.wpe-modal-actions{display:flex;gap:10px;flex-wrap:wrap}
.wpe-modal-actions .grow{flex:1}
.wpe-gate-scrim{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-3,rgba(8,10,14,.55));display:flex;align-items:center;justify-content:center;z-index:91;padding:24px}
.wpe-gate{width:min(420px,100%);border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,#fff);padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--dsw-shadow-lv3,0 24px 70px rgba(0,0,0,.5))}
.wpe-gate .t{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary,inherit)}
.wpe-gate .d{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-gate ol{margin:0;padding-left:20px;font-size:12.5px;line-height:1.9;color:var(--dsw-alias-label-secondary,inherit)}
.wpe-gate .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
`;

/** The sidebar glyph: a display with a stand. */
function PanelIcon(props) {
  const size = props?.size ?? 18;
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, [
    h('rect', { key: 'a', x: 3, y: 4, width: 18, height: 13, rx: 2 }),
    h('path', { key: 'b', d: 'M8 21h8M12 17v4' }),
  ]);
}

/** The footer quick-action glyph: a shuffle. */
function ShuffleIcon(props) {
  const size = props?.size ?? 18;
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, h('path', { d: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5' }));
}

/** Human-readable byte count. */
function fmtBytes(value) {
  const n = Number(value) || 0;
  if (n <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x >= 10 ? String(Math.round(x)) : x.toFixed(1)} ${units[i]}`;
}

/** Compact subscriber counts. */
function fmtNum(value) {
  const n = Number(value) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** "Scene" → the chip a card shows; keyed off the item's own tags. */
function typeOf(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  if (tags.includes('Video')) return 'video';
  if (tags.includes('Scene')) return 'scene';
  if (tags.includes('Application')) return 'app';
  if (tags.includes('Web')) return 'web';
  return '';
}

const TYPE_LABEL = { video: '视频', scene: '场景', app: '应用', web: '网页' };

/**
 * GET one of this plugin's routes as JSON.
 *
 * @param path - the path beneath the route prefix, query string included.
 * @returns the decoded body, or `null` when it could not be read.
 */
async function getJson(path) {
  try {
    const response = await fetch(`${ROUTE}${path}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Overlay one wallpaper behind the app frame, fading in when it arrives.
 *
 * Used for the detail modal's backdrop blur-free look and nowhere else yet;
 * kept as a component because the modal and any future "wear it" affordance
 * would share exactly this markup.
 */
function Thumb({ item }) {
  return h('img', {
    className: 'wpe-thumb',
    src: item.preview,
    loading: 'lazy',
    alt: item.title,
  });
}

/**
 * The Steam gate dialog: what a user who has no Steam client sees when they
 * try to subscribe.
 *
 * @param props - `{ onClose }`.
 */
function SteamGate(props) {
  return h('div', {
    className: 'wpe-gate-scrim',
    onClick: (e) => { if (e.target === e.currentTarget) props.onClose(); },
  },
    h('div', { className: 'wpe-gate' },
      h('div', { className: 't' }, '订阅需要 Steam'),
      h('div', { className: 'd' }, '浏览和搜索不需要登录；但订阅壁纸必须通过 Steam 完成：'),
      h('ol', null,
        h('li', null, '安装 Steam 客户端（steam 版 Wallpaper Engine 也需要它）'),
        h('li', null, '登录你的 Steam 账号'),
        h('li', null, '拥有 Wallpaper Engine（Steam 商店约 ¥19）'),
      ),
      h('div', { className: 'd' }, '订阅动作会在 Steam 客户端或工坊页面里完成，本插件不接触你的账号凭据。'),
      h('div', { className: 'acts' },
        h('a', { className: 'wpe-btn primary', href: 'https://store.steampowered.com/app/431960/', target: '_blank', rel: 'noreferrer' }, '打开 Steam 商店'),
        h('button', { className: 'wpe-btn', onClick: props.onClose }, '知道了'),
      ),
    ),
  );
}

/**
 * The detail modal for one wallpaper.
 *
 * @param props - `{ item, steamOk, onClose }`; `steamOk` decides whether the
 *   primary action opens `steam://` directly or shows the gate first.
 */
function DetailModal(props) {
  const item = props.item;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return h('div', {
    className: 'wpe-modal-scrim',
    onClick: (e) => { if (e.target === e.currentTarget) props.onClose(); },
  },
    h('div', { className: 'wpe-modal' },
      h('button', {
        className: 'wpe-modal-x',
        'aria-label': '关闭',
        onClick: props.onClose,
      }, '✕'),
      h('div', { className: 'wpe-modal-hero' },
        item.preview !== '' ? h('img', { src: item.preview, alt: item.title }) : null,
      ),
      h('div', { className: 'wpe-modal-body' },
        h('div', { className: 'wpe-modal-title' }, item.title),
        h('div', { className: 'wpe-modal-stats' },
          h('div', { className: 'wpe-stat' }, h('div', { className: 'k' }, '订阅'), h('div', { className: 'v' }, fmtNum(item.subscriptions))),
          h('div', { className: 'wpe-stat' }, h('div', { className: 'k' }, '收藏'), h('div', { className: 'v' }, fmtNum(item.favorited))),
          h('div', { className: 'wpe-stat' }, h('div', { className: 'k' }, '浏览'), h('div', { className: 'v' }, fmtNum(item.views))),
          h('div', { className: 'wpe-stat' }, h('div', { className: 'k' }, '大小'), h('div', { className: 'v' }, fmtBytes(item.sizeBytes))),
        ),
        item.description !== ''
          ? h('div', { className: 'wpe-modal-desc' }, item.description.slice(0, 600))
          : null,
        tags.length > 0
          ? h('div', { className: 'wpe-tags' },
              tags.slice(0, 10).map((tag, i) => h('span', {
                key: `${tag}${i}`,
                className: tag === 'Adult only' ? 'wpe-tag adult' : 'wpe-tag',
              }, tag)))
          : null,
        h('div', { className: 'wpe-modal-actions' },
          props.steamOk
            ? h('a', {
                className: 'wpe-btn primary',
                href: `steam://url/CommunityFilePage/${item.id}`,
                onClick: props.onClose,
              }, '在 Steam 中订阅')
            : h('button', { className: 'wpe-btn primary', onClick: props.onOpen }, '在 Steam 中订阅'),
          h('a', {
            className: 'wpe-btn',
            href: item.pageUrl,
            target: '_blank',
            rel: 'noreferrer',
          }, '在浏览器打开'),
        ),
      ),
    ),
  );
}

/** One page of results, as the pager needs it. */
function Pager(props) {
  const { page, lastPage, total, loading, onGo } = props;
  const [draft, setDraft] = React.useState(String(page));
  React.useEffect(() => { setDraft(String(page)); }, [page]);

  const jump = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1 && (lastPage === 0 || n <= lastPage)) onGo(n);
    else setDraft(String(page));
  };

  return h('div', { className: 'wpe-foot' },
    h('button', {
      className: 'wpe-btn',
      disabled: loading || page <= 1,
      onClick: () => onGo(page - 1),
    }, '←'),
    h('span', { className: 'wpe-pagemeta' },
      lastPage > 0 ? `第 ${page} / ${fmtNum(lastPage)} 页 · 共 ${fmtNum(total)} 项` : `第 ${page} 页`),
    h('button', {
      className: 'wpe-btn',
      disabled: loading || (lastPage > 0 && page >= lastPage) || props.empty,
      onClick: () => onGo(page + 1),
    }, '→'),
    lastPage > 1
      ? h('span', { className: 'wpe-bar' },
          h('input', {
            className: 'wpe-page-input',
            value: draft,
            onChange: (e) => setDraft(e.target.value.replace(/[^\d]/g, '')),
            onKeyDown: (e) => { if (e.key === 'Enter') jump(); },
            'aria-label': '跳转到页',
          }),
          h('button', { className: 'wpe-btn', onClick: jump, disabled: loading }, '跳页'))
      : null,
  );
}

/**
 * The panel body.
 *
 * @param props - slot props; this panel reads none of them.
 */
function Panel(props) {
  void props;
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState('trend');
  const [tag, setTag] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [lastPage, setLastPage] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [firstLoad, setFirstLoad] = React.useState(true);
  const [error, setError] = React.useState('');
  const [hint, setHint] = React.useState('');
  const [showAdult, setShowAdult] = React.useState(false);
  const [steam, setSteam] = React.useState(null);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [gate, setGate] = React.useState(false);

  const steamOk = steam !== null && steam.loggedIn === true;

  const load = React.useCallback(async (q, s, t, p) => {
    setLoading(true);
    setError('');
    setHint('');
    try {
      const params = new URLSearchParams({ sort: s, page: String(p) });
      if (q !== '') params.set('q', q);
      if (t !== '') params.set('tag', t);
      const result = await getJson(`/browse?${params.toString()}`);
      if (result === null) {
        setItems([]);
        setError('无法连接插件宿主：请求没有返回。');
      } else if (result.ok !== true) {
        setItems([]);
        setError(result.reason ?? '加载失败。');
        setHint(result.hint ?? '');
      } else {
        setItems(Array.isArray(result.items) ? result.items : []);
        setLastPage(Number(result.lastPage) || 0);
        setTotal(Number(result.total) || 0);
      }
    } catch (e) {
      setItems([]);
      setError(`请求出错：${String(e?.message ?? e)}`);
    }
    setLoading(false);
    setFirstLoad(false);
  }, []);

  React.useEffect(() => {
    let alive = true;
    getJson('/status?probe=1').then((result) => {
      if (alive && result !== null) setSteam(result.steam ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    load('', 'trend', '', 1);
  }, [load]);

  const doSearch = () => {
    setPage(1);
    load(query, sort, tag, 1);
  };
  const pickSort = (key) => {
    setSort(key);
    setPage(1);
    load(query, key, tag, 1);
  };
  const pickTag = (key) => {
    setTag(key);
    setPage(1);
    load(query, sort, key, 1);
  };
  const goPage = (next) => {
    const clamped = Math.max(1, lastPage > 0 ? Math.min(next, lastPage) : next);
    setPage(clamped);
    load(query, sort, tag, clamped);
  };
  const openDetail = (item) => {
    // The gate appears when there is no Steam session: subscribing without one
    // is the one action this panel cannot complete on its own. Opening a new
    // detail clears a stale gate so the dialogs never stack.
    setGate(false);
    setDetail(item);
  };

  const visible = showAdult ? items : items.filter((item) => item.adult !== true);
  const hiddenAdult = items.length - visible.length;

  return h('div', { className: 'wpe-wrap' },
    h('div', { className: 'wpe-head' },
      h('div', { className: 'wpe-h1' }, 'Wallpaper Engine 创意工坊'),
      h('div', { className: 'wpe-subtle' }, steamOk ? '已检测到 Steam 登录' : '免登录浏览公开资源'),
    ),

    steam !== null && !steamOk && !bannerDismissed
      ? h('div', { className: 'wpe-banner' },
          h('div', null,
            h('div', { className: 'wpe-bt' }, '未检测到 Steam 登录'),
            h('div', { className: 'wpe-bd' },
              '当前为免登录浏览模式，可以搜索和查看所有公开壁纸；订阅壁纸需要安装 Steam 并登录。',
              h('a', {
                href: 'https://store.steampowered.com/about/',
                target: '_blank', rel: 'noreferrer',
                style: { marginLeft: 6 },
              }, '获取 Steam'),
              ' · ',
              h('a', {
                href: 'https://store.steampowered.com/app/431960/',
                target: '_blank', rel: 'noreferrer',
              }, '获取 Wallpaper Engine'),
            ),
          ),
          h('button', {
            className: 'wpe-bx', 'aria-label': '关闭提示',
            onClick: () => setBannerDismissed(true),
          }, '✕'),
        )
      : null,

    h('div', { className: 'wpe-bar' },
      h('input', {
        className: 'wpe-input',
        placeholder: '搜索壁纸，例如：初音未来 / 赛博朋克 / 4K…',
        value: query,
        onChange: (e) => setQuery(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') doSearch();
        },
      }),
      h('select', {
        className: 'wpe-select',
        value: tag,
        onChange: (e) => pickTag(e.target.value),
        'aria-label': '类型筛选',
      }, TAG_FILTERS.map((t) => h('option', { key: t.key || 'all', value: t.key }, t.label))),
      h('button', { className: 'wpe-btn primary', onClick: doSearch, disabled: loading }, '搜索'),
    ),
    h('div', { className: 'wpe-bar' },
      SORTS.map((entry) => h('button', {
        key: entry.key,
        className: 'wpe-btn',
        'data-active': query === '' && sort === entry.key ? '1' : '0',
        onClick: () => pickSort(entry.key),
        disabled: loading,
      }, entry.label)),
      h('button', {
        className: 'wpe-btn',
        'data-active': showAdult ? '1' : '0',
        title: '成人内容需要已登录且开启了社区内容偏好的 Steam 账号',
        onClick: () => setShowAdult((value) => !value),
      }, showAdult ? '成人内容：显示' : '成人内容：隐藏'),
    ),

    !loading && !firstLoad && (total > 0 || items.length > 0)
      ? h('div', { className: 'wpe-stats' },
          h('span', null, `本页 ${String(visible.length)} 项`),
          total > 0 ? h('span', null, `共 ${fmtNum(total)} 项`) : null,
          hiddenAdult > 0 ? h('span', null, `已隐藏 ${String(hiddenAdult)} 项成人内容`) : null,
        )
      : null,

    error !== '' ? h('div', { className: 'wpe-msg err' }, error) : null,
    hint !== '' ? h('div', { className: 'wpe-note' }, hint) : null,

    loading
      ? h('div', { className: 'wpe-grid' },
          Array.from({ length: 9 }, (_, i) => h('div', { className: 'wpe-skel', key: `sk${i}` },
            h('div', { className: 'a' }), h('div', { className: 'b' }))))
      : null,

    !loading && error === '' && visible.length === 0
      ? h('div', { className: 'wpe-msg' }, '没有结果。换个关键词或放宽类型筛选试试。')
      : null,

    !loading
      ? h('div', { className: 'wpe-grid' },
          visible.map((item) => {
            const type = typeOf(item);
            return h('button', {
              className: 'wpe-card',
              key: item.id,
              onClick: () => openDetail(item),
              title: item.title,
            },
              h('div', { className: 'wpe-thumbbox' },
                item.preview !== ''
                  ? h(Thumb, { item })
                  : null,
                type !== ''
                  ? h('span', { className: `wpe-typechip ${type}` }, TYPE_LABEL[type])
                  : null,
                item.adult === true
                  ? h('span', { className: 'wpe-adultchip' }, '18+')
                  : null,
              ),
              h('div', { className: 'wpe-meta' },
                h('div', { className: 'wpe-title' }, item.title),
                h('div', { className: 'wpe-sub' },
                  h('span', null, `ID ${item.id}`),
                  item.sizeBytes ? h('span', null, fmtBytes(item.sizeBytes)) : null,
                  item.subscriptions ? h('span', null, `${fmtNum(item.subscriptions)} 订阅`) : null,
                ),
              ),
            );
          }),
        )
      : null,

    h(Pager, {
      page, lastPage, total, loading,
      empty: visible.length === 0,
      onGo: goPage,
    }),

    detail !== null
      ? h(DetailModal, {
          item: detail,
          steamOk,
          onOpen: () => setGate(true),
          onClose: () => setDetail(null),
        })
      : null,
    gate
      ? h(SteamGate, {
          onClose: () => setGate(false),
        })
      : null,
  );
}

const name = 'dsh-wallpaper-engine';
const inject = ['slots'];

/**
 * Install this panel's stylesheet, returning the disposer that removes it.
 *
 * A real plugin owns its own `<style>` element rather than reaching for the
 * dynamic-plugin sandbox's `styles` helper, which does not exist here. The
 * effect that owns this disposer is what makes the sheet disappear when the
 * plugin unloads, so a reload never leaves two copies of these rules behind.
 *
 * @returns a function that removes the element.
 */
function installStyles() {
  const element = document.createElement('style');
  element.dataset.dshWallpaperEngine = '';
  element.textContent = CSS;
  document.head.append(element);
  return () => {
    element.remove();
  };
}

/**
 * Mount the client half.
 *
 * @param ctx - the client Cordis context.
 */
function apply(ctx) {
  ctx.effect(installStyles, 'dsh-wallpaper-engine: styles');

  // The sidebar leaf and the main panel are two halves of one entry: the id
  // here is what the shell dispatches into `main` when the row is clicked.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 40,
    label: '壁纸工坊',
  }, PanelIcon));

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, Panel));
}

module.exports = { apply, inject, name };

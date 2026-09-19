/*
 * The parsing surface, tested against the shapes Steam actually returns.
 *
 * The fixtures are trimmed copies of real responses — a card anchor from a live
 * browse page, and a `GetPublishedFileDetails` row for a public item — so these
 * tests fail when Steam's markup changes, which is the thing worth knowing.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildBrowseUrl,
  decodeEntities,
  mergeItems,
  normalizeConfig,
  parseFileDetails,
  parseTotalEntries,
  parseWorkshopPage,
  passesAdultFilter,
  publishedFileToWallpaper,
  stripTags,
} from '../src/shared/constants.js';

/** One card exactly as the server-rendered listing emits it. */
const CARD_HTML = '<div class="Panel"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3509243656" class="tK5agp5sRy8-"><img src="https://images.steamusercontent.com/ugc/14437333802904616125/E661D2016D2A20BE15E9B5A4792CA9894279A84E/?ima=fit&amp;impolicy=Letterbox" alt="三体实时演算 | Three-Body problem - SYKM" loading="lazy" class=""/></a></div>';

/** A second card, so ordering and de-duplication can be checked. */
const CARD_HTML_2 = '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3799142774" class="tK5agp5sRy8-"><img src="https://images.steamusercontent.com/ugc/9540179765161089476/4DE4889B4F31581DD70DA81AC75C79BF6B9927F9/" alt="Rhine Lab" loading="lazy" class=""/></a>';

describe('buildBrowseUrl', () => {
  it('browses by sort when there is no query', () => {
    const url = buildBrowseUrl({ sort: 'toprated', page: 1 });
    assert.match(url, /appid=431960/);
    assert.match(url, /browsesort=toprated/);
    assert.doesNotMatch(url, /searchtext/);
    assert.doesNotMatch(url, /p=1/, 'page 1 is the default and is omitted');
  });

  it('pairs a keyword with Steam\'s textsearch sort', () => {
    const url = buildBrowseUrl({ query: '初音未来', sort: 'toprated' });
    assert.match(url, /searchtext=%E5%88%9D%E9%9F%B3%E6%9C%AA%E6%9D%A5/);
    assert.match(url, /browsesort=textsearch/, 'Steam ignores the keyword under any other sort');
  });

  it('adds the page only past the first', () => {
    assert.match(buildBrowseUrl({ page: 3 }), /p=3/);
    assert.doesNotMatch(buildBrowseUrl({ page: 1 }), /p=/);
  });

  it('falls back to trend for an unknown sort', () => {
    assert.match(buildBrowseUrl({ sort: 'nonsense' }), /browsesort=trend/);
  });

  it('appends a known tag filter and drops an unknown one', () => {
    assert.match(buildBrowseUrl({ tag: 'Anime' }), /requiredtags\[\]=Anime/);
    assert.doesNotMatch(buildBrowseUrl({ tag: 'NotATag' }), /requiredtags/);
    assert.doesNotMatch(buildBrowseUrl({ tag: '' }), /requiredtags/);
  });

  it('combines tag with page and sort', () => {
    const url = buildBrowseUrl({ tag: 'Scene', page: 4, sort: 'mostrecent' });
    assert.match(url, /requiredtags\[\]=Scene/);
    assert.match(url, /p=4/);
    assert.match(url, /browsesort=mostrecent/);
  });
});

describe('parseTotalEntries', () => {
  it('reads the Chinese count marker with separators', () => {
    assert.equal(parseTotalEntries('<div>2,892,355 个条目符合筛选条件</div>'), 2892355);
  });

  it('reads the fullwidth-comma variant', () => {
    assert.equal(parseTotalEntries('1，234 个条目'), 1234);
  });

  it('reads the English marker', () => {
    assert.equal(parseTotalEntries('Showing 1-30 of 4,621 entries'), 4621);
  });

  it('returns zero for junk or empty', () => {
    assert.equal(parseTotalEntries('no marker here'), 0);
    assert.equal(parseTotalEntries(''), 0);
    assert.equal(parseTotalEntries(null), 0);
    assert.equal(parseTotalEntries('ab,c 个条目'), 0);
  });
});

describe('text helpers', () => {
  it('decodes the entities Steam emits', () => {
    assert.equal(decodeEntities('a &amp; b &quot;c&quot; &#39;d&#39;'), 'a & b "c" \'d\'');
  });

  it('drops BBCode and tags but keeps the words', () => {
    assert.equal(stripTags('[h2]Title[/h2]<br/>line [url=X]link[/url]'), 'Title\nline link');
  });
});

describe('parseWorkshopPage', () => {
  it('reads id, title and preview from a card', () => {
    const items = parseWorkshopPage(CARD_HTML);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, '3509243656');
    assert.equal(items[0].title, '三体实时演算 | Three-Body problem - SYKM');
    assert.match(items[0].preview, /^https:\/\/images\.steamusercontent\.com\//);
    assert.doesNotMatch(items[0].preview, /&amp;/, 'the preview URL is decoded');
    assert.equal(items[0].pageUrl, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3509243656');
  });

  it('keeps page order and removes duplicates', () => {
    const items = parseWorkshopPage(`${CARD_HTML}${CARD_HTML_2}${CARD_HTML}`);
    assert.deepEqual(items.map((item) => item.id), ['3509243656', '3799142774']);
  });

  it('returns nothing for a page with no cards', () => {
    assert.deepEqual(parseWorkshopPage('<html><body>no items</body></html>'), []);
    assert.deepEqual(parseWorkshopPage(''), []);
    assert.deepEqual(parseWorkshopPage(null), []);
  });
});

describe('publishedFileToWallpaper', () => {
  const row = {
    publishedfileid: '3509243656',
    result: 1,
    title: '三体实时演算',
    description: '[b]desc[/b]<br>second',
    preview_url: 'https://images.steamusercontent.com/ugc/x/',
    file_size: '159345938',
    subscriptions: 1303753,
    favorited: 58209,
    views: 141205,
    tags: [{ tag: 'Scene' }, { tag: 'Everyone' }],
    banned: 0,
    time_created: 1750958279,
    hcontent_file: '6802796996654610456',
  };

  it('normalizes a public row', () => {
    const item = publishedFileToWallpaper(row);
    assert.equal(item.id, '3509243656');
    assert.equal(item.sizeBytes, 159345938);
    assert.equal(item.subscriptions, 1303753);
    assert.deepEqual(item.tags, ['Scene', 'Everyone']);
    assert.equal(item.adult, false);
    assert.equal(item.hasFileHandle, true);
    assert.equal(item.description, 'desc\nsecond');
  });

  it('flags the Adult only audience tag', () => {
    const item = publishedFileToWallpaper({ ...row, tags: [{ tag: 'Adult only' }] });
    assert.equal(item.adult, true);
  });

  it('drops rows Steam says are not accessible', () => {
    // result 9 is what an anonymous caller gets for a private or missing item.
    assert.equal(publishedFileToWallpaper({ ...row, result: 9 }), null);
    assert.equal(publishedFileToWallpaper({ ...row, publishedfileid: 'abc' }), null);
    assert.equal(publishedFileToWallpaper(null), null);
  });
});

describe('parseFileDetails', () => {
  it('parses a raw response body as well as a decoded one', () => {
    const payload = JSON.stringify({ response: { publishedfiledetails: [
      { publishedfileid: '1', result: 1, title: 'ok' },
      { publishedfileid: '2', result: 9 },
    ] } });
    assert.equal(parseFileDetails(payload).length, 1, 'the inaccessible row is dropped');
    assert.equal(parseFileDetails(JSON.parse(payload)).length, 1);
    assert.deepEqual(parseFileDetails('not json'), []);
    assert.deepEqual(parseFileDetails({}), []);
  });

  it('returns nothing when the response envelope is missing', () => {
    assert.deepEqual(parseFileDetails(JSON.stringify({ response: {} })), []);
    assert.deepEqual(parseFileDetails(JSON.stringify({ publishedfiledetails: [] })), []);
  });
});

describe('mergeItems', () => {
  it('keeps listing order and the sized preview', () => {
    const cards = parseWorkshopPage(`${CARD_HTML}${CARD_HTML_2}`);
    const details = [
      { id: '3799142774', subscriptions: 5, preview: 'https://images.steamusercontent.com/orig/' },
      { id: '3509243656', subscriptions: 9, preview: 'https://images.steamusercontent.com/orig/' },
    ];
    const merged = mergeItems(cards, details);
    assert.deepEqual(merged.map((item) => item.id), ['3509243656', '3799142774']);
    assert.equal(merged[0].subscriptions, 9);
    assert.match(merged[0].preview, /images\.steamusercontent\.com/, 'the card preview wins over the API original');
  });

  it('keeps a card the API omitted', () => {
    const cards = parseWorkshopPage(CARD_HTML);
    const merged = mergeItems(cards, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, '三体实时演算 | Three-Body problem - SYKM');
  });
});

describe('passesAdultFilter', () => {
  it('hides adult items unless asked', () => {
    assert.equal(passesAdultFilter({ adult: true }, false), false);
    assert.equal(passesAdultFilter({ adult: true }, true), true);
    assert.equal(passesAdultFilter({ adult: false }, false), true);
  });
});

describe('normalizeConfig', () => {
  it('fills every field from defaults', () => {
    const config = normalizeConfig({}, undefined);
    assert.equal(config.sort, 'trend');
    assert.equal(config.tag, '');
    assert.equal(config.page, 1);
    assert.equal(config.showAdult, false);
    assert.equal(config.tileSize, 200);
    assert.equal(config.wallpaper, null);
  });

  it('rejects a sort Steam does not have, and clamps the page', () => {
    const config = normalizeConfig({ sort: 'evil', page: -5, tileSize: 100000 }, undefined);
    assert.equal(config.sort, 'trend');
    assert.equal(config.page, 1);
    assert.equal(config.tileSize, 480);
  });

  it('keeps a known tag and drops an unknown one', () => {
    assert.equal(normalizeConfig({ tag: 'Anime' }, undefined).tag, 'Anime');
    assert.equal(normalizeConfig({ tag: 'Nope' }, undefined).tag, '');
  });

  it('drops a malformed wallpaper rather than repairing it', () => {
    assert.equal(normalizeConfig({ wallpaper: { nope: true } }, undefined).wallpaper, null);
    const good = normalizeConfig({ wallpaper: { id: '42', full: 'u', pageUrl: 'p' } }, undefined);
    assert.deepEqual(good.wallpaper, { id: '42', full: 'u', pageUrl: 'p' });
  });

  it('ignores a non-object patch', () => {
    const config = normalizeConfig('nonsense', undefined);
    assert.equal(config.sort, 'trend');
  });
});

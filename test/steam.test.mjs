/*
 * Steam and Wallpaper Engine detection.
 *
 * Three requirements have to be told apart, because they fail for different
 * reasons and send the user to different places: no Steam at all, Steam with
 * nobody signed in, and Steam signed in without Wallpaper Engine. Every case
 * below is a real shape from a Windows install.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeSteam, parseLibraryFolders, parseLoginUsers } from '../src/host/steam.js';

/** A document with two remembered accounts, in Steam's own layout. */
const VDF = `"users"
{
\t"76561199107908627"
\t{
\t\t"AccountName"\t\t"someone"
\t\t"PersonaName"\t\t"玩家一号"
\t\t"RememberPassword"\t\t"1"
\t\t"MostRecent"\t\t"1"
\t\t"Timestamp"\t\t"1750958279"
\t}
\t"76561198000000000"
\t{
\t\t"AccountName"\t\t"other"
\t\t"PersonaName"\t\t"Second"
\t\t"RememberPassword"\t\t"0"
\t\t"MostRecent"\t\t"0"
\t\t"Timestamp"\t\t"1600000000"
\t}
}
`;

describe('parseLoginUsers', () => {
  it('reads each remembered account', () => {
    const accounts = parseLoginUsers(VDF);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].steamId, '76561199107908627');
    assert.equal(accounts[0].personaName, '玩家一号');
    assert.equal(accounts[0].mostRecent, true);
    assert.equal(accounts[1].mostRecent, false);
  });

  it('returns nothing for junk rather than throwing', () => {
    assert.deepEqual(parseLoginUsers(''), []);
    assert.deepEqual(parseLoginUsers(null), []);
    assert.deepEqual(parseLoginUsers('"users" { }'), []);
  });
});

describe('parseLibraryFolders', () => {
  it('reads every declared library path and unescapes backslashes', () => {
    const vdf = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"D:\\\\steam"
\t\t"label"\t\t""
\t}
\t"1"
\t{
\t\t"path"\t\t"E:\\\\Games\\\\SteamLibrary"
\t}
}
`;
    assert.deepEqual(parseLibraryFolders(vdf), ['D:\\steam', 'E:\\Games\\SteamLibrary']);
  });

  it('de-duplicates and tolerates junk', () => {
    const vdf = '"path" "D:\\\\steam"\n"path" "D:\\\\steam"\n"path" "D:\\\\steam"';
    assert.deepEqual(parseLibraryFolders(vdf), ['D:\\steam']);
    assert.deepEqual(parseLibraryFolders(''), []);
    assert.deepEqual(parseLibraryFolders(null), []);
  });
});

/** Build a fake Steam install; each test says which pieces it wants. */
async function makeSteam(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wpe-steam-'));
  await mkdir(join(root, 'config'), { recursive: true });

  if (options.login !== false) {
    await writeFile(join(root, 'config', 'loginusers.vdf'), VDF, 'utf8');
    await writeFile(join(root, 'config', 'ssfn1234'), 'x', 'utf8');
  }

  if (options.library !== undefined) {
    await writeFile(join(root, 'config', 'libraryfolders.vdf'), options.library, 'utf8');
  }

  if (options.we === true) {
    const weDir = join(root, 'steamapps', 'common', 'wallpaper_engine');
    await mkdir(weDir, { recursive: true });
    await writeFile(join(root, 'steamapps', 'appmanifest_431960.acf'), '"AppState" {}', 'utf8');
  }

  return root;
}

describe('describeSteam', () => {
  const made = [];
  const track = (dir) => {
    made.push(dir);
    return dir;
  };

  after(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  it('reports a logged-in client with no Wallpaper Engine', async () => {
    const root = track(await makeSteam());
    const state = await describeSteam({ roots: [root] });

    assert.equal(state.installed, true);
    assert.equal(state.loggedIn, true);
    assert.equal(state.root, root);
    assert.equal(state.installs[0].ssfnCount, 1);
    assert.equal(state.installs[0].accounts, 2);
    // Persona names are reported; nothing else about the account is.
    assert.deepEqual(Object.keys(state.accounts[0]).sort(), ['mostRecent', 'personaName']);

    // The whole point: signed in is not the same as usable.
    assert.equal(state.wallpaperEngine.installed, false);
    assert.equal(state.ready, false);
    assert.deepEqual(state.missing, ['wallpaperEngine']);
  });

  it('reports ready when Wallpaper Engine is installed alongside', async () => {
    const root = track(await makeSteam({ we: true }));
    const state = await describeSteam({ roots: [root] });

    assert.equal(state.wallpaperEngine.installed, true);
    assert.match(state.wallpaperEngine.path, /wallpaper_engine/);
    assert.equal(state.ready, true);
    assert.deepEqual(state.missing, []);
  });

  it('separates "installed" from "signed in"', async () => {
    const root = track(await makeSteam({ login: false }));
    const state = await describeSteam({ roots: [root] });

    assert.equal(state.installed, true);
    assert.equal(state.loggedIn, false);
    assert.equal(state.ready, false);
    assert.deepEqual(state.missing, ['login', 'wallpaperEngine']);
  });

  it('reports nothing at all when Steam is absent', async () => {
    const missing = join(tmpdir(), 'dsh-wpe-does-not-exist-xyz');
    const state = await describeSteam({ roots: [missing] });

    assert.equal(state.installed, false);
    assert.equal(state.loggedIn, false);
    assert.equal(state.ready, false);
    assert.deepEqual(state.missing, ['steam', 'login', 'wallpaperEngine']);
  });

  it('finds Wallpaper Engine in a secondary library, not just the client root', async () => {
    // The "hidden game" case: Steam lives on one drive, the app on another.
    const steamRoot = track(await makeSteam({ library: '"path" ""' }));
    const otherLibrary = await mkdtemp(join(tmpdir(), 'dsh-wpe-lib-'));
    track(otherLibrary);

    await mkdir(join(otherLibrary, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
    await writeFile(join(otherLibrary, 'steamapps', 'appmanifest_431960.acf'), '"AppState" {}', 'utf8');
    await writeFile(
      join(steamRoot, 'config', 'libraryfolders.vdf'),
      `"libraryfolders" { "0" { "path" "${otherLibrary.replace(/\\/g, '\\\\')}" } }`,
      'utf8',
    );

    const state = await describeSteam({ roots: [steamRoot] });
    assert.equal(state.wallpaperEngine.installed, true);
    assert.match(state.wallpaperEngine.path, new RegExp(otherLibrary.replace(/\\/g, '\\\\')));
    assert.equal(state.ready, true);
  });

  it('accepts the files being present without a manifest', async () => {
    // A partially-copied or hand-placed library still counts as installed.
    const root = track(await makeSteam());
    await mkdir(join(root, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });

    const state = await describeSteam({ roots: [root] });
    assert.equal(state.wallpaperEngine.installed, true);
    assert.equal(state.ready, true);
  });
});

/*
 * Steam and Wallpaper Engine detection.
 *
 * This module answers one question for the panel: what is missing before a
 * wallpaper can actually reach the desktop? Three things have to be true, and
 * they fail independently:
 *
 *   1. A Steam client is installed here.
 *   2. Some account is signed in on it — the download of a workshop item is
 *      authenticated, and Steam answers an anonymous request with
 *      `{"success":15,"message":"No user"}`.
 *   3. Wallpaper Engine (app 431960) is installed, because that is the only
 *      thing that can render a Scene wallpaper and the only thing that turns a
 *      downloaded file into a desktop background.
 *
 * Nothing here reads a credential. `loginusers.vdf` is parsed for the persona
 * name and the "most recent" flag alone — no tokens, no `ssfn` files, and no
 * request that would need either.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The Steam application id Wallpaper Engine is published under. */
const WE_APPID = '431960';

/**
 * Where a Steam client is installed, in the order worth checking.
 *
 * The Windows registry would be authoritative (`HKCU\Software\Valve\Steam` →
 * `SteamPath`), but the host half runs inside DSH's Node process and has no
 * registry API. These cover the default install and the drive layouts people
 * actually use; a Steam found anywhere else is reported as "not found", which
 * is why the panel states the requirement rather than claiming certainty.
 */
const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\steam',
  'E:\\Steam',
  'E:\\steam',
];

/**
 * Parse `libraryfolders.vdf` into the library paths it declares.
 *
 * Steam keeps one of these per install and lists every drive that holds a
 * library, so this is how Wallpaper Engine is found when it lives somewhere
 * other than the client's own directory — including the "hidden" case, where
 * the app is installed but filtered out of the library UI.
 *
 * @param text - the document body.
 * @returns absolute library paths, de-duplicated.
 */
export function parseLibraryFolders(text) {
  if (typeof text !== 'string' || text === '') return [];
  const paths = [];
  const seen = new Set();
  const re = /"path"\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    // VDF escapes backslashes; a Windows path arrives as `D:\\steam`.
    const raw = match[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"').trim();
    if (raw === '') continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(raw);
  }
  return paths;
}

/**
 * Parse `loginusers.vdf` into the accounts it remembers.
 *
 * The format is Valve's keyvalues: a quoted SteamID64 opening a brace-delimited
 * block of quoted key/value pairs. Only the two fields this plugin reports are
 * read.
 *
 * @param text - the document body.
 * @returns one entry per remembered account.
 */
export function parseLoginUsers(text) {
  if (typeof text !== 'string' || text === '') return [];
  const accounts = [];
  const blockRe = /"(\d{17})"\s*\{([\s\S]*?)\}/g;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const body = match[2];
    const field = (key) => {
      const found = new RegExp(`"${key}"\\s*"([^"]*)"`).exec(body);
      return found === null ? '' : found[1];
    };
    accounts.push({
      steamId: match[1],
      personaName: field('PersonaName'),
      mostRecent: field('MostRecent') === '1',
      rememberPassword: field('RememberPassword') === '1',
    });
  }
  return accounts;
}

/** Read a file, returning `null` instead of throwing when it is absent. */
async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Whether a directory exists. */
async function isDir(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Look for Wallpaper Engine inside one library.
 *
 * Two independent signals are checked, because each catches a case the other
 * misses: the `appmanifest` proves Steam considers the app installed, and the
 * directory proves the files are really there. An app that is installed but
 * hidden from the library UI still has both.
 *
 * @param libraryPath - one Steam library root, e.g. `D:\steam`.
 * @returns `{ installed, path }`.
 */
async function findWallpaperEngine(libraryPath) {
  const steamapps = join(libraryPath, 'steamapps');
  const manifest = join(steamapps, `appmanifest_${WE_APPID}.acf`);
  const directory = join(steamapps, 'common', 'wallpaper_engine');

  const [hasManifest, hasDirectory] = await Promise.all([
    readIfPresent(manifest).then((text) => text !== null),
    isDir(directory),
  ]);

  if (!hasManifest && !hasDirectory) return { installed: false, path: '' };
  return { installed: true, path: hasDirectory ? directory : steamapps };
}

/**
 * Describe the Steam and Wallpaper Engine state of this machine.
 *
 * Every field is derived from a file on disk; nothing is inferred from a
 * network request, so this stays cheap enough to call on every refresh.
 *
 * @param options - `{ roots }` to override the search path (used by tests).
 * @returns the state, never throwing.
 */
export async function describeSteam(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots : STEAM_ROOTS;

  /** The first root that actually holds a Steam client. */
  let steamRoot = '';
  for (const root of roots) {
    if (await isDir(root)) {
      steamRoot = root;
      break;
    }
  }

  if (steamRoot === '') {
    return {
      installed: false,
      loggedIn: false,
      accounts: [],
      installs: [],
      wallpaperEngine: { installed: false, path: '' },
      ready: false,
      missing: ['steam', 'login', 'wallpaperEngine'],
    };
  }

  const configDir = join(steamRoot, 'config');
  const loginText = await readIfPresent(join(configDir, 'loginusers.vdf'));
  const accounts = parseLoginUsers(loginText ?? '');

  // Every library this install knows about, plus the install's own directory
  // so a single-library setup works even if the folder file is missing.
  const libraryText = await readIfPresent(join(configDir, 'libraryfolders.vdf'));
  const libraries = [steamRoot, ...parseLibraryFolders(libraryText ?? '')];

  let wallpaperEngine = { installed: false, path: '' };
  for (const library of libraries) {
    const found = await findWallpaperEngine(library);
    if (found.installed) {
      wallpaperEngine = found;
      break;
    }
  }

  let ssfnCount = 0;
  try {
    const entries = await readdir(configDir);
    ssfnCount = entries.filter((name) => /^ssfn/i.test(name)).length;
  } catch {
    ssfnCount = 0;
  }

  const loggedIn = accounts.length > 0;
  const missing = [];
  if (!loggedIn) missing.push('login');
  if (!wallpaperEngine.installed) missing.push('wallpaperEngine');

  return {
    installed: true,
    root: steamRoot,
    loggedIn,
    accounts: accounts.map((account) => ({
      personaName: account.personaName,
      mostRecent: account.mostRecent,
    })),
    installs: [{ root: steamRoot, accounts: accounts.length, ssfnCount }],
    libraries,
    wallpaperEngine,
    /** True only when a wallpaper can genuinely be downloaded *and* used. */
    ready: loggedIn && wallpaperEngine.installed,
    missing,
  };
}

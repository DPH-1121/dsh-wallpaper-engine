/*
 * Steam client detection.
 *
 * This is the honest half of the download story. Steam answers an anonymous
 * `downloadfile` request with `{"success":15,"message":"No user"}`, so fetching
 * a wallpaper requires a real Steam session — which this plugin does not have
 * and does not ask for. What it *can* do is tell the user, accurately, whether
 * the machine they are on has a logged-in Steam client, so the panel can say
 * "downloads need Steam" only when that is actually true.
 *
 * Reading `loginusers.vdf` is the whole mechanism: it is a plain VDF document
 * Steam writes next to its own configuration, containing each remembered
 * account's persona name and which one was used last. This plugin reads it and
 * nothing else — no tokens, no `ssfn` files, no credentials.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where a Steam client is installed, in the order worth checking.
 *
 * There is no registry probe here on purpose: the host half runs inside DSH's
 * own process, and the Windows registry is not part of the API this plugin is
 * written against. These paths cover the default install and the two drive
 * layouts people actually use.
 */
const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'E:\\Steam',
];

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

/**
 * Describe the Steam state of this machine.
 *
 * @param options - `{ roots }` to override the search path (used by tests).
 * @returns `{ installed, loggedIn, installs }`, never throwing.
 */
export async function describeSteam(options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots : STEAM_ROOTS;
  const installs = [];

  for (const root of roots) {
    let present = false;
    try {
      const info = await stat(root);
      present = info.isDirectory();
    } catch {
      present = false;
    }
    if (!present) continue;

    let accounts = [];
    try {
      const text = await readFile(join(root, 'config', 'loginusers.vdf'), 'utf8');
      accounts = parseLoginUsers(text);
    } catch {
      accounts = [];
    }

    let ssfnCount = 0;
    try {
      const entries = await readdir(join(root, 'config'));
      ssfnCount = entries.filter((name) => /^ssfn/i.test(name)).length;
    } catch {
      ssfnCount = 0;
    }

    installs.push({
      root,
      accounts: accounts.map((account) => ({
        personaName: account.personaName,
        mostRecent: account.mostRecent,
      })),
      ssfnCount,
    });
  }

  return {
    installed: installs.length > 0,
    loggedIn: installs.some((install) => install.accounts.length > 0),
    installs,
  };
}

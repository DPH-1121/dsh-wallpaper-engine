/*
 * Steam client detection.
 *
 * `parseLoginUsers` is tested against a document shaped like the one Steam
 * writes, because the parser's job is to survive a format it does not control.
 * `describeSteam` is pointed at a temporary directory so the test never reads
 * the machine's real Steam install.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeSteam, parseLoginUsers } from '../src/host/steam.js';

/** A document with one remembered account, in Steam's own layout. */
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

describe('describeSteam', () => {
  let root;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-wpe-steam-'));
    await mkdir(join(root, 'config'), { recursive: true });
    await writeFile(join(root, 'config', 'loginusers.vdf'), VDF, 'utf8');
    await writeFile(join(root, 'config', 'ssfn1234'), 'x', 'utf8');
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports an installed, logged-in client', async () => {
    const state = await describeSteam({ roots: [root] });
    assert.equal(state.installed, true);
    assert.equal(state.loggedIn, true);
    assert.equal(state.installs.length, 1);
    assert.equal(state.installs[0].accounts.length, 2);
    assert.equal(state.installs[0].ssfnCount, 1);
    // Persona names are reported; nothing else about the account is.
    assert.deepEqual(Object.keys(state.installs[0].accounts[0]).sort(), ['mostRecent', 'personaName']);
  });

  it('reports nothing for a root that does not exist', async () => {
    const state = await describeSteam({ roots: [join(root, 'nope')] });
    assert.equal(state.installed, false);
    assert.equal(state.loggedIn, false);
    assert.deepEqual(state.installs, []);
  });

  it('separates "installed" from "logged in"', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'dsh-wpe-steam-empty-'));
    try {
      await mkdir(join(empty, 'config'), { recursive: true });
      const state = await describeSteam({ roots: [empty] });
      assert.equal(state.installed, true, 'the directory exists');
      assert.equal(state.loggedIn, false, 'but nobody is remembered');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

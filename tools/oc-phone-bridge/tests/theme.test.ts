import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTheme } from '../src/routes/theme.js';

let dir: string;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bridge-theme-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('theme: 404 paths', () => {
  it('404s with name:null when tui.json is absent', async () => {
    await assert.rejects(() => getTheme(dir), (e: unknown) => {
      const err = e as { status?: number; name?: unknown; message?: string };
      assert.equal(err.status, 404);
      assert.equal(err.name, null);
      assert.match(String(err.message), /tui\.json not found/);
      return true;
    });
  });
  it('404s with name:null when tui.json has no theme field', async () => {
    await writeFile(path.join(dir, 'tui.json'), JSON.stringify({ scroll_speed: 2 }));
    await assert.rejects(() => getTheme(dir), (e: unknown) => {
      assert.equal((e as { status?: number }).status, 404);
      assert.equal((e as { name?: unknown }).name, null);
      return true;
    });
  });
  it('404s with the theme name when the theme file is missing', async () => {
    await writeFile(path.join(dir, 'tui.json'), JSON.stringify({ theme: 'tokyonight' }));
    await assert.rejects(() => getTheme(dir), (e: unknown) => {
      const err = e as { status?: number; name?: unknown };
      assert.equal(err.status, 404);
      assert.equal(err.name, 'tokyonight');
      return true;
    });
  });
  it('returns {name, json} when both files exist', async () => {
    await mkdir(path.join(dir, 'themes'), { recursive: true });
    const themeJson = { primary: { fg: '#c0caf5' } };
    await writeFile(path.join(dir, 'themes', 'tokyonight.json'), JSON.stringify(themeJson));
    assert.deepEqual(await getTheme(dir), { name: 'tokyonight', json: themeJson });
  });
});

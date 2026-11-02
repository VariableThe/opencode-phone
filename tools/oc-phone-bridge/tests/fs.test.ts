import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDir, readTextFile } from '../src/routes/fs.js';

let root: string;
let outside: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'bridge-allowed-'));
  outside = await mkdtemp(path.join(tmpdir(), 'bridge-outside-'));
  await writeFile(path.join(root, 'hello.txt'), 'hello world');
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'inner.txt'), 'inner');
  await writeFile(path.join(outside, 'secret.txt'), 'top secret');
  await symlink(outside, path.join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink('loop', path.join(root, 'loop'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('fs: allowed-root enforcement', () => {
  it('lists a directory inside the root', async () => {
    const out = await listDir(root, [root]);
    assert.equal(out.path, root);
    assert.deepEqual(
      out.entries.map((e) => e.name),
      ['hello.txt', 'loop', 'outside-link', 'sub'],
    );
    const link = out.entries.find((e) => e.name === 'outside-link');
    assert.deepEqual(
      link && { name: link.name, type: link.type, size: link.size },
      { name: 'outside-link', type: 'other', size: null },
    );
  });
  it('reads a file inside the root', async () => {
    const out = await readTextFile(path.join(root, 'hello.txt'), [root]);
    assert.equal(out.content, 'hello world');
  });
  it('rejects paths outside the roots', async () => {
    await assert.rejects(() => listDir(path.join(outside, 'secret.txt'), [root]), (e: unknown) => {
      const err = e as Error & { status?: number };
      assert.equal(err.status, 403);
      return true;
    });
    await assert.rejects(() => readTextFile('/etc/hostname', [root]), /outside the allowed roots/);
  });
  it('rejects path traversal (.. escapes)', async () => {
    const traversal = path.join(root, 'sub', '..', '..', 'outside-x');
    await assert.rejects(() => listDir(traversal, [root]), /outside the allowed roots/);
    // sneaky: a sibling whose name merely starts with the root string
    await assert.rejects(() => listDir(root + '-evil', [root]), /outside the allowed roots/);
  });
  it('rejects a symlink inside an allowed root that points outside it', async () => {
    await assert.rejects(() => readTextFile(path.join(root, 'outside-link', 'secret.txt'), [root]), (e: unknown) => {
      assert.equal((e as { status?: number }).status, 403);
      return true;
    });
  });
  it('rejects an unresolved symlink loop instead of falling back to its lexical path', async () => {
    await assert.rejects(() => readTextFile(path.join(root, 'loop'), [root]), (e: unknown) => {
      assert.equal((e as { status?: number }).status, 403);
      return true;
    });
  });
  it('denies everything when no roots are configured', async () => {
    await assert.rejects(() => listDir(root, []), /outside the allowed roots/);
  });
  it('requires a path and distinguishes files from dirs', async () => {
    await assert.rejects(() => listDir('', [root]), /`path` is required/);
    await assert.rejects(() => listDir(path.join(root, 'hello.txt'), [root]), /not a directory/);
    await assert.rejects(() => readTextFile(root, [root]), /not a file/);
    await assert.rejects(() => readTextFile(path.join(root, 'nope.txt'), [root]), (e: unknown) => {
      assert.equal((e as { status?: number }).status, 404);
      return true;
    });
  });
});

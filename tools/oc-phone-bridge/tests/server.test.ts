import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import type { BridgeConfig } from '../src/config.js';
import { setTmuxRunner, TmuxError } from '../src/tmux.js';

const TOKEN = 'test-token-'.padEnd(32, 'x');

let baseUrl = '';
let server: ReturnType<typeof createApp>;
let allowedRoot: string;

async function req(
  urlPath: string,
  init: RequestInit = {},
  token: string | null = TOKEN,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(baseUrl + urlPath, { ...init, headers });
  return { status: res.status, json: await res.json() };
}

before(async () => {
  allowedRoot = await mkdtemp(path.join(tmpdir(), 'bridge-srv-'));
  await writeFile(path.join(allowedRoot, 'note.txt'), 'hi');
  setTmuxRunner(async (args) => {
    if (args[0] === '-V') return { stdout: 'tmux 3.4\n', stderr: '' };
    if (args[0] === 'list-panes') return { stdout: 'work|1700000000|1|1|opencode\n', stderr: '' };
    if (args[0] === 'capture-pane') return { stdout: 'pane-output\n', stderr: '' };
    if (args[0] === 'new-session') return { stdout: '', stderr: '' };
    if (args[0] === 'kill-session') {
      throw new TmuxError("tmux kill-session failed: can't find session: ghost");
    }
    return { stdout: '', stderr: '' };
  });
  const config: BridgeConfig = {
    token: TOKEN,
    host: '127.0.0.1',
    port: 0,
    allowedRoots: [allowedRoot],
    version: '0.1.0',
  };
  // Point theme lookup at an empty dir so /theme deterministically 404s.
  server = createApp(config, { openCodeConfigDir: allowedRoot });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setTmuxRunner(null);
  await new Promise((resolve) => server.close(resolve));
  await rm(allowedRoot, { recursive: true, force: true });
});

describe('server: auth gate', () => {
  it('401s without a token, with a wrong token, and with a malformed header', async () => {
    for (const t of [null, 'wrong-token-that-is-long-enough-123', '']) {
      const { status, json } = await req('/health', {}, t);
      assert.equal(status, 401);
      assert.equal((json as { code?: string }).code, 'UNAUTHORIZED');
    }
    const res = await fetch(baseUrl + '/health', { headers: { authorization: 'Basic abc' } });
    assert.equal(res.status, 401);
  });
  it('accepts the valid token', async () => {
    const { status, json } = await req('/health');
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: true, version: '0.1.0', tmux: 'tmux 3.4' });
  });
});

describe('server: routes', () => {
  it('GET /tmux lists sessions', async () => {
    const { status, json } = await req('/tmux');
    assert.equal(status, 200);
    assert.deepEqual(json, {
      sessions: [{ name: 'work', created: 1700000000, paneCommand: 'opencode', isOpencode: true }],
    });
  });
  it('POST /tmux rejects injection names with 400', async () => {
    const { status, json } = await req(
      '/tmux',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '; rm -rf ~' }),
      },
    );
    assert.equal(status, 400);
    assert.equal((json as { code?: string }).code, 'INVALID_SESSION_NAME');
  });
  it('POST /tmux rejects non-JSON content types', async () => {
    const { status } = await req(
      '/tmux',
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"name":"x"}' },
    );
    assert.equal(status, 400);
  });
  it('POST /tmux creates a session (201)', async () => {
    const { status, json } = await req(
      '/tmux',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'work2' }),
      },
    );
    assert.equal(status, 201);
    assert.deepEqual(json, { name: 'work2' });
  });
  it('GET /tmux/:name/tail enforces the line cap', async () => {
    const ok = await req('/tmux/work/tail?lines=10');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { name: 'work', lines: 10, output: 'pane-output\n' });
    const capped = await req('/tmux/work/tail?lines=99999');
    assert.equal(capped.status, 400);
    assert.equal((capped.json as { code?: string }).code, 'INVALID_LINES');
  });
  it('DELETE /tmux/:name maps missing sessions to 404', async () => {
    const { status } = await req('/tmux/ghost', { method: 'DELETE' });
    assert.equal(status, 404);
  });
  it('GET /fs/read rejects traversal outside the roots', async () => {
    const { status, json } = await req('/fs/read?path=' + encodeURIComponent('/etc/hostname'));
    assert.equal(status, 403);
    assert.equal((json as { code?: string }).code, 'PATH_FORBIDDEN');
  });
  it('GET /fs/list serves files inside the roots', async () => {
    const { status, json } = await req('/fs/list?path=' + encodeURIComponent(allowedRoot));
    assert.equal(status, 200);
    assert.equal((json as { entries?: unknown[] }).entries?.length, 1);
  });
  it('GET /theme surfaces the 404 path with name:null', async () => {
    const { status, json } = await req('/theme');
    assert.equal(status, 404);
    assert.equal((json as { name?: unknown }).name, null);
  });
  it('unknown routes 404 as JSON', async () => {
    const { status, json } = await req('/nope');
    assert.equal(status, 404);
    assert.equal((json as { code?: string }).code, 'NOT_FOUND');
  });
});

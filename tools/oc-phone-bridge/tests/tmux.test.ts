import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  TmuxError,
  isOpencodeCommand,
  isValidSessionName,
  listSessions,
  newSession,
  killSession,
  tailSession,
  parseTailLines,
  getTmuxVersion,
  setTmuxRunner,
  type TmuxRunner,
} from '../src/tmux.js';

function stubRunner(impl: TmuxRunner): void {
  setTmuxRunner(impl);
}

afterEach(() => setTmuxRunner(null));

describe('tmux: session name validation', () => {
  it('accepts plain names', () => {
    assert.equal(isValidSessionName('opencode-1'), true);
    assert.equal(isValidSessionName('ABC_xyz09'), true);
  });
  it('rejects shell metacharacters and traversal', () => {
    for (const bad of [
      '; rm -rf ~',
      '$(rm -rf ~)',
      '`id`',
      'a;b',
      'a|b',
      'a&b',
      'a b',
      '../etc',
      '/tmp/x',
      'a/b',
      '',
      'x'.repeat(65),
      'café',
    ]) {
      assert.equal(isValidSessionName(bad), false, JSON.stringify(bad));
    }
  });
});

describe('tmux: commands go through execFile argv (no shell)', () => {
  it('passes the session name as a single argv element', async () => {
    let seen: string[] = [];
    stubRunner(async (args) => {
      seen = args;
      return { stdout: '', stderr: '' };
    });
    await killSession('my-sess_1');
    assert.deepEqual(seen, ['kill-session', '-t', 'my-sess_1']);
  });

  it('never invokes the runner for an invalid name (rejected before exec)', async () => {
    let called = false;
    stubRunner(async () => {
      called = true;
      return { stdout: '', stderr: '' };
    });
    await assert.rejects(() => killSession('; rm -rf ~'), (e: unknown) => {
      assert.ok(e instanceof HttpError && e.status === 400);
      return true;
    });
    await assert.rejects(() => tailSession('$(evil)', 10), /invalid session name/);
    assert.equal(called, false);
  });

  it('listSessions returns [] when no tmux server is running', async () => {
    stubRunner(async () => {
      throw new TmuxError('tmux ls failed: no server running on /tmp/tmux-1000/default');
    });
    assert.deepEqual(await listSessions(), []);
  });

  it('listSessions returns [] when tmux was never started (socket missing)', async () => {
    stubRunner(async () => {
      throw new TmuxError(
        'tmux ls failed: error connecting to /tmp/tmux-1000/default (No such file or directory)',
      );
    });
    assert.deepEqual(await listSessions(), []);
  });

  it('listSessions uses a single list-panes invocation (no shell)', async () => {
    let seen: string[] = [];
    stubRunner(async (args) => {
      seen = args;
      return { stdout: 'alpha|1700000000|1|1|opencode\n', stderr: '' };
    });
    const out = await listSessions();
    assert.deepEqual(seen, [
      'list-panes',
      '-a',
      '-F',
      '#{session_name}|#{session_created}|#{window_active}|#{pane_active}|#{pane_current_command}',
    ]);
    assert.deepEqual(out, [{ name: 'alpha', created: 1700000000, paneCommand: 'opencode', isOpencode: true }]);
  });

  it('listSessions parses rows and prefers the active pane of the active window', async () => {
    stubRunner(async () => ({
      stdout:
        'alpha|1700000000|0|0|zsh\n' +
        'alpha|1700000000|1|1|opencode\n' +
        'beta|not-a-number|1|1|bash\n',
      stderr: '',
    }));
    assert.deepEqual(await listSessions(), [
      { name: 'alpha', created: 1700000000, paneCommand: 'opencode', isOpencode: true },
      { name: 'beta', created: null, paneCommand: 'bash', isOpencode: false },
    ]);
  });

  it('newSession maps duplicates to 409', async () => {
    stubRunner(async () => {
      throw new TmuxError('tmux new-session failed: duplicate session: work');
    });
    await assert.rejects(() => newSession({ name: 'work' }), (e: unknown) => {
      assert.ok(e instanceof TmuxError && e.status === 409 && e.code === 'SESSION_EXISTS');
      return true;
    });
  });

  it('newSession passes dir (-c) and cmd as argv elements', async () => {
    let seen: string[] = [];
    stubRunner(async (args) => {
      seen = args;
      return { stdout: '', stderr: '' };
    });
    await newSession({ name: 'w', dir: '/home/u/proj', cmd: 'opencode', allowedRoots: ['/home/u'] });
    assert.deepEqual(seen, ['new-session', '-d', '-s', 'w', '-c', '/home/u/proj', 'opencode']);
  });

  it('newSession rejects a dir outside the allowed roots', async () => {
    let called = false;
    stubRunner(async () => {
      called = true;
      return { stdout: '', stderr: '' };
    });
    await assert.rejects(
      () => newSession({ name: 'w', dir: '/etc', allowedRoots: ['/home/u'] }),
      (e: unknown) => {
        assert.ok(e instanceof HttpError && e.status === 403);
        return true;
      },
    );
    assert.equal(called, false);
  });

  it('killSession maps missing sessions to 404', async () => {
    stubRunner(async () => {
      throw new TmuxError("tmux kill-session failed: can't find session: ghost");
    });
    await assert.rejects(() => killSession('ghost'), (e: unknown) => {
      assert.ok(e instanceof TmuxError && e.status === 404);
      return true;
    });
  });
});

describe('tmux: tail line cap', () => {
  it('parseTailLines defaults to 200 and accepts 1..2000', () => {
    assert.equal(parseTailLines(null), 200);
    assert.equal(parseTailLines(undefined), 200);
    assert.equal(parseTailLines('1'), 1);
    assert.equal(parseTailLines('2000'), 2000);
  });
  it('parseTailLines rejects 0, huge, non-numeric values', () => {
    for (const bad of ['0', '-5', '2001', '99999', 'abc', '10.5', '']) {
      if (bad === '') continue; // '' means default
      assert.throws(() => parseTailLines(bad), /`lines` must be an integer 1-2000/, JSON.stringify(bad));
    }
  });
  it('tailSession uses capture-pane -S -<lines> and enforces the cap pre-exec', async () => {
    let seen: string[] = [];
    stubRunner(async (args) => {
      seen = args;
      return { stdout: 'line1\nline2\n', stderr: '' };
    });
    const out = await tailSession('work', 50);
    assert.deepEqual(seen, ['capture-pane', '-p', '-t', 'work', '-S', '-50']);
    assert.deepEqual(out, { name: 'work', lines: 50, output: 'line1\nline2\n' });

    let called = false;
    stubRunner(async () => {
      called = true;
      return { stdout: '', stderr: '' };
    });
    await assert.rejects(() => tailSession('work', 99999), /`lines` must be an integer/);
    assert.equal(called, false);
  });
});

describe('tmux: isOpencode heuristic', () => {
  it('matches exactly `opencode` (bare, absolute path, login-shell dash)', () => {
    for (const cmd of ['opencode', '/usr/local/bin/opencode', '/opt/homebrew/bin/opencode', '-opencode']) {
      assert.equal(isOpencodeCommand(cmd), true, JSON.stringify(cmd));
    }
  });
  it('rejects lookalikes, shells, and empty input (conservative)', () => {
    for (const cmd of [
      'zsh',
      'bash',
      'node',
      'nvim',
      'opencode-tui',
      'my-opencode',
      'opencode-server',
      'Opencode',
      'OPENCODE',
      '',
      '   ',
    ]) {
      assert.equal(isOpencodeCommand(cmd), false, JSON.stringify(cmd));
    }
    assert.equal(isOpencodeCommand(null), false);
    assert.equal(isOpencodeCommand(undefined), false);
  });
});

describe('tmux: pane info degrades gracefully', () => {
  it('empty pane command becomes paneCommand:null + isOpencode:false', async () => {
    stubRunner(async () => ({ stdout: 'alpha|1700000000|1|1|\n', stderr: '' }));
    assert.deepEqual(await listSessions(), [
      { name: 'alpha', created: 1700000000, paneCommand: null, isOpencode: false },
    ]);
  });
  it('falls back to the first row when no pane is marked active', async () => {
    stubRunner(async () => ({ stdout: 'alpha|1700000000|0|0|zsh\n', stderr: '' }));
    assert.deepEqual(await listSessions(), [
      { name: 'alpha', created: 1700000000, paneCommand: 'zsh', isOpencode: false },
    ]);
  });
  it('malformed rows without a session name are skipped, not fatal', async () => {
    stubRunner(async () => ({ stdout: '||||\nbeta|1700000000|1|1|opencode\n', stderr: '' }));
    assert.deepEqual(await listSessions(), [
      { name: 'beta', created: 1700000000, paneCommand: 'opencode', isOpencode: true },
    ]);
  });
  it('short rows are skipped and empty timestamps become null', async () => {
    stubRunner(async () => ({ stdout: 'alpha|1700000000|1\n' + 'gamma||1|1|zsh\n', stderr: '' }));
    assert.deepEqual(await listSessions(), [{ name: 'gamma', created: null, paneCommand: 'zsh', isOpencode: false }]);
  });
});

describe('tmux: version never throws', () => {
  it('degrades to an unavailable string when tmux is missing', async () => {
    stubRunner(async () => {
      throw new TmuxError('tmux -V failed: command not found');
    });
    const v = await getTmuxVersion();
    assert.match(v, /^unavailable:/);
  });
  it('returns trimmed version output', async () => {
    stubRunner(async () => ({ stdout: 'tmux 3.4\n', stderr: '' }));
    assert.equal(await getTmuxVersion(), 'tmux 3.4');
  });
});

void beforeEach;

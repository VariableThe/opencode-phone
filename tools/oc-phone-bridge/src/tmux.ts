import { execFile } from 'node:child_process';
import path from 'node:path';
import { isPathInsideRoots } from './paths.js';

/** Session names are restricted to this shape everywhere (routes + tmux layer). */
export const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Hard cap for `GET /tmux/:name/tail?lines=N`. */
export const MAX_TAIL_LINES = 2000;
export const DEFAULT_TAIL_LINES = 200;

export function isValidSessionName(name: string): boolean {
  return SESSION_NAME_RE.test(name);
}

export function assertValidSessionName(name: string): void {
  if (!isValidSessionName(name)) {
    throw new HttpError(
      400,
      `invalid session name ${JSON.stringify(name)}: must match [A-Za-z0-9_-]{1,64}`,
      'INVALID_SESSION_NAME',
    );
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class TmuxError extends HttpError {
  constructor(message: string, code = 'TMUX_ERROR', status = 500) {
    super(status, message, code);
  }
}

// ---------------------------------------------------------------------------
// Runner (injectable for tests so no test needs a real tmux server)
// ---------------------------------------------------------------------------

export type TmuxRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

function defaultRunner(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // NOTE: execFile with an argv array — never a shell string. Session
    // names / dirs / commands are passed as single argv entries, so a name
    // like "; rm -rf" cannot escape into a shell (there is no shell).
    execFile('tmux', args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: unknown };
        reject(
          new TmuxError(`tmux ${args[0] ?? ''} failed: ${(stderr || err.message).trim()}`, 'TMUX_ERROR'),
        );
        void e;
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

let runner: TmuxRunner = defaultRunner;

/** Override the tmux subprocess runner (tests). Pass null/undefined to reset. */
export function setTmuxRunner(fn: TmuxRunner | null | undefined): void {
  runner = fn ?? defaultRunner;
}

function tmuxFailedNoServer(stderrOrMessage: string): boolean {
  // All of these mean "there is no tmux server / session to talk to", which
  // is the normal cold state — not an internal error. Note the last two:
  // when tmux has never run, `ls` fails with "error connecting to
  // /tmp/tmux-<uid>/default (No such file or directory)".
  return /no server running|no sessions|can't find session|session not found|error connecting to|no such file or directory/i.test(
    stderrOrMessage,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TmuxSessionInfo {
  name: string;
  /** Unix seconds from `#{session_created}`, or null when unparseable. */
  created: number | null;
  /**
   * Foreground command of the session's active pane
   * (`#{pane_current_command}`), or null when unavailable/empty.
   */
  paneCommand: string | null;
  /**
   * True when `paneCommand` looks like an opencode process.
   * See `isOpencodeCommand` for the exact heuristic. False when
   * `paneCommand` is null (unknown degrades to false, never throws).
   */
  isOpencode: boolean;
}

/**
 * Conservative opencode heuristic: true iff the command's argv[0] basename
 * (after stripping directories, surrounding quotes, and a leading `-`
 * login-shell marker) is exactly `opencode`, case-sensitive.
 *
 * Matches: `opencode`, `/usr/local/bin/opencode`, `-opencode`.
 * Rejects (by design — no guessing): `opencode-tui`, `my-opencode`,
 * `opencode-server`, `Opencode`, shells, empty/null input.
 */
export function isOpencodeCommand(cmd: string | null | undefined): boolean {
  if (cmd === null || cmd === undefined) return false;
  const trimmed = cmd.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed.split(/\s+/, 1)[0] ?? '';
  const unquoted = first.replace(/^['"]+|['"]+$/g, '');
  const base = unquoted.split('/').pop() ?? '';
  const name = base.startsWith('-') && base.length > 1 ? base.slice(1) : base;
  return name === 'opencode';
}

/**
 * List sessions. Returns [] when no tmux server/sessions exist.
 *
 * Single tmux invocation: `list-panes -a` already reports every session,
 * so one call yields the session name, creation time, and the active
 * pane's foreground command — no separate `ls` needed.
 *
 * NOTE: fields are `|`-separated, not tab-separated. This tmux build
 * rewrites tab characters in its own output (verified: `show-option`
 * and `-F` output turn tabs into `_`), while `|` passes through
 * untouched, so `\t` cannot be used as a separator here.
 */
export async function listSessions(): Promise<TmuxSessionInfo[]> {
  let out: string;
  try {
    ({ stdout: out } = await runner([
      'list-panes',
      '-a',
      '-F',
      '#{session_name}|#{session_created}|#{window_active}|#{pane_active}|#{pane_current_command}',
    ]));
  } catch (err) {
    if (err instanceof TmuxError && tmuxFailedNoServer(err.message)) return [];
    throw err;
  }
  // Group pane rows by session; prefer the active pane of the active
  // window, fall back to any active pane, then to the first row seen.
  const rowsBySession = new Map<string, { createdRaw: string; win: string; pane: string; cmd: string }[]>();
  for (const rawLine of out.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const parts = line.split('|');
    if (parts.length < 5) continue;
    const [name = '', createdRaw = '', win = '', pane = ''] = parts;
    if (name.length === 0) continue;
    // Rejoin the tail so a `|` inside the command itself doesn't corrupt
    // the row (session names are parts[0]; commands are single tokens but
    // be liberal in what we accept).
    const cmd = parts.slice(4).join('|');
    const rows = rowsBySession.get(name) ?? [];
    rows.push({ createdRaw, win, pane, cmd });
    rowsBySession.set(name, rows);
  }
  return [...rowsBySession.entries()].map(([name, rows]) => {
    const first = rows[0]!;
    const created = first.createdRaw === '' ? NaN : Number(first.createdRaw);
    const active = rows.find((r) => r.win === '1' && r.pane === '1') ?? rows.find((r) => r.pane === '1') ?? first;
    const paneCommand = active.cmd.length > 0 ? active.cmd : null;
    return {
      name,
      created: Number.isFinite(created) ? created : null,
      paneCommand,
      isOpencode: isOpencodeCommand(paneCommand),
    };
  });
}

export interface NewSessionOptions {
  name: string;
  /** Optional absolute start directory; must live inside an allowed root. */
  dir?: string | undefined;
  /** Optional command tmux runs inside the new session (argv element, no shell). */
  cmd?: string | undefined;
  /** Roots `dir` is checked against. Required when `dir` is provided. */
  allowedRoots?: string[] | undefined;
}

/** Validate + normalize the `dir` for session creation. */
export function resolveSessionDir(dir: string, allowedRoots: string[]): string {
  if (!path.isAbsolute(dir)) {
    throw new HttpError(400, '`dir` must be an absolute path', 'INVALID_DIR');
  }
  const resolved = path.resolve(dir);
  if (!isPathInsideRoots(resolved, allowedRoots)) {
    throw new HttpError(403, '`dir` is outside the allowed roots', 'DIR_FORBIDDEN');
  }
  return resolved;
}

export async function newSession(opts: NewSessionOptions): Promise<{ name: string }> {
  assertValidSessionName(opts.name);
  const args = ['new-session', '-d', '-s', opts.name];
  if (opts.dir !== undefined) {
    const resolved = resolveSessionDir(opts.dir, opts.allowedRoots ?? []);
    args.push('-c', resolved);
  }
  if (opts.cmd !== undefined && opts.cmd !== '') {
    args.push(opts.cmd);
  }
  try {
    await runner(args);
  } catch (err) {
    if (err instanceof TmuxError && /duplicate|already exists/i.test(err.message)) {
      throw new TmuxError(`session ${JSON.stringify(opts.name)} already exists`, 'SESSION_EXISTS', 409);
    }
    throw err;
  }
  return { name: opts.name };
}

export async function killSession(name: string): Promise<{ name: string }> {
  assertValidSessionName(name);
  try {
    await runner(['kill-session', '-t', name]);
  } catch (err) {
    if (err instanceof TmuxError && tmuxFailedNoServer(err.message)) {
      throw new TmuxError(`session ${JSON.stringify(name)} not found`, 'SESSION_NOT_FOUND', 404);
    }
    throw err;
  }
  return { name };
}

export function parseTailLines(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_TAIL_LINES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TAIL_LINES) {
    throw new HttpError(
      400,
      `\`lines\` must be an integer 1-${MAX_TAIL_LINES}, got ${JSON.stringify(raw)}`,
      'INVALID_LINES',
    );
  }
  return n;
}

export async function tailSession(
  name: string,
  lines: number = DEFAULT_TAIL_LINES,
): Promise<{ name: string; lines: number; output: string }> {
  assertValidSessionName(name);
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_TAIL_LINES) {
    throw new HttpError(
      400,
      `\`lines\` must be an integer 1-${MAX_TAIL_LINES}, got ${JSON.stringify(lines)}`,
      'INVALID_LINES',
    );
  }
  let stdout: string;
  try {
    // capture-pane -S -<lines> = last <lines> lines of the pane history.
    ({ stdout } = await runner(['capture-pane', '-p', '-t', name, '-S', `-${lines}`]));
  } catch (err) {
    if (err instanceof TmuxError && tmuxFailedNoServer(err.message)) {
      throw new TmuxError(`session ${JSON.stringify(name)} not found`, 'SESSION_NOT_FOUND', 404);
    }
    throw err;
  }
  return { name, lines, output: stdout };
}

/** `tmux -V` output for /health; never throws — degrades to an `unavailable:` string. */
export async function getTmuxVersion(): Promise<string> {
  try {
    const { stdout } = await runner(['-V']);
    return stdout.trim() || 'tmux (empty version output)';
  } catch (err) {
    return `unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

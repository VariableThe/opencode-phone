import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isAuthorized } from './auth.js';
import { loadConfig, type BridgeConfig } from './config.js';
import { getHealth } from './routes/health.js';
import { readJsonBody, sendJson, toErrorBody } from './routes/http.js';
import { tmuxRoute } from './routes/tmux.js';
import { listDir, readTextFile } from './routes/fs.js';
import { getTheme } from './routes/theme.js';

export interface AppOverrides {
  /** Override the OpenCode config dir for GET /theme (tests). */
  openCodeConfigDir?: string;
}

function logLine(method: string, pathname: string, status: number, ms: number): void {
  // Structured access log. NEVER log headers, tokens, or query values —
  // only the path shape (query values may contain filesystem paths).
  const q = pathname.includes('?') ? ' +query' : '';
  const route = pathname.split('?')[0] ?? pathname;
  process.stdout.write(
    JSON.stringify({ t: new Date().toISOString(), m: method, p: route + q, s: status, ms }) + '\n',
  );
}

/** Split `/tmux/<name>/tail` style suffixes. Returns null when no match. */
function matchTmuxSub(
  pathname: string,
): { kind: 'tail'; name: string } | { kind: 'one'; name: string } | null {
  const m = /^\/tmux\/([^/]+)(\/tail)?$/.exec(pathname);
  if (!m) return null;
  const name = m[1] ?? '';
  if (m[2] === '/tail') return { kind: 'tail', name };
  return { kind: 'one', name };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: BridgeConfig,
  overrides: AppOverrides,
): Promise<void> {
  const start = Date.now();
  const method = (req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  let status = 500;

  try {
    // ---- auth: every route, including /health ----
    if (!isAuthorized(req.headers['authorization'], config.token)) {
      status = 401;
      sendJson(res, 401, { error: 'unauthorized: missing or invalid bearer token', code: 'UNAUTHORIZED' });
      return;
    }

    if (method === 'GET' && pathname === '/health') {
      status = 200;
      sendJson(res, 200, await getHealth());
      return;
    }
    if (method === 'GET' && pathname === '/tmux') {
      status = 200;
      sendJson(res, 200, { sessions: await tmuxRoute.listSessions() });
      return;
    }
    if (method === 'POST' && pathname === '/tmux') {
      const body = await readJsonBody(req);
      status = 201;
      sendJson(res, 201, await tmuxRoute.createSession(body, config.allowedRoots));
      return;
    }
    if (pathname.startsWith('/tmux/')) {
      const sub = matchTmuxSub(pathname);
      if (sub && method === 'GET' && sub.kind === 'tail') {
        status = 200;
        sendJson(res, 200, await tmuxRoute.tailSession(sub.name, url.searchParams.get('lines')));
        return;
      }
      if (sub && method === 'DELETE' && sub.kind === 'one') {
        status = 200;
        sendJson(res, 200, await tmuxRoute.deleteSession(sub.name));
        return;
      }
    }
    if (method === 'GET' && pathname === '/fs/list') {
      status = 200;
      sendJson(res, 200, await listDir(url.searchParams.get('path') ?? '', config.allowedRoots));
      return;
    }
    if (method === 'GET' && pathname === '/fs/read') {
      status = 200;
      sendJson(res, 200, await readTextFile(url.searchParams.get('path') ?? '', config.allowedRoots));
      return;
    }
    if (method === 'GET' && pathname === '/theme') {
      status = 200;
      sendJson(res, 200, await getTheme(overrides.openCodeConfigDir));
      return;
    }

    status = 404;
    sendJson(res, 404, { error: `not found: ${method} ${pathname}`, code: 'NOT_FOUND' });
  } catch (err) {
    const { status: s, body } = toErrorBody(err);
    status = s;
    // Theme 404s carry the theme name for the phone client; preserve it.
    const extra = (err as { name?: unknown })?.name;
    sendJson(res, s, extra !== undefined && s === 404 ? { ...body, name: extra } : body);
    if (s === 500) {
      // Internal errors go to stderr with detail; the client only sees 'internal error'.
      process.stderr.write(`internal error ${method} ${pathname}: ${String((err as Error)?.stack ?? err)}\n`);
    }
  } finally {
    logLine(method, pathname + (url.search ? '?…' : ''), status, Date.now() - start);
  }
}

export function createApp(config: BridgeConfig, overrides: AppOverrides = {}): Server {
  return createServer((req, res) => {
    void handle(req, res, config, overrides).catch((err: unknown) => {
      try {
        sendJson(res, 500, { error: 'internal error', code: 'INTERNAL' });
      } catch {
        // response already half-written; nothing left to do
      }
      process.stderr.write(`unhandled handler error: ${String((err as Error)?.stack ?? err)}\n`);
    });
  });
}

function isMain(): boolean {
  const thisFile = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invoked === thisFile;
}

if (isMain()) {
  let config: BridgeConfig;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`oc-phone-bridge: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const server = createApp(config);
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `oc-phone-bridge v${config.version} listening on http://${config.host}:${config.port} ` +
        `(allowedRoots=${JSON.stringify(config.allowedRoots)})\n`,
    );
  });
}

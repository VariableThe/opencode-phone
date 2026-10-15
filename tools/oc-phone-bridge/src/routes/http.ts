import type { IncomingMessage } from 'node:http';
import { HttpError } from '../tmux.js';

/** Max JSON body size: 64 KiB. Larger bodies get 413. */
export const MAX_BODY_BYTES = 64 * 1024;

export function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function toErrorBody(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  const e = err as (Error & { status?: number; code?: string }) | null;
  if (e && typeof e.status === 'number') {
    return {
      status: e.status,
      body: { error: e.message || 'request failed', code: e.code || 'ERROR' },
    };
  }
  return { status: 500, body: { error: 'internal error', code: 'INTERNAL' } };
}

/** Read + JSON-parse a request body. Enforces JSON-only and the size cap. */
export async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  const chunks: Buffer[] = [];
  let seen = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      seen += c.length;
      if (seen > limit) {
        reject(new HttpError(413, `request body exceeds ${limit} bytes`, 'BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve());
    req.on('error', (e) => reject(e));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  if (!String(contentType).includes('application/json')) {
    throw new HttpError(400, 'content-type must be application/json', 'INVALID_CONTENT_TYPE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'malformed JSON body', 'INVALID_JSON');
  }
}

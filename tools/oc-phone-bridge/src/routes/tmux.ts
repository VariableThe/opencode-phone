import { HttpError } from '../tmux.js';
import {
  assertValidSessionName,
  killSession,
  listSessions,
  newSession,
  parseTailLines,
  tailSession,
} from '../tmux.js';

export interface CreateSessionInput {
  name: unknown;
  dir?: unknown;
  cmd?: unknown;
}

function asOptionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new HttpError(400, `\`${field}\` must be a string`, 'INVALID_FIELD');
  }
  return v;
}

/** POST /tmux body validation. Throws HttpError(400) on bad input. */
export function validateCreateInput(body: unknown): {
  name: string;
  dir: string | undefined;
  cmd: string | undefined;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'body must be a JSON object {name, dir?, cmd?}', 'INVALID_BODY');
  }
  const input = body as CreateSessionInput;
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new HttpError(400, '`name` is required and must be a non-empty string', 'INVALID_FIELD');
  }
  assertValidSessionName(input.name);
  const dir = asOptionalString(input.dir, 'dir');
  const cmd = asOptionalString(input.cmd, 'cmd');
  if (cmd !== undefined && cmd.length > 4096) {
    throw new HttpError(400, '`cmd` exceeds 4096 characters', 'INVALID_FIELD');
  }
  return { name: input.name, dir, cmd };
}

export const tmuxRoute = {
  listSessions,
  async createSession(body: unknown, allowedRoots: string[]) {
    const { name, dir, cmd } = validateCreateInput(body);
    return newSession({ name, dir, cmd, allowedRoots });
  },
  async deleteSession(name: string) {
    assertValidSessionName(decodeURIComponent(name));
    return killSession(decodeURIComponent(name));
  },
  async tailSession(name: string, linesRaw: string | null) {
    const decoded = decodeURIComponent(name);
    assertValidSessionName(decoded);
    return tailSession(decoded, parseTailLines(linesRaw));
  },
};

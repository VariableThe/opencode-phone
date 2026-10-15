import os from 'node:os';
import path from 'node:path';

export const VERSION = '0.1.0';
export const MIN_TOKEN_LENGTH = 32;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

export interface BridgeConfig {
  token: string;
  host: string;
  port: number;
  /** Absolute, normalized roots that fs reads and tmux `dir` must live under. */
  allowedRoots: string[];
  version: string;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`OC_BRIDGE_PORT must be an integer 1-65535, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export function parseAllowedRoots(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [os.homedir()];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => path.resolve(s));
}

/**
 * Read bridge configuration from env. Throws on missing/invalid values so
 * the server refuses to start rather than running unauthenticated.
 *
 * - OC_BRIDGE_TOKEN (required, >= 32 chars)
 * - OC_BRIDGE_HOST (default 127.0.0.1 — loopback only)
 * - OC_BRIDGE_PORT (default 8787)
 * - OC_BRIDGE_ALLOWED_ROOTS (optional comma-separated absolute paths;
 *   default: the workstation user's home directory)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const token = env['OC_BRIDGE_TOKEN'];
  if (!token) {
    throw new Error('OC_BRIDGE_TOKEN is required: refusing to start without a bearer token.');
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `OC_BRIDGE_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters, got ${token.length}.`,
    );
  }
  const host = env['OC_BRIDGE_HOST'] ?? DEFAULT_HOST;
  const port = parsePort(env['OC_BRIDGE_PORT']);
  const allowedRoots = parseAllowedRoots(env['OC_BRIDGE_ALLOWED_ROOTS']);
  return { token, host, port, allowedRoots, version: VERSION };
}

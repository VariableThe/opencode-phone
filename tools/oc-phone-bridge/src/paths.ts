import path from 'node:path';

/**
 * True when `candidate` (already resolved) equals `root` or lives under it.
 * Pure string-prefix check on resolved absolute paths — `..` segments must
 * be resolved with path.resolve() BEFORE calling this.
 */
export function isPathInsideRoots(candidate: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(
    (root) => candidate === root || candidate.startsWith(root + path.sep),
  );
}

/**
 * Resolve a user-supplied path and verify it sits inside one of the allowed
 * roots. Throws HttpError-compatible Error with status/code fields.
 * (Defined here to avoid a tmux<->fs import cycle; server.ts maps it.)
 */
export function resolveWithinRoots(
  requestedPath: string,
  allowedRoots: string[],
  opts: { param?: string } = {},
): string {
  const param = opts.param ?? 'path';
  if (!requestedPath || requestedPath.trim() === '') {
    const err = new Error(`\`${param}\` is required`) as Error & { status?: number; code?: string };
    err.status = 400;
    err.code = 'MISSING_PATH';
    throw err;
  }
  const resolved = path.resolve(requestedPath);
  if (allowedRoots.length === 0 || !isPathInsideRoots(resolved, allowedRoots)) {
    const err = new Error(
      `\`${param}\` is outside the allowed roots`,
    ) as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = 'PATH_FORBIDDEN';
    throw err;
  }
  return resolved;
}

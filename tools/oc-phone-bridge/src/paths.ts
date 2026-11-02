import { realpath } from 'node:fs/promises';
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

type PathError = Error & { status?: number; code?: string };

function pathError(status: number, code: string, message: string): PathError {
  const err = new Error(message) as PathError;
  err.status = status;
  err.code = code;
  return err;
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function canonicalExistingRoots(allowedRoots: string[]): Promise<string[]> {
  const roots = await Promise.all(
    allowedRoots.map(async (root) => {
      try {
        return await realpath(root);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
        // A missing configured root cannot contain an existing candidate. Keep
        // the prior 404 behavior for requests under it instead of failing all
        // roots because one optional path is unavailable.
        return null;
      }
    }),
  );
  return roots.filter((root): root is string => root !== null);
}

/**
 * Resolve a user-supplied path and verify it sits inside one of the allowed
 * roots. Throws HttpError-compatible Error with status/code fields.
 * (Defined here to avoid a tmux<->fs import cycle; server.ts maps it.)
 */
export async function resolveWithinRoots(
  requestedPath: string,
  allowedRoots: string[],
  opts: { param?: string } = {},
): Promise<string> {
  const param = opts.param ?? 'path';
  if (!requestedPath || requestedPath.trim() === '') {
    throw pathError(400, 'MISSING_PATH', `\`${param}\` is required`);
  }
  const resolved = path.resolve(requestedPath);
  if (allowedRoots.length === 0 || !isPathInsideRoots(resolved, allowedRoots)) {
    throw pathError(403, 'PATH_FORBIDDEN', `\`${param}\` is outside the allowed roots`);
  }

  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(resolved);
  } catch (error) {
    // Let the caller preserve its existing not-found response when the
    // candidate has no canonical path yet.
    if (isMissingPathError(error)) return resolved;
    throw pathError(403, 'PATH_FORBIDDEN', `\`${param}\` is outside the allowed roots`);
  }

  try {
    const canonicalRoots = await canonicalExistingRoots(allowedRoots);
    if (isPathInsideRoots(canonicalCandidate, canonicalRoots)) {
      return canonicalCandidate;
    }
  } catch {
    // Access, loop, and other canonicalization failures must not fall back to
    // a lexical path that a later filesystem operation could follow.
  }

  throw pathError(403, 'PATH_FORBIDDEN', `\`${param}\` is outside the allowed roots`);
}

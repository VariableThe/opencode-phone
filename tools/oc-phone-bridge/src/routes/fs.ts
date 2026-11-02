import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinRoots } from '../paths.js';
import { HttpError } from '../tmux.js';

/** Max bytes returned by GET /fs/read (1 MiB). Larger files get 413. */
export const MAX_READ_BYTES = 1_048_576;

export interface FsEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number | null;
  mtime: string | null;
}

/** GET /fs/list?path= — list a directory inside the allowed roots. */
export async function listDir(
  requestedPath: string,
  allowedRoots: string[],
): Promise<{ path: string; entries: FsEntry[] }> {
  const resolved = await resolveWithinRoots(requestedPath, allowedRoots);
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(resolved);
  } catch {
    throw new HttpError(404, `no such file or directory: ${resolved}`, 'NOT_FOUND');
  }
  if (!st.isDirectory()) {
    throw new HttpError(400, '`path` is not a directory', 'NOT_A_DIRECTORY');
  }
  const dirents = await readdir(resolved, { withFileTypes: true });
  const entries: FsEntry[] = await Promise.all(
    dirents.map(async (d) => {
      let size: number | null = null;
      let mtime: string | null = null;
      try {
        // Do not follow a symlink encountered while listing: metadata about a
        // target outside the allowed roots must not leak through this route.
        const s = await lstat(resolved + '/' + d.name);
        size = s.isFile() ? s.size : null;
        mtime = s.mtime.toISOString();
      } catch {
        // best-effort metadata; entry still listed
      }
      return {
        name: d.name,
        type: d.isDirectory() ? ('dir' as const) : d.isFile() ? ('file' as const) : ('other' as const),
        size,
        mtime,
      };
    }),
  );
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { path: path.resolve(requestedPath), entries };
}

/** GET /fs/read?path= — read a text file inside the allowed roots. */
export async function readTextFile(
  requestedPath: string,
  allowedRoots: string[],
): Promise<{ path: string; size: number; content: string }> {
  const resolved = await resolveWithinRoots(requestedPath, allowedRoots);
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(resolved);
  } catch {
    throw new HttpError(404, `no such file or directory: ${resolved}`, 'NOT_FOUND');
  }
  if (!st.isFile()) {
    throw new HttpError(400, '`path` is not a file', 'NOT_A_FILE');
  }
  if (st.size > MAX_READ_BYTES) {
    throw new HttpError(
      413,
      `file is ${st.size} bytes, max readable size is ${MAX_READ_BYTES}`,
      'FILE_TOO_LARGE',
    );
  }
  const content = await readFile(resolved, 'utf8');
  return { path: path.resolve(requestedPath), size: st.size, content };
}

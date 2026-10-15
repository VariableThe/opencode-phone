import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { HttpError } from '../tmux.js';

/**
 * Exact OpenCode theme paths read by GET /theme:
 *   1. `<configDir>/tui.json` — JSON object, `theme` field holds the theme
 *      name (e.g. `"tokyonight"`), same file `opencode` itself reads.
 *   2. `<configDir>/themes/<name>.json` — the theme definition.
 * `<configDir>` defaults to `$XDG_CONFIG_HOME/opencode`, else
 * `~/.config/opencode`. Tests may inject a different directory.
 */
export function defaultOpenCodeConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg && xdg.trim() !== '') return path.join(xdg, 'opencode');
  return path.join(os.homedir(), '.config', 'opencode');
}

const THEME_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ThemeBody {
  name: string;
  json: unknown;
}

/** Read the OpenCode theme. Throws HttpError(404) with `name: null` when absent. */
export async function getTheme(configDir?: string): Promise<ThemeBody> {
  const dir = configDir ?? defaultOpenCodeConfigDir();
  let tuiRaw: string;
  try {
    tuiRaw = await readFile(path.join(dir, 'tui.json'), 'utf8');
  } catch {
    throw Object.assign(new HttpError(404, 'no OpenCode theme configured (tui.json not found)', 'THEME_NOT_FOUND'), {
      name: null as string | null,
    });
  }
  let tui: unknown;
  try {
    tui = JSON.parse(tuiRaw);
  } catch {
    throw new HttpError(404, 'tui.json is not valid JSON', 'THEME_NOT_FOUND');
  }
  const name =
    typeof tui === 'object' && tui !== null
      ? (tui as Record<string, unknown>)['theme']
      : undefined;
  if (typeof name !== 'string' || name.length === 0 || !THEME_NAME_RE.test(name)) {
    throw Object.assign(
      new HttpError(404, 'no OpenCode theme configured (`theme` missing in tui.json)', 'THEME_NOT_FOUND'),
      { name: null as string | null },
    );
  }
  let themeRaw: string;
  try {
    themeRaw = await readFile(path.join(dir, 'themes', `${name}.json`), 'utf8');
  } catch {
    throw Object.assign(
      new HttpError(404, `theme ${JSON.stringify(name)} configured but themes/${name}.json not found`, 'THEME_FILE_NOT_FOUND'),
      { name },
    );
  }
  try {
    return { name, json: JSON.parse(themeRaw) };
  } catch {
    throw new HttpError(404, `themes/${name}.json is not valid JSON`, 'THEME_FILE_INVALID');
  }
}

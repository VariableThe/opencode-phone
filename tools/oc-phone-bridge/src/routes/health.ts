import { VERSION } from '../config.js';
import { getTmuxVersion } from '../tmux.js';

export interface HealthBody {
  ok: true;
  version: string;
  tmux: string;
}

export async function getHealth(): Promise<HealthBody> {
  return { ok: true, version: VERSION, tmux: await getTmuxVersion() };
}

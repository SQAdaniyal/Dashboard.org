import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let loaded = false;

export async function loadEnv(root = process.cwd()) {
  if (loaded) return;
  loaded = true;
  const content = await readFile(join(root, '.env'), 'utf8').catch(() => '');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i);
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(i + 1);
  }
}

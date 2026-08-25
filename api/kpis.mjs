import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from '../lib/env.mjs';
import { buildSnapshot } from '../lib/kpis.mjs';

export default async function handler(req, res) {
  await loadEnv();
  const url = new URL(req.url, 'http://localhost');
  const live = req.query?.live === '1' || url.searchParams.get('live') === '1';

  if (!live) {
    try {
      const snapshot = JSON.parse(await readFile(join(process.cwd(), 'data', 'cache.json'), 'utf8'));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(snapshot);
    } catch { /* No cached snapshot: fall through to a live fetch. */ }
  }

  try {
    const snapshot = await buildSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(snapshot);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}

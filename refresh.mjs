// Scheduled, headless KPI refresh. Keeps a last-known-good snapshot for the UI.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { buildSnapshot } from './lib/kpis.mjs';

await loadEnv();
const root = process.cwd();

const snapshot = await buildSnapshot();
if (!snapshot.ktrade.connected) throw new Error(snapshot.ktrade.reason);
if (!snapshot.adEngineering.connected) throw new Error(snapshot.adEngineering.reason);

await mkdir(join(root, 'data'), { recursive: true });
await writeFile(join(root, 'data', 'cache.json'), JSON.stringify(snapshot, null, 2));
console.log(`KPI snapshot refreshed at ${snapshot.generatedAt}`);

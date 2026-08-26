// Scheduled, headless KPI refresh. Keeps a last-known-good snapshot for the UI.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { buildSnapshot } from './lib/kpis.mjs';

await loadEnv();
const root = process.cwd();

async function reportFailure(message) {
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Refresh failed\n\n${message}\n`).catch(() => {});
  }
}

const REQUIRED_VARS = [
  'KTRADE_EMAIL', 'KTRADE_PASSWORD',
  'AD_ENGINEERING_EMAIL', 'AD_ENGINEERING_PASSWORD'
];
const missing = REQUIRED_VARS.filter(name => !process.env[name]);
if (missing.length) {
  await reportFailure(
    `Missing environment variable(s): ${missing.join(', ')}.\n\n` +
    `If running in GitHub Actions, add these as **Repository secrets** ` +
    `(Settings -> Secrets and variables -> Actions -> Repository secrets) ` +
    `-- not Environment secrets, since this workflow does not declare an environment.`
  );
  process.exit(1);
}

const snapshot = await buildSnapshot();
if (!snapshot.ktrade.connected) {
  await reportFailure(`K-Trade did not connect: ${snapshot.ktrade.reason}`);
  process.exit(1);
}
if (!snapshot.adEngineering.connected) {
  await reportFailure(`AD Engineering did not connect: ${snapshot.adEngineering.reason}`);
  process.exit(1);
}

await mkdir(join(root, 'data'), { recursive: true });
await writeFile(join(root, 'data', 'cache.json'), JSON.stringify(snapshot, null, 2));
console.log(`KPI snapshot refreshed at ${snapshot.generatedAt}`);

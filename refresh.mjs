// Scheduled, headless KPI refresh. Keeps a last-known-good snapshot for the UI.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const env = Object.fromEntries((await readFile(join(root, '.env'), 'utf8').catch(() => '')).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const number = value => Number(value ?? 0) || 0;
if (!env.KTRADE_EMAIL || !env.KTRADE_PASSWORD) throw new Error('K-Trade secrets are missing from .env.');
const base = env.KTRADE_API_BASE || 'https://6luue8cst3.execute-api.us-east-1.amazonaws.com/dev';
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.KTRADE_EMAIL, password: env.KTRADE_PASSWORD, clientName: env.KTRADE_CLIENT_NAME || 'KTrade' }) }).then(r => r.json());
if (!login.success) throw new Error(login.message || 'K-Trade login failed.');
const response = await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${login.data.tokens.accessToken}` } }).then(r => r.json());
const stats = response.data || response;
const allocated = number(stats.allocatedMinutes), used = number(stats.consumedMinutes);
const snapshot = { generatedAt: new Date().toISOString(), ktrade: { connected: true, allocatedMinutes: allocated, consumedMinutes: used, remainingMinutes: Math.max(allocated-used, 0), utilisation: allocated ? +(used / allocated * 100).toFixed(1) : 0, conversations: number(stats.conversationCount?.currentMonth ?? stats.conversationCount), averageDuration: stats.conversationDuration?.currentMonthAverageDuration ?? null, trend: (stats.conversationTrend || []).map(i => ({ label: `${i.month || ''} ${i.year || ''}`.trim(), value: number(i.channels?.VoiceCall ?? i.volume) })) }, adEngineering: { connected: false, reason: 'Waiting for a reachable AD Engineering API endpoint.' } };
await mkdir(join(root, 'data'), { recursive: true });
await writeFile(join(root, 'data', 'cache.json'), JSON.stringify(snapshot, null, 2));
console.log(`KPI snapshot refreshed at ${snapshot.generatedAt}`);

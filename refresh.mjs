// Scheduled, headless KPI refresh. Keeps a last-known-good snapshot for the UI.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const env = Object.fromEntries((await readFile(join(root, '.env'), 'utf8').catch(() => '')).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const number = value => Number(value ?? 0) || 0;

if (!env.KTRADE_EMAIL || !env.KTRADE_PASSWORD) throw new Error('K-Trade secrets are missing from .env.');
const kBase = env.KTRADE_API_BASE || 'https://6luue8cst3.execute-api.us-east-1.amazonaws.com/dev';
const kLogin = await fetch(`${kBase}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.KTRADE_EMAIL, password: env.KTRADE_PASSWORD, clientName: env.KTRADE_CLIENT_NAME || 'KTrade' }) }).then(r => r.json());
if (!kLogin.success) throw new Error(kLogin.message || 'K-Trade login failed.');
const kResponse = await fetch(`${kBase}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${kLogin.data.tokens.accessToken}` } }).then(r => r.json());
const stats = kResponse.data || kResponse, allocated = number(stats.allocatedMinutes), used = number(stats.consumedMinutes);

if (!env.AD_ENGINEERING_EMAIL || !env.AD_ENGINEERING_PASSWORD) throw new Error('AD Engineering secrets are missing from .env.');
const adBase = env.AD_ENGINEERING_API_BASE || 'https://bvk0cvcp20.execute-api.us-east-1.amazonaws.com';
const adLogin = await fetch(`${adBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.AD_ENGINEERING_EMAIL, password: env.AD_ENGINEERING_PASSWORD }) }).then(r => r.json());
if (!adLogin.token) throw new Error(adLogin.message || 'AD Engineering login failed.');
const proposals = await fetch(`${adBase}/proposalHistory`, { headers: { Authorization: `Bearer ${adLogin.token}` } }).then(r => r.json());
const now = new Date(), monthlyLimit = number(env.AD_ENGINEERING_MONTHLY_LIMIT || 5);
const generatedThisMonth = (Array.isArray(proposals) ? proposals : []).filter(item => { const date = new Date(item.proposalGeneratedAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }).length;

const snapshot = { generatedAt: new Date().toISOString(), ktrade: { connected: true, allocatedMinutes: allocated, consumedMinutes: used, remainingMinutes: Math.max(allocated-used, 0), utilisation: allocated ? +(used / allocated * 100).toFixed(1) : 0, conversations: number(stats.conversationCount?.currentMonth ?? stats.conversationCount), averageDuration: stats.conversationDuration?.currentMonthAverageDuration ?? null, trend: (stats.conversationTrend || []).map(i => ({ label: `${i.month || ''} ${i.year || ''}`.trim(), value: number(i.channels?.VoiceCall ?? i.volume) })) }, adEngineering: { connected: true, generatedThisMonth, monthlyLimit, remaining: Math.max(monthlyLimit - generatedThisMonth, 0), utilisation: monthlyLimit ? +(generatedThisMonth / monthlyLimit * 100).toFixed(1) : 0 } };
await mkdir(join(root, 'data'), { recursive: true });
await writeFile(join(root, 'data', 'cache.json'), JSON.stringify(snapshot, null, 2));
console.log(`KPI snapshot refreshed at ${snapshot.generatedAt}`);

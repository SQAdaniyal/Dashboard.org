import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const env = Object.fromEntries((await readFile(join(root, '.env'), 'utf8').catch(() => '')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const number = value => Number(value ?? 0) || 0;

async function ktrade() {
  if (!env.KTRADE_EMAIL || !env.KTRADE_PASSWORD) return { connected: false, reason: 'K-Trade credentials are not configured locally.' };
  const base = env.KTRADE_API_BASE || 'https://6luue8cst3.execute-api.us-east-1.amazonaws.com/dev';
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.KTRADE_EMAIL, password: env.KTRADE_PASSWORD, clientName: env.KTRADE_CLIENT_NAME || 'KTrade' }) }).then(r => r.json());
  if (!login.success) throw new Error(login.message || 'K-Trade login failed');
  const headers = { Authorization: `Bearer ${login.data.tokens.accessToken}` };
  const [statsResponse, reportsResponse] = await Promise.all([
    fetch(`${base}/api/dashboard/stats`, { headers }).then(r => r.json()),
    fetch(`${base}/api/conversations/reports`, { headers }).then(r => r.json())
  ]);
  const stats = statsResponse.data || statsResponse;
  const reports = reportsResponse.data || reportsResponse;
  const allocated = number(stats.allocatedMinutes);
  const used = number(stats.consumedMinutes);
  const trend = (stats.conversationTrend || []).map(item => ({ label: `${item.month || ''} ${item.year || ''}`.trim(), value: number(item.channels?.VoiceCall ?? item.volume) }));
  return {
    connected: true,
    allocatedMinutes: allocated,
    consumedMinutes: used,
    remainingMinutes: Math.max(allocated - used, 0),
    utilisation: allocated ? +(used / allocated * 100).toFixed(1) : 0,
    conversations: number(stats.conversationCount?.currentMonth ?? stats.conversationCount),
    averageDuration: stats.conversationDuration?.currentMonthAverageDuration ?? null,
    trend,
    rawReportCount: Array.isArray(reports.reports) ? reports.reports.length : 0
  };
}

async function api(res, live = false) {
  if (!live) {
    try {
      const snapshot = JSON.parse(await readFile(join(root, 'data', 'cache.json'), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(snapshot));
    } catch { /* No scheduled snapshot yet: fetch a live one below. */ }
  }
  try {
    const data = await ktrade();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ generatedAt: new Date().toISOString(), ktrade: data, adEngineering: { connected: false, reason: 'Waiting for a reachable AD Engineering API endpoint.' } }));
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/kpis') return api(res, url.searchParams.get('live') === '1');
  const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
  const file = join(root, requested);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { await stat(file); res.writeHead(200, { 'Content-Type': contentType[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, () => console.log('KPI dashboard: http://localhost:4173'));

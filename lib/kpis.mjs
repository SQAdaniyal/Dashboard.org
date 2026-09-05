import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const number = value => Number(value ?? 0) || 0;

// Amber ("up, but the team is aware of an issue") isn't derivable from an API
// health check -- it's a judgment call. The team flags it by editing this file.
async function loadStatusOverrides() {
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'status-overrides.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function withStatus(key, data, overrides) {
  if (!data.connected) return { ...data, statusLevel: 'red', statusNote: data.reason || 'Not connected' };
  const override = overrides[key];
  if (override?.level === 'amber') return { ...data, statusLevel: 'amber', statusNote: override.note || 'The team is investigating an issue.' };
  return { ...data, statusLevel: 'green', statusNote: 'Operational' };
}
async function safeFetch(fn, label) {
  try {
    return await fn();
  } catch (err) {
    return { connected: false, reason: err.message || `${label} request failed.` };
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Catalect operates on Pakistan time. Bucketing by PKT wall-clock (rather than
// UTC or whatever timezone the process happens to run in) keeps "this month" /
// "last month" consistent with what the source platforms show their users.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const pktParts = date => { const shifted = new Date(date.getTime() + PKT_OFFSET_MS); return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() }; };
const pktDayKey = ms => new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);

// Builds a dense, gap-filled day-by-day series (oldest data day -> today, PKT)
// from a Map<'YYYY-MM-DD', number>, so the UI never has to special-case a
// missing day versus a real zero.
function denseDailySeries(totalsByDay) {
  if (!totalsByDay.size) return [];
  const keys = [...totalsByDay.keys()].sort();
  const cursor = new Date(`${keys[0]}T00:00:00.000Z`);
  const end = new Date(`${pktDayKey(Date.now())}T00:00:00.000Z`);
  const series = [];
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ key, value: +(totalsByDay.get(key) || 0).toFixed(2) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

function monthlyTrend(items, dateField, months = 12) {
  const anchor = pktParts(new Date());
  const buckets = Array.from({ length: months }, (_, i) => {
    const totalMonths = anchor.year * 12 + anchor.month - (months - 1 - i);
    const year = Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12;
    return { year, month, key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[month]} ${year}`, value: 0 };
  });
  for (const item of items) {
    const date = new Date(item[dateField]);
    if (Number.isNaN(date.getTime())) continue;
    const parts = pktParts(date);
    const bucket = buckets.find(b => b.year === parts.year && b.month === parts.month);
    if (bucket) bucket.value += 1;
  }
  return buckets.map(({ key, label, value }) => ({ key, label, value }));
}

// The conversations list is the only endpoint with per-call timestamps (no
// date-filter query params are supported), so a full paginated sweep is
// required to build a daily minutes series. It's sorted newest-first and
// capped at 100/page; `maxPages` bounds the sweep well above the account's
// current volume (~9 pages) so a future growth spurt doesn't cause runaway
// sequential requests.
async function fetchAllConversations(base, headers, maxPages = 20) {
  const first = await fetch(`${base}/api/conversations?page=1&limit=100`, { headers }).then(r => r.json());
  const list = [...(first.data?.conversations || [])];
  const totalPages = Math.min(first.data?.pagination?.totalPages || 1, maxPages);
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
        .map(page => fetch(`${base}/api/conversations?page=${page}&limit=100`, { headers }).then(r => r.json()))
    );
    for (const r of rest) list.push(...(r.data?.conversations || []));
  }
  return list;
}

function dailyMinutesFromConversations(conversations) {
  const totals = new Map();
  for (const c of conversations) {
    const startSeconds = Number(c.SessionStart);
    if (!startSeconds) continue;
    const key = pktDayKey(startSeconds * 1000);
    const minutes = Number(c.HandlingDuration || 0) / 60;
    totals.set(key, (totals.get(key) || 0) + minutes);
  }
  return denseDailySeries(totals);
}

export async function fetchKtrade() {
  const email = process.env.KTRADE_EMAIL;
  const password = process.env.KTRADE_PASSWORD;
  if (!email || !password) return { connected: false, reason: 'K-Trade credentials are not configured.' };
  const base = process.env.KTRADE_API_BASE || 'https://6luue8cst3.execute-api.us-east-1.amazonaws.com/dev';
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, clientName: process.env.KTRADE_CLIENT_NAME || 'KTrade' })
  }).then(r => r.json());
  if (!login.success) throw new Error(login.message || 'K-Trade login failed');
  const headers = { Authorization: `Bearer ${login.data.tokens.accessToken}` };
  const [statsResponse, reportsResponse, conversationRecords] = await Promise.all([
    fetch(`${base}/api/dashboard/stats`, { headers }).then(r => r.json()),
    fetch(`${base}/api/conversations/reports`, { headers }).then(r => r.json()),
    fetchAllConversations(base, headers)
  ]);
  const stats = statsResponse.data || statsResponse;
  const reports = reportsResponse.data || reportsResponse;
  const dailyMinutes = dailyMinutesFromConversations(conversationRecords);
  const allocated = number(stats.allocatedMinutes);
  const used = number(stats.consumedMinutes);
  const trend = (stats.conversationTrend || []).map(item => {
    const monthIndex = MONTH_NAMES.findIndex(m => m.toLowerCase() === String(item.month || '').toLowerCase());
    return {
      key: monthIndex >= 0 && item.year ? `${item.year}-${String(monthIndex + 1).padStart(2, '0')}` : null,
      label: `${item.month || ''} ${item.year || ''}`.trim(),
      value: number(item.channels?.VoiceCall ?? item.volume)
    };
  });
  // stats.conversationCount is unreliable (often 0 even with real traffic) --
  // the per-month trend is accurate, so pull this month's call count from there.
  const nowParts = pktParts(new Date());
  const currentKey = `${nowParts.year}-${String(nowParts.month + 1).padStart(2, '0')}`;
  const currentMonthTrend = trend.find(item => item.key === currentKey);
  const conversations = currentMonthTrend ? currentMonthTrend.value : number(stats.conversationCount?.currentMonth ?? stats.conversationCount);
  return {
    connected: true,
    allocatedMinutes: allocated,
    consumedMinutes: used,
    remainingMinutes: Math.max(allocated - used, 0),
    utilisation: allocated ? +(used / allocated * 100).toFixed(1) : 0,
    conversations,
    averageDuration: stats.conversationDuration?.currentMonthAverageDuration ?? null,
    trend,
    dailyMinutes,
    rawReportCount: Array.isArray(reports.reports) ? reports.reports.length : 0
  };
}

export async function fetchAdEngineering() {
  const email = process.env.AD_ENGINEERING_EMAIL;
  const password = process.env.AD_ENGINEERING_PASSWORD;
  if (!email || !password) return { connected: false, reason: 'AD Engineering credentials are not configured.' };
  const base = process.env.AD_ENGINEERING_API_BASE || 'https://bvk0cvcp20.execute-api.us-east-1.amazonaws.com';
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }).then(r => r.json());
  if (!login.token) throw new Error(login.message || 'AD Engineering login failed');
  const proposalsRaw = await fetch(`${base}/proposalHistory`, { headers: { Authorization: `Bearer ${login.token}` } }).then(r => r.json());
  // The API's "status" field is unreliable on its own (some failed pipeline
  // runs are still marked "success"), so a proposal only counts as generated
  // if it actually produced a .docx output rather than an error.txt.
  const isGenerated = item => item.status === 'success' && /\.docx$/i.test(item.proposalFilename || '');
  const generated = (Array.isArray(proposalsRaw) ? proposalsRaw : []).filter(isGenerated);
  const nowParts = pktParts(new Date());
  const generatedThisMonth = generated.filter(item => {
    const parts = pktParts(new Date(item.proposalGeneratedAt));
    return parts.year === nowParts.year && parts.month === nowParts.month;
  }).length;
  const monthlyLimit = number(process.env.AD_ENGINEERING_MONTHLY_LIMIT || 5);
  const dailyTotals = new Map();
  for (const item of generated) {
    const ms = new Date(item.proposalGeneratedAt).getTime();
    if (Number.isNaN(ms)) continue;
    const key = pktDayKey(ms);
    dailyTotals.set(key, (dailyTotals.get(key) || 0) + 1);
  }
  return {
    connected: true,
    generatedThisMonth,
    monthlyLimit,
    remaining: Math.max(monthlyLimit - generatedThisMonth, 0),
    utilisation: monthlyLimit ? +(generatedThisMonth / monthlyLimit * 100).toFixed(1) : 0,
    trend: monthlyTrend(generated, 'proposalGeneratedAt'),
    dailyProposals: denseDailySeries(dailyTotals)
  };
}

export async function buildSnapshot() {
  const [overrides, ktradeRaw, adRaw] = await Promise.all([
    loadStatusOverrides(),
    safeFetch(fetchKtrade, 'K-Trade'),
    safeFetch(fetchAdEngineering, 'AD Engineering')
  ]);
  return {
    generatedAt: new Date().toISOString(),
    ktrade: withStatus('ktrade', ktradeRaw, overrides),
    adEngineering: withStatus('adEngineering', adRaw, overrides)
  };
}

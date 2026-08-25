const number = value => Number(value ?? 0) || 0;

function monthlyTrend(items, dateField, months = 12) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), value: 0 };
  });
  for (const item of items) {
    const date = new Date(item[dateField]);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = buckets.find(b => b.year === date.getFullYear() && b.month === date.getMonth());
    if (bucket) bucket.value += 1;
  }
  return buckets.map(({ label, value }) => ({ label, value }));
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
  const [statsResponse, reportsResponse] = await Promise.all([
    fetch(`${base}/api/dashboard/stats`, { headers }).then(r => r.json()),
    fetch(`${base}/api/conversations/reports`, { headers }).then(r => r.json())
  ]);
  const stats = statsResponse.data || statsResponse;
  const reports = reportsResponse.data || reportsResponse;
  const allocated = number(stats.allocatedMinutes);
  const used = number(stats.consumedMinutes);
  const trend = (stats.conversationTrend || []).map(item => ({
    label: `${item.month || ''} ${item.year || ''}`.trim(),
    value: number(item.channels?.VoiceCall ?? item.volume)
  }));
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
  const proposals = Array.isArray(proposalsRaw) ? proposalsRaw : [];
  const now = new Date();
  const generatedThisMonth = proposals.filter(item => {
    const date = new Date(item.proposalGeneratedAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }).length;
  const monthlyLimit = number(process.env.AD_ENGINEERING_MONTHLY_LIMIT || 5);
  return {
    connected: true,
    generatedThisMonth,
    monthlyLimit,
    remaining: Math.max(monthlyLimit - generatedThisMonth, 0),
    utilisation: monthlyLimit ? +(generatedThisMonth / monthlyLimit * 100).toFixed(1) : 0,
    trend: monthlyTrend(proposals, 'proposalGeneratedAt')
  };
}

export async function buildSnapshot() {
  const [ktrade, adEngineering] = await Promise.all([fetchKtrade(), fetchAdEngineering()]);
  return { generatedAt: new Date().toISOString(), ktrade, adEngineering };
}

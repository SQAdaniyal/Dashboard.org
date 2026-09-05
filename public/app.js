const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(n || 0));
const duration = m => { let mins = Math.floor(Number(m || 0)), secs = Math.round((Number(m || 0) - mins) * 60); if (secs === 60) { mins += 1; secs = 0 } return `${fmt(mins)}m ${String(secs).padStart(2, '0')}s`; };

// ---- animated count-up: tweens from the element's last rendered value to a new one ----
const numberAnimState = new WeakMap();
function animateNumber(el, targetValue, render, ms = 700) {
  if (!el) return;
  const prev = numberAnimState.get(el);
  if (prev?.frame) cancelAnimationFrame(prev.frame);
  const from = Number.isFinite(prev?.value) ? prev.value : 0;
  if (from === targetValue) { render(targetValue); numberAnimState.set(el, { value: targetValue, frame: null }); return; }
  const start = performance.now();
  const step = ts => {
    const progress = Math.min((ts - start) / ms, 1);
    const current = from + (targetValue - from) * easeOutCubic(progress);
    render(current);
    const frame = progress < 1 ? requestAnimationFrame(step) : null;
    numberAnimState.set(el, { value: progress < 1 ? current : targetValue, frame });
  };
  numberAnimState.set(el, { value: from, frame: requestAnimationFrame(step) });
}

// ---- date helpers (all keys are plain 'YYYY-MM-DD' PKT calendar days from the backend) ----
const parseKey = key => new Date(`${key}T00:00:00.000Z`);
const shortDate = key => parseKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdayShort = key => parseKey(key).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const fullDate = key => parseKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const addDays = (key, delta) => { const d = parseKey(key); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
const mondayOf = key => { const d = parseKey(key); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return d.toISOString().slice(0, 10); };
const monthStart = key => `${key.slice(0, 7)}-01`;
const daysInMonth = key => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

// ---- "nice" axis scale (rounds the y-axis max/step to human-friendly numbers) ----
function niceNumber(range, round) {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction;
  if (round) niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}
function niceScale(maxValue, tickCount) {
  if (!maxValue || maxValue <= 0) return { max: tickCount, step: 1 };
  // Every value on these charts is displayed as a whole number, so a
  // sub-1 step (e.g. 0.2) would round to the same integer on consecutive
  // gridlines -- always keep the step at least 1.
  const step = Math.max(Math.round(niceNumber(niceNumber(maxValue, false) / tickCount, true)), 1);
  return { max: Math.ceil(maxValue / step) * step, step };
}
const easeOutCubic = t => 1 - (1 - t) ** 3;
function lighten(hex, amt = 0.28) {
  const num = parseInt(hex.replace('#', ''), 16);
  const mix = c => Math.round(c + (255 - c) * amt);
  return `rgb(${mix((num >> 16) & 255)},${mix((num >> 8) & 255)},${mix(num & 255)})`;
}
function roundedTopRect(ctx, x, y, w, h, r) {
  r = Math.max(Math.min(r, w / 2, h), 0);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// ---- bar chart renderer: one project's series, one color, animated, hover tooltip ----
const chartAnimFrames = {};
function barChart(canvasId, points, opts) {
  const canvas = $(canvasId);
  if (!canvas) return;
  cancelAnimationFrame(chartAnimFrames[canvasId]);
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  const pl = 40, pr = 12, pt = opts.showValueLabels ? 26 : 14, pb = 22;
  const pw = w - pl - pr, ph = h - pt - pb;
  const n = points.length;
  const slot = pw / Math.max(n, 1);
  const barW = Math.max(Math.min(slot * 0.55, 24), 4);
  const scale = niceScale(Math.max(...points.map(p => p.value), 0), 4);
  let hoverIndex = -1;
  const tooltip = opts.tooltipId ? $(opts.tooltipId) : null;

  function draw(progress) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const tickCount = Math.round(scale.max / scale.step);
    for (let i = 0; i <= tickCount; i++) {
      const v = scale.step * i;
      const y = pt + ph - (v / scale.max) * ph;
      ctx.strokeStyle = '#edf1f7';
      ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(w - pr, y); ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(fmt(Math.round(v)), pl - 8, y);
    }
    ctx.strokeStyle = '#c9d2e3';
    ctx.beginPath(); ctx.moveTo(pl, pt + ph); ctx.lineTo(w - pr, pt + ph); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    points.forEach((p, i) => {
      const cx = pl + slot * i + slot / 2;
      const targetH = scale.max ? (p.value / scale.max) * ph : 0;
      const barH = Math.max(targetH * progress, p.value > 0 ? 1 : 0);
      const x = cx - barW / 2, y = pt + ph - barH;
      const isToday = opts.todayKey && p.key === opts.todayKey;
      const baseColor = isToday ? opts.todayColor : opts.color;
      ctx.fillStyle = i === hoverIndex ? lighten(baseColor) : baseColor;
      roundedTopRect(ctx, x, y, barW, barH, Math.min(4, barH));
      ctx.fill();
      ctx.fillStyle = isToday ? '#ae7400' : '#94a3b8';
      ctx.font = isToday ? '700 10px Inter, system-ui, sans-serif' : '10px Inter, system-ui, sans-serif';
      ctx.fillText(p.label, cx, pt + ph + 6);
      if (opts.showValueLabels && progress > 0.98 && p.value > 0) {
        ctx.font = '700 10px Inter, system-ui, sans-serif';
        const text = opts.formatValue(p.value);
        if (ctx.measureText(text).width <= slot - 4) {
          ctx.fillStyle = '#475569';
          ctx.fillText(text, cx, Math.max(y - 13, 2));
        }
      }
    });
  }

  let start = null;
  function frame(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / 500, 1);
    draw(easeOutCubic(progress));
    if (progress < 1) chartAnimFrames[canvasId] = requestAnimationFrame(frame);
  }
  chartAnimFrames[canvasId] = requestAnimationFrame(frame);

  canvas.onpointermove = e => {
    const r = canvas.getBoundingClientRect();
    const idx = Math.floor((e.clientX - r.left - pl) / slot);
    if (idx < 0 || idx >= n) { canvas.onpointerleave(); return; }
    if (idx !== hoverIndex) { hoverIndex = idx; draw(1); }
    if (tooltip) {
      const p = points[idx];
      tooltip.textContent = `${fullDate(p.key)} — ${opts.formatValue(p.value)}`;
      tooltip.style.opacity = 1;
      const cx = pl + slot * idx + slot / 2;
      tooltip.style.left = `${Math.min(Math.max(cx, 64), w - 64)}px`;
      tooltip.style.top = `${pt - 8}px`;
    }
  };
  canvas.onpointerleave = () => { if (hoverIndex !== -1) { hoverIndex = -1; draw(1); } if (tooltip) tooltip.style.opacity = 0; };
}

// ---- per-project (K-Trade / AD Engineering) daily / weekly / monthly analytics ----
const PROJECTS = {
  ktrade: {
    color: '#3563e9',
    // The voice bot only runs Monday-Friday, so weekends are dropped
    // rather than shown as permanent zero bars.
    businessDaysOnly: true,
    formatValue: v => `${fmt(Math.round(v))} min`,
    formatAvg: v => `${(Math.round(v * 10) / 10).toFixed(1)} min`
  },
  ad: {
    color: '#22c1a0',
    // A proposal can be generated any day of the week, weekends included.
    businessDaysOnly: false,
    formatValue: v => { const r = Math.round(v); return `${fmt(r)} ${r === 1 ? 'proposal' : 'proposals'}`; },
    formatAvg: v => { const r = Math.round(v * 10) / 10; return `${r.toFixed(1)} ${r === 1 ? 'proposal' : 'proposals'}`; }
  }
};
const state = { ktrade: { view: 'daily', anchor: null }, ad: { view: 'daily', anchor: null } };
const seriesData = { ktrade: [], ad: [] };

function seriesMap(list) { const m = new Map(); list.forEach(p => m.set(p.key, p.value)); return m; }
const isWeekday = key => { const dow = parseKey(key).getUTCDay(); return dow !== 0 && dow !== 6; };
// Weekends are hidden for a business-days-only project (nothing ever happens
// then), EXCEPT today -- today's status should always be visible even if
// today happens to fall on a weekend.
const keepDay = (key, businessDaysOnly, todayKey) => !businessDaysOnly || isWeekday(key) || key === todayKey;
function buildDaily(list, businessDaysOnly, todayKey) {
  const filtered = list.filter(p => keepDay(p.key, businessDaysOnly, todayKey));
  return filtered.slice(businessDaysOnly ? -5 : -7).map(p => ({ key: p.key, value: p.value, label: shortDate(p.key) }));
}
function buildWeekly(list, anchorKey, businessDaysOnly, todayKey) {
  const map = seriesMap(list), monday = mondayOf(anchorKey), days = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(monday, i);
    if (!keepDay(key, businessDaysOnly, todayKey)) continue;
    days.push({ key, value: map.get(key) || 0, label: weekdayShort(key) });
  }
  return days;
}
function buildMonthly(list, anchorKey, businessDaysOnly, todayKey) {
  const map = seriesMap(list), start = monthStart(anchorKey), count = daysInMonth(start), days = [];
  for (let i = 0; i < count; i++) { const key = addDays(start, i); if (keepDay(key, businessDaysOnly, todayKey)) days.push({ key, value: map.get(key) || 0, label: String(i + 1) }); }
  return days;
}
function periodLabelFor(view, anchorKey, businessDaysOnly, days) {
  if (view === 'daily') return businessDaysOnly ? 'Last 5 business days' : 'Last 7 days';
  if (view === 'weekly') return `${shortDate(days[0].key)} – ${shortDate(days[days.length - 1].key)}`;
  return parseKey(monthStart(anchorKey)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function updateNavUI(project, list) {
  const st = state[project];
  const nav = document.querySelector(`.period-nav[data-project="${project}"]`);
  const prevBtn = nav.querySelector('[data-dir="-1"]'), nextBtn = nav.querySelector('[data-dir="1"]');
  if (st.view === 'daily' || !list.length) { nav.classList.add('is-hidden'); return; }
  nav.classList.remove('is-hidden');
  const firstKey = list[0].key, lastKey = list[list.length - 1].key;
  if (st.view === 'weekly') {
    const cur = mondayOf(st.anchor);
    prevBtn.disabled = cur <= mondayOf(firstKey);
    nextBtn.disabled = cur >= mondayOf(lastKey);
  } else {
    const cur = st.anchor.slice(0, 7);
    prevBtn.disabled = cur <= firstKey.slice(0, 7);
    nextBtn.disabled = cur >= lastKey.slice(0, 7);
  }
}

function renderProject(project) {
  const cfg = PROJECTS[project], list = seriesData[project], st = state[project];
  const canvas = $(`${project}-bar-chart`), empty = $(`${project}-bar-empty`), tbody = $(`${project}-table-body`);
  if (!list.length) {
    empty.style.display = ''; canvas.style.visibility = 'hidden';
    ['total', 'avg', 'high', 'low'].forEach(k => $(`${project}-sum-${k}`).textContent = '—');
    tbody.innerHTML = '';
    updateNavUI(project, list);
    return;
  }
  empty.style.display = 'none'; canvas.style.visibility = 'visible';
  if (!st.anchor) st.anchor = list[list.length - 1].key;

  const todayKey = list[list.length - 1].key;
  const days = st.view === 'daily' ? buildDaily(list, cfg.businessDaysOnly, todayKey) : st.view === 'weekly' ? buildWeekly(list, st.anchor, cfg.businessDaysOnly, todayKey) : buildMonthly(list, st.anchor, cfg.businessDaysOnly, todayKey);
  // The period text always rides beside the chart's own label -- Daily,
  // Weekly and Monthly all show it in the same spot. The nav row (visible
  // for Weekly/Monthly) carries only the prev/next arrows.
  $(`${project}-period-caption`).textContent = periodLabelFor(st.view, st.anchor, cfg.businessDaysOnly, days);
  const todayInView = days.some(d => d.key === todayKey);
  $(`${project}-today-chip`).style.display = todayInView ? '' : 'none';
  barChart(`${project}-bar-chart`, days, { color: cfg.color, formatValue: cfg.formatValue, showValueLabels: days.length <= 8, tooltipId: `${project}-tooltip`, todayKey: todayInView ? todayKey : null, todayColor: '#f4a63a' });

  const total = days.reduce((s, d) => s + d.value, 0);
  const avg = total / days.length;
  let highest = days[0], lowest = days[0];
  for (const d of days) { if (d.value > highest.value) highest = d; if (d.value < lowest.value) lowest = d; }
  const elTotal = $(`${project}-sum-total`), elAvg = $(`${project}-sum-avg`), elHigh = $(`${project}-sum-high`), elLow = $(`${project}-sum-low`);
  animateNumber(elTotal, total, v => elTotal.textContent = cfg.formatValue(v));
  // When nothing happened all period, "average/highest/lowest" all tie at
  // zero -- attaching an arbitrary date to that is noise, not information.
  if (total === 0) {
    numberAnimState.delete(elAvg); numberAnimState.delete(elHigh); numberAnimState.delete(elLow);
    elAvg.textContent = elHigh.textContent = elLow.textContent = '—';
  } else {
    animateNumber(elAvg, avg, v => elAvg.textContent = cfg.formatAvg(v));
    animateNumber(elHigh, highest.value, v => elHigh.textContent = `${cfg.formatValue(v)} · ${shortDate(highest.key)}`);
    animateNumber(elLow, lowest.value, v => elLow.textContent = `${cfg.formatValue(v)} · ${shortDate(lowest.key)}`);
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const d of days) {
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td'); tdDate.textContent = fullDate(d.key);
    const tdVal = document.createElement('td'); tdVal.textContent = cfg.formatValue(d.value);
    tr.append(tdDate, tdVal); frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  updateNavUI(project, list);
}

function positionTabIndicator(tabs) {
  const indicator = tabs.querySelector('.tab-indicator');
  const active = tabs.querySelector('.view-tab.active');
  if (!indicator || !active) return;
  indicator.style.left = `${active.offsetLeft}px`;
  indicator.style.width = `${active.offsetWidth}px`;
}
document.querySelectorAll('.view-tabs').forEach(tabs => {
  const project = tabs.dataset.project;
  positionTabIndicator(tabs);
  tabs.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      tabs.querySelectorAll('.view-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
      positionTabIndicator(tabs);
      state[project].view = btn.dataset.view;
      if (seriesData[project].length) state[project].anchor = seriesData[project][seriesData[project].length - 1].key;
      renderProject(project);
    });
  });
});
window.addEventListener('resize', () => document.querySelectorAll('.view-tabs').forEach(positionTabIndicator));
document.querySelectorAll('.period-nav').forEach(nav => {
  const project = nav.dataset.project;
  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.dir), st = state[project];
      st.anchor = st.view === 'weekly' ? addDays(mondayOf(st.anchor), dir * 7)
        : (() => { const d = parseKey(monthStart(st.anchor)); d.setUTCMonth(d.getUTCMonth() + dir); return d.toISOString().slice(0, 10); })();
      renderProject(project);
    });
  });
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderProject('ktrade'); renderProject('ad'); }, 150); });

// ---- alerts / agent status (unchanged logic, independent of the charts above) ----
function buildAlerts(k, ad) {
  let alerts = [];
  if (k.statusLevel === 'red') alerts.push({ level: 'critical', title: 'K-Trade is offline', desc: k.statusNote || k.reason || 'Connection failed.', tag: 'Action needed' });
  else if (k.statusLevel === 'amber') alerts.push({ level: 'warning', title: 'K-Trade has a flagged issue', desc: k.statusNote, tag: 'Monitor' });
  if (ad) {
    if (ad.statusLevel === 'red') alerts.push({ level: 'critical', title: 'AD Engineering is offline', desc: ad.statusNote || ad.reason || 'Connection failed.', tag: 'Action needed' });
    else if (ad.statusLevel === 'amber') alerts.push({ level: 'warning', title: 'AD Engineering has a flagged issue', desc: ad.statusNote, tag: 'Monitor' });
  }
  if (ad?.connected && ad.remaining === 0) alerts.push({ level: 'critical', title: 'AD Engineering limit reached', desc: `All ${ad.monthlyLimit} proposals for this month have been generated.`, tag: 'Action needed' });
  else if (ad?.connected && ad.monthlyLimit && ad.remaining <= Math.ceil(ad.monthlyLimit * .2)) alerts.push({ level: 'warning', title: 'AD Engineering balance running low', desc: `${ad.remaining} of ${ad.monthlyLimit} proposals remaining this month.`, tag: 'Monitor' });
  if (k.connected && k.utilisation >= 90) alerts.push({ level: 'critical', title: 'K-Trade minutes nearly exhausted', desc: `${k.utilisation}% of allocated minutes used.`, tag: 'Action needed' });
  else if (k.connected && k.utilisation >= 75) alerts.push({ level: 'warning', title: 'K-Trade usage trending high', desc: `${k.utilisation}% of allocated minutes used.`, tag: 'Monitor' });
  return alerts;
}
const statusColor = level => level === 'green' ? '#42c985' : level === 'amber' ? '#f4a63a' : '#ed5365';
function renderAgentStatus(k, ad) {
  const kLevel = k.statusLevel || (k.connected ? 'green' : 'red');
  $('status-dot-ktrade').style.background = statusColor(kLevel);
  $('status-note-ktrade').textContent = k.statusNote || (k.connected ? 'Operational' : (k.reason || 'Not connected'));
  const adLevel = ad?.statusLevel || (ad?.connected ? 'green' : 'red');
  $('status-dot-ad').style.background = statusColor(adLevel);
  $('status-note-ad').textContent = ad?.statusNote || (ad?.connected ? 'Operational' : (ad?.reason || 'Not connected'));
}
function renderAlerts(alerts) {
  const badge = $('alert-count'); badge.textContent = alerts.length; badge.style.display = alerts.length ? '' : 'none';
  const list = $('alerts-list');
  list.innerHTML = alerts.length ? alerts.map(a => `<div class="alert ${a.level}"><i></i><div><strong>${a.title}</strong><p>${a.desc}</p></div><span>${a.tag}</span></div>`).join('') : '<div class="alert-empty">No active alerts — all systems normal.</div>';
}

function show(d) {
  const k = d.ktrade, ad = d.adEngineering;
  renderAgentStatus(k, ad);
  if (k.connected) {
    animateNumber($('calls-used'), k.conversations, v => $('calls-used').textContent = fmt(v));
    animateNumber($('minutes-used'), k.consumedMinutes, v => $('minutes-used').textContent = duration(v));
    animateNumber($('minutes-left'), k.remainingMinutes, v => $('minutes-left').textContent = duration(v));
    $('minutes-caption').textContent = `${duration(k.allocatedMinutes)} total allocation · ${k.utilisation}% utilisation`;
    $('ktrade-badge').textContent = 'Live source'; $('ktrade-badge').className = 'badge live';
    seriesData.ktrade = k.dailyMinutes || [];
  } else {
    $('minutes-caption').textContent = k.reason || 'K-Trade is not connected.';
    $('ktrade-badge').textContent = 'Offline'; $('ktrade-badge').className = 'badge pending';
    seriesData.ktrade = [];
  }
  if (ad?.connected) {
    animateNumber($('proposals-generated'), ad.generatedThisMonth, v => $('proposals-generated').textContent = `${fmt(v)} / ${ad.monthlyLimit}`);
    animateNumber($('proposals-remaining'), ad.remaining, v => $('proposals-remaining').textContent = fmt(v));
    $('proposals-caption').textContent = `${ad.monthlyLimit} monthly limit · ${ad.utilisation}% used`;
    $('ad-badge').textContent = ad.remaining ? 'Live source' : 'Limit reached';
    $('ad-badge').className = `badge ${ad.remaining ? 'live' : 'pending'}`;
    seriesData.ad = ad.dailyProposals || [];
  } else {
    $('proposals-caption').textContent = ad?.reason || 'AD Engineering is not connected.';
    $('ad-badge').textContent = 'Offline'; $('ad-badge').className = 'badge pending';
    seriesData.ad = [];
  }
  renderProject('ktrade');
  renderProject('ad');
  renderAlerts(buildAlerts(k, ad));
  const overallOk = k.connected && ad?.connected;
  $('status-dot').style.background = overallOk ? '#42c985' : '#ed5365';
  $('status').textContent = overallOk ? 'K-Trade and AD Engineering connections are healthy.' : 'One or more sources are not connected — see Agent Status above.';
  $('updated').textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

(function initHeader() {
  const now = new Date();
  $('today').textContent = now.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  $('period').textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
})();
function setLoading(on) { $('loading-overlay').classList.toggle('show', on); }
function tilt(el, e) { const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = `perspective(2200px) rotateX(${(-y * 1.5).toFixed(2)}deg) rotateY(${(x * 1.5).toFixed(2)}deg) translateY(-1px)`; }
document.querySelectorAll('.panel').forEach(el => { el.addEventListener('mousemove', e => tilt(el, e)); el.addEventListener('mouseleave', () => el.style.transform = ''); });
// Selecting K-Trade / AD Engineering -- from the sidebar or from an Agent
// Status chip -- focuses the page on just that project's section.
// Overview / Alerts, or re-selecting the active chip, show both again.
let activeProjectFocus = null;
function applyProjectFocus(key) {
  activeProjectFocus = key;
  $('ktrade').style.display = (!key || key === 'ktrade') ? '' : 'none';
  $('ktrade-issues').style.display = (!key || key === 'ktrade') ? '' : 'none';
  $('ad').style.display = (!key || key === 'ad') ? '' : 'none';
  $('ad-issues').style.display = (!key || key === 'ad') ? '' : 'none';
  document.querySelectorAll('.status-chip').forEach(chip => chip.classList.toggle('selected', chip.dataset.key === key));
  document.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
  const navLink = document.querySelector(`nav a[href="#${key || 'overview'}"]`);
  if (navLink) navLink.classList.add('active');
}
document.querySelectorAll('nav a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const targetId = a.getAttribute('href').slice(1);
    applyProjectFocus(targetId === 'ktrade' || targetId === 'ad' ? targetId : null);
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
});
document.querySelectorAll('.status-chip').forEach(chip => {
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  const activate = () => {
    const key = chip.dataset.key;
    applyProjectFocus(activeProjectFocus === key ? null : key);
    $(activeProjectFocus || 'overview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  chip.addEventListener('click', activate);
  chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
});
// ---- Issue resolution logs (static support records, not part of the live snapshot) ----
const ISSUE_LOGS = {
  ktrade: [
    { text: 'SIP public IP 125.209.82.82 changed to 61.5.144.162', category: 'Infrastructure', raised: '21 Jul 2026', resolved: '21 Jul 2026' },
    { text: 'New ISP IP 125.209.97.10 added to the SIP trunk', category: 'Infrastructure', raised: '1 Aug 2026', resolved: '1 Aug 2026' },
    { text: 'SIP connectivity issue — packets not reaching the PBX', category: 'Infrastructure', raised: '22 Jul 2026', resolved: '3 Aug 2026' },
    { text: 'Call routing on extension 801', category: 'Infrastructure', raised: '3 Aug 2026', resolved: '3 Aug 2026' },
    { text: 'Call #10 — unclear conversation, no proper response', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'Call #20 — AI response was significantly delayed', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'Call #33 — conversation could not proceed / customer unable to speak', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: "Call #28 — AI didn't answer a question about the updated application", category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'IPO Book Building — AI gave incorrect information (hallucination)', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'AI went unresponsive at the end of a conversation', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'Bot completely unresponsive; customer questions missing from the transcript', category: 'AI Behavior', raised: '27 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'Separate extensions required per department', category: 'Process', raised: '3 Aug 2026', resolved: '28 Aug 2026' },
    { text: 'SIM calls not reaching new extensions (802 and others)', category: 'Infrastructure', raised: '3 Aug 2026', resolved: '28 Aug 2026' }
  ],
  ad: [
    { text: 'A solicitation failed to generate a proposal even after earlier pipeline fixes', category: 'Proposal Pipeline', raised: '1 Sep 2026', resolved: '2 Sep 2026' }
  ]
};
function renderIssues(project) {
  const issues = ISSUE_LOGS[project];
  const list = $(`${project}-issues-list`);
  if (!issues || !list) return;
  const resolvedCount = issues.filter(i => i.resolved).length;
  $(`${project}-issues-progress-badge`).textContent = `${resolvedCount} / ${issues.length} Resolved`;
  requestAnimationFrame(() => { $(`${project}-issues-progress-fill`).style.width = `${(resolvedCount / issues.length) * 100}%`; });
  const frag = document.createDocumentFragment();
  issues.forEach((issue, i) => {
    const row = document.createElement('div');
    row.className = 'issue-row';
    row.style.animationDelay = `${Math.min(i * 0.04, 0.4)}s`;

    const num = document.createElement('span'); num.className = 'issue-num'; num.textContent = i + 1;

    const body = document.createElement('div'); body.className = 'issue-body';
    const text = document.createElement('span'); text.className = 'issue-text'; text.textContent = issue.text;
    const cat = document.createElement('span'); cat.className = 'issue-category'; cat.textContent = issue.category;
    const dates = document.createElement('span'); dates.className = 'issue-dates';
    dates.textContent = issue.resolved ? `Raised ${issue.raised} · Resolved ${issue.resolved}` : `Raised ${issue.raised} · Resolution date pending`;
    body.append(text, document.createElement('br'), cat, dates);
    if (issue.note) {
      const note = document.createElement('span'); note.className = 'issue-dates'; note.textContent = issue.note;
      body.append(document.createElement('br'), note);
    }

    const status = document.createElement('span'); status.className = 'issue-status resolved'; status.textContent = 'Resolved';

    row.append(num, body, status);
    frag.appendChild(row);
  });
  list.appendChild(frag);
}
function setupIssuesToggle(project) {
  const toggleEl = $(`${project}-issues-toggle`);
  if (!toggleEl) return;
  const activate = () => {
    const expanded = toggleEl.getAttribute('aria-expanded') === 'true';
    toggleEl.setAttribute('aria-expanded', String(!expanded));
    $(`${project}-issues-list`).classList.toggle('open', !expanded);
  };
  toggleEl.addEventListener('click', activate);
  toggleEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
}
['ktrade', 'ad'].forEach(project => { renderIssues(project); setupIssuesToggle(project); });

async function load() {
  setLoading(true);
  try { show(await fetch('/api/kpis?live=1', { cache: 'no-store' }).then(r => r.json())); }
  catch (e) {
    try { show(await fetch('/api/kpis', { cache: 'no-store' }).then(r => r.json())); }
    catch (e2) { $('status').textContent = (e2 || e).message || 'Live data could not be loaded.'; $('status-dot').style.background = '#ed5365'; }
  } finally { setLoading(false); }
}
$('refresh').addEventListener('click', async () => { const b = $('refresh'); b.classList.add('loading'); b.querySelector('.label').textContent = 'Loading'; await load(); b.classList.remove('loading'); b.querySelector('.label').textContent = 'Refresh'; });
load();

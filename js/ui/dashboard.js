/* =============================================
   SRScreen — Dashboard UI Module (dashboard.js)
   KPI countUp, Canvas donut, PRISMA SVG, recent runs
   ============================================= */

import * as DB from '../db.js';

let initialized = false;

export async function initDashboard({ switchTab, toast }) {
  // Refresh every time tab is visited
  await refreshDashboard({ switchTab, toast });
  initialized = true;
}

export async function refreshDashboard({ switchTab, toast }) {
  const stats = await DB.getAggregateStats();

  // KPI cards — animate count up
  animateValue('kpi-total', stats.total);
  animateValue('kpi-included', stats.included);
  animateValue('kpi-excluded', stats.excluded);
  animateValue('kpi-uncertain', stats.uncertain);

  // Banner visibility
  const banner = document.getElementById('dash-banner');
  const hasKey = !!localStorage.getItem('srscreen:apikey');
  if (banner) banner.style.display = hasKey ? 'none' : 'flex';

  // Banner link
  const link = document.getElementById('dash-banner-link');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (switchTab) switchTab('settings');
    });
  }

  // Donut chart
  drawDonut(stats);

  // PRISMA flow
  await drawPRISMA(stats);

  // Recent runs
  await renderRecentRuns({ switchTab });
}

/* ─── CountUp Animation ────────────────────── */

function animateValue(elementId, target, duration = 800) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const start = parseInt(el.textContent) || 0;
  if (start === target) { el.textContent = target.toLocaleString(); return; }

  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * eased);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

/* ─── Canvas Donut Chart ───────────────────── */

function drawDonut(stats) {
  const canvas = document.getElementById('donut-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 180;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const outerR = 80;
  const innerR = 52;

  const total = stats.total || 1; // avoid /0
  const segments = [
    { value: stats.included, color: '#00e5b4' },
    { value: stats.excluded, color: '#ff4757' },
    { value: stats.uncertain, color: '#f5a623' },
  ];

  // Animate
  const duration = 1200;
  const startTime = performance.now();

  function frame(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    ctx.clearRect(0, 0, size, size);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, (outerR + innerR) / 2, 0, Math.PI * 2);
    ctx.lineWidth = outerR - innerR;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.stroke();

    // Segments
    let startAngle = -Math.PI / 2;
    segments.forEach(seg => {
      const angle = (seg.value / total) * Math.PI * 2 * eased;
      if (angle <= 0) return;

      ctx.beginPath();
      ctx.arc(cx, cy, (outerR + innerR) / 2, startAngle, startAngle + angle);
      ctx.lineWidth = outerR - innerR;
      ctx.strokeStyle = seg.color;
      ctx.lineCap = 'round';
      ctx.stroke();
      startAngle += angle;
    });

    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Center label
  const pctEl = document.getElementById('donut-pct');
  if (pctEl) {
    const pct = stats.total > 0 ? ((stats.included / stats.total) * 100).toFixed(1) + '%' : '—';
    pctEl.textContent = pct;
  }
}

/* ─── PRISMA Flow Diagram (SVG) ────────────── */

async function drawPRISMA(stats) {
  const wrap = document.getElementById('prisma-svg-wrap');
  if (!wrap) return;

  if (stats.total === 0) {
    wrap.innerHTML = '<div class="empty-state-small">Run a screening session to generate the PRISMA flow diagram.</div>';
    return;
  }

  const inc = stats.included;
  const exc = stats.excluded;
  const unc = stats.uncertain;

  wrap.innerHTML = `
    <svg viewBox="0 0 600 320" width="100%" style="max-width:650px">
      <!-- Boxes -->
      <rect class="prisma-box" x="180" y="10" width="240" height="56" rx="8"/>
      <text class="prisma-label" x="300" y="30" text-anchor="middle">Records Identified</text>
      <text class="prisma-value" x="300" y="52" text-anchor="middle">${stats.total}</text>

      <rect class="prisma-box" x="180" y="100" width="240" height="56" rx="8"/>
      <text class="prisma-label" x="300" y="120" text-anchor="middle">Records Screened</text>
      <text class="prisma-value" x="300" y="142" text-anchor="middle">${stats.total}</text>

      <rect class="prisma-box prisma-box-excluded" x="460" y="100" width="130" height="56" rx="8"/>
      <text class="prisma-label" x="525" y="120" text-anchor="middle">Excluded</text>
      <text class="prisma-value" x="525" y="142" text-anchor="middle" fill="var(--accent-crimson)">${exc}</text>

      <rect class="prisma-box" x="180" y="190" width="240" height="56" rx="8"/>
      <text class="prisma-label" x="300" y="210" text-anchor="middle">Uncertain / Review</text>
      <text class="prisma-value" x="300" y="232" text-anchor="middle" fill="var(--accent-amber)">${unc}</text>

      <rect class="prisma-box prisma-box-included" x="180" y="270" width="240" height="44" rx="8"/>
      <text class="prisma-label" x="300" y="286" text-anchor="middle">Included in Review</text>
      <text class="prisma-value" x="300" y="305" text-anchor="middle" fill="var(--accent-teal)">${inc}</text>

      <!-- Arrows -->
      <line class="prisma-arrow arrow-anim" x1="300" y1="66" x2="300" y2="100" style="--dash-length:34"/>
      <line class="prisma-arrow arrow-anim" x1="420" y1="128" x2="460" y2="128" style="--dash-length:40"/>
      <line class="prisma-arrow arrow-anim" x1="300" y1="156" x2="300" y2="190" style="--dash-length:34"/>
      <line class="prisma-arrow arrow-anim" x1="300" y1="246" x2="300" y2="270" style="--dash-length:24"/>
    </svg>
  `;

  // Animate arrows
  wrap.querySelectorAll('.arrow-anim').forEach((line, i) => {
    const len = line.getTotalLength ? line.getTotalLength() : 40;
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.style.animation = `drawLine 600ms var(--ease-snappy) ${150 * i}ms forwards`;
    line.style.setProperty('--dash-length', len);
  });
}

/* ─── Recent Runs ──────────────────────────── */

async function renderRecentRuns({ switchTab }) {
  const container = document.getElementById('recent-runs-list');
  if (!container) return;

  let runs = [];
  try { runs = await DB.getAllRuns(); } catch {}

  if (runs.length === 0) {
    container.innerHTML = '<div class="empty-state-small">No sessions yet. Upload articles and screen to see history here.</div>';
    return;
  }

  // Show last 5
  const recent = runs.slice(0, 5);
  container.innerHTML = recent.map((r, i) => `
    <div class="run-row anim-stagger" style="animation-delay:${i * 60}ms" data-run-id="${r.id}">
      <span class="run-id">#${r.id}</span>
      <span class="run-name">${esc(r.filename || 'Session')}</span>
      <span class="run-stats">
        <span class="inc">✅${r.includedCount || 0}</span>
        <span class="exc">❌${r.excludedCount || 0}</span>
        ${r.uncertainCount ? `<span class="unc">⚠️${r.uncertainCount}</span>` : ''}
      </span>
      <span class="run-meta">${new Date(r.timestamp).toLocaleDateString()}</span>
      <div class="run-actions">
        <button class="btn-icon" data-action="view-run" data-run-id="${r.id}" data-tooltip="View Results">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  // Wire view buttons
  container.querySelectorAll('[data-action="view-run"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const runId = parseInt(btn.dataset.runId);
      localStorage.setItem('srscreen:lastRunId', String(runId));
      if (switchTab) switchTab('results');
    });
  });
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

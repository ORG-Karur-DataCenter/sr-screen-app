/* =============================================
   SRScreen — Audit / Reasoning Log UI (audit.js)
   Run selector, audit table, expanded rows,
   aggregate stats bar, export
   ============================================= */

import * as DB from '../db.js';

let currentRunId = null;
let auditArticles = [];
let expandedAuditRow = -1;

export async function renderAudit(container, runId, { toast }) {
  currentRunId = runId || parseInt(localStorage.getItem('srscreen:lastRunId'));

  let runs = [];
  try { runs = await DB.getAllRuns(); } catch {}

  if (runs.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg width="64" height="64" fill="none" viewBox="0 0 24 24" stroke="var(--text-muted)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
      <p>No audit data. Run a screening session to view the reasoning log.</p>
    </div>`;
    return;
  }

  if (!currentRunId) currentRunId = runs[0].id;

  try {
    auditArticles = await DB.getArticlesForRun(currentRunId);
  } catch { auditArticles = []; }

  expandedAuditRow = -1;
  container.innerHTML = buildAuditHTML(runs);
  wireAuditEvents(container, toast);
  renderAuditTable(container);
}

function buildAuditHTML(runs) {
  // Aggregate stats
  const totalTokensIn = auditArticles.reduce((s, a) => s + (a.tokensIn || 0), 0);
  const totalTokensOut = auditArticles.reduce((s, a) => s + (a.tokensOut || 0), 0);
  const avgConf = auditArticles.length > 0 ? (auditArticles.reduce((s, a) => s + (a.confidence || 0), 0) / auditArticles.length).toFixed(1) : '—';
  const avgLatency = auditArticles.length > 0 ? (auditArticles.reduce((s, a) => s + (a.latencyMs || 0), 0) / auditArticles.length / 1000).toFixed(1) : '—';
  const overrides = auditArticles.filter(a => a.manualOverride).length;
  const overrideRate = auditArticles.length > 0 ? ((overrides / auditArticles.length) * 100).toFixed(1) : '0';

  return `
    <!-- Toolbar -->
    <div class="audit-toolbar">
      <div class="run-selector">
        <label>Run:</label>
        <select id="audit-run-select">
          ${runs.map(r => `<option value="${r.id}" ${r.id === currentRunId ? 'selected' : ''}>#${r.id} — ${esc(r.filename || 'Session')} (${new Date(r.timestamp).toLocaleDateString()})</option>`).join('')}
        </select>
      </div>
      <div class="search-wrap" style="flex:1;min-width:180px">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="search" id="audit-search" placeholder="Search titles, reasoning..." />
      </div>
    </div>

    <!-- Stats Bar -->
    <div class="audit-stats-bar">
      <div class="audit-stat"><span class="audit-stat-label">Total Tokens</span><span class="audit-stat-value">${(totalTokensIn + totalTokensOut).toLocaleString()}</span></div>
      <div class="audit-stat"><span class="audit-stat-label">Avg Confidence</span><span class="audit-stat-value">${avgConf}%</span></div>
      <div class="audit-stat"><span class="audit-stat-label">Avg Latency</span><span class="audit-stat-value">${avgLatency}s/article</span></div>
      <div class="audit-stat"><span class="audit-stat-label">Override Rate</span><span class="audit-stat-value">${overrideRate}%</span></div>
      <div class="audit-stat"><span class="audit-stat-label">Articles</span><span class="audit-stat-value">${auditArticles.length}</span></div>
    </div>

    <!-- Table -->
    <div class="glass-card">
      <div class="audit-table-wrap">
        <table class="audit-table" id="audit-table-el">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Decision</th>
              <th>Conf%</th>
              <th>Tokens In</th>
              <th>Tokens Out</th>
              <th>Latency</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody id="audit-tbody"></tbody>
        </table>
      </div>
    </div>

    <!-- Export -->
    <div class="audit-export-bar">
      <button class="btn btn-secondary" id="btn-export-audit-json">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
        Export Full Audit JSON
      </button>
    </div>
  `;
}

function renderAuditTable(container) {
  const tbody = container.querySelector('#audit-tbody');
  if (!tbody) return;

  const searchQ = (container.querySelector('#audit-search')?.value || '').toLowerCase();
  let items = auditArticles;
  if (searchQ) {
    items = items.filter(a =>
      (a.title || '').toLowerCase().includes(searchQ) ||
      (a.reasoning || '').toLowerCase().includes(searchQ)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No matching audit entries.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map((a, i) => {
    const icon = a.decision === 'INCLUDE' ? '✅' : a.decision === 'EXCLUDE' ? '❌' : '⚠️';
    const confCls = a.confidence >= 80 ? 'conf-high' : a.confidence >= 50 ? 'conf-medium' : 'conf-low';

    let html = `<tr class="audit-row" data-idx="${i}">
      <td class="audit-col-id">${a.index + 1}</td>
      <td class="audit-col-title" title="${esc(a.title)}">${esc((a.title || '').slice(0, 50))}${(a.title || '').length > 50 ? '…' : ''}</td>
      <td><span class="badge badge-${a.decision === 'INCLUDE' ? 'teal' : a.decision === 'EXCLUDE' ? 'crimson' : 'amber'}">${icon} ${a.decision}</span></td>
      <td><span class="conf-badge ${confCls}">${a.confidence}%</span></td>
      <td class="audit-col-tokens">${(a.tokensIn || 0).toLocaleString()}</td>
      <td class="audit-col-tokens">${(a.tokensOut || 0).toLocaleString()}</td>
      <td class="audit-col-latency">${((a.latencyMs || 0) / 1000).toFixed(1)}s</td>
      <td class="audit-col-reasoning">${esc((a.reasoning || '').slice(0, 60))}${(a.reasoning || '').length > 60 ? '…' : ''}</td>
    </tr>`;

    if (expandedAuditRow === i) {
      html += `<tr class="audit-expanded-row"><td colspan="8">
        <div class="audit-detail-grid">
          <div class="audit-prompt-block">
            <div class="audit-block-label">Prompt Sent</div>
            <pre>${esc(a.promptSent || 'Not recorded')}</pre>
          </div>
          <div class="audit-response-block">
            <div class="audit-block-label">Full AI Response</div>
            <div class="reasoning-full">${esc(a.responseFull || a.reasoning || 'Not recorded')}</div>
          </div>
        </div>
      </td></tr>`;
    }

    return html;
  }).join('');

  // Wire row click
  tbody.querySelectorAll('.audit-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx);
      expandedAuditRow = expandedAuditRow === idx ? -1 : idx;
      renderAuditTable(container);
    });
  });
}

function wireAuditEvents(container, toast) {
  // Run selector
  container.querySelector('#audit-run-select')?.addEventListener('change', async (e) => {
    currentRunId = parseInt(e.target.value);
    try { auditArticles = await DB.getArticlesForRun(currentRunId); } catch { auditArticles = []; }
    expandedAuditRow = -1;
    // Re-render just the table + stats
    const statsBar = container.querySelector('.audit-stats-bar');
    if (statsBar) {
      const totalTokensIn = auditArticles.reduce((s, a) => s + (a.tokensIn || 0), 0);
      const totalTokensOut = auditArticles.reduce((s, a) => s + (a.tokensOut || 0), 0);
      const avgConf = auditArticles.length > 0 ? (auditArticles.reduce((s, a) => s + (a.confidence || 0), 0) / auditArticles.length).toFixed(1) : '—';
      const avgLatency = auditArticles.length > 0 ? (auditArticles.reduce((s, a) => s + (a.latencyMs || 0), 0) / auditArticles.length / 1000).toFixed(1) : '—';
      statsBar.children[0].querySelector('.audit-stat-value').textContent = (totalTokensIn + totalTokensOut).toLocaleString();
      statsBar.children[1].querySelector('.audit-stat-value').textContent = avgConf + '%';
      statsBar.children[2].querySelector('.audit-stat-value').textContent = avgLatency + 's/article';
      statsBar.children[4].querySelector('.audit-stat-value').textContent = auditArticles.length;
    }
    renderAuditTable(container);
  });

  // Search with debounce
  let timer;
  container.querySelector('#audit-search')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { expandedAuditRow = -1; renderAuditTable(container); }, 250);
  });

  // Export JSON
  container.querySelector('#btn-export-audit-json')?.addEventListener('click', () => {
    const data = auditArticles.map(a => ({
      index: a.index, title: a.title, decision: a.decision, confidence: a.confidence,
      reasoning: a.reasoning, tokensIn: a.tokensIn, tokensOut: a.tokensOut,
      latencyMs: a.latencyMs, promptSent: a.promptSent, responseFull: a.responseFull,
      manualOverride: a.manualOverride, overrideReason: a.overrideReason
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_log_run_${currentRunId}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('📥 Audit log exported as JSON.', 'success');
  });
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

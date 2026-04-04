/* =============================================
   SRScreen — Results UI Module (results.js)
   Filter, table, expand, override, export
   ============================================= */

import * as DB from '../db.js';

let currentRunId = null;
let allArticles = [];
let filteredArticles = [];
let currentFilter = 'all';
let searchQuery = '';
let currentPage = 1;
const PAGE_SIZE = 25;
let expandedRow = -1;

export async function renderResults(container, runId, { toast }) {
  currentRunId = runId || parseInt(localStorage.getItem('srscreen:lastRunId'));
  if (!currentRunId) {
    container.innerHTML = `<div class="empty-state">
      <svg width="64" height="64" fill="none" viewBox="0 0 24 24" stroke="var(--text-muted)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <p>No results yet. Run a screening session first.</p>
    </div>`;
    return;
  }

  try {
    allArticles = await DB.getArticlesForRun(currentRunId);
  } catch { allArticles = []; }

  if (allArticles.length === 0) {
    container.innerHTML = '<div class="empty-state-small">No articles found for this run.</div>';
    return;
  }

  currentFilter = 'all';
  searchQuery = '';
  currentPage = 1;
  expandedRow = -1;
  applyFilters();

  container.innerHTML = buildResultsHTML();
  wireResultsEvents(container, toast);
  renderTable(container);
}

function buildResultsHTML() {
  const inc = allArticles.filter(a => a.decision === 'INCLUDE').length;
  const exc = allArticles.filter(a => a.decision === 'EXCLUDE').length;
  const unc = allArticles.filter(a => a.decision === 'UNCERTAIN').length;
  const total = allArticles.length;
  const rate = total > 0 ? ((inc / total) * 100).toFixed(1) : '0.0';

  return `
    <!-- Summary -->
    <div class="results-summary">
      <div class="result-mini"><span class="rval">${total}</span><span class="rlabel">Total</span></div>
      <div class="result-mini"><span class="rval" style="color:var(--accent-teal)">${inc}</span><span class="rlabel">Included</span></div>
      <div class="result-mini"><span class="rval" style="color:var(--accent-crimson)">${exc}</span><span class="rlabel">Excluded</span></div>
      <div class="result-mini"><span class="rval" style="color:var(--accent-amber)">${unc}</span><span class="rlabel">Uncertain</span></div>
      <div class="result-mini"><span class="rval">${rate}%</span><span class="rlabel">Include Rate</span></div>
    </div>

    <!-- Toolbar -->
    <div class="results-toolbar">
      <div class="filter-group">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="INCLUDE">✅ Included</button>
        <button class="filter-btn" data-filter="EXCLUDE">❌ Excluded</button>
        <button class="filter-btn" data-filter="UNCERTAIN">⚠️ Uncertain</button>
      </div>
      <div class="search-wrap">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="search" id="results-search" placeholder="Search title, authors..." />
      </div>
    </div>

    <!-- Table -->
    <div class="glass-card results-table-wrap">
      <div class="table-wrap">
        <table class="results-table" id="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Authors</th>
              <th>Year</th>
              <th>Title</th>
              <th>Decision</th>
              <th>Conf%</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="results-tbody"></tbody>
        </table>
      </div>
      <div class="results-pagination" id="results-pagination"></div>
    </div>

    <!-- Export -->
    <div class="glass-card export-panel">
      <h3>Export</h3>
      <div class="export-grid">
        <button class="export-btn" id="btn-export-inc-ris">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Included as RIS
          <span class="export-sub">Import to Rayyan / Covidence</span>
        </button>
        <button class="export-btn" id="btn-export-full-csv">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Full Results CSV
          <span class="export-sub">Excel / Sheets compatible</span>
        </button>
        <button class="export-btn" id="btn-export-prisma">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          PRISMA Counts JSON
          <span class="export-sub">Flow diagram data</span>
        </button>
        <button class="export-btn" id="btn-export-excluded">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Excluded List
          <span class="export-sub">PRISMA appendix</span>
        </button>
      </div>
    </div>
  `;
}

function applyFilters() {
  filteredArticles = allArticles.filter(a => {
    if (currentFilter !== 'all' && a.decision !== currentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (a.title || '').toLowerCase().includes(q) ||
             (a.authors || '').toLowerCase().includes(q) ||
             (a.reasoning || '').toLowerCase().includes(q);
    }
    return true;
  });
}

function renderTable(container) {
  const tbody = container.querySelector('#results-tbody');
  if (!tbody) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredArticles.slice(start, start + PAGE_SIZE);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No matching articles.</td></tr>';
    renderPagination(container);
    return;
  }

  tbody.innerHTML = pageItems.map((a, i) => {
    const globalIdx = start + i;
    const icon = a.decision === 'INCLUDE' ? '✅' : a.decision === 'EXCLUDE' ? '❌' : '⚠️';
    const cls = a.decision.toLowerCase();
    const override = a.manualOverride ? ' (overridden)' : '';
    const confCls = a.confidence >= 80 ? 'conf-high' : a.confidence >= 50 ? 'conf-medium' : 'conf-low';

    let html = `<tr data-idx="${globalIdx}" class="result-row">
      <td>${a.index + 1}</td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.authors?.split(';')[0] || '—')}</td>
      <td>${esc(a.year || '—')}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.title)}">${esc(a.title)}</td>
      <td><span class="badge badge-${cls === 'include' ? 'teal' : cls === 'exclude' ? 'crimson' : 'amber'}">${icon} ${a.decision}${override}</span></td>
      <td><span class="conf-badge ${confCls}">${a.confidence}%</span></td>
      <td>
        <button class="btn-icon" data-action="expand" data-idx="${globalIdx}" data-tooltip="Details">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
        </button>
      </td>
    </tr>`;

    // Expanded row
    if (expandedRow === globalIdx) {
      html += `<tr class="result-expanded-row"><td colspan="7">
        <div class="expanded-content">
          <div>
            <div class="expanded-abstract-label">Abstract</div>
            <div class="expanded-abstract">${esc(a.abstract || 'No abstract available.')}</div>
          </div>
          <div>
            <div class="expanded-reasoning">
              <div class="expanded-reasoning-label">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                AI Reasoning
              </div>
              <div class="expanded-reasoning-text">${esc(a.reasoning || 'No reasoning recorded.')}</div>
            </div>
            <div class="override-panel">
              <label>Override:</label>
              <select data-override-select="${globalIdx}">
                <option value="">— Keep AI decision —</option>
                <option value="INCLUDE" ${a.manualOverride === 'INCLUDE' ? 'selected' : ''}>INCLUDE</option>
                <option value="EXCLUDE" ${a.manualOverride === 'EXCLUDE' ? 'selected' : ''}>EXCLUDE</option>
                <option value="UNCERTAIN" ${a.manualOverride === 'UNCERTAIN' ? 'selected' : ''}>UNCERTAIN</option>
              </select>
              <input type="text" data-override-reason="${globalIdx}" placeholder="Reason for override..." value="${esc(a.overrideReason || '')}" />
              <button class="btn btn-secondary" data-override-save="${globalIdx}" style="padding:var(--space-1) var(--space-3);font-size:0.75rem">Save</button>
            </div>
          </div>
        </div>
      </td></tr>`;
    }

    return html;
  }).join('');

  // Wire expand buttons
  tbody.querySelectorAll('[data-action="expand"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      expandedRow = expandedRow === idx ? -1 : idx;
      renderTable(container);
    });
  });

  // Wire row click to expand
  tbody.querySelectorAll('.result-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.idx);
      expandedRow = expandedRow === idx ? -1 : idx;
      renderTable(container);
    });
  });

  // Wire override saves
  tbody.querySelectorAll('[data-override-save]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.overrideSave);
      const art = filteredArticles[idx];
      const sel = tbody.querySelector(`[data-override-select="${idx}"]`);
      const reason = tbody.querySelector(`[data-override-reason="${idx}"]`);
      if (sel && art) {
        art.manualOverride = sel.value || null;
        art.overrideReason = reason?.value || '';
        art.overrideTimestamp = new Date().toISOString();
        await DB.updateArticle(art);
        renderTable(container);
      }
    });
  });

  renderPagination(container);
}

function renderPagination(container) {
  const pagEl = container.querySelector('#results-pagination');
  if (!pagEl) return;
  const totalPages = Math.ceil(filteredArticles.length / PAGE_SIZE);
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }

  let html = '';
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
  }
  pagEl.innerHTML = html;
  pagEl.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      expandedRow = -1;
      renderTable(container);
    });
  });
}

function wireResultsEvents(container, toast) {
  // Filter buttons
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      currentPage = 1;
      expandedRow = -1;
      applyFilters();
      renderTable(container);
    });
  });

  // Search
  let searchTimer;
  container.querySelector('#results-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      currentPage = 1;
      expandedRow = -1;
      applyFilters();
      renderTable(container);
    }, 250);
  });

  // Exports
  container.querySelector('#btn-export-inc-ris')?.addEventListener('click', () => {
    const included = allArticles.filter(a => (a.manualOverride || a.decision) === 'INCLUDE');
    const ris = included.map(a => buildRISEntry(a)).join('\n\n');
    download(ris, 'text/plain', 'included_articles.ris');
    toast(`📥 Exported ${included.length} included articles as RIS.`, 'success');
  });

  container.querySelector('#btn-export-full-csv')?.addEventListener('click', () => {
    const csv = buildFullCSV(allArticles);
    download(csv, 'text/csv', 'screening_results.csv');
    toast('📥 Full results CSV downloaded.', 'success');
  });

  container.querySelector('#btn-export-prisma')?.addEventListener('click', () => {
    const prisma = buildPRISMAJson(allArticles);
    download(JSON.stringify(prisma, null, 2), 'application/json', 'prisma_counts.json');
    toast('📥 PRISMA counts JSON downloaded.', 'success');
  });

  container.querySelector('#btn-export-excluded')?.addEventListener('click', () => {
    const excluded = allArticles.filter(a => (a.manualOverride || a.decision) === 'EXCLUDE');
    const text = excluded.map((a, i) => `${i + 1}. ${a.title} (${a.year || '?'}) — ${a.reasoning || 'No reason'}`).join('\n');
    download(text, 'text/plain', 'excluded_list.txt');
    toast(`📥 Excluded list (${excluded.length} articles) downloaded.`, 'success');
  });
}

/* ─── Export Helpers ───────────────────────── */

function buildRISEntry(a) {
  const parts = ['TY  - JOUR'];
  if (a.title) parts.push(`TI  - ${a.title}`);
  if (a.doi) parts.push(`DO  - ${a.doi}`);
  if (a.year) parts.push(`PY  - ${a.year}`);
  if (a.journal) parts.push(`JO  - ${a.journal}`);
  if (a.authors) a.authors.split(';').forEach(au => parts.push(`AU  - ${au.trim()}`));
  if (a.abstract) parts.push(`AB  - ${a.abstract}`);
  parts.push(`N1  - SR-SCREEN: ${a.decision} (Confidence: ${a.confidence}%) — ${(a.reasoning || '').slice(0, 200)}`);
  parts.push('ER  -');
  return parts.join('\n');
}

function buildFullCSV(articles) {
  const headers = ['record_id', 'authors', 'year', 'title', 'journal', 'doi', 'abstract', 'decision', 'confidence_pct', 'ai_reasoning', 'manual_override', 'override_reason', 'override_timestamp', 'run_id'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = articles.map(a => [
    a.index + 1, a.authors, a.year, a.title, a.journal, a.doi, a.abstract,
    a.manualOverride || a.decision, a.confidence, a.reasoning,
    a.manualOverride || '', a.overrideReason || '', a.overrideTimestamp || '', a.runId
  ].map(esc).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function buildPRISMAJson(articles) {
  const total = articles.length;
  const exc = articles.filter(a => (a.manualOverride || a.decision) === 'EXCLUDE');
  const inc = articles.filter(a => (a.manualOverride || a.decision) === 'INCLUDE');
  const unc = articles.filter(a => (a.manualOverride || a.decision) === 'UNCERTAIN');

  return {
    identification: { records_identified: total, records_from_databases: total, records_from_other_sources: 0 },
    screening: {
      records_screened: total,
      records_excluded: exc.length,
      records_uncertain: unc.length,
      note: 'AI-screened title/abstract only'
    },
    included: { studies_included: inc.length }
  };
}

function download(content, mime, name) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

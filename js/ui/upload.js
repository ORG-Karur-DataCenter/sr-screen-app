/* =============================================
   SRScreen — Upload & Screen UI (upload.js)
   Dropzone, parser orchestration, live screening
   feed with typewriter effect
   ============================================= */

import { getApiKeys, getSelectedModel, getConfig, hasApiKey } from './settings.js';
import { getCriteria } from './criteria.js';
import * as DB from '../db.js';

let parsedArticles = [];
let parsedFilename = '';
let parsedFormat = '';
let screeningWorker = null;
let screeningResults = [];
let recentDecisions = [];
let startTime = 0;
let initialized = false;

/* ─── Public API ───────────────────────────── */

export function initUpload({ toast, switchTab, onScreeningComplete }) {
  if (initialized) return;
  initialized = true;

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('dropzone-browse');

  // Click / keyboard to open file picker
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter') fileInput.click(); });
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

  // Drag & drop
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, toast);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0], toast);
  });

  // Clear file
  document.getElementById('btn-clear-file')?.addEventListener('click', () => {
    parsedArticles = [];
    parsedFilename = '';
    parsedFormat = '';
    document.getElementById('prescan-card').hidden = true;
    document.getElementById('screening-feed').hidden = true;
    dropzone.style.display = '';
    toast('File cleared.', 'info');
  });

  // Begin screening
  document.getElementById('btn-begin-screening')?.addEventListener('click', () => {
    startScreening(toast, switchTab, onScreeningComplete);
  });

  // Pause / Resume
  document.getElementById('btn-pause')?.addEventListener('click', () => {
    if (!screeningWorker) return;
    const btn = document.getElementById('btn-pause');
    if (btn.textContent === 'Pause') {
      screeningWorker.postMessage({ type: 'PAUSE' });
      btn.textContent = 'Resume';
      document.getElementById('screening-status-text').textContent = 'Paused';
      document.getElementById('screening-status-text').classList.add('paused');
    } else {
      screeningWorker.postMessage({ type: 'RESUME' });
      btn.textContent = 'Pause';
      document.getElementById('screening-status-text').textContent = 'Screening in Progress';
      document.getElementById('screening-status-text').classList.remove('paused');
    }
  });

  // Abort
  document.getElementById('btn-abort')?.addEventListener('click', () => {
    if (!screeningWorker) return;
    if (!confirm('Abort screening? Partial results will be saved.')) return;
    screeningWorker.postMessage({ type: 'ABORT' });
  });
}

/* ─── Handle file drop/selection ───────────── */

async function handleFile(file, toast) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['bib', 'ris', 'csv'].includes(ext)) {
    toast(`❌ Unsupported format .${ext} — use .bib, .ris, or .csv`, 'error');
    return;
  }

  toast('Parsing file...', 'info');

  try {
    const text = await file.text();
    const worker = new Worker('js/workers/parser-worker.js');

    worker.onmessage = (e) => {
      const msg = e.data;
      worker.terminate();

      if (msg.type === 'PARSE_COMPLETE') {
        parsedArticles = msg.payload.articles;
        parsedFilename = file.name;
        parsedFormat = msg.payload.detectedFormat;
        showPrescanCard(file, toast);
      } else if (msg.type === 'PARSE_ERROR') {
        toast(`❌ Parse error: ${msg.payload.message}`, 'error');
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      toast(`❌ Worker error: ${err.message}`, 'error');
    };

    worker.postMessage({
      type: 'PARSE',
      payload: { rawText: text, format: ext === 'bib' ? 'bibtex' : ext, filename: file.name }
    });
  } catch (err) {
    toast(`❌ Failed to read file: ${err.message}`, 'error');
  }
}

/* ─── Pre-scan Summary Card ────────────────── */

function showPrescanCard(file, toast) {
  document.getElementById('dropzone').style.display = 'none';
  const card = document.getElementById('prescan-card');
  card.hidden = false;

  const hasKey = hasApiKey();
  const model = getSelectedModel();
  const criteria = getCriteria();
  const hasCriteria = criteria.inclusion_keywords.terms.length > 0 || criteria.pico.P || criteria.study_types.length > 0;

  const grid = document.getElementById('prescan-grid');
  grid.innerHTML = `
    <div class="prescan-item"><span class="prescan-label">File</span><span class="prescan-value">${escapeHtml(file.name)}</span></div>
    <div class="prescan-item"><span class="prescan-label">Format</span><span class="prescan-value">${parsedFormat}</span></div>
    <div class="prescan-item"><span class="prescan-label">Articles</span><span class="prescan-value mono">${parsedArticles.length.toLocaleString()}</span></div>
    <div class="prescan-item"><span class="prescan-label">Model</span><span class="prescan-value mono">${model}</span></div>
    <div class="prescan-item"><span class="prescan-label">Criteria</span><span class="prescan-value">${hasCriteria ? '✅ Set' : '⚠️ Not set'}</span></div>
    <div class="prescan-item"><span class="prescan-label">API Key</span><span class="prescan-value">${hasKey ? '✅ Configured' : '❌ Missing'}</span></div>
  `;

  const btn = document.getElementById('btn-begin-screening');
  btn.disabled = !hasKey || parsedArticles.length === 0;

  if (!hasKey) toast('⚠️ Set your Gemini API key in Settings before screening.', 'warn');
  if (!hasCriteria) toast('⚠️ No criteria defined — the AI may screen with default behavior.', 'warn');
  if (parsedArticles.length > 0) toast(`✅ Parsed ${parsedArticles.length} articles from ${file.name}`, 'success');
}

/* ─── Start Screening ──────────────────────── */

function startScreening(toast, switchTab, onScreeningComplete) {
  const apiKeys = getApiKeys();
  const model = getSelectedModel();
  const config = getConfig();
  const criteria = getCriteria();

  if (apiKeys.length === 0) { toast('❌ No API keys. Go to Settings.', 'error'); return; }
  if (parsedArticles.length === 0) { toast('❌ No articles loaded.', 'error'); return; }

  // Show feed, hide prescan
  document.getElementById('prescan-card').hidden = true;
  const feed = document.getElementById('screening-feed');
  feed.hidden = false;

  // Reset state
  screeningResults = [];
  recentDecisions = [];
  startTime = performance.now();
  document.getElementById('btn-pause').textContent = 'Pause';
  document.getElementById('screening-status-text').textContent = 'Screening in Progress';
  document.getElementById('screening-status-text').classList.remove('paused');
  document.getElementById('screening-progress').style.width = '0%';
  document.getElementById('screening-counter').textContent = `0 / ${parsedArticles.length}`;
  document.getElementById('screening-eta').textContent = '';
  document.getElementById('recent-decisions-list').innerHTML = '';
  document.getElementById('decision-display').innerHTML = '';
  document.getElementById('ai-reasoning-text').innerHTML = '<span class="typewriter-cursor"></span>';

  // Create worker
  screeningWorker = new Worker('js/workers/screening-worker.js');

  screeningWorker.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'PROGRESS') {
      handleProgress(msg.payload);
    }

    if (msg.type === 'ERROR') {
      const p = msg.payload;
      // Log full details to console for debugging (do not surface raw errorType to users)
      try { console.error('Screening worker ERROR payload:', p); } catch (e) {}

      if (p.isRateLimit) {
        // Friendly rate-limit message
        const retryText = p.retriesLeft > 0 ? ` Retrying (${p.retriesLeft} left)…` : ' No retries left.';
        toast(`⏳ Rate limited on #${p.index + 1}.${retryText}`, 'warn');
      } else if (p.isServiceUnavailable) {
        // Service unavailable - concise message
        toast('⚠️ Service temporarily unavailable. Retrying shortly…', 'error');
      } else {
        // Generic user-friendly error; full details are in console
        toast('⚠️ API error encountered. Check console for details.', 'error');
      }
    }

    if (msg.type === 'COMPLETE' || msg.type === 'ABORTED') {
      screeningWorker.terminate();
      screeningWorker = null;

      const isAborted = msg.type === 'ABORTED';
      const results = msg.payload.results || screeningResults;
      const summary = msg.payload.summary || {};

      document.getElementById('screening-progress').style.width = '100%';
      document.getElementById('screening-progress').classList.remove('processing');
      document.getElementById('screening-status-text').textContent = isAborted ? 'Aborted' : 'Complete';

      toast(isAborted ? '⚠️ Screening aborted. Partial results saved.' : '✅ Screening complete!', isAborted ? 'warn' : 'success');

      // Save to IndexedDB
      saveScreeningRun(results, summary, isAborted).then(() => {
        if (onScreeningComplete) onScreeningComplete(results, summary, isAborted);
      });
    }

    if (msg.type === 'PAUSED') {
      toast('⏸ Screening paused.', 'info');
    }
  };

  screeningWorker.onerror = (err) => {
    screeningWorker.terminate();
    screeningWorker = null;
    toast(`❌ Fatal worker error: ${err.message}`, 'error');
  };

  // Start
  screeningWorker.postMessage({
    type: 'START',
    payload: { articles: parsedArticles, criteria, apiKeys, model, config }
  });

  toast('🚀 Screening started!', 'success');
}

/* ─── Handle Progress Updates ──────────────── */

function handleProgress(p) {
  screeningResults.push(p);

  const pct = ((p.index + 1) / p.total * 100).toFixed(1);
  document.getElementById('screening-progress').style.width = pct + '%';
  document.getElementById('screening-counter').textContent = `${p.index + 1} / ${p.total}`;

  // ETA
  const elapsed = performance.now() - startTime;
  const avgMs = elapsed / (p.index + 1);
  const remaining = avgMs * (p.total - p.index - 1);
  document.getElementById('screening-eta').textContent = `≈ ${formatDuration(remaining)} left`;

  // Current article card
  document.getElementById('article-index-badge').textContent = `Now Screening #${p.index + 1}`;
  document.getElementById('article-title').textContent = p.article.title || '[No title]';
  document.getElementById('article-meta').innerHTML = `
    <span>${escapeHtml(p.article.authors?.split(';')[0] || 'Unknown')} ${p.article.year ? `(${p.article.year})` : ''}</span>
    ${p.article.journal ? `<span>${escapeHtml(p.article.journal)}</span>` : ''}
  `;

  // Typewriter effect for reasoning
  typewriteReasoning(p.reasoning || '');

  // Decision badge
  const decDisplay = document.getElementById('decision-display');
  const icon = p.decision === 'INCLUDE' ? '✅' : p.decision === 'EXCLUDE' ? '❌' : '⚠️';
  const cls = p.decision.toLowerCase();
  decDisplay.innerHTML = `
    <span class="decision-badge ${cls}">${icon} ${p.decision}</span>
    <span class="decision-conf">Confidence: ${p.confidence}%</span>
  `;

  // Recent decisions (ring buffer of 10)
  recentDecisions.unshift(p);
  if (recentDecisions.length > 10) recentDecisions.pop();
  renderRecentDecisions();
}

/* ─── Typewriter Effect ────────────────────── */

function typewriteReasoning(text) {
  const el = document.getElementById('ai-reasoning-text');
  el.innerHTML = '';
  let i = 0;
  const interval = 18; // ms per character

  function addChar() {
    if (i < text.length) {
      el.textContent = text.slice(0, i + 1);
      i++;
      setTimeout(addChar, interval);
    } else {
      // Remove cursor when done
      el.innerHTML = escapeHtml(text);
    }
  }

  // Add cursor
  el.innerHTML = '<span class="typewriter-cursor"></span>';
  setTimeout(addChar, 100);
}

/* ─── Recent Decisions List ────────────────── */

function renderRecentDecisions() {
  const container = document.getElementById('recent-decisions-list');
  container.innerHTML = recentDecisions.map(d => {
    const icon = d.decision === 'INCLUDE' ? '✅' : d.decision === 'EXCLUDE' ? '❌' : '⚠️';
    return `
      <div class="recent-decision-item">
        <span class="recent-decision-icon">${icon}</span>
        <span class="recent-decision-index">#${d.index + 1}</span>
        <span class="recent-decision-title">${escapeHtml((d.article?.title || d.title || '').slice(0, 80))}</span>
        <span class="recent-decision-conf">(${d.confidence}%)</span>
      </div>
    `;
  }).join('');
}

/* ─── Save Run ─────────────────────────────── */

async function saveScreeningRun(results, summary, isAborted) {
  const run = {
    timestamp: new Date().toISOString(),
    filename: parsedFilename,
    format: parsedFormat,
    status: isAborted ? 'aborted' : 'complete',
    totalArticles: results.length,
    includedCount: results.filter(r => r.decision === 'INCLUDE').length,
    excludedCount: results.filter(r => r.decision === 'EXCLUDE').length,
    uncertainCount: results.filter(r => r.decision === 'UNCERTAIN').length,
    totalTokensIn: summary.totalTokensIn || 0,
    totalTokensOut: summary.totalTokensOut || 0,
    durationMs: summary.durationMs || 0,
    criteriaSnapshot: getCriteria()
  };

  const runId = await DB.saveRun(run);

  // Save articles
  const articles = results.map((r, i) => ({
    runId,
    index: i,
    bibkey: r.bibkey || '',
    title: r.title || r.article?.title || '',
    authors: r.authors || r.article?.authors || '',
    year: r.year || r.article?.year || '',
    abstract: r.abstract || r.article?.abstract || '',
    journal: r.journal || r.article?.journal || '',
    doi: r.doi || r.article?.doi || '',
    decision: r.decision,
    confidence: r.confidence,
    reasoning: r.reasoning,
    promptSent: r.promptSent || '',
    responseFull: r.responseFull || '',
    tokensIn: r.tokensIn || 0,
    tokensOut: r.tokensOut || 0,
    latencyMs: r.latencyMs || 0,
    manualOverride: null,
    overrideReason: ''
  }));

  await DB.saveArticles(articles);
  localStorage.setItem('srscreen:lastRunId', String(runId));
}

/* ─── Helpers ──────────────────────────────── */

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

function formatDuration(ms) {
  if (ms < 1000) return '< 1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

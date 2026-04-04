/* =============================================
   SRScreen — Settings UI Module (settings.js)
   API key, model picker, screening config, history
   ============================================= */

import * as DB from '../db.js';

const STORAGE_KEYS = {
  apiKey: 'srscreen:apikey', // Legacy
  apiKeys: 'srscreen:apikeys',
  model: 'srscreen:model',
  config: 'srscreen:config'
};

const MODELS = [
  { id: 'gemini-2.0-flash', name: 'gemini-2.0-flash', desc: 'Fast, cheap — recommended for large batches', cost: '~$0.01 / 1k articles' },
  { id: 'gemini-1.5-pro', name: 'gemini-1.5-pro', desc: 'Highest quality, slower, more expensive', cost: '~$0.18 / 1k articles' },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'gemini-2.5-flash (preview)', desc: 'Latest experimental model', cost: '~$0.02 / 1k articles' },
];

let initialized = false;

/* ─── Public API ───────────────────────────── */

export function initSettings(container, { onApiKeyChange, toast }) {
  if (initialized) return;
  initialized = true;

  container.innerHTML = buildSettingsHTML();
  wireEvents(container, { onApiKeyChange, toast });
  loadSavedValues();
  renderHistory(container);
}

export function getApiKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.apiKeys);
    if (raw) return JSON.parse(raw);
  } catch {}
  
  // Legacy single key migration
  const oldKey = localStorage.getItem(STORAGE_KEYS.apiKey);
  if (oldKey) {
    try {
      const key = atob(oldKey);
      localStorage.setItem(STORAGE_KEYS.apiKeys, JSON.stringify([key]));
      localStorage.removeItem(STORAGE_KEYS.apiKey);
      return [key];
    } catch {}
  }
  return [];
}

export function getSelectedModel() {
  return localStorage.getItem(STORAGE_KEYS.model) || MODELS[0].id;
}

export function getConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.config);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { batchSize: 10, requestDelayMs: 100, temperature: 0.1, maxTokens: 512, retryLimit: 3 };
}

export function hasApiKey() {
  return getApiKeys().length > 0;
}

export async function refreshHistory(container) {
  await renderHistory(container || document.getElementById('settings-layout'));
}

/* ─── Build HTML ───────────────────────────── */

function buildSettingsHTML() {
  return `
    <!-- API Configuration -->
    <div class="glass-card settings-section">
      <h3>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
        Gemini API Keys
      </h3>
      <div class="api-key-row" style="flex-direction: column; gap: var(--space-3)">
        <div class="form-field" style="width: 100%">
          <label class="form-label" for="input-api-keys">API Keys (one per line) - Failover enabled</label>
          <textarea class="form-input form-input-mono" id="input-api-keys" rows="3" placeholder="AIzaSy...&#10;AIzaSy..." autocomplete="off"></textarea>
        </div>
        <div style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap;">
          <button class="btn btn-primary" id="btn-save-key">Save Keys</button>
          <button class="btn btn-secondary" id="btn-test-key">Test First Key</button>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">OR</span>
          <input type="file" id="upload-api-keys" accept=".txt" style="display: none;" />
          <button class="btn btn-secondary" id="btn-upload-keys" onclick="document.getElementById('upload-api-keys').click()">Upload .txt</button>
        </div>
      </div>
      <div class="api-status-row" id="api-status-row">
        <span class="api-status-dot disconnected" id="api-dot"></span>
        <span id="api-status-msg">No API keys configured</span>
      </div>
    </div>

    <!-- Model Selection -->
    <div class="glass-card settings-section">
      <h3>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        Model Selection
      </h3>
      <div class="model-options" id="model-options">
        ${MODELS.map(m => `
          <button class="model-option" data-model="${m.id}">
            <span class="model-radio"></span>
            <div class="model-info">
              <div class="model-name">${m.name}</div>
              <div class="model-desc">${m.desc}</div>
            </div>
            <span class="model-cost">${m.cost}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Screening Configuration -->
    <div class="glass-card settings-section">
      <h3>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
        Screening Configuration
      </h3>
      <div class="config-grid">
        <div class="form-field">
          <label class="form-label" for="cfg-batch">Batch Size</label>
          <input type="number" class="form-input" id="cfg-batch" value="10" min="1" max="50" />
        </div>
        <div class="form-field">
          <label class="form-label" for="cfg-delay">Delay (ms)</label>
          <input type="number" class="form-input" id="cfg-delay" value="100" min="0" max="5000" step="50" />
        </div>
        <div class="form-field">
          <label class="form-label" for="cfg-temp">Temperature</label>
          <input type="number" class="form-input" id="cfg-temp" value="0.1" min="0" max="2" step="0.05" />
        </div>
        <div class="form-field">
          <label class="form-label" for="cfg-tokens">Max Tokens</label>
          <input type="number" class="form-input" id="cfg-tokens" value="512" min="64" max="4096" step="64" />
        </div>
        <div class="form-field">
          <label class="form-label" for="cfg-retries">Retries</label>
          <input type="number" class="form-input" id="cfg-retries" value="3" min="0" max="10" />
        </div>
      </div>
      <button class="btn btn-secondary" id="btn-save-config" style="margin-top:var(--space-4)">Save Configuration</button>
    </div>

    <!-- History Manager -->
    <div class="glass-card settings-section">
      <h3>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Session History
      </h3>
      <div class="history-list" id="history-list">
        <div class="empty-state-small">Loading...</div>
      </div>
    </div>

    <!-- Danger Zone -->
    <div class="glass-card settings-section danger-zone">
      <h3>
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--accent-crimson)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
        Danger Zone
      </h3>
      <p class="app-info">SRScreen v1.0.0 · Static build · IndexedDB v${3} schema</p>
      <button class="btn btn-danger" id="btn-factory-reset">🔴 Factory Reset — Clear ALL Data</button>
    </div>
  `;
}

/* ─── Wire Events ──────────────────────────── */

function wireEvents(container, { onApiKeyChange, toast }) {
  // Save API keys
  container.querySelector('#btn-save-key').addEventListener('click', () => {
    const text = container.querySelector('#input-api-keys').value;
    const keys = text.split('\n').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) { toast('Please enter at least one API key.', 'warn'); return; }
    localStorage.setItem(STORAGE_KEYS.apiKeys, JSON.stringify(keys));
    updateApiStatus(container, true, `${keys.length} keys configured`);
    if (onApiKeyChange) onApiKeyChange(true);
    toast(`✅ ${keys.length} API keys saved.`, 'success');
  });

  // Upload .txt file
  container.querySelector('#upload-api-keys').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const keys = text.split('\n').map(k => k.trim()).filter(Boolean);
      if (keys.length === 0) { toast('No keys found in file.', 'warn'); return; }
      container.querySelector('#input-api-keys').value = keys.join('\n');
      localStorage.setItem(STORAGE_KEYS.apiKeys, JSON.stringify(keys));
      updateApiStatus(container, true, `${keys.length} keys configured`);
      if (onApiKeyChange) onApiKeyChange(true);
      toast(`✅ Loaded ${keys.length} API keys from file.`, 'success');
    } catch (err) {
      toast(`❌ File read error: ${err.message}`, 'error');
    }
  });

  // Test API key
  container.querySelector('#btn-test-key').addEventListener('click', async () => {
    const keys = getApiKeys();
    if (keys.length === 0) { toast('Save API keys first.', 'warn'); return; }
    toast('Testing first API key...', 'info');
    const key = keys[0];

    try {
      const model = getSelectedModel();
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Respond with only the word "OK".' }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8 }
          })
        }
      );

      if (resp.ok) {
        updateApiStatus(container, true, `${keys.length} keys configured`);
        toast('✅ First API key is valid!', 'success');
      } else {
        const err = await resp.text();
        updateApiStatus(container, false, `Error: ${resp.status}`);
        toast(`❌ API key rejected: ${err.slice(0, 100)}`, 'error');
      }
    } catch (e) {
      updateApiStatus(container, false, 'Network error');
      toast(`❌ Network error: ${e.message}`, 'error');
    }
  });

  // Model selection
  container.querySelectorAll('.model-option').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.model-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      localStorage.setItem(STORAGE_KEYS.model, btn.dataset.model);
      toast(`Model set to ${btn.dataset.model}`, 'info');
    });
  });

  // Save config
  container.querySelector('#btn-save-config').addEventListener('click', () => {
    const config = {
      batchSize: parseInt(container.querySelector('#cfg-batch').value) || 10,
      requestDelayMs: parseInt(container.querySelector('#cfg-delay').value) || 100,
      temperature: parseFloat(container.querySelector('#cfg-temp').value) || 0.1,
      maxTokens: parseInt(container.querySelector('#cfg-tokens').value) || 512,
      retryLimit: parseInt(container.querySelector('#cfg-retries').value) || 3
    };
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
    toast('✅ Configuration saved.', 'success');
  });

  // Factory reset
  container.querySelector('#btn-factory-reset').addEventListener('click', async () => {
    if (!confirm('This will permanently delete ALL data including sessions, articles, criteria, and settings. Proceed?')) return;
    await DB.clearAllData();
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    localStorage.removeItem(STORAGE_KEYS.apiKeys);
    localStorage.removeItem(STORAGE_KEYS.model);
    localStorage.removeItem(STORAGE_KEYS.config);
    localStorage.removeItem('srscreen:lastRunId');
    updateApiStatus(container, false);
    if (onApiKeyChange) onApiKeyChange(false);
    await renderHistory(container);
    toast('🔴 All data cleared.', 'warn');
  });
}

/* ─── Load Saved Values ────────────────────── */

function loadSavedValues() {
  const container = document.getElementById('settings-layout');
  const keys = getApiKeys();
  if (keys.length > 0) {
    container.querySelector('#input-api-keys').value = keys.join('\n');
    updateApiStatus(container, true, `${keys.length} keys configured`);
  }

  // Model
  const model = getSelectedModel();
  container.querySelectorAll('.model-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.model === model);
  });

  // Config
  const config = getConfig();
  container.querySelector('#cfg-batch').value = config.batchSize;
  container.querySelector('#cfg-delay').value = config.requestDelayMs;
  container.querySelector('#cfg-temp').value = config.temperature;
  container.querySelector('#cfg-tokens').value = config.maxTokens;
  container.querySelector('#cfg-retries').value = config.retryLimit;
}

/* ─── API Status Display ───────────────────── */

function updateApiStatus(container, connected, msg) {
  const dot = container.querySelector('#api-dot');
  const msgEl = container.querySelector('#api-status-msg');

  dot.className = `api-status-dot ${connected ? 'connected' : 'disconnected'}`;
  msgEl.textContent = msg || (connected ? `Connected — ${getSelectedModel()}` : 'No API keys configured');

  // Also update sidebar pill
  const pill = document.getElementById('api-status-pill');
  const pillLabel = document.getElementById('api-status-label');
  if (pill && pillLabel) {
    pill.className = `status-pill ${connected ? 'status-active' : 'status-inactive'}`;
    pillLabel.textContent = connected ? 'API Connected' : 'No API Key';
  }
}

/* ─── History Rendering ────────────────────── */

async function renderHistory(container) {
  const listEl = container.querySelector('#history-list');
  if (!listEl) return;

  try {
    const runs = await DB.getAllRuns();
    if (runs.length === 0) {
      listEl.innerHTML = '<div class="empty-state-small">No sessions yet.</div>';
      return;
    }

    listEl.innerHTML = runs.map(r => `
      <div class="history-item" data-run-id="${r.id}">
        <span class="history-id">#${r.id}</span>
        <div class="history-info">
          <div class="history-name">${escapeHtml(r.filename || 'Unnamed session')}</div>
          <div class="history-meta">${new Date(r.timestamp).toLocaleDateString()} · ${r.totalArticles || 0} articles · ✅${r.includedCount || 0} ❌${r.excludedCount || 0}</div>
        </div>
        <div class="history-actions">
          <button class="btn-icon" data-action="delete" data-run-id="${r.id}" data-tooltip="Delete">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    // Wire delete buttons
    listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const runId = parseInt(btn.dataset.runId);
        if (!confirm(`Delete session #${runId}? This cannot be undone.`)) return;
        await DB.deleteRun(runId);
        await renderHistory(container);
      });
    });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state-small">Error loading history: ${e.message}</div>`;
  }
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

/* =============================================
   SRScreen — Criteria Builder UI (criteria.js)
   Visual JSON editor: study types, keywords,
   custom rules, PICO, live preview
   ============================================= */

import { getApiKeys, getSelectedModel } from './settings.js';

let _criteria = getDefaultCriteria();
let _toast = null;
let initialized = false;

export function getDefaultCriteria() {
  return {
    study_types: [],
    inclusion_keywords: { logic: 'ANY', terms: [], fields: ['title', 'abstract'] },
    exclusion_keywords: { logic: 'ANY', terms: [], fields: ['title', 'abstract'] },
    custom_rules: [],
    pico: { P: '', I: '', C: '', O: '' }
  };
}

export function getCriteria() {
  return JSON.parse(JSON.stringify(_criteria));
}

export function setCriteria(c) {
  _criteria = JSON.parse(JSON.stringify(c));
}

export function initCriteria(container, { toast }) {
  if (initialized) return;
  initialized = true;
  _toast = toast;

  container.innerHTML = buildPanelsHTML();
  wireEvents(container);
  updatePreview();

  // Load/save/export buttons (in the preview card)
  document.getElementById('btn-save-criteria')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(_criteria, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'screening_criteria.json';
    a.click();
    URL.revokeObjectURL(url);
    _toast('📥 Criteria exported as JSON.', 'success');
  });

  document.getElementById('btn-load-criteria')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        _criteria = { ...getDefaultCriteria(), ...parsed };
        rebuildPanels(container);
        _toast('✅ Criteria loaded from file.', 'success');
      } catch (err) {
        _toast(`❌ Failed to load: ${err.message}`, 'error');
      }
    };
    input.click();
  });
}

/* ─── Build Panels HTML ────────────────────── */

function buildPanelsHTML() {
  const STUDY_TYPES = ['RCT', 'Cohort', 'Case-Control', 'Cross-sectional', 'Systematic Review', 'Case Report', 'Case Series', 'All'];

  return `
    <!-- AI Auto-fill Template -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        AI Auto-Fill (Optional)
      </h3>
      <div style="margin-bottom: var(--space-3)">
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: var(--space-2)">Paste your inclusion/exclusion criteria or review protocol below. AI will parse it and auto-fill the sections.</p>
        <textarea id="ai-criteria-template" class="form-input" rows="3" placeholder="e.g. Include randomized controlled trials involving adult patients with hypertension treated with ACE inhibitors. Exclude animal studies."></textarea>
      </div>
      <div style="display: flex; gap: var(--space-3); align-items: center;">
        <button class="btn btn-primary" id="btn-ai-parse" style="padding:var(--space-2) var(--space-3)">✨ Auto-Fill</button>
        <span id="ai-parse-status" style="font-size: 0.85rem; color: var(--text-secondary);"></span>
      </div>
    </div>

    <!-- Study Type Selector -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
        Study Types
      </h3>
      <div class="study-type-grid" id="study-type-grid">
        ${STUDY_TYPES.map(t => `<button class="study-chip${_criteria.study_types.includes(t) ? ' active' : ''}" data-type="${t}">${t}</button>`).join('')}
      </div>
    </div>

    <!-- Inclusion Keywords -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--accent-teal)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Inclusion Keywords
      </h3>
      <div class="tag-input-wrap">
        <div class="tag-input-header">
          <div class="logic-toggle-wrap">
            <span class="logic-label">Logic:</span>
            <div class="toggle-group" id="inc-logic-toggle">
              <button class="toggle-option${_criteria.inclusion_keywords.logic === 'ANY' ? ' active' : ''}" data-val="ANY">ANY (OR)</button>
              <button class="toggle-option${_criteria.inclusion_keywords.logic === 'ALL' ? ' active' : ''}" data-val="ALL">ALL (AND)</button>
            </div>
          </div>
        </div>
        <div class="tag-input-field">
          <input type="text" id="inc-keyword-input" placeholder="Type keyword and press Enter..." />
          <button class="btn btn-primary" id="btn-add-inc" style="padding:var(--space-2) var(--space-3)">Add</button>
        </div>
        <div class="tag-list" id="inc-tag-list"></div>
      </div>
    </div>

    <!-- Exclusion Keywords -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--accent-crimson)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        Exclusion Keywords
      </h3>
      <div class="tag-input-wrap">
        <div class="tag-input-header">
          <div class="logic-toggle-wrap">
            <span class="logic-label">Logic:</span>
            <div class="toggle-group" id="exc-logic-toggle">
              <button class="toggle-option${_criteria.exclusion_keywords.logic === 'ANY' ? ' active' : ''}" data-val="ANY">ANY (OR)</button>
              <button class="toggle-option${_criteria.exclusion_keywords.logic === 'ALL' ? ' active' : ''}" data-val="ALL">ALL (AND)</button>
            </div>
          </div>
        </div>
        <div class="tag-input-field">
          <input type="text" id="exc-keyword-input" placeholder="Type keyword and press Enter..." />
          <button class="btn btn-danger" id="btn-add-exc" style="padding:var(--space-2) var(--space-3)">Add</button>
        </div>
        <div class="tag-list" id="exc-tag-list"></div>
      </div>
    </div>

    <!-- Custom Rules -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--accent-violet)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        Custom Rules
      </h3>
      <div class="rules-list" id="rules-list"></div>
      <div class="add-rule-form" id="add-rule-form">
        <span style="font-size:0.78rem;color:var(--text-secondary)">IF</span>
        <select id="rule-field" class="form-input" style="padding:var(--space-2) var(--space-3);font-size:0.78rem">
          <option value="title">Title</option>
          <option value="abstract">Abstract</option>
          <option value="keywords">Keywords</option>
          <option value="any">Any Field</option>
        </select>
        <input type="text" id="rule-term-input" class="form-input" placeholder="contains..." style="font-size:0.78rem" />
        <select id="rule-action" class="form-input" style="padding:var(--space-2) var(--space-3);font-size:0.78rem">
          <option value="EXCLUDE">EXCLUDE</option>
          <option value="INCLUDE">INCLUDE</option>
        </select>
        <button class="btn btn-violet" id="btn-add-rule" style="padding:var(--space-2) var(--space-3);font-size:0.78rem">+ Add</button>
      </div>
    </div>

    <!-- PICO Block -->
    <div class="glass-card criteria-section">
      <h3>
        <svg class="section-icon" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="var(--accent-ice)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
        PICO Framework
      </h3>
      <div class="pico-grid">
        <div class="pico-field">
          <label><span class="pico-letter pico-P">P</span> Population</label>
          <input type="text" class="form-input" id="pico-p" placeholder="e.g., Adults with hypertension" value="${escapeAttr(_criteria.pico.P)}" />
        </div>
        <div class="pico-field">
          <label><span class="pico-letter pico-I">I</span> Intervention</label>
          <input type="text" class="form-input" id="pico-i" placeholder="e.g., ACE inhibitors" value="${escapeAttr(_criteria.pico.I)}" />
        </div>
        <div class="pico-field">
          <label><span class="pico-letter pico-C">C</span> Comparator</label>
          <input type="text" class="form-input" id="pico-c" placeholder="e.g., Placebo or no treatment" value="${escapeAttr(_criteria.pico.C)}" />
        </div>
        <div class="pico-field">
          <label><span class="pico-letter pico-O">O</span> Outcome</label>
          <input type="text" class="form-input" id="pico-o" placeholder="e.g., Blood pressure reduction" value="${escapeAttr(_criteria.pico.O)}" />
        </div>
      </div>
    </div>
  `;
}

function rebuildPanels(container) {
  container.innerHTML = buildPanelsHTML();
  wireEvents(container);
  renderTags();
  renderRules();
  updatePreview();
}

/* ─── Wire Events ──────────────────────────── */

function wireEvents(container) {
  // AI Auto Parse
  const btnAiParse = container.querySelector('#btn-ai-parse');
  if (btnAiParse) {
    btnAiParse.addEventListener('click', async () => {
      const textBox = container.querySelector('#ai-criteria-template');
      const text = textBox.value.trim();
      if (!text) { if (_toast) _toast('Please enter a protocol or criteria template text.', 'warn'); return; }

      const keys = getApiKeys();
      if (keys.length === 0) { if (_toast) _toast('No API keys configured. Go to Settings first.', 'error'); return; }

      const model = getSelectedModel();
      const statusEl = container.querySelector('#ai-parse-status');
      
      btnAiParse.disabled = true;
      statusEl.textContent = 'Parsing with AI...';

      const prompt = `You are a systematic review criteria parsing assistant.
Extract the inclusion/exclusion criteria, study types, and PICO format from the following text and return ONLY valid JSON matching this exact structure:
{
  "study_types": ["RCT", "Cohort", "Case-Control", "Cross-sectional", "Systematic Review", "Case Report", "Case Series", "All"],
  "inclusion_keywords": { "logic": "ANY", "terms": ["keyword1", "keyword2"] },
  "exclusion_keywords": { "logic": "ANY", "terms": ["keyword3"] },
  "pico": { "P": "population desc", "I": "intervention desc", "C": "comparator desc", "O": "outcomes desc" }
}
TEXT:
${text}`;

      let success = false;
      for (const key of keys) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1 }
            })
          });

          if (!resp.ok) {
            // Only treat 429 as a rate limit for key rotation; other errors should be surfaced
            const ra = resp.headers.get('Retry-After');
            if (resp.status === 429) {
              if (ra) await sleep(parseInt(ra, 10) * 1000 + Math.floor(Math.random() * 300));
              // try next key
              continue;
            }
            // For other non-OK responses (e.g., 503), throw so the UI shows an error
            throw new Error(`HTTP ${resp.status}`);
          }

          const data = await resp.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          
          const jsonMatch = clean.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          
          const parsed = JSON.parse(jsonMatch[0]);

          _criteria = { ...getDefaultCriteria(), ...parsed };
          _criteria.custom_rules = []; // Reset custom rules
          
          rebuildPanels(container);
          if (_toast) _toast('✅ Criteria auto-filled via AI!', 'success');
          
          container.querySelector('#ai-criteria-template').value = text;
          success = true;
          break;
        } catch (err) {
          console.error('AI Parse error:', err);
        }
      }

      if (!success) {
        statusEl.textContent = 'Parsing failed.';
        if (_toast) _toast('❌ Failed to parse criteria with configured API keys.', 'error');
      } else {
        statusEl.textContent = '';
      }
      
      // We must re-select the button because rebuildPanels destroys it
      const newBtn = container.querySelector('#btn-ai-parse');
      if (newBtn) newBtn.disabled = false;
    });
  }

  // Study type chips
  container.querySelectorAll('.study-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type;
      if (type === 'All') {
        _criteria.study_types = chip.classList.contains('active') ? [] : ['All'];
        container.querySelectorAll('.study-chip').forEach(c => c.classList.remove('active'));
        if (_criteria.study_types.includes('All')) chip.classList.add('active');
      } else {
        chip.classList.toggle('active');
        const allChip = container.querySelector('.study-chip[data-type="All"]');
        if (allChip) allChip.classList.remove('active');
        _criteria.study_types = _criteria.study_types.filter(t => t !== 'All');
        if (chip.classList.contains('active')) {
          if (!_criteria.study_types.includes(type)) _criteria.study_types.push(type);
        } else {
          _criteria.study_types = _criteria.study_types.filter(t => t !== type);
        }
      }
      updatePreview();
    });
  });

  // Inclusion logic toggle
  container.querySelectorAll('#inc-logic-toggle .toggle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#inc-logic-toggle .toggle-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _criteria.inclusion_keywords.logic = btn.dataset.val;
      updatePreview();
    });
  });

  // Exclusion logic toggle
  container.querySelectorAll('#exc-logic-toggle .toggle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#exc-logic-toggle .toggle-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _criteria.exclusion_keywords.logic = btn.dataset.val;
      updatePreview();
    });
  });

  // Add inclusion keyword
  const incInput = container.querySelector('#inc-keyword-input');
  const addInc = () => {
    const val = incInput.value.trim();
    if (val && !_criteria.inclusion_keywords.terms.includes(val)) {
      _criteria.inclusion_keywords.terms.push(val);
      incInput.value = '';
      renderTags();
      updatePreview();
    }
  };
  incInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addInc(); } });
  container.querySelector('#btn-add-inc').addEventListener('click', addInc);

  // Add exclusion keyword
  const excInput = container.querySelector('#exc-keyword-input');
  const addExc = () => {
    const val = excInput.value.trim();
    if (val && !_criteria.exclusion_keywords.terms.includes(val)) {
      _criteria.exclusion_keywords.terms.push(val);
      excInput.value = '';
      renderTags();
      updatePreview();
    }
  };
  excInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addExc(); } });
  container.querySelector('#btn-add-exc').addEventListener('click', addExc);

  // Add custom rule
  container.querySelector('#btn-add-rule').addEventListener('click', () => {
    const field = container.querySelector('#rule-field').value;
    const term = container.querySelector('#rule-term-input').value.trim();
    const action = container.querySelector('#rule-action').value;
    if (!term) { if (_toast) _toast('Enter a term for the rule.', 'warn'); return; }
    _criteria.custom_rules.push({ field, term, action });
    container.querySelector('#rule-term-input').value = '';
    renderRules();
    updatePreview();
  });

  // PICO live update
  ['pico-p', 'pico-i', 'pico-c', 'pico-o'].forEach(id => {
    const el = container.querySelector(`#${id}`);
    if (el) {
      el.addEventListener('input', () => {
        const key = id.split('-')[1].toUpperCase();
        _criteria.pico[key] = el.value;
        updatePreview();
      });
    }
  });

  renderTags();
  renderRules();
}

/* ─── Tag Rendering ────────────────────────── */

function renderTags() {
  const incList = document.getElementById('inc-tag-list');
  const excList = document.getElementById('exc-tag-list');
  if (incList) {
    incList.innerHTML = _criteria.inclusion_keywords.terms.map((t, i) =>
      `<span class="tag"><span>${escapeHtml(t)}</span><span class="tag-remove" data-group="inc" data-idx="${i}">✕</span></span>`
    ).join('');
    incList.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _criteria.inclusion_keywords.terms.splice(+btn.dataset.idx, 1);
        renderTags();
        updatePreview();
      });
    });
  }
  if (excList) {
    excList.innerHTML = _criteria.exclusion_keywords.terms.map((t, i) =>
      `<span class="tag exclude-tag"><span>${escapeHtml(t)}</span><span class="tag-remove" data-group="exc" data-idx="${i}">✕</span></span>`
    ).join('');
    excList.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _criteria.exclusion_keywords.terms.splice(+btn.dataset.idx, 1);
        renderTags();
        updatePreview();
      });
    });
  }
}

/* ─── Rule Rendering ───────────────────────── */

function renderRules() {
  const list = document.getElementById('rules-list');
  if (!list) return;

  if (_criteria.custom_rules.length === 0) {
    list.innerHTML = '<div class="empty-state-small" style="padding:var(--space-3)">No custom rules defined.</div>';
    return;
  }

  list.innerHTML = _criteria.custom_rules.map((r, i) => `
    <div class="rule-card" draggable="true" data-idx="${i}">
      <span class="rule-drag-handle">⠿</span>
      <span class="rule-text">IF <span class="rule-keyword">${r.field}</span> CONTAINS "<span class="rule-keyword">${escapeHtml(r.term)}</span>" THEN <span class="rule-action-${r.action.toLowerCase()}">${r.action}</span></span>
      <button class="btn-icon" data-action="delete-rule" data-idx="${i}">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');

  // Wire delete
  list.querySelectorAll('[data-action="delete-rule"]').forEach(btn => {
    btn.addEventListener('click', () => {
      _criteria.custom_rules.splice(+btn.dataset.idx, 1);
      renderRules();
      updatePreview();
    });
  });

  // Wire drag & drop reorder
  let dragIdx = null;
  list.querySelectorAll('.rule-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragIdx = +card.dataset.idx;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const dropIdx = +card.dataset.idx;
      if (dragIdx !== null && dragIdx !== dropIdx) {
        const [moved] = _criteria.custom_rules.splice(dragIdx, 1);
        _criteria.custom_rules.splice(dropIdx, 0, moved);
        renderRules();
        updatePreview();
      }
      dragIdx = null;
    });
  });
}

/* ─── Live JSON Preview ────────────────────── */

function updatePreview() {
  const pane = document.getElementById('json-preview-pane');
  if (!pane) return;
  pane.innerHTML = syntaxHighlight(JSON.stringify(_criteria, null, 2));
}

function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
    .replace(/:\s*"([^"]*)"/g, ': <span class="json-str">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
}

/* ─── Helpers ──────────────────────────────── */

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

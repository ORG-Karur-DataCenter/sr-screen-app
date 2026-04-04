/* =============================================
   SRScreen — App Orchestrator (app.js)
   Router, state, event bus, tab orchestration,
   toast system, lazy tab initialization
   ============================================= */

import { initDashboard, refreshDashboard } from './ui/dashboard.js';
import { initCriteria } from './ui/criteria.js';
import { initUpload } from './ui/upload.js';
import { renderResults } from './ui/results.js';
import { renderAudit } from './ui/audit.js';
import { initSettings, hasApiKey, refreshHistory } from './ui/settings.js';

/* ═══════════════════════════════════════════════
   ❶ STATE
═══════════════════════════════════════════════ */
const state = {
  activeTab: 'dashboard',
  tabsInitialized: new Set()
};

/* ═══════════════════════════════════════════════
   ❷ TAB NAVIGATION
═══════════════════════════════════════════════ */
const TAB_NAMES = ['dashboard', 'criteria', 'upload', 'results', 'audit', 'settings'];

function switchTab(name) {
  if (!TAB_NAMES.includes(name)) return;
  state.activeTab = name;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === name);
  });

  // Update panel visibility
  TAB_NAMES.forEach(t => {
    const panel = document.getElementById(`tab-${t}`);
    if (panel) panel.classList.toggle('active', t === name);
  });

  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('open');

  // Lazy init tabs on first visit
  initTab(name);
}

async function initTab(name) {
  const helpers = { toast, switchTab };

  switch (name) {
    case 'dashboard':
      // Always refresh dashboard data
      await initDashboard(helpers);
      break;

    case 'criteria':
      if (!state.tabsInitialized.has('criteria')) {
        initCriteria(document.getElementById('criteria-panels'), helpers);
        state.tabsInitialized.add('criteria');
      }
      break;

    case 'upload':
      if (!state.tabsInitialized.has('upload')) {
        initUpload({
          toast,
          switchTab,
          onScreeningComplete: async (results, summary, isAborted) => {
            // Refresh dashboard and results after screening
            await refreshDashboard({ switchTab, toast });
            await refreshHistory();
          }
        });
        state.tabsInitialized.add('upload');
      }
      break;

    case 'results':
      await renderResults(
        document.getElementById('results-content'),
        null,
        helpers
      );
      break;

    case 'audit':
      await renderAudit(
        document.getElementById('audit-content'),
        null,
        helpers
      );
      break;

    case 'settings':
      if (!state.tabsInitialized.has('settings')) {
        initSettings(document.getElementById('settings-layout'), {
          onApiKeyChange: (hasKey) => {
            // Update dashboard banner
            const banner = document.getElementById('dash-banner');
            if (banner) banner.style.display = hasKey ? 'none' : 'flex';
            // Update sidebar pill
            const pill = document.getElementById('api-status-pill');
            const label = document.getElementById('api-status-label');
            if (pill) pill.className = `status-pill ${hasKey ? 'status-active' : 'status-inactive'}`;
            if (label) label.textContent = hasKey ? 'API Connected' : 'No API Key';
          },
          toast
        });
        state.tabsInitialized.add('settings');
      }
      break;
  }
}

/* ═══════════════════════════════════════════════
   ❸ TOAST NOTIFICATION SYSTEM
═══════════════════════════════════════════════ */
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  // Auto dismiss
  setTimeout(() => {
    el.classList.add('toast-exit');
    el.addEventListener('animationend', () => el.remove());
  }, duration);

  // Click to dismiss
  el.addEventListener('click', () => {
    el.classList.add('toast-exit');
    el.addEventListener('animationend', () => el.remove());
  });
}

/* ═══════════════════════════════════════════════
   ❹ APP LOAD SEQUENCE
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Wire nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(el.dataset.tab);
    });
  });

  // Mobile menu toggle
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // Close sidebar on outside click (mobile)
  document.getElementById('main-content')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
  });

  // Set initial API status in sidebar
  const hasKey = hasApiKey();
  const pill = document.getElementById('api-status-pill');
  const label = document.getElementById('api-status-label');
  if (pill) pill.className = `status-pill ${hasKey ? 'status-active' : 'status-inactive'}`;
  if (label) label.textContent = hasKey ? 'API Connected' : 'No API Key';

  // Animate app load
  animateAppLoad();

  // Init dashboard (default tab)
  await initTab('dashboard');
});

/* ═══════════════════════════════════════════════
   ❺ APP LOAD ANIMATION
═══════════════════════════════════════════════ */
function animateAppLoad() {
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');

  // Sidebar fade in
  if (sidebar) {
    sidebar.style.opacity = '0';
    sidebar.style.transform = 'translateX(-20px)';
    requestAnimationFrame(() => {
      sidebar.style.transition = 'opacity 400ms var(--ease-snappy), transform 400ms var(--ease-snappy)';
      sidebar.style.opacity = '1';
      sidebar.style.transform = 'translateX(0)';
    });
  }

  // Nav items stagger
  document.querySelectorAll('.nav-item').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-10px)';
    setTimeout(() => {
      el.style.transition = 'opacity 300ms var(--ease-snappy), transform 300ms var(--ease-snappy)';
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    }, 200 + i * 60);
  });

  // Main content fade
  if (mainContent) {
    mainContent.style.opacity = '0';
    setTimeout(() => {
      mainContent.style.transition = 'opacity 300ms var(--ease-smooth)';
      mainContent.style.opacity = '1';
    }, 400);
  }

  // KPI cards stagger
  document.querySelectorAll('.stat-card').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    setTimeout(() => {
      el.style.transition = 'opacity 300ms var(--ease-snappy), transform 300ms var(--ease-snappy)';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, 500 + i * 80);
  });
}

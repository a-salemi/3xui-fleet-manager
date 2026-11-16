// ─── App Global State ────────────────────────────────────────────────────────
let panels = [];
let schedules = [];
let backendLogs = [];
let allUsers = [];
let currentUser = { username: 'Admin', role: 'admin' };
let currentRoute = 'dashboard';
let telegramEnabled = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Start live clock
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // Setup sidebar navigation clicks
  document.querySelectorAll('.nav-link[data-route]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const route = el.getAttribute('data-route');
      navigateRoute(route);
      if (window.innerWidth <= 868) toggleSidebar(false);
    });
  });

  // Handle browser Back / Forward buttons
  window.addEventListener('popstate', () => {
    handleUrlRoute(false);
  });

  // Initialize Language & Theme
  if (typeof setLanguage === 'function') {
    setLanguage(currentLang);
  }
  initTheme();

  // Initial Load from URL
  handleUrlRoute(false);
  await loadAllData();

  // Dismiss Preloader smoothly
  hideAppLoader();

  // Polling: System metrics every 4s, Schedules/Logs every 15s
  setInterval(() => {
    if (currentRoute === 'dashboard') loadSystemMetrics();
  }, 4000);

  setInterval(() => {
    if (currentRoute === 'logs') loadBackendLogs();
    if (currentRoute === 'schedules') loadSchedules(false);
  }, 15000);
});

function hideAppLoader() {
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 500);
  }
}

// ─── Theme Management ────────────────────────────────────────────────────────
function getInitialTheme() {
  const saved = localStorage.getItem('xui_theme');
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function initTheme() {
  const theme = getInitialTheme();
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      if (!localStorage.getItem('xui_theme')) {
        const autoTheme = e.matches ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', autoTheme);
        updateThemeIcon(autoTheme);
      }
    });
  }
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('xui_theme', next);
  updateThemeIcon(next);
  toast(next === 'dark' ? 'Switched to Obsidian Dark 🌙' : 'Switched to Apple Light Glass ☀️', 'info');
}

function updateThemeIcon(theme) {
  const icon = theme === 'dark' ? '🌙' : '☀️';
  const tBtnDesk = document.getElementById('desktopThemeToggleBtn');
  const tBtnMob = document.getElementById('mobileThemeToggleBtn');
  if (tBtnDesk) tBtnDesk.textContent = icon;
  if (tBtnMob) tBtnMob.textContent = icon;
}

function updateLiveClock() {
  const el = document.getElementById('liveClockDisplay');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleTimeString();
  }
}

// ─── SPA Routing with HTML5 History ──────────────────────────────────────────
function handleUrlRoute(pushState = true) {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const validRoutes = ['dashboard', 'schedules', 'panels', 'logs', 'settings'];
  const route = validRoutes.includes(path) ? path : 'dashboard';
  navigateRoute(route, pushState);
}

function navigateRoute(route, pushState = true) {
  currentRoute = route;

  // Update browser address bar without page refresh
  if (pushState) {
    const url = (route === 'dashboard') ? '/dashboard' : `/${route}`;
    history.pushState({ route }, '', url);
  }

  // Update sidebar active link
  document.querySelectorAll('.nav-link[data-route]').forEach(e => {
    e.classList.toggle('active', e.getAttribute('data-route') === route);
  });

  // Show correct tab pane
  document.querySelectorAll('.tab-pane').forEach(e => e.classList.remove('active'));
  const activePane = document.getElementById('tab-' + route);
  if (activePane) activePane.classList.add('active');

  // Update topbar breadcrumbs
  updateRouteViewTitles();

  // Route-specific instant actions
  if (route === 'dashboard') loadSystemMetrics();
  if (route === 'logs') loadBackendLogs();
  if (route === 'settings' && currentUser && currentUser.role === 'admin') {
    loadSettings();
    loadUsers();
    load2FAStatus();
  }
}

function updateRouteViewTitles() {
  const titles = {
    dashboard: t('nav_overview') || 'Overview',
    schedules: t('nav_schedules') || 'Schedules',
    panels: t('nav_panels') || 'Panels',
    logs: t('nav_logs') || 'Activity Logs',
    settings: t('nav_settings') || 'Settings'
  };

  const crumb = document.getElementById('crumbCurrent');
  if (crumb) crumb.textContent = titles[currentRoute] || 'Dashboard';
  document.title = `${titles[currentRoute] || 'Dashboard'} · 3X-UI Manager`;
}

function toggleSidebar(forceState) {
  const sb = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const isOpen = (forceState !== undefined) ? forceState : !sb.classList.contains('open');
  sb.classList.toggle('open', isOpen);
  if (backdrop) backdrop.classList.toggle('open', isOpen);
  document.body.classList.toggle('sidebar-locked', isOpen);
}

// ─── Data Initialization ─────────────────────────────────────────────────────
async function loadAllData() {
  await loadMe();
  // Load panels first so schedule names and dependencies resolve immediately
  await loadPanels();
  await Promise.all([
    loadSystemMetrics(),
    loadSchedules(),
    loadBackendLogs()
  ]);
  if (currentUser.role === 'admin') {
    await loadSettings();
    await loadUsers();
  }
  updateMetrics();
}

async function loadMe() {
  try {
    currentUser = await api('GET', '/api/me');
    document.getElementById('currentUserDisplay').textContent = currentUser.username;
    document.getElementById('currentUserRole').textContent = currentUser.role.toUpperCase() + ' ROLE';
    if (currentUser.role !== 'admin') {
      const uSec = document.getElementById('adminUsersSection');
      if (uSec) uSec.style.display = 'none';
      const a2fa = document.getElementById('admin2faSection');
      if (a2fa) a2fa.style.display = 'none';
    }
  } catch (e) {
    console.error('Failed to load user profile:', e);
  }
}

// ─── API Client with Abort Timeout ───────────────────────────────────────────
async function api(method, path, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    };
    if (body) opts.body = JSON.stringify(body);

    const r = await fetch(path, opts);
    clearTimeout(timeoutId);

    if (r.status === 401 || r.status === 302 || r.redirected) {
      window.location = '/login';
      return null;
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(e.detail || 'Request failed with HTTP ' + r.status);
    }
    return r.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Connection timed out. Server or target instance did not respond in 12s.');
    }
    throw err;
  }
}

// ─── Apple / iOS Dynamic Island Glass Notifications ─────────────────────────
function toast(msg, type = true, duration = 3800) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;

  // Determine kind: 'ok' (success), 'err' (error), or 'info'
  let kind = 'ok';
  if (type === false || type === 'err' || type === 'error') {
    kind = 'err';
  } else if (type === 'info' || (type === true && typeof msg === 'string' && (msg.startsWith('Testing') || msg.startsWith('Running') || msg.startsWith('Sending')))) {
    kind = 'info';
  } else {
    kind = 'ok';
  }

  // Strip leading emojis from msg if already present
  const cleanMsg = typeof msg === 'string' ? msg.replace(/^[✓⚠️ℹ️❌⚡🟢🔴]\s*/, '').trim() : String(msg);

  // High-precision Apple Glass SVG icons
  let iconSvg = '';
  if (kind === 'ok') {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (kind === 'err') {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else {
    iconSvg = `<svg class="toast-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="38" stroke-dashoffset="14"></circle></svg>`;
  }

  const item = document.createElement('div');
  item.className = `toast-apple ${kind}`;
  item.setAttribute('role', 'alert');
  item.innerHTML = `
    <div class="toast-island-icon">${iconSvg}</div>
    <div class="toast-island-text">${cleanMsg}</div>
    <button class="toast-island-close" aria-label="Dismiss">&times;</button>
    <div class="toast-progress-bar" style="animation-duration:${duration}ms;"></div>
  `;

  const dismiss = () => {
    if (item.classList.contains('dismissing')) return;
    item.classList.add('dismissing');
    setTimeout(() => {
      if (item.parentNode) item.remove();
    }, 280);
  };

  const closeBtn = item.querySelector('.toast-island-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
  }

  stack.appendChild(item);

  let timer = setTimeout(dismiss, duration);
  item.addEventListener('mouseenter', () => clearTimeout(timer));
  item.addEventListener('mouseleave', () => {
    timer = setTimeout(dismiss, 1500);
  });
}

// ─── Modal Helpers ───────────────────────────────────────────────────────────
function openModal(title, badge, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBadge').textContent = badge || 'CONFIG';
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('show');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
}

function setBtnLoading(btn, loading, text = 'Saving...') {
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${text}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || 'Save';
    btn.disabled = false;
  }
}

// ─── 0. LIVE HARDWARE TELEMETRY ──────────────────────────────────────────────
async function loadSystemMetrics() {
  try {
    const m = await api('GET', '/api/system/stats');
    if (!m) return;

    // CPU
    document.getElementById('cpuBadge').textContent = `${m.cpu_percent}%`;
    document.getElementById('cpuFill').style.width = `${Math.min(m.cpu_percent, 100)}%`;
    document.getElementById('cpuCores').textContent = `${m.cpu_cores} Cores`;
    const loadStr = (m.load_avg && m.load_avg.length) 
      ? m.load_avg.map(x => Number(x).toFixed(2)).join(' / ') 
      : '0.00 / 0.00 / 0.00';
    document.getElementById('cpuLoad').textContent = `Load: ${loadStr}`;

    // RAM
    document.getElementById('ramBadge').textContent = `${m.ram_percent}%`;
    document.getElementById('ramFill').style.width = `${Math.min(m.ram_percent, 100)}%`;
    document.getElementById('ramUsage').textContent = `${m.ram_used_gb} GB / ${m.ram_total_gb} GB`;
    document.getElementById('ramPercent').textContent = `${m.ram_percent}%`;

    // SWAP
    document.getElementById('swapBadge').textContent = `${m.swap_percent}%`;
    document.getElementById('swapFill').style.width = `${Math.min(m.swap_percent, 100)}%`;
    document.getElementById('swapUsage').textContent = `${m.swap_used_gb} GB / ${m.swap_total_gb} GB`;
    document.getElementById('swapPercent').textContent = `${m.swap_percent}%`;

    // DISK
    document.getElementById('diskBadge').textContent = `${m.disk_percent}%`;
    document.getElementById('diskFill').style.width = `${Math.min(m.disk_percent, 100)}%`;
    document.getElementById('diskUsage').textContent = `${m.disk_used_gb} GB / ${m.disk_total_gb} GB`;
    document.getElementById('diskPercent').textContent = `${m.disk_percent}%`;

    // Uptime
    document.getElementById('statUptime').textContent = m.uptime;
  } catch (e) {
    console.error('Telemetry query error:', e);
  }
}

// ─── 24-Hour Mobile Friendly Time Picker Helper ──────────────────────────────
function generate24hOptions(selectedVal) {
  let hOpts = '';
  let mOpts = '';
  const selH = selectedVal ? selectedVal.split(':')[0] : '02';
  const selM = selectedVal ? selectedVal.split(':')[1] : '00';

  for (let i = 0; i < 24; i++) {
    const val = String(i).padStart(2, '0');
    hOpts += `<option value="${val}" ${val === selH ? 'selected' : ''}>${val}</option>`;
  }
  for (let i = 0; i < 60; i += 5) {
    const val = String(i).padStart(2, '0');
    mOpts += `<option value="${val}" ${val === selM ? 'selected' : ''}>${val}</option>`;
  }
  return { hOpts, mOpts };
}

function renderTimePickerHTML(prefix, defaultVal) {
  const { hOpts, mOpts } = generate24hOptions(defaultVal);
  return `
    <div class="time-picker-24h-group">
      <select class="time-box-select" id="${prefix}_H">${hOpts}</select>
      <span class="time-colon">:</span>
      <select class="time-box-select" id="${prefix}_M">${mOpts}</select>
    </div>
  `;
}

function getTimePickerValue(prefix) {
  const h = document.getElementById(`${prefix}_H`).value;
  const m = document.getElementById(`${prefix}_M`).value;
  return `${h}:${m}`;
}

function applyPreset(enH, enM, disH, disM) {
  document.getElementById('sEn_H').value = enH;
  document.getElementById('sEn_M').value = enM;
  document.getElementById('sDis_H').value = disH;
  document.getElementById('sDis_M').value = disM;
}

// ─── 1. PANELS LOGIC ─────────────────────────────────────────────────────────
async function loadPanels() {
  try {
    panels = await api('GET', '/api/panels');
    renderPanels();
    if (schedules && schedules.length > 0) {
      renderSchedules();
    }
    updateMetrics();
  } catch (e) {
    toast('Error loading panels: ' + e.message, false);
  }
}

function renderPanels() {
  const grid = document.getElementById('panelsGrid');
  const empty = document.getElementById('panelsEmpty');
  document.getElementById('badgePanelCount').textContent = panels.length;

  if (!panels.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = panels.map(p => `
    <div class="panel-card-box">
      <div class="panel-card-head">
        <div>
          <div class="panel-title-text">${esc(p.name)}</div>
          <div class="panel-url-sub">${esc(p.url)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="panel-ping-badge" id="pingBadge_${p.id}" onclick="pingPanel('${p.id}')" title="Click to Ping">⚡ Ping</span>
          <span class="panel-status-tag">Connected</span>
        </div>
      </div>
      <div class="panel-footer-actions">
        <button class="btn btn-xray-restart" onclick="restartPanelXray('${p.id}')" title="${t('btn_restart_xray')}">${t('btn_restart_xray')}</button>
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 ${t('btn_test') || 'Test'}</button>
        <button class="btn btn-edit btn-sm" onclick="editPanel('${p.id}')">✏️ ${t('btn_edit') || 'Edit'}</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 ${t('btn_delete') || 'Delete'}</button>
      </div>
    </div>
  `).join('');

  // Background latency heartbeat
  panels.forEach(p => pingPanel(p.id, false));
}

async function restartPanelXray(id) {
  const p = panels.find(x => String(x.id).trim() === String(id).trim());
  const panelName = p ? p.name : 'Panel';
  if (!confirm(`Are you sure you want to refresh/restart Xray service on ${panelName}? Active proxy sessions will reconnect in <1 second.`)) return;
  toast(`Restarting Xray service on ${panelName}...`, 'info');
  try {
    const res = await api('POST', `/api/panels/${id}/xray/restart`);
    toast(res.message || `Xray restarted on ${panelName}!`, 'ok');
    loadBackendLogs();
  } catch (e) {
    toast(`Xray restart failed: ${e.message}`, 'err');
    loadBackendLogs();
  }
}

async function pingPanel(id, notify = true) {
  const badge = document.getElementById(`pingBadge_${id}`);
  if (badge) {
    badge.className = 'panel-ping-badge';
    badge.innerHTML = `<span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span>`;
  }
  try {
    const res = await api('GET', `/api/panels/${id}/ping`);
    if (res.ok) {
      const ms = res.latency_ms;
      if (badge) {
        let cls = 'online';
        if (ms > 350) cls = 'offline';
        else if (ms > 150) cls = 'degraded';
        badge.className = `panel-ping-badge ${cls}`;
        badge.innerHTML = `⚡ ${ms}ms`;
      }
      if (notify) toast(`Ping to panel: ${ms}ms`, 'ok');
    } else {
      if (badge) {
        badge.className = 'panel-ping-badge offline';
        badge.textContent = 'Offline';
      }
      if (notify) toast(`Ping failed: ${res.error}`, 'err');
    }
  } catch (e) {
    if (badge) {
      badge.className = 'panel-ping-badge offline';
      badge.textContent = 'Err';
    }
    if (notify) toast(`Ping error: ${e.message}`, 'err');
  }
}

function showAddPanel() {
  openModal('Add 3X-UI Panel', 'NEW INSTANCE', `
    <div class="form-field">
      <label>Panel Display Name</label>
      <input class="form-input" id="pName" placeholder="e.g. ShabGard Server"/>
    </div>
    <div class="form-field">
      <label>Panel Base URL</label>
      <input class="form-input" id="pUrl" placeholder="https://127.0.0.1:2087/shabgard"/>
      <span class="field-hint">Include sub-path if set (e.g. /shabgard). Use 127.0.0.1 if on same VPS.</span>
    </div>
    <div class="form-field">
      <label>API Bearer Token</label>
      <input class="form-input" id="pToken" placeholder="Paste token from Panel Settings > API Token"/>
    </div>
    <div class="form-field">
      <label>Path Prefix</label>
      <input class="form-input" id="pPrefix" value="/panel"/>
      <span class="field-hint">Default is /panel. Only change if reverse-proxy dictates otherwise.</span>
    </div>
    <button class="btn btn-primary" id="btnAddPanel" style="width:100%;margin-top:10px" onclick="savePanel()">
      Save Panel Instance
    </button>
  `);
}

async function savePanel() {
  const btn = document.getElementById('btnAddPanel');
  const data = {
    name: document.getElementById('pName').value.trim(),
    url: document.getElementById('pUrl').value.trim().replace(/\/+$/, ''),
    token: document.getElementById('pToken').value.trim(),
    path_prefix: document.getElementById('pPrefix').value.trim() || '/panel',
  };
  if (!data.name || !data.url || !data.token) {
    toast('Please fill all required fields', false);
    return;
  }

  setBtnLoading(btn, true, 'Saving...');
  try {
    await api('POST', '/api/panels', data);
    closeModal();
    toast('Panel saved successfully! Click "Test" to verify.');
    await loadPanels();
  } catch (e) {
    toast(e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

function editPanel(id) {
  const p = panels.find(x => String(x.id).trim() === String(id).trim());
  if (!p) return;
  openModal(t('modal_edit_panel') || 'Edit 3X-UI Panel', 'EDIT INSTANCE', `
    <div class="form-field">
      <label>${t('field_panel_name') || 'Panel Display Name'}</label>
      <input class="form-input" id="editPName" value="${esc(p.name)}" placeholder="e.g. ShabGard Server"/>
    </div>
    <div class="form-field">
      <label>${t('field_panel_url') || 'Panel Base URL'}</label>
      <input class="form-input" id="editPUrl" value="${esc(p.url)}" placeholder="https://127.0.0.1:2087/shabgard"/>
      <span class="field-hint">Include sub-path if set (e.g. /shabgard). Use 127.0.0.1 if on same VPS.</span>
    </div>
    <div class="form-field">
      <label>${t('field_panel_token') || 'API Bearer Token'}</label>
      <input class="form-input" id="editPToken" value="${esc(p.token)}" placeholder="Paste token from Panel Settings > API Token"/>
    </div>
    <div class="form-field">
      <label>${t('field_path_prefix') || 'Path Prefix'}</label>
      <input class="form-input" id="editPPrefix" value="${esc(p.path_prefix || '/panel')}"/>
      <span class="field-hint">Default is /panel. Only change if reverse-proxy dictates otherwise.</span>
    </div>
    <button class="btn btn-primary" id="btnUpdatePanel" style="width:100%;margin-top:10px" onclick="updatePanel('${p.id}')">
      ${t('btn_update_panel') || 'Update Panel Instance'}
    </button>
  `);
}

async function updatePanel(id) {
  const btn = document.getElementById('btnUpdatePanel');
  const data = {
    name: document.getElementById('editPName').value.trim(),
    url: document.getElementById('editPUrl').value.trim().replace(/\/+$/, ''),
    token: document.getElementById('editPToken').value.trim(),
    path_prefix: document.getElementById('editPPrefix').value.trim() || '/panel',
  };
  if (!data.name || !data.url || !data.token) {
    toast('Please fill all required fields', false);
    return;
  }

  setBtnLoading(btn, true, 'Updating...');
  try {
    await api('PUT', `/api/panels/${id}`, data);
    closeModal();
    toast('Panel updated successfully! Linked schedules preserved.', 'ok');
    await loadPanels();
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast(e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deletePanel(id) {
  try {
    await api('DELETE', '/api/panels/' + id);
    toast('Panel removed');
    await loadPanels();
    await loadSchedules();
  } catch (e) {
    toast(e.message, false);
  }
}

async function testPanel(id) {
  const p = panels.find(x => String(x.id).trim() === String(id).trim());
  const panelName = p ? p.name : 'Panel';
  try {
    toast(`Testing connection to ${panelName}...`, 'info');
    const inbounds = await api('GET', `/api/panels/${id}/inbounds`);
    toast(`Connected to ${panelName}! Found ${inbounds.length} inbound service(s).`, 'ok');
    loadBackendLogs();
  } catch (e) {
    toast(`Connection failed: ${e.message}`, 'err');
    loadBackendLogs();
  }
}

// ─── 2. SCHEDULES LOGIC (With Edit & Sync State Check) ────────────────────────
async function loadSchedules(showToast = false) {
  try {
    schedules = await api('GET', '/api/schedules');
    renderSchedules();
    updateMetrics();
  } catch (e) {
    if (showToast) toast('Error loading schedules: ' + e.message, false);
  }
}

function isScheduleActiveNow(s) {
  if (!s.enabled) return false;
  try {
    const [eh, em] = s.enable_time.split(':').map(Number);
    const [dh, dm] = s.disable_time.split(':').map(Number);
    const enMins = eh * 60 + em;
    const disMins = dh * 60 + dm;

    const now = new Date();
    // JS getDay(): 0=Sun, 1=Mon ... 6=Sat -> Python weekday: 0=Mon ... 6=Sun
    const todayWeekday = (now.getDay() + 6) % 7;
    const days = (s.days && s.days.length) ? s.days : [0, 1, 2, 3, 4, 5, 6];

    const curMins = now.getHours() * 60 + now.getMinutes();

    if (enMins < disMins) {
      if (days.length < 7 && !days.includes(todayWeekday)) return false;
      return curMins >= enMins && curMins < disMins;
    } else if (enMins > disMins) {
      if (curMins >= enMins) {
        if (days.length < 7 && !days.includes(todayWeekday)) return false;
        return true;
      } else if (curMins < disMins) {
        const yesterdayWeekday = (todayWeekday + 6) % 7;
        if (days.length < 7 && !days.includes(yesterdayWeekday)) return false;
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function formatScheduleDays(days) {
  if (!days || days.length === 0 || days.length === 7) {
    return t('days_all');
  }
  const isWeekendIR = days.length === 2 && days.includes(3) && days.includes(4);
  if (isWeekendIR) return t('days_weekend_ir');

  const isWeekendIntl = days.length === 2 && days.includes(5) && days.includes(6);
  if (isWeekendIntl) return t('days_weekend_intl');

  const isWorkdays = days.length === 5 && [0,1,2,3,4].every(d => days.includes(d));
  if (isWorkdays) return t('days_workdays');

  const order = currentLang === 'fa' ? [5, 6, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.map(d => t('day_' + d)).join(', ');
}

function renderSchedules() {
  const tbody = document.getElementById('schedulesTableBody');
  const empty = document.getElementById('schedulesEmpty');
  document.getElementById('badgeScheduleCount').textContent = schedules.length;

  if (!schedules.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = schedules.map(s => {
    let p = panels.find(x => String(x.id).trim() === String(s.panel_id).trim());
    if (!p && panels.length === 1) {
      p = panels[0];
    }
    const actionType = s.action_type || 'inbound_window';

    let panelName = s.panel_name || (p ? p.name : '');
    if (!panelName || panelName === 'Unknown Panel') {
      if (s.panel_id === 'all') panelName = t('panel_all_fleet');
      else if (actionType === 'custom_command') panelName = t('panel_host_server');
      else if (actionType === 'telegram_alert') panelName = 'Telegram Bot';
      else if (p) panelName = p.name;
      else if (panels.length === 1) panelName = panels[0].name;
      else panelName = s.panel_id || 'Panel';
    }

    const isActiveWindow = isScheduleActiveNow(s);

    let taskBadge = '';
    if (actionType === 'inbound_window') {
      taskBadge = `<span class="task-pill inbound">⚡ ${t('badge_inbound')}</span>`;
    } else if (actionType === 'xray_restart') {
      taskBadge = `<span class="task-pill xray">🔄 ${t('badge_xray_restart')}</span>`;
    } else if (actionType === 'xray_window') {
      taskBadge = `<span class="task-pill xray">🛑 ${t('badge_xray_window')}</span>`;
    } else if (actionType === 'reset_traffic') {
      taskBadge = `<span class="task-pill reset">📊 ${t('badge_reset_traffic')}</span>`;
    } else if (actionType === 'custom_command') {
      taskBadge = `<span class="task-pill command">💻 ${t('badge_command')}</span>`;
    } else if (actionType === 'custom_api') {
      taskBadge = `<span class="task-pill api">🌐 ${t('badge_api')}</span>`;
    } else if (actionType === 'telegram_alert') {
      taskBadge = `<span class="task-pill alert">✈️ ${t('badge_alert')}</span>`;
    }

    let statusBadge = '';
    if (!s.enabled) {
      statusBadge = `<span class="status-pill disabled">${t('status_paused')}</span>`;
    } else if (actionType === 'inbound_window' || actionType === 'xray_window') {
      if (isActiveWindow) {
        statusBadge = `<span class="status-pill active">${t('status_active')}</span>`;
      } else {
        statusBadge = `<span class="status-pill idle">${t('status_idle')}</span>`;
      }
    } else {
      statusBadge = `<span class="status-pill active">⏰ ACTIVE RULE</span>`;
    }

    let inboundCellHtml = '';
    if (actionType === 'inbound_window') {
      inboundCellHtml = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${taskBadge}
          <span class="inbound-name">${esc(s.inbound_remark || 'Inbound')}</span>
          <span class="inbound-id-tag">#${s.inbound_id}</span>
          <button class="btn-micro" onclick="showInboundStats('${s.id}')" title="${t('btn_traffic_stats')}">📊</button>
        </div>
      `;
    } else if (actionType === 'xray_restart') {
      inboundCellHtml = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${taskBadge}
          <span class="inbound-name">${esc(s.task_name || 'Xray Core Auto-Restart')}</span>
        </div>
      `;
    } else if (actionType === 'xray_window') {
      inboundCellHtml = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${taskBadge}
          <span class="inbound-name">${esc(s.task_name || 'Xray Maintenance Window')}</span>
        </div>
      `;
    } else if (actionType === 'reset_traffic') {
      inboundCellHtml = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${taskBadge}
          <span class="inbound-name">${esc(s.task_name || ('Reset Traffic (' + (s.inbound_remark || 'All Inbounds') + ')'))}</span>
        </div>
      `;
    } else if (actionType === 'custom_command') {
      inboundCellHtml = `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${taskBadge}
            <span class="inbound-name">${esc(s.task_name || 'Shell Script')}</span>
          </div>
          <code style="font-size:11px;color:#a78bfa;background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;width:fit-content;direction:ltr;">${esc((s.command || '').slice(0, 35))}${(s.command && s.command.length > 35) ? '...' : ''}</code>
        </div>
      `;
    } else if (actionType === 'custom_api') {
      inboundCellHtml = `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${taskBadge}
            <span class="inbound-name">${esc(s.task_name || 'Custom 3X-UI API')}</span>
          </div>
          <code style="font-size:11px;color:#fb7185;background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;width:fit-content;direction:ltr;">${esc(s.api_method || 'POST')} ${esc(s.api_endpoint || '/')}</code>
        </div>
      `;
    } else if (actionType === 'telegram_alert') {
      inboundCellHtml = `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${taskBadge}
            <span class="inbound-name">${esc(s.task_name || 'Telegram Reminder')}</span>
          </div>
          <div style="font-size:11.5px;color:var(--text-muted);">${esc((s.message || '').slice(0, 45))}${(s.message && s.message.length > 45) ? '...' : ''}</div>
        </div>
      `;
    }

    let timeBadgeHtml = '';
    if (actionType === 'inbound_window' || actionType === 'xray_window') {
      timeBadgeHtml = `
        <div class="window-badge">
          <span>${s.enable_time}</span>
          <span class="window-arrow">→</span>
          <span>${s.disable_time || '--:--'}</span>
        </div>
      `;
    } else {
      timeBadgeHtml = `
        <div class="window-badge">
          <span>⏰ ${s.enable_time}</span>
        </div>
      `;
    }

    let actionBtnsHtml = '';
    if (actionType === 'inbound_window') {
      actionBtnsHtml = `
        <button class="btn btn-success btn-sm" onclick="runNow('${s.id}', 'enable')" title="${t('on_now')}">▶ ON</button>
        <button class="btn btn-ghost btn-sm" onclick="runNow('${s.id}', 'disable')" title="${t('off_now')}">⏹ OFF</button>
      `;
    } else if (actionType === 'xray_window') {
      actionBtnsHtml = `
        <button class="btn btn-danger btn-sm" onclick="runNow('${s.id}', 'stop')" title="Stop Core">🛑 Stop</button>
        <button class="btn btn-success btn-sm" onclick="runNow('${s.id}', 'start')" title="Start Core">🟢 Start</button>
      `;
    } else {
      actionBtnsHtml = `
        <button class="btn btn-primary btn-sm" onclick="runNow('${s.id}', 'run')" title="${t('btn_run_task')}">▶ ${t('btn_run_task')}</button>
      `;
    }

    return `
      <tr>
        <td class="col-inbound">
          <div class="schedule-card-top">
            ${inboundCellHtml}
            <div class="mobile-status-slot">${statusBadge}</div>
          </div>
        </td>
        <td class="col-panel">
          <span class="cell-label">${t('th_panel')}:</span>
          <span style="font-weight:600;color:#cbd5e1;">${esc(panelName)}</span>
        </td>
        <td class="col-window">
          <span class="cell-label">${t('th_window')}:</span>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${timeBadgeHtml}
            <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
              <span>📅</span> <span>${formatScheduleDays(s.days)}</span>
            </div>
          </div>
        </td>
        <td class="col-tz">
          <span class="cell-label">${t('th_timezone')}:</span>
          <span style="color:var(--text-muted);font-size:12px;">${esc(s.timezone)}</span>
        </td>
        <td class="col-auto">
          <span class="cell-label">${t('th_auto')}:</span>
          <span class="toggle-switch ${s.enabled ? 'on' : ''}" onclick="toggleSchedule('${s.id}')"></span>
        </td>
        <td class="desktop-status-slot">
          ${statusBadge}
        </td>
        <td class="col-actions">
          <div class="table-actions">
            <button class="btn btn-edit btn-sm" onclick="showEditSchedule('${s.id}')" title="Edit Schedule">✏️ ${t('btn_edit')}</button>
            ${actionBtnsHtml}
            <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')" title="${t('btn_delete')}">🗑 ${t('btn_delete')}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterSchedules() {
  const q = document.getElementById('searchScheduleInput').value.toLowerCase().trim();
  const rows = document.querySelectorAll('#schedulesTableBody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

// ─── Day-of-Week Chips Selector ──────────────────────────────────────────────
function renderDayChipsHTML(containerId, selectedDays = [0, 1, 2, 3, 4, 5, 6]) {
  const isFa = currentLang === 'fa';
  // Display order: Persian starts from Sat (5) ... Fri (4); International Mon (0) ... Sun (6)
  const daysList = isFa ? [5, 6, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];

  const chips = daysList.map(d => {
    const active = selectedDays.includes(d) ? 'active' : '';
    return `<span class="day-chip ${active}" data-day="${d}" onclick="toggleDayChip(this)">${t('day_' + d)}</span>`;
  }).join('');

  return `
    <div class="form-field" style="margin-top:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label>${t('th_days')}</label>
        <div style="display:flex;gap:4px;">
          <button type="button" class="day-preset-btn" onclick="applyDayPreset('${containerId}', [0,1,2,3,4,5,6])">${t('days_all')}</button>
          <button type="button" class="day-preset-btn" onclick="applyDayPreset('${containerId}', ${isFa ? '[3,4]' : '[5,6]'})">${isFa ? 'آخر هفته' : 'Weekend'}</button>
          <button type="button" class="day-preset-btn" onclick="applyDayPreset('${containerId}', [0,1,2,3,4])">${isFa ? 'روزهای کاری' : 'Workdays'}</button>
        </div>
      </div>
      <div class="day-chips-grid" id="${containerId}">
        ${chips}
      </div>
    </div>
  `;
}

function toggleDayChip(el) {
  el.classList.toggle('active');
}

function applyDayPreset(containerId, daysArray) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.day-chip').forEach(chip => {
    const d = parseInt(chip.getAttribute('data-day'));
    if (daysArray.includes(d)) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function getSelectedDaysFromContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [0, 1, 2, 3, 4, 5, 6];
  const activeChips = container.querySelectorAll('.day-chip.active');
  const days = Array.from(activeChips).map(c => parseInt(c.getAttribute('data-day')));
  return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
}

function showAddSchedule() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const commandOption = isAdmin ? `<option value="custom_command">💻 ${t('task_custom_command')}</option>` : '';

  const panelOptions = [
    `<option value="all">${t('panel_all_fleet')}</option>`,
    ...panels.map(p => `<option value="${p.id}">${esc(p.name)}</option>`)
  ].join('');

  openModal(t('btn_new_schedule') || 'Create Schedule', 'AUTO TASK', `
    <div class="form-field">
      <label>${t('task_type')}</label>
      <select class="form-input" id="sActionType" onchange="onScheduleActionTypeChange()">
        <option value="inbound_window" selected>⚡ ${t('task_inbound_window')}</option>
        <option value="xray_restart">🔄 ${t('task_xray_restart')}</option>
        <option value="xray_window">🛑 ${t('task_xray_window')}</option>
        <option value="reset_traffic">📊 ${t('task_reset_traffic')}</option>
        ${commandOption}
        <option value="custom_api">🌐 ${t('task_custom_api')}</option>
        <option value="telegram_alert">✈️ ${t('task_telegram_alert')}</option>
      </select>
    </div>

    <div class="form-field" id="secTaskName" style="display:none;">
      <label>${t('field_task_name')}</label>
      <input class="form-input" id="sTaskName" placeholder="e.g. Daily Xray Refresh at 4 AM"/>
    </div>

    <div class="form-field" id="secPanel">
      <label>${t('th_panel')}</label>
      <select class="form-input" id="sPanel" onchange="onSchedulePanelChange()">${panelOptions}</select>
    </div>

    <div class="form-field" id="secInbound">
      <label>${t('th_inbound')}</label>
      <select class="form-input" id="sInbound"><option>Loading inbounds...</option></select>
    </div>

    <div class="form-field" id="secCommand" style="display:none;">
      <label>${t('field_shell_command')}</label>
      <textarea class="form-input" id="sCommand" rows="3" placeholder="systemctl restart xray&#10;sync && echo 3 > /proc/sys/vm/drop_caches" style="font-family:var(--font-mono);direction:ltr;"></textarea>
      <span class="field-hint">Executed asynchronously via Linux bash subprocess with stdout/stderr logged & sent to Telegram.</span>
    </div>

    <div id="secApi" style="display:none;">
      <div class="form-grid-2">
        <div class="form-field">
          <label>${t('field_api_method')}</label>
          <select class="form-input" id="sApiMethod">
            <option value="POST" selected>POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div class="form-field">
          <label>${t('field_api_endpoint')}</label>
          <input class="form-input" id="sApiEndpoint" placeholder="/server/restartXrayService" style="direction:ltr;font-family:var(--font-mono);"/>
        </div>
      </div>
      <div class="form-field">
        <label>${t('field_api_payload')}</label>
        <textarea class="form-input" id="sApiPayload" rows="2" placeholder='{"id": 1}' style="font-family:var(--font-mono);direction:ltr;"></textarea>
      </div>
    </div>

    <div class="form-field" id="secMessage" style="display:none;">
      <label>${t('field_message')}</label>
      <textarea class="form-input" id="sMessage" rows="3" placeholder="🔔 Attention: Weekly server maintenance starting in 5 minutes!"></textarea>
    </div>

    <div class="form-grid-2" id="secDualTime">
      <div class="form-field">
        <label id="lblTime1">${t('th_window')} - START</label>
        ${renderTimePickerHTML('sEn', '02:00')}
      </div>
      <div class="form-field">
        <label id="lblTime2">${t('th_window')} - END</label>
        ${renderTimePickerHTML('sDis', '07:00')}
      </div>
    </div>

    <div class="form-field" id="secSingleTime" style="display:none;">
      <label>${t('field_trigger_time')}</label>
      ${renderTimePickerHTML('sSingle', '04:00')}
    </div>

    <div class="time-presets" id="secPresets">
      <span style="font-size:11px;color:var(--text-muted);align-self:center;">Presets:</span>
      <span class="preset-chip" onclick="applyPreset('02','00','07','00')">🌙 Nightly (02:00 - 07:00)</span>
      <span class="preset-chip" onclick="applyPreset('01','00','06','00')">01:00 - 06:00</span>
      <span class="preset-chip" onclick="applyPreset('08','00','18','00')">☀️ Daytime (08:00 - 18:00)</span>
    </div>

    ${renderDayChipsHTML('newScheduleDays', [0, 1, 2, 3, 4, 5, 6])}

    <div class="form-field" style="margin-top:16px;">
      <label>${t('th_timezone')}</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" selected>Asia/Tehran (Iran Standard Time UTC+3:30)</option>
        <option value="UTC">UTC (Universal Coordinated Time)</option>
        <option value="Asia/Dubai">Asia/Dubai (UTC+4:00)</option>
        <option value="Europe/Istanbul">Europe/Istanbul (UTC+3:00)</option>
        <option value="Europe/Berlin">Europe/Berlin (CET)</option>
      </select>
    </div>

    <button class="btn btn-primary" id="btnSaveSchedule" style="width:100%;margin-top:14px;" onclick="saveNewSchedule()">
      ${t('btn_save')} & ${t('th_auto')}
    </button>
  `);

  onScheduleActionTypeChange();
}

function onScheduleActionTypeChange() {
  const type = document.getElementById('sActionType').value;
  const secTaskName = document.getElementById('secTaskName');
  const secPanel = document.getElementById('secPanel');
  const secInbound = document.getElementById('secInbound');
  const secCommand = document.getElementById('secCommand');
  const secApi = document.getElementById('secApi');
  const secMessage = document.getElementById('secMessage');
  const secDualTime = document.getElementById('secDualTime');
  const secSingleTime = document.getElementById('secSingleTime');
  const secPresets = document.getElementById('secPresets');
  const lblTime1 = document.getElementById('lblTime1');
  const lblTime2 = document.getElementById('lblTime2');
  const pSel = document.getElementById('sPanel');

  if (type === 'inbound_window') {
    if (secTaskName) secTaskName.style.display = 'none';
    if (secPanel) secPanel.style.display = 'block';
    if (secInbound) secInbound.style.display = 'block';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'grid';
    if (secSingleTime) secSingleTime.style.display = 'none';
    if (secPresets) secPresets.style.display = 'flex';
    if (lblTime1) lblTime1.textContent = (currentLang === 'fa') ? 'ساعت روشن شدن (۲۴ ساعته)' : 'Turn ON Time (24h)';
    if (lblTime2) lblTime2.textContent = (currentLang === 'fa') ? 'ساعت خاموش شدن (۲۴ ساعته)' : 'Turn OFF Time (24h)';

    if (pSel && pSel.value === 'all' && panels.length > 0) {
      pSel.value = panels[0].id;
    }
    loadInboundSelect();
  } else if (type === 'xray_restart') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'block';
    if (secInbound) secInbound.style.display = 'none';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'none';
    if (secSingleTime) secSingleTime.style.display = 'block';
    if (secPresets) secPresets.style.display = 'none';
  } else if (type === 'xray_window') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'block';
    if (secInbound) secInbound.style.display = 'none';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'grid';
    if (secSingleTime) secSingleTime.style.display = 'none';
    if (secPresets) secPresets.style.display = 'none';
    if (lblTime1) lblTime1.textContent = (currentLang === 'fa') ? 'ساعت متوقف شدن هسته (Stop)' : 'Core Stop Time (24h)';
    if (lblTime2) lblTime2.textContent = (currentLang === 'fa') ? 'ساعت شروع به کار مجدد (Start)' : 'Core Start Time (24h)';
  } else if (type === 'reset_traffic') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'block';
    if (secInbound) secInbound.style.display = 'block';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'none';
    if (secSingleTime) secSingleTime.style.display = 'block';
    if (secPresets) secPresets.style.display = 'none';
    loadInboundSelect(null, true);
  } else if (type === 'custom_command') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'none';
    if (secInbound) secInbound.style.display = 'none';
    if (secCommand) secCommand.style.display = 'block';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'none';
    if (secSingleTime) secSingleTime.style.display = 'block';
    if (secPresets) secPresets.style.display = 'none';
  } else if (type === 'custom_api') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'block';
    if (secInbound) secInbound.style.display = 'none';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'block';
    if (secMessage) secMessage.style.display = 'none';
    if (secDualTime) secDualTime.style.display = 'none';
    if (secSingleTime) secSingleTime.style.display = 'block';
    if (secPresets) secPresets.style.display = 'none';
  } else if (type === 'telegram_alert') {
    if (secTaskName) secTaskName.style.display = 'block';
    if (secPanel) secPanel.style.display = 'none';
    if (secInbound) secInbound.style.display = 'none';
    if (secCommand) secCommand.style.display = 'none';
    if (secApi) secApi.style.display = 'none';
    if (secMessage) secMessage.style.display = 'block';
    if (secDualTime) secDualTime.style.display = 'none';
    if (secSingleTime) secSingleTime.style.display = 'block';
    if (secPresets) secPresets.style.display = 'none';
  }
}

function onSchedulePanelChange() {
  const type = document.getElementById('sActionType') ? document.getElementById('sActionType').value : 'inbound_window';
  if (type === 'inbound_window') {
    loadInboundSelect();
  } else if (type === 'reset_traffic') {
    loadInboundSelect(null, true);
  }
}

async function loadInboundSelect(selectedInboundId = null, includeAllChoice = false) {
  const pSel = document.getElementById('sPanel');
  if (!pSel) return;
  const panelId = pSel.value;
  const sel = document.getElementById('sInbound');
  if (!sel) return;

  if (panelId === 'all') {
    sel.innerHTML = `<option value="">${t('task_all_inbounds')}</option>`;
    return;
  }

  sel.innerHTML = '<option>Loading inbounds from panel...</option>';

  try {
    const inbounds = await api('GET', `/api/panels/${panelId}/inbounds`);
    let opts = '';
    if (includeAllChoice) {
      opts += `<option value="" ${!selectedInboundId ? 'selected' : ''}>${t('task_all_inbounds')}</option>`;
    }
    if (!inbounds.length && !includeAllChoice) {
      sel.innerHTML = '<option value="">No inbounds configured on this panel</option>';
      return;
    }
    opts += inbounds.map(i => `
      <option value="${i.id}" data-remark="${esc(i.remark)}" ${selectedInboundId == i.id ? 'selected' : ''}>
        ${esc(i.remark)} (Port ${i.port}) ${i.enable ? '🟢 Enabled' : '🔴 Disabled'}
      </option>
    `).join('');
    sel.innerHTML = opts;
  } catch (e) {
    if (includeAllChoice) {
      sel.innerHTML = `<option value="">${t('task_all_inbounds')}</option>`;
    } else {
      sel.innerHTML = `<option value="">Error fetching inbounds: ${e.message}</option>`;
    }
  }
}

async function saveNewSchedule() {
  const type = document.getElementById('sActionType').value;
  const btn = document.getElementById('btnSaveSchedule');

  let pId = document.getElementById('sPanel') ? document.getElementById('sPanel').value : '';
  let panelName = '';
  if (pId === 'all') {
    panelName = t('panel_all_fleet');
  } else if (type === 'custom_command') {
    pId = '';
    panelName = t('panel_host_server');
  } else if (type === 'telegram_alert') {
    pId = '';
    panelName = 'Telegram Bot';
  } else {
    const pObj = panels.find(x => String(x.id).trim() === String(pId).trim());
    panelName = pObj ? pObj.name : '';
  }

  let inboundId = null;
  let inboundRemark = '';
  if (type === 'inbound_window' || type === 'reset_traffic') {
    const sel = document.getElementById('sInbound');
    if (sel && sel.value) {
      inboundId = parseInt(sel.value);
      const opt = sel.options[sel.selectedIndex];
      inboundRemark = opt ? (opt.dataset.remark || opt.textContent) : '';
    } else if (type === 'inbound_window') {
      toast('Please select an inbound service', false);
      return;
    }
  }

  let enableTime = '02:00';
  let disableTime = '07:00';
  if (type === 'inbound_window' || type === 'xray_window') {
    enableTime = getTimePickerValue('sEn');
    disableTime = getTimePickerValue('sDis');
  } else {
    enableTime = getTimePickerValue('sSingle');
    disableTime = '';
  }

  const data = {
    action_type: type,
    task_name: (document.getElementById('sTaskName') ? document.getElementById('sTaskName').value.trim() : '') || '',
    panel_id: pId,
    panel_name: panelName,
    inbound_id: inboundId,
    inbound_remark: inboundRemark,
    enable_time: enableTime,
    disable_time: disableTime,
    timezone: document.getElementById('sTz').value,
    days: getSelectedDaysFromContainer('newScheduleDays'),
    command: (document.getElementById('sCommand') ? document.getElementById('sCommand').value.trim() : '') || '',
    api_method: (document.getElementById('sApiMethod') ? document.getElementById('sApiMethod').value : 'POST') || 'POST',
    api_endpoint: (document.getElementById('sApiEndpoint') ? document.getElementById('sApiEndpoint').value.trim() : '') || '',
    api_payload: (document.getElementById('sApiPayload') ? document.getElementById('sApiPayload').value.trim() : '') || '',
    message: (document.getElementById('sMessage') ? document.getElementById('sMessage').value.trim() : '') || ''
  };

  setBtnLoading(btn, true, 'Creating Task...');
  try {
    await api('POST', '/api/schedules', data);
    closeModal();
    toast('Automation task scheduled successfully!');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Error creating task: ' + e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

// ─── EDIT SCHEDULE MODAL ──────────────────────────────────────────────────────
function showEditSchedule(scheduleId) {
  const s = schedules.find(x => x.id === scheduleId);
  if (!s) return;

  const actionType = s.action_type || 'inbound_window';
  const isAdmin = currentUser && currentUser.role === 'admin';
  const commandOption = (isAdmin || actionType === 'custom_command') ? `<option value="custom_command" ${actionType === 'custom_command' ? 'selected' : ''}>💻 ${t('task_custom_command')}</option>` : '';

  const panelOptions = [
    `<option value="all" ${s.panel_id === 'all' ? 'selected' : ''}>${t('panel_all_fleet')}</option>`,
    ...panels.map(p => `
      <option value="${p.id}" ${p.id === s.panel_id ? 'selected' : ''}>${esc(p.name)}</option>
    `)
  ].join('');

  openModal(t('btn_edit') || 'Edit Schedule', 'UPDATE TASK', `
    <div class="form-field">
      <label>${t('task_type')}</label>
      <select class="form-input" id="sActionType" onchange="onScheduleActionTypeChange()">
        <option value="inbound_window" ${actionType === 'inbound_window' ? 'selected' : ''}>⚡ ${t('task_inbound_window')}</option>
        <option value="xray_restart" ${actionType === 'xray_restart' ? 'selected' : ''}>🔄 ${t('task_xray_restart')}</option>
        <option value="xray_window" ${actionType === 'xray_window' ? 'selected' : ''}>🛑 ${t('task_xray_window')}</option>
        <option value="reset_traffic" ${actionType === 'reset_traffic' ? 'selected' : ''}>📊 ${t('task_reset_traffic')}</option>
        ${commandOption}
        <option value="custom_api" ${actionType === 'custom_api' ? 'selected' : ''}>🌐 ${t('task_custom_api')}</option>
        <option value="telegram_alert" ${actionType === 'telegram_alert' ? 'selected' : ''}>✈️ ${t('task_telegram_alert')}</option>
      </select>
    </div>

    <div class="form-field" id="secTaskName">
      <label>${t('field_task_name')}</label>
      <input class="form-input" id="sTaskName" value="${esc(s.task_name || '')}" placeholder="e.g. Daily Xray Refresh at 4 AM"/>
    </div>

    <div class="form-field" id="secPanel">
      <label>${t('th_panel')}</label>
      <select class="form-input" id="sPanel" onchange="onSchedulePanelChange()">${panelOptions}</select>
    </div>

    <div class="form-field" id="secInbound">
      <label>${t('th_inbound')}</label>
      <select class="form-input" id="sInbound"><option>Loading...</option></select>
    </div>

    <div class="form-field" id="secCommand" style="display:none;">
      <label>${t('field_shell_command')}</label>
      <textarea class="form-input" id="sCommand" rows="3" style="font-family:var(--font-mono);direction:ltr;">${esc(s.command || '')}</textarea>
    </div>

    <div id="secApi" style="display:none;">
      <div class="form-grid-2">
        <div class="form-field">
          <label>${t('field_api_method')}</label>
          <select class="form-input" id="sApiMethod">
            <option value="POST" ${s.api_method === 'POST' ? 'selected' : ''}>POST</option>
            <option value="GET" ${s.api_method === 'GET' ? 'selected' : ''}>GET</option>
            <option value="PUT" ${s.api_method === 'PUT' ? 'selected' : ''}>PUT</option>
            <option value="DELETE" ${s.api_method === 'DELETE' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
        <div class="form-field">
          <label>${t('field_api_endpoint')}</label>
          <input class="form-input" id="sApiEndpoint" value="${esc(s.api_endpoint || '')}" placeholder="/server/restartXrayService" style="direction:ltr;font-family:var(--font-mono);"/>
        </div>
      </div>
      <div class="form-field">
        <label>${t('field_api_payload')}</label>
        <textarea class="form-input" id="sApiPayload" rows="2" style="font-family:var(--font-mono);direction:ltr;">${esc(s.api_payload || '')}</textarea>
      </div>
    </div>

    <div class="form-field" id="secMessage" style="display:none;">
      <label>${t('field_message')}</label>
      <textarea class="form-input" id="sMessage" rows="3">${esc(s.message || '')}</textarea>
    </div>

    <div class="form-grid-2" id="secDualTime">
      <div class="form-field">
        <label id="lblTime1">${t('th_window')} - START</label>
        ${renderTimePickerHTML('sEn', s.enable_time || '02:00')}
      </div>
      <div class="form-field">
        <label id="lblTime2">${t('th_window')} - END</label>
        ${renderTimePickerHTML('sDis', s.disable_time || '07:00')}
      </div>
    </div>

    <div class="form-field" id="secSingleTime" style="display:none;">
      <label>${t('field_trigger_time')}</label>
      ${renderTimePickerHTML('sSingle', s.enable_time || '04:00')}
    </div>

    <div class="time-presets" id="secPresets">
      <span style="font-size:11px;color:var(--text-muted);align-self:center;">Presets:</span>
      <span class="preset-chip" onclick="applyPreset('02','00','07','00')">🌙 Nightly (02:00 - 07:00)</span>
      <span class="preset-chip" onclick="applyPreset('01','00','06','00')">01:00 - 06:00</span>
      <span class="preset-chip" onclick="applyPreset('08','00','18','00')">☀️ Daytime (08:00 - 18:00)</span>
    </div>

    ${renderDayChipsHTML('editScheduleDays', s.days || [0, 1, 2, 3, 4, 5, 6])}

    <div class="form-field" style="margin-top:16px;">
      <label>${t('th_timezone')}</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" ${s.timezone === 'Asia/Tehran' ? 'selected' : ''}>Asia/Tehran (Iran Standard Time UTC+3:30)</option>
        <option value="UTC" ${s.timezone === 'UTC' ? 'selected' : ''}>UTC</option>
        <option value="Asia/Dubai" ${s.timezone === 'Asia/Dubai' ? 'selected' : ''}>Asia/Dubai (UTC+4)</option>
        <option value="Europe/Istanbul" ${s.timezone === 'Europe/Istanbul' ? 'selected' : ''}>Europe/Istanbul (UTC+3)</option>
        <option value="Europe/Berlin" ${s.timezone === 'Europe/Berlin' ? 'selected' : ''}>Europe/Berlin (CET)</option>
      </select>
    </div>

    <button class="btn btn-primary" id="btnUpdateSchedule" style="width:100%;margin-top:14px;" onclick="updateSchedule('${s.id}')">
      ${t('btn_save')} & ${t('th_auto')}
    </button>
  `);

  onScheduleActionTypeChange();
  if (actionType === 'inbound_window') {
    loadInboundSelect(s.inbound_id, false);
  } else if (actionType === 'reset_traffic') {
    loadInboundSelect(s.inbound_id, true);
  }
}

async function updateSchedule(scheduleId) {
  const type = document.getElementById('sActionType').value;
  const btn = document.getElementById('btnUpdateSchedule');

  let pId = document.getElementById('sPanel') ? document.getElementById('sPanel').value : '';
  let panelName = '';
  if (pId === 'all') {
    panelName = t('panel_all_fleet');
  } else if (type === 'custom_command') {
    pId = '';
    panelName = t('panel_host_server');
  } else if (type === 'telegram_alert') {
    pId = '';
    panelName = 'Telegram Bot';
  } else {
    const pObj = panels.find(x => String(x.id).trim() === String(pId).trim());
    panelName = pObj ? pObj.name : '';
  }

  let inboundId = null;
  let inboundRemark = '';
  if (type === 'inbound_window' || type === 'reset_traffic') {
    const sel = document.getElementById('sInbound');
    if (sel && sel.value) {
      inboundId = parseInt(sel.value);
      const opt = sel.options[sel.selectedIndex];
      inboundRemark = opt ? (opt.dataset.remark || opt.textContent) : '';
    } else if (type === 'inbound_window') {
      toast('Please select an inbound service', false);
      return;
    }
  }

  let enableTime = '02:00';
  let disableTime = '07:00';
  if (type === 'inbound_window' || type === 'xray_window') {
    enableTime = getTimePickerValue('sEn');
    disableTime = getTimePickerValue('sDis');
  } else {
    enableTime = getTimePickerValue('sSingle');
    disableTime = '';
  }

  const data = {
    action_type: type,
    task_name: (document.getElementById('sTaskName') ? document.getElementById('sTaskName').value.trim() : '') || '',
    panel_id: pId,
    panel_name: panelName,
    inbound_id: inboundId,
    inbound_remark: inboundRemark,
    enable_time: enableTime,
    disable_time: disableTime,
    timezone: document.getElementById('sTz').value,
    days: getSelectedDaysFromContainer('editScheduleDays'),
    command: (document.getElementById('sCommand') ? document.getElementById('sCommand').value.trim() : '') || '',
    api_method: (document.getElementById('sApiMethod') ? document.getElementById('sApiMethod').value : 'POST') || 'POST',
    api_endpoint: (document.getElementById('sApiEndpoint') ? document.getElementById('sApiEndpoint').value.trim() : '') || '',
    api_payload: (document.getElementById('sApiPayload') ? document.getElementById('sApiPayload').value.trim() : '') || '',
    message: (document.getElementById('sMessage') ? document.getElementById('sMessage').value.trim() : '') || ''
  };

  setBtnLoading(btn, true, 'Updating Task...');
  try {
    await api('PUT', `/api/schedules/${scheduleId}`, data);
    closeModal();
    toast('Task updated & re-scheduled successfully!');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Error updating task: ' + e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

async function toggleSchedule(id) {
  try {
    await api('PATCH', `/api/schedules/${id}/toggle`);
    toast('Schedule status toggled');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast(e.message, false);
  }
}

async function deleteSchedule(id) {
  try {
    await api('DELETE', `/api/schedules/${id}`);
    toast('Schedule deleted successfully');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Delete failed: ' + e.message, false);
  }
}

async function runNow(id, action) {
  try {
    const actLabel = (action === 'enable' ? 'ON' : (action === 'disable' ? 'OFF' : (action === 'stop' ? 'STOP' : (action === 'start' ? 'START' : 'RUN'))));
    toast(`Running manual ${actLabel} execution...`, 'info');
    await api('POST', `/api/schedules/${id}/run/${action}`);
    toast(`Task ${actLabel} executed successfully!`, 'ok');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Execution failed: ' + e.message, 'err');
    loadBackendLogs();
  }
}

// ─── 3. PERSISTENT EXECUTION LOGS ────────────────────────────────────────────
async function loadBackendLogs() {
  try {
    backendLogs = await api('GET', '/api/logs');
    renderLogs();
  } catch (e) {
    console.error('Failed to load logs:', e);
  }
}

function renderLogs() {
  const tbody = document.getElementById('logsTableBody');
  const empty = document.getElementById('logsEmpty');

  if (!backendLogs.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = backendLogs.map(l => `
    <tr>
      <td class="log-col-time">
        <div class="log-top-bar">
          <span class="log-time-badge">${esc(l.timestamp)}</span>
          <span class="log-status-tag ${esc(l.status)} mobile-status-slot">${esc(l.status)}</span>
        </div>
      </td>
      <td class="log-col-panel">
        <span class="cell-label">${t('th_panel')}:</span>
        <strong>${esc(l.panel)}</strong>
      </td>
      <td class="log-col-inbound">
        <span class="cell-label">${t('th_inbound')}:</span>
        <span>${esc(l.inbound)}</span>
      </td>
      <td class="log-col-action">
        <span class="cell-label">${t('th_action')}:</span>
        <span class="log-action-tag">${esc(l.action)}</span>
      </td>
      <td class="desktop-status-slot">
        <span class="log-status-tag ${esc(l.status)}">${esc(l.status)}</span>
      </td>
      <td class="log-col-details">
        <div class="log-details-box">${esc(l.details)}</div>
      </td>
    </tr>
  `).join('');
}

async function clearBackendLogs() {
  try {
    await api('DELETE', '/api/logs');
    backendLogs = [];
    renderLogs();
    toast('All execution logs cleared');
  } catch (e) {
    toast('Failed to clear logs: ' + e.message, false);
  }
}

// ─── 4. SETTINGS & TELEGRAM INTEGRATION ──────────────────────────────────────
async function loadSettings() {
  if (currentUser && currentUser.role === 'admin') {
    load2FAStatus();
  }
  try {
    const s = await api('GET', '/api/settings');
    if (s) {
      document.getElementById('setPort').value = s.port || 8181;
      const tg = s.telegram || {};
      telegramEnabled = !!tg.enabled;
      document.getElementById('tgEnabledToggle').classList.toggle('on', telegramEnabled);
      document.getElementById('tgToken').value = tg.bot_token || '';
      document.getElementById('tgChatId').value = tg.chat_id || '';
      document.getElementById('tgProxy').value = tg.socks_proxy || '';
      document.getElementById('tgApiServer').value = tg.api_server || '';
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function toggleTelegramState() {
  telegramEnabled = !telegramEnabled;
  document.getElementById('tgEnabledToggle').classList.toggle('on', telegramEnabled);
}

async function saveTelegramSettings() {
  const btn = document.getElementById('btnSaveTelegram');
  setBtnLoading(btn, true, 'Saving...');

  const tgData = {
    enabled: telegramEnabled,
    bot_token: document.getElementById('tgToken').value.trim(),
    chat_id: document.getElementById('tgChatId').value.trim(),
    socks_proxy: document.getElementById('tgProxy').value.trim(),
    api_server: document.getElementById('tgApiServer').value.trim()
  };

  const portVal = parseInt(document.getElementById('setPort').value) || 8181;

  try {
    await api('POST', '/api/settings', {
      port: portVal,
      telegram: tgData
    });
    toast('Telegram settings saved successfully!');
  } catch (e) {
    toast('Error saving settings: ' + e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

async function testTelegramChannel() {
  const btn = document.getElementById('btnTestTelegram');
  const token = document.getElementById('tgToken').value.trim();
  const chatId = document.getElementById('tgChatId').value.trim();
  const proxy = document.getElementById('tgProxy').value.trim();
  const apiServer = document.getElementById('tgApiServer').value.trim();

  if (!token || !chatId) {
    toast('Please enter Bot Token and Chat ID first', false);
    return;
  }

  setBtnLoading(btn, true, 'Sending Test...');
  toast('Sending test notification to Telegram...', 'info');
  try {
    const res = await api('POST', '/api/telegram/test', {
      bot_token: token,
      chat_id: chatId,
      socks_proxy: proxy,
      api_server: apiServer
    });
    toast(res.message || 'Test message sent! Check your Telegram.', 'ok');
  } catch (e) {
    toast('Telegram test failed: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function savePortSetting() {
  const portVal = parseInt(document.getElementById('setPort').value);
  if (!portVal || portVal < 1 || portVal > 65535) {
    toast('Invalid port number (1-65535)', false);
    return;
  }

  const tgData = {
    enabled: telegramEnabled,
    bot_token: document.getElementById('tgToken').value.trim(),
    chat_id: document.getElementById('tgChatId').value.trim(),
    socks_proxy: document.getElementById('tgProxy').value.trim(),
    api_server: document.getElementById('tgApiServer').value.trim()
  };

  try {
    await api('POST', '/api/settings', {
      port: portVal,
      telegram: tgData
    });
    toast('Port saved! Run "systemctl restart xui-manager" to activate new port.');
  } catch (e) {
    toast(e.message, false);
  }
}

// ─── 5. USER MANAGEMENT (MULTI-USER ACCESS CONTROL) ──────────────────────────
async function loadUsers() {
  if (currentUser.role !== 'admin') return;
  try {
    allUsers = await api('GET', '/api/users');
    renderUsers();
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  tbody.innerHTML = allUsers.map(u => {
    let roleClass = 'btn-ghost';
    if (u.role === 'admin') roleClass = 'btn-primary';
    else if (u.role === 'operator') roleClass = 'btn-edit';

    const isSelf = (u.username === currentUser.username);

    return `
      <tr>
        <td class="user-col-name">
          <div class="user-top-bar">
            <div>
              <strong>${esc(u.username)}</strong>
              ${isSelf ? '<span style="font-size:11px;color:var(--accent-cyan);margin-left:6px;">(You)</span>' : ''}
            </div>
            <span class="btn ${roleClass} btn-sm mobile-role-slot" style="cursor:default;padding:2px 8px;font-size:11px;">
              ${esc(u.role.toUpperCase())}
            </span>
          </div>
        </td>
        <td class="desktop-role-slot">
          <span class="btn ${roleClass} btn-sm" style="cursor:default;padding:2px 8px;font-size:11px;">
            ${esc(u.role.toUpperCase())}
          </span>
        </td>
        <td>
          <span class="cell-label">${t('th_created')}:</span>
          <span style="color:var(--text-muted);font-size:12px;">${esc(u.created_at || '—')}</span>
        </td>
        <td>
          <div class="table-actions">
            <button class="btn btn-ghost btn-sm" onclick="showChangePasswordModal('${u.id}', '${esc(u.username)}')">🔑 Password</button>
            ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">🗑 ${t('btn_delete')}</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function showAddUserModal() {
  openModal('Add System User', 'NEW ACCOUNT', `
    <div class="form-field">
      <label>Username</label>
      <input type="text" class="form-input" id="newUsername" placeholder="e.g. operator1"/>
    </div>
    <div class="form-field">
      <label>Password</label>
      <input type="password" class="form-input" id="newPassword" placeholder="Minimum 4 characters"/>
    </div>
    <div class="form-field">
      <label>Access Role</label>
      <select class="form-input" id="newRole">
        <option value="operator" selected>Operator (Can manage schedules, inbounds & manual toggles)</option>
        <option value="admin">Administrator (Full access, user & port management)</option>
        <option value="viewer">Viewer (Read-only observation & logs)</option>
      </select>
    </div>
    <button class="btn btn-primary" id="btnCreateUser" style="width:100%;margin-top:10px;" onclick="createUser()">
      Create User Account
    </button>
  `);
}

async function createUser() {
  const btn = document.getElementById('btnCreateUser');
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;

  if (!username || !password) {
    toast('Please fill username and password', false);
    return;
  }

  setBtnLoading(btn, true, 'Creating...');
  try {
    await api('POST', '/api/users', { username, password, role });
    closeModal();
    toast(`User '${username}' created successfully!`);
    await loadUsers();
  } catch (e) {
    toast(e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

function showChangePasswordModal(userId, username) {
  openModal('Change Password', 'SECURITY', `
    <div class="form-field">
      <label>Target User</label>
      <input type="text" class="form-input" value="${username}" disabled/>
    </div>
    <div class="form-field">
      <label>New Password</label>
      <input type="password" class="form-input" id="editPassword" placeholder="Enter new password"/>
    </div>
    <button class="btn btn-primary" id="btnChangePass" style="width:100%;margin-top:10px;" onclick="updateUserPassword('${userId}')">
      Update Password
    </button>
  `);
}

async function updateUserPassword(userId) {
  const btn = document.getElementById('btnChangePass');
  const pass = document.getElementById('editPassword').value;
  if (!pass || pass.length < 4) {
    toast('Password must be at least 4 characters', false);
    return;
  }

  setBtnLoading(btn, true, 'Updating...');
  try {
    await api('PUT', `/api/users/${userId}`, { password: pass });
    closeModal();
    toast('Password updated successfully!');
  } catch (e) {
    toast(e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deleteUser(userId) {
  try {
    await api('DELETE', `/api/users/${userId}`);
    toast('User deleted successfully');
    await loadUsers();
  } catch (e) {
    toast(e.message, false);
  }
}

// ─── 5.1 TWO-FACTOR AUTHENTICATION (2FA / TOTP) ──────────────────────────
async function load2FAStatus() {
  const badge = document.getElementById('twoFaStatusBadge');
  const area = document.getElementById('twoFaContentArea');
  if (!badge || !area) return;

  try {
    const res = await api('GET', '/api/settings/2fa/status');
    if (res.enabled) {
      badge.className = 'panel-status-tag online';
      badge.textContent = t('twofa_status_enabled');
      area.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
          <div>
            <div style="font-weight:700;color:var(--success);font-size:15px;display:flex;align-items:center;gap:6px;">
              <span>🛡️</span> <span>${t('twofa_status_enabled')}</span>
            </div>
            <p style="font-size:12.5px;color:var(--text-muted);margin-top:6px;max-width:560px;line-height:1.5;">
              ${t('twofa_sub')}
            </p>
          </div>
          <button class="btn btn-danger btn-sm" onclick="disable2FA()">
            ${t('btn_disable_2fa')}
          </button>
        </div>
      `;
    } else {
      badge.className = 'panel-status-tag';
      badge.textContent = t('twofa_status_disabled');
      area.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
          <div>
            <div style="font-weight:700;color:var(--text-secondary);font-size:15px;display:flex;align-items:center;gap:6px;">
              <span>⚪</span> <span>${t('twofa_status_disabled')}</span>
            </div>
            <p style="font-size:12.5px;color:var(--text-muted);margin-top:6px;max-width:560px;line-height:1.5;">
              ${t('twofa_sub')}
            </p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="start2FASetup()">
            ${t('btn_enable_2fa')}
          </button>
        </div>
      `;
    }
  } catch (e) {
    console.error('Failed to load 2FA status:', e);
  }
}

async function start2FASetup() {
  try {
    toast('Generating 2FA configuration...', 'info');
    const res = await api('POST', '/api/settings/2fa/setup');
    openModal(t('twofa_title'), '2FA SETUP', `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${t('twofa_scan_desc')}</p>
        <div style="display:flex;justify-content:center;padding:12px;background:#ffffff;border-radius:12px;width:fit-content;margin:0 auto;box-shadow:0 4px 12px rgba(0,0,0,0.15);" id="twoFaQrContainer"></div>
        <div class="form-field">
          <label>${t('twofa_secret_key')}</label>
          <div style="display:flex;gap:8px;">
            <input class="form-input" id="twoFaSecretInput" value="${res.secret}" readonly style="font-family:var(--font-mono);font-size:13.5px;font-weight:700;letter-spacing:1px;text-align:center;background:rgba(255,255,255,0.04);"/>
            <button class="btn btn-ghost" type="button" onclick="copy2FaSecret()" title="Copy Key">📋</button>
          </div>
        </div>
        <div class="form-field">
          <label>${t('twofa_enter_code')}</label>
          <input class="form-input" id="twoFaConfirmCode" placeholder="123456" maxlength="6" inputmode="numeric" style="text-align:center;font-size:22px;letter-spacing:6px;font-family:var(--font-mono);font-weight:700;" autocomplete="one-time-code" autofocus/>
        </div>
        <button class="btn btn-primary" id="btnConfirm2FA" style="width:100%;margin-top:6px;" onclick="confirmAndEnable2FA('${res.secret}')">
          ${t('btn_verify_enable')}
        </button>
      </div>
    `);

    setTimeout(() => {
      const qrBox = document.getElementById('twoFaQrContainer');
      if (qrBox && typeof QRCode !== 'undefined') {
        new QRCode(qrBox, {
          text: res.uri,
          width: 170,
          height: 170,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
      const codeInp = document.getElementById('twoFaConfirmCode');
      if (codeInp) {
        codeInp.focus();
        codeInp.addEventListener('keyup', (e) => {
          if (e.key === 'Enter') confirmAndEnable2FA(res.secret);
        });
      }
    }, 80);
  } catch (e) {
    toast('Failed to initialize 2FA: ' + (e.message || e), 'err');
  }
}

function copy2FaSecret() {
  const inp = document.getElementById('twoFaSecretInput');
  if (!inp) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inp.value).then(() => {
      toast(t('copy_secret_success') || 'Secret key copied to clipboard!', 'ok');
    }).catch(() => {
      inp.select();
      document.execCommand('copy');
      toast(t('copy_secret_success') || 'Secret key copied to clipboard!', 'ok');
    });
  } else {
    inp.select();
    document.execCommand('copy');
    toast(t('copy_secret_success') || 'Secret key copied to clipboard!', 'ok');
  }
}

async function confirmAndEnable2FA(secret) {
  const codeInp = document.getElementById('twoFaConfirmCode');
  const code = codeInp ? codeInp.value.trim() : '';
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    toast('Please enter a valid 6-digit confirmation code.', 'err');
    return;
  }
  const btn = document.getElementById('btnConfirm2FA');
  setBtnLoading(btn, true, 'Verifying...');
  try {
    const res = await api('POST', '/api/settings/2fa/enable', { secret, code });
    closeModal();
    toast(res.message || 'Two-Factor Authentication activated successfully!', 'ok');
    await load2FAStatus();
    loadBackendLogs();
  } catch (e) {
    toast(e.message || 'Verification failed', 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function disable2FA() {
  if (!confirm('Are you sure you want to disable Two-Factor Authentication? Your account will only be protected by password.')) return;
  try {
    const res = await api('POST', '/api/settings/2fa/disable');
    toast(res.message || 'Two-Factor Authentication disabled.', 'ok');
    await load2FAStatus();
    loadBackendLogs();
  } catch (e) {
    toast('Error disabling 2FA: ' + (e.message || e), 'err');
  }
}

// ─── 6. METRICS SUMMARY ──────────────────────────────────────────────────────
function updateMetrics() {
  const activeCount = schedules.filter(s => s.enabled).length;
  document.getElementById('statActiveSchedules').textContent = activeCount;
  document.getElementById('statTotalPanels').textContent = panels.length;
}

// ─── 7. INBOUND TELEMETRY & PORT CHECK ───────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function showInboundStats(scheduleId) {
  openModal(t('btn_traffic_stats'), 'LIVE TELEMETRY', `
    <div style="text-align:center;padding:24px;">
      <span class="spinner"></span>
      <p style="margin-top:10px;color:var(--text-muted);">Fetching inbound telemetry from 3X-UI...</p>
    </div>
  `);

  try {
    const stats = await api('GET', `/api/schedules/${scheduleId}/stats`);
    if (!stats.ok) throw new Error(stats.error || 'Failed to fetch inbound telemetry');

    const limitStr = stats.limit_bytes > 0 ? formatBytes(stats.limit_bytes) : 'Unlimited (نامحدود)';

    openModal(`${stats.remark} (#${stats.id})`, stats.protocol.toUpperCase(), `
      <div style="display:flex;flex-direction:column;gap:14px;padding:4px 0;">
        <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;">
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:12px;padding:14px;">
            <div style="font-size:11px;color:var(--text-muted);">${t('stat_download')} (Down)</div>
            <div style="font-size:18px;font-weight:800;color:var(--accent-cyan);margin-top:4px;">⬇️ ${formatBytes(stats.down_bytes)}</div>
          </div>
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:12px;padding:14px;">
            <div style="font-size:11px;color:var(--text-muted);">${t('stat_upload')} (Up)</div>
            <div style="font-size:18px;font-weight:800;color:var(--accent-purple);margin-top:4px;">⬆️ ${formatBytes(stats.up_bytes)}</div>
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:12px;padding:14px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);">${t('stat_total_transferred')}:</span>
            <span style="font-weight:700;color:var(--text-primary);">${formatBytes(stats.total_bytes)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);">Traffic Cap (سقف ترافیک):</span>
            <span style="font-weight:700;color:var(--text-primary);">${limitStr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);">${t('stat_clients')}:</span>
            <span style="font-weight:700;color:var(--text-primary);">👥 ${stats.client_count} client(s)</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:12px;color:var(--text-muted);">Port & Protocol:</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--accent-cyan);">:${stats.port} (${stats.protocol})</span>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:8px;">
          <button class="btn btn-primary" style="width:100%;" onclick="closeModal()">Close</button>
        </div>
      </div>
    `);
  } catch (e) {
    openModal('Telemetry Error', 'ERROR', `
      <div style="text-align:center;padding:20px;color:var(--danger);">
        ⚠️ Failed to load stats: ${esc(e.message)}
      </div>
    `);
  }
}

// ─── 8. BACKUP & RESTORE ─────────────────────────────────────────────────────
function downloadBackup() {
  toast('Generating fleet backup file...', 'info');
  window.location.href = '/api/backup';
  setTimeout(() => {
    toast('Backup download initiated!', 'ok');
  }, 800);
}

async function sendBackupToTelegram() {
  try {
    toast('Packaging and sending backup to Telegram...', 'info');
    const res = await api('POST', '/api/backup/telegram');
    toast(res.message || 'Backup document sent to Telegram!', 'ok');
  } catch (e) {
    toast('Failed to send backup: ' + e.message, 'err');
  }
}

function triggerRestoreFileDialog() {
  const fi = document.getElementById('backupFileInput');
  if (fi) fi.click();
}

async function handleRestoreFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!confirm('Are you sure you want to restore from this backup file? Existing configuration will be updated.')) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      toast('Restoring fleet configuration...', 'info');
      const res = await api('POST', '/api/restore', data);
      toast(res.message || 'Backup restored successfully!', 'ok');
      await loadAllData();
    } catch (err) {
      toast('Restore failed: ' + err.message, 'err');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

// ─── UTIL ────────────────────────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

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

  // Initialize Language
  if (typeof setLanguage === 'function') {
    setLanguage(currentLang);
  }

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
        <span class="panel-status-tag">Connected</span>
      </div>
      <div class="panel-footer-actions">
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 ${t('btn_test') || 'Test'}</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 ${t('btn_delete') || 'Delete'}</button>
      </div>
    </div>
  `).join('');
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
    const curMins = now.getHours() * 60 + now.getMinutes();

    if (enMins < disMins) {
      return curMins >= enMins && curMins < disMins;
    } else if (enMins > disMins) {
      return curMins >= enMins || curMins < disMins;
    }
    return false;
  } catch {
    return false;
  }
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
    const panelName = s.panel_name || (p ? p.name : 'Unknown Panel');
    const isActiveWindow = isScheduleActiveNow(s);

    let statusBadge = '';
    if (!s.enabled) {
      statusBadge = `<span class="status-pill disabled">${t('status_paused')}</span>`;
    } else if (isActiveWindow) {
      statusBadge = `<span class="status-pill active">${t('status_active')}</span>`;
    } else {
      statusBadge = `<span class="status-pill idle">${t('status_idle')}</span>`;
    }

    return `
      <tr>
        <td class="col-inbound">
          <div class="schedule-card-top">
            <div class="inbound-title">
              <span class="inbound-name">${esc(s.inbound_remark)}</span>
              <span class="inbound-id-tag">#${s.inbound_id}</span>
            </div>
            <div class="mobile-status-slot">${statusBadge}</div>
          </div>
        </td>
        <td class="col-panel">
          <span class="cell-label">${t('th_panel')}:</span>
          <span style="font-weight:600;color:#cbd5e1;">${esc(panelName)}</span>
        </td>
        <td class="col-window">
          <span class="cell-label">${t('th_window')}:</span>
          <div class="window-badge">
            <span>${s.enable_time}</span>
            <span class="window-arrow">→</span>
            <span>${s.disable_time}</span>
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
            <button class="btn btn-success btn-sm" onclick="runNow('${s.id}', 'enable')" title="${t('on_now')}">▶ ON</button>
            <button class="btn btn-ghost btn-sm" onclick="runNow('${s.id}', 'disable')" title="${t('off_now')}">⏹ OFF</button>
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

function showAddSchedule() {
  if (!panels.length) {
    toast('Please add at least one panel first!', false);
    return;
  }

  const panelOptions = panels.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  openModal('Create Inbound Schedule', 'AUTO TRIGGER', `
    <div class="form-field">
      <label>Target 3X-UI Panel</label>
      <select class="form-input" id="sPanel" onchange="loadInboundSelect()">${panelOptions}</select>
    </div>

    <div class="form-field">
      <label>Target Inbound</label>
      <select class="form-input" id="sInbound"><option>Loading inbounds...</option></select>
    </div>

    <div class="form-grid-2">
      <div class="form-field">
        <label>Turn ON Time (24h)</label>
        ${renderTimePickerHTML('sEn', '02:00')}
      </div>
      <div class="form-field">
        <label>Turn OFF Time (24h)</label>
        ${renderTimePickerHTML('sDis', '07:00')}
      </div>
    </div>

    <div class="time-presets">
      <span style="font-size:11px;color:var(--text-muted);align-self:center;">Presets:</span>
      <span class="preset-chip" onclick="applyPreset('02','00','07','00')">🌙 Nightly (02:00 - 07:00)</span>
      <span class="preset-chip" onclick="applyPreset('01','00','06','00')">01:00 - 06:00</span>
      <span class="preset-chip" onclick="applyPreset('08','00','18','00')">☀️ Daytime (08:00 - 18:00)</span>
    </div>

    <div class="form-field" style="margin-top:16px;">
      <label>Timezone</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" selected>Asia/Tehran (Iran Standard Time UTC+3:30)</option>
        <option value="UTC">UTC (Universal Coordinated Time)</option>
        <option value="Asia/Dubai">Asia/Dubai (UTC+4:00)</option>
        <option value="Europe/Istanbul">Europe/Istanbul (UTC+3:00)</option>
        <option value="Europe/Berlin">Europe/Berlin (CET)</option>
      </select>
    </div>

    <button class="btn btn-primary" id="btnSaveSchedule" style="width:100%;margin-top:12px;" onclick="saveNewSchedule()">
      Create Schedule & Auto-Sync State
    </button>
  `);

  loadInboundSelect();
}

async function loadInboundSelect(selectedInboundId = null) {
  const panelId = document.getElementById('sPanel').value;
  const sel = document.getElementById('sInbound');
  sel.innerHTML = '<option>Loading inbounds from panel...</option>';

  try {
    const inbounds = await api('GET', `/api/panels/${panelId}/inbounds`);
    if (!inbounds.length) {
      sel.innerHTML = '<option value="">No inbounds configured on this panel</option>';
      return;
    }
    sel.innerHTML = inbounds.map(i => `
      <option value="${i.id}" data-remark="${esc(i.remark)}" ${selectedInboundId == i.id ? 'selected' : ''}>
        ${esc(i.remark)} (Port ${i.port}) ${i.enable ? '🟢 Enabled' : '🔴 Disabled'}
      </option>
    `).join('');
  } catch (e) {
    sel.innerHTML = `<option value="">Error fetching inbounds: ${e.message}</option>`;
    toast('Error loading inbounds: ' + e.message, false);
  }
}

async function saveNewSchedule() {
  const sel = document.getElementById('sInbound');
  if (!sel.value) {
    toast('Please select an inbound', false);
    return;
  }
  const opt = sel.options[sel.selectedIndex];
  const btn = document.getElementById('btnSaveSchedule');
  const pId = document.getElementById('sPanel').value;
  const pObj = panels.find(x => String(x.id).trim() === String(pId).trim());
  const panelName = pObj ? pObj.name : '';

  const data = {
    panel_id: pId,
    panel_name: panelName,
    inbound_id: parseInt(sel.value),
    inbound_remark: opt.dataset.remark || opt.textContent,
    enable_time: getTimePickerValue('sEn'),
    disable_time: getTimePickerValue('sDis'),
    timezone: document.getElementById('sTz').value
  };

  setBtnLoading(btn, true, 'Creating & Syncing...');
  try {
    await api('POST', '/api/schedules', data);
    closeModal();
    toast('Schedule created! Current window state applied.');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Error creating schedule: ' + e.message, false);
  } finally {
    setBtnLoading(btn, false);
  }
}

// ─── EDIT SCHEDULE MODAL ──────────────────────────────────────────────────────
function showEditSchedule(scheduleId) {
  const s = schedules.find(x => x.id === scheduleId);
  if (!s) return;

  const panelOptions = panels.map(p => `
    <option value="${p.id}" ${p.id === s.panel_id ? 'selected' : ''}>${esc(p.name)}</option>
  `).join('');

  openModal('Edit Schedule', 'UPDATE CONFIG', `
    <div class="form-field">
      <label>Target 3X-UI Panel</label>
      <select class="form-input" id="sPanel" onchange="loadInboundSelect()">${panelOptions}</select>
    </div>

    <div class="form-field">
      <label>Target Inbound</label>
      <select class="form-input" id="sInbound"><option>Loading...</option></select>
    </div>

    <div class="form-grid-2">
      <div class="form-field">
        <label>Turn ON Time (24h)</label>
        ${renderTimePickerHTML('sEn', s.enable_time)}
      </div>
      <div class="form-field">
        <label>Turn OFF Time (24h)</label>
        ${renderTimePickerHTML('sDis', s.disable_time)}
      </div>
    </div>

    <div class="time-presets">
      <span style="font-size:11px;color:var(--text-muted);align-self:center;">Presets:</span>
      <span class="preset-chip" onclick="applyPreset('02','00','07','00')">🌙 Nightly (02:00 - 07:00)</span>
      <span class="preset-chip" onclick="applyPreset('01','00','06','00')">01:00 - 06:00</span>
      <span class="preset-chip" onclick="applyPreset('08','00','18','00')">☀️ Daytime (08:00 - 18:00)</span>
    </div>

    <div class="form-field" style="margin-top:16px;">
      <label>Timezone</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" ${s.timezone === 'Asia/Tehran' ? 'selected' : ''}>Asia/Tehran (Iran Standard Time UTC+3:30)</option>
        <option value="UTC" ${s.timezone === 'UTC' ? 'selected' : ''}>UTC</option>
        <option value="Asia/Dubai" ${s.timezone === 'Asia/Dubai' ? 'selected' : ''}>Asia/Dubai (UTC+4)</option>
        <option value="Europe/Istanbul" ${s.timezone === 'Europe/Istanbul' ? 'selected' : ''}>Europe/Istanbul (UTC+3)</option>
      </select>
    </div>

    <button class="btn btn-primary" id="btnUpdateSchedule" style="width:100%;margin-top:12px;" onclick="updateSchedule('${s.id}')">
      Update Schedule & Re-Sync State
    </button>
  `);

  loadInboundSelect(s.inbound_id);
}

async function updateSchedule(scheduleId) {
  const sel = document.getElementById('sInbound');
  const opt = sel.options[sel.selectedIndex];
  const btn = document.getElementById('btnUpdateSchedule');
  const pId = document.getElementById('sPanel').value;
  const pObj = panels.find(x => String(x.id).trim() === String(pId).trim());
  const panelName = pObj ? pObj.name : '';

  const data = {
    panel_id: pId,
    panel_name: panelName,
    inbound_id: parseInt(sel.value),
    inbound_remark: opt ? (opt.dataset.remark || opt.textContent) : undefined,
    enable_time: getTimePickerValue('sEn'),
    disable_time: getTimePickerValue('sDis'),
    timezone: document.getElementById('sTz').value
  };

  setBtnLoading(btn, true, 'Updating & Syncing...');
  try {
    await api('PUT', `/api/schedules/${scheduleId}`, data);
    closeModal();
    toast('Schedule updated! Inbound state re-synchronized.');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Error updating schedule: ' + e.message, false);
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
    toast(`Running manual ${action.toUpperCase()} command...`, 'info');
    await api('POST', `/api/schedules/${id}/run/${action}`);
    toast(`Inbound ${action === 'enable' ? 'turned ON' : 'turned OFF'} successfully!`, 'ok');
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Command failed: ' + e.message, 'err');
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

// ─── 6. METRICS SUMMARY ──────────────────────────────────────────────────────
function updateMetrics() {
  const activeCount = schedules.filter(s => s.enabled).length;
  document.getElementById('statActiveSchedules').textContent = activeCount;
  document.getElementById('statTotalPanels').textContent = panels.length;
}

// ─── UTIL ────────────────────────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

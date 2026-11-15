// ─── App Global State ────────────────────────────────────────────────────────
let panels = [];
let schedules = [];
let backendLogs = [];
let currentTab = 'schedules';

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  document.querySelectorAll('.nav-link[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchTab(el.dataset.tab);
      if (window.innerWidth <= 868) toggleSidebar(false);
    });
  });

  // Initial Load
  loadAllData();

  // Auto-refresh logs and status every 15 seconds
  setInterval(() => {
    if (currentTab === 'logs') loadBackendLogs();
    if (currentTab === 'schedules') loadSchedules(false);
  }, 15000);
});

async function loadAllData() {
  await loadPanels();
  await loadSchedules();
  await loadBackendLogs();
  await loadSettings();
  updateMetrics();
}

// ─── Navigation & Views ──────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-link[data-tab]').forEach(e => e.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-link[data-tab="${tab}"]`);
  if (activeLink) activeLink.classList.add('active');

  document.querySelectorAll('.tab-pane').forEach(e => e.classList.remove('active'));
  const activePane = document.getElementById('tab-' + tab);
  if (activePane) activePane.classList.add('active');

  const titles = {
    schedules: { title: 'Inbound Schedules', sub: 'Automated time-based inbound enabling and disabling' },
    panels: { title: 'Connected Panels', sub: 'Manage your 3X-UI instances and token authentications' },
    logs: { title: 'Execution Logs', sub: 'Audit trail of automatic schedules and manual trigger actions' },
    settings: { title: 'Manager Settings', sub: 'Configure panel security credentials and web listening port' }
  };

  const meta = titles[tab] || { title: 'Dashboard', sub: '' };
  document.getElementById('viewTitle').textContent = meta.title;
  document.getElementById('viewSubtitle').textContent = meta.sub;

  const topActions = document.getElementById('topActions');
  if (tab === 'schedules') {
    topActions.innerHTML = `<button class="btn btn-primary" onclick="showAddSchedule()">+ New Schedule</button>`;
  } else if (tab === 'panels') {
    topActions.innerHTML = `<button class="btn btn-primary" onclick="showAddPanel()">+ New Panel</button>`;
  } else if (tab === 'logs') {
    topActions.innerHTML = `<button class="btn btn-ghost" onclick="loadBackendLogs()">🔄 Refresh Logs</button>`;
  } else {
    topActions.innerHTML = '';
  }
}

function toggleSidebar(forceState) {
  const sb = document.getElementById('sidebar');
  if (forceState !== undefined) {
    sb.classList.toggle('open', forceState);
  } else {
    sb.classList.toggle('open');
  }
}

// ─── API Client with Abort Timeout ───────────────────────────────────────────
async function api(method, path, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s safe timeout

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

// ─── Toast Notifications ─────────────────────────────────────────────────────
function toast(msg, ok = true) {
  const stack = document.getElementById('toastStack');
  const d = document.createElement('div');
  d.className = 'toast-msg ' + (ok ? 'ok' : 'err');
  d.innerHTML = (ok ? '✓ ' : '⚠️ ') + msg;
  stack.appendChild(d);
  setTimeout(() => {
    d.style.opacity = '0';
    d.style.transform = 'translateY(12px)';
    setTimeout(() => d.remove(), 300);
  }, 4000);
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
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 Test Inbounds</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 Delete</button>
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
    toast('Panel saved successfully! Click "Test Inbounds" to verify.');
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
  const p = panels.find(x => x.id === id);
  try {
    toast(`Testing connection to ${p.name}...`);
    const inbounds = await api('GET', `/api/panels/${id}/inbounds`);
    toast(`✓ Connected to ${p.name}! Found ${inbounds.length} inbound service(s).`);
    loadBackendLogs();
  } catch (e) {
    toast(`Connection failed: ${e.message}`, false);
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

    // Use browser current time as proxy for view
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
    const p = panels.find(x => x.id === s.panel_id);
    const panelName = p ? p.name : 'Unknown Panel';
    const isActiveWindow = isScheduleActiveNow(s);

    let statusBadge = '';
    if (!s.enabled) {
      statusBadge = '<span class="status-pill disabled">PAUSED</span>';
    } else if (isActiveWindow) {
      statusBadge = '<span class="status-pill active">🟢 ACTIVE (Window Open)</span>';
    } else {
      statusBadge = '<span class="status-pill idle">⏸ IDLE (Outside Window)</span>';
    }

    return `
      <tr>
        <td>
          <div class="inbound-title">
            <span class="inbound-name">${esc(s.inbound_remark)}</span>
            <span class="inbound-id-tag">#${s.inbound_id}</span>
          </div>
        </td>
        <td>
          <span style="font-weight:600;color:#cbd5e1;">${esc(panelName)}</span>
        </td>
        <td>
          <div class="window-badge">
            <span>${s.enable_time}</span>
            <span class="window-arrow">→</span>
            <span>${s.disable_time}</span>
          </div>
        </td>
        <td>
          <span style="color:var(--text-muted);font-size:12px;">${esc(s.timezone)}</span>
        </td>
        <td>
          <span class="toggle-switch ${s.enabled ? 'on' : ''}" onclick="toggleSchedule('${s.id}')"></span>
        </td>
        <td>
          ${statusBadge}
        </td>
        <td>
          <div class="table-actions">
            <button class="btn btn-edit btn-sm" onclick="showEditSchedule('${s.id}')" title="Edit Schedule">✏️ Edit</button>
            <button class="btn btn-success btn-sm" onclick="runNow('${s.id}', 'enable')" title="Force ON right now">▶ ON</button>
            <button class="btn btn-ghost btn-sm" onclick="runNow('${s.id}', 'disable')" title="Force OFF right now">⏹ OFF</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')" title="Delete Schedule">🗑 Delete</button>
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

  const data = {
    panel_id: document.getElementById('sPanel').value,
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
    toast('Schedule created! Current window state checked and applied.');
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

  const data = {
    panel_id: document.getElementById('sPanel').value,
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
    toast(`Running manual ${action.toUpperCase()} command...`);
    await api('POST', `/api/schedules/${id}/run/${action}`);
    toast(`Inbound ${action === 'enable' ? 'turned ON 🟢' : 'turned OFF 🔴'} successfully!`);
    await loadSchedules();
    loadBackendLogs();
  } catch (e) {
    toast('Command failed: ' + e.message, false);
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
      <td style="color:var(--text-muted);white-space:nowrap;">${esc(l.timestamp)}</td>
      <td><strong>${esc(l.panel)}</strong></td>
      <td>${esc(l.inbound)}</td>
      <td><span class="log-action-tag">${esc(l.action)}</span></td>
      <td>
        <span class="log-status-tag ${esc(l.status)}">${esc(l.status)}</span>
      </td>
      <td style="color:var(--text-secondary);max-width:320px;word-break:break-word;">
        ${esc(l.details)}
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

// ─── 4. SETTINGS VIEW ────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    if (s) {
      document.getElementById('setAdminUser').value = s.username || 'admin';
      document.getElementById('setPort').value = s.port || 8181;
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveSettingsForm() {
  const user = document.getElementById('setAdminUser').value.trim();
  const pass = document.getElementById('setAdminPass').value;
  const port = parseInt(document.getElementById('setPort').value);

  if (!user) {
    toast('Username cannot be empty', false);
    return;
  }
  if (!port || port < 1 || port > 65535) {
    toast('Port must be between 1 and 65535', false);
    return;
  }

  try {
    const res = await api('POST', '/api/settings', {
      username: user,
      password: pass || null,
      port: port
    });
    toast(res.message);
  } catch (e) {
    toast(e.message, false);
  }
}

// ─── 5. METRICS SUMMARY ──────────────────────────────────────────────────────
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

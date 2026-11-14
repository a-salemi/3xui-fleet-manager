// ─── State ────────────────────────────────────────────────
let panels = [];
let schedules = [];
const logs = [];

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchTab(el.dataset.tab);
    });
  });
  loadPanels();
  loadSchedules();
});

function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(e => e.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const titles = { panels: 'Panel Management', schedules: 'Inbound Schedules', logs: 'Activity Logs' };
  document.getElementById('pageTitle').textContent = titles[tab] || '';
}

// ─── API helpers ──────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 302 || r.redirected) { window.location = '/login'; return null; }
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(e.detail || 'Request failed');
  }
  return r.json();
}

// ─── Toast ────────────────────────────────────────────────
function toast(msg, ok = true) {
  const c = document.getElementById('toastContainer');
  const d = document.createElement('div');
  d.className = 'toast ' + (ok ? 'ok' : 'err');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 3500);
}

// ─── Log ──────────────────────────────────────────────────
function addLog(msg, type = '') {
  const t = new Date().toLocaleTimeString();
  logs.unshift({ msg: `[${t}] ${msg}`, type });
  renderLogs();
}
function renderLogs() {
  const box = document.getElementById('logBox');
  box.innerHTML = logs.map(l => `<div class="log-entry ${l.type}">${l.msg}</div>`).join('');
}
function clearLogs() { logs.length = 0; renderLogs(); }

// ─── Modal ────────────────────────────────────────────────
function openModal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

// ─── Panels ───────────────────────────────────────────────
async function loadPanels() {
  try {
    panels = await api('GET', '/api/panels');
    renderPanels();
  } catch (e) { toast(e.message, false); }
}

function renderPanels() {
  const c = document.getElementById('panelsList');
  if (!panels.length) {
    c.innerHTML = '<div class="empty-state">No panels added yet. Click "Add Panel" to connect your 3X-UI instance.</div>';
    return;
  }
  c.innerHTML = panels.map(p => `
    <div class="panel-card">
      <div class="card-head">
        <div>
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-url">${esc(p.url)}</div>
        </div>
        <span class="card-badge badge-ok">Connected</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 Test</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 Delete</button>
      </div>
    </div>
  `).join('');
}

function showAddPanel() {
  openModal('Add Panel', `
    <div class="form-group">
      <label>Panel Name</label>
      <input class="form-input" id="pName" placeholder="My Server"/>
    </div>
    <div class="form-group">
      <label>Panel URL</label>
      <input class="form-input" id="pUrl" placeholder="http://1.2.3.4:2053"/>
    </div>
    <div class="form-group">
      <label>API Token</label>
      <input class="form-input" id="pToken" placeholder="Bearer token from panel settings"/>
    </div>
    <div class="form-group">
      <label>Path Prefix</label>
      <input class="form-input" id="pPrefix" value="/panel"/>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="addPanel()">Connect Panel</button>
  `);
}

async function addPanel() {
  const data = {
    name: document.getElementById('pName').value,
    url: document.getElementById('pUrl').value.replace(/\/+$/, ''),
    token: document.getElementById('pToken').value,
    path_prefix: document.getElementById('pPrefix').value || '/panel',
  };
  if (!data.name || !data.url || !data.token) { toast('Fill all fields', false); return; }
  try {
    await api('POST', '/api/panels', data);
    closeModal();
    toast('Panel connected successfully!');
    addLog('Panel "' + data.name + '" added', 'success');
    loadPanels();
  } catch (e) { toast(e.message, false); }
}

async function deletePanel(id) {
  if (!confirm('Delete this panel and all its schedules?')) return;
  try {
    await api('DELETE', '/api/panels/' + id);
    toast('Panel deleted');
    addLog('Panel removed', '');
    loadPanels();
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function testPanel(id) {
  const p = panels.find(x => x.id === id);
  try {
    const inbounds = await api('GET', '/api/panels/' + id + '/inbounds');
    toast(`Connected! Found ${inbounds.length} inbound(s)`);
    addLog(`Test OK: ${p.name} — ${inbounds.length} inbound(s)`, 'success');
  } catch (e) {
    toast('Connection failed: ' + e.message, false);
    addLog(`Test FAIL: ${p.name} — ${e.message}`, 'error');
  }
}

// ─── Schedules ────────────────────────────────────────────
async function loadSchedules() {
  try {
    schedules = await api('GET', '/api/schedules');
    renderSchedules();
  } catch (e) { toast(e.message, false); }
}

function renderSchedules() {
  const body = document.getElementById('schedulesBody');
  const empty = document.getElementById('schedulesEmpty');
  if (!schedules.length) {
    body.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = schedules.map(s => {
    const pname = panels.find(p => p.id === s.panel_id)?.name || 'Unknown';
    return `<tr>
      <td><strong>${esc(s.inbound_remark)}</strong> <span style="color:var(--muted);font-size:11px">#${s.inbound_id}</span></td>
      <td>${esc(pname)}</td>
      <td><code>${s.enable_time}</code></td>
      <td><code>${s.disable_time}</code></td>
      <td>${esc(s.timezone)}</td>
      <td>
        <span class="toggle ${s.enabled ? 'on' : ''}" onclick="toggleSchedule('${s.id}')"></span>
      </td>
      <td>
        <button class="btn btn-success btn-sm" onclick="runNow('${s.id}','enable')" title="Enable now">▶ ON</button>
        <button class="btn btn-danger btn-sm" onclick="runNow('${s.id}','disable')" title="Disable now">⏸ OFF</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')" title="Delete">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

async function showAddSchedule() {
  if (!panels.length) { toast('Add a panel first', false); return; }
  const panelOpts = panels.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  openModal('Add Schedule', `
    <div class="form-group">
      <label>Panel</label>
      <select class="form-input" id="sPanel" onchange="loadInboundSelect()">${panelOpts}</select>
    </div>
    <div class="form-group">
      <label>Inbound</label>
      <select class="form-input" id="sInbound"><option>Loading...</option></select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Enable Time</label>
        <input type="time" class="form-input" id="sEnable" value="02:00"/>
      </div>
      <div class="form-group">
        <label>Disable Time</label>
        <input type="time" class="form-input" id="sDisable" value="07:00"/>
      </div>
    </div>
    <div class="form-group">
      <label>Timezone</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" selected>Asia/Tehran (UTC+3:30)</option>
        <option value="UTC">UTC</option>
        <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
        <option value="Europe/Istanbul">Europe/Istanbul (UTC+3)</option>
      </select>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="addSchedule()">Create Schedule</button>
  `);
  loadInboundSelect();
}

async function loadInboundSelect() {
  const pid = document.getElementById('sPanel').value;
  const sel = document.getElementById('sInbound');
  sel.innerHTML = '<option>Loading...</option>';
  try {
    const inbounds = await api('GET', '/api/panels/' + pid + '/inbounds');
    sel.innerHTML = inbounds.map(i =>
      `<option value="${i.id}" data-remark="${esc(i.remark)}">${esc(i.remark)} (#${i.id}) — Port ${i.port} ${i.enable ? '🟢' : '🔴'}</option>`
    ).join('');
  } catch (e) {
    sel.innerHTML = '<option>Error loading inbounds</option>';
    toast(e.message, false);
  }
}

async function addSchedule() {
  const sel = document.getElementById('sInbound');
  const opt = sel.options[sel.selectedIndex];
  const data = {
    panel_id: document.getElementById('sPanel').value,
    inbound_id: parseInt(sel.value),
    inbound_remark: opt.dataset.remark || opt.textContent,
    enable_time: document.getElementById('sEnable').value,
    disable_time: document.getElementById('sDisable').value,
    timezone: document.getElementById('sTz').value,
  };
  if (!data.inbound_id) { toast('Select an inbound', false); return; }
  try {
    await api('POST', '/api/schedules', data);
    closeModal();
    toast('Schedule created!');
    addLog(`Schedule: ${data.inbound_remark} — ON at ${data.enable_time}, OFF at ${data.disable_time}`, 'success');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function toggleSchedule(id) {
  try {
    await api('PATCH', '/api/schedules/' + id + '/toggle');
    toast('Schedule toggled');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function deleteSchedule(id) {
  if (!confirm('Delete this schedule?')) return;
  try {
    await api('DELETE', '/api/schedules/' + id);
    toast('Schedule deleted');
    addLog('Schedule removed', '');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function runNow(id, action) {
  try {
    await api('POST', `/api/schedules/${id}/run/${action}`);
    toast(`Inbound ${action}d manually!`);
    addLog(`Manual ${action} executed`, 'success');
  } catch (e) { toast(e.message, false); }
}

// ─── Util ─────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

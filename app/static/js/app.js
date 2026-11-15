let panels = [];
let schedules = [];
const logs = [];

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchTab(el.dataset.tab);
    });
  });
  loadPanels();
  loadSchedules();
  loadSettings();
});

function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(e => e.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const titles = { panels:'Panel Management', schedules:'Inbound Schedules', settings:'Panel Settings', logs:'Activity Logs' };
  document.getElementById('pageTitle').textContent = titles[tab] || '';
}

async function api(method, path, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 302 || r.redirected) { window.location = '/login'; return null; }
  if (!r.ok) {
    const e = await r.json().catch(() => ({detail: r.statusText}));
    throw new Error(e.detail || 'Request failed');
  }
  return r.json();
}

function toast(msg, ok=true) {
  const c = document.getElementById('toastContainer');
  const d = document.createElement('div');
  d.className = 'toast ' + (ok ? 'ok' : 'err');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

function addLog(msg, type='') {
  logs.unshift({ msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type });
  renderLogs();
}
function renderLogs() {
  document.getElementById('logBox').innerHTML = logs.map(l => `<div class="log-entry ${l.type}">${l.msg}</div>`).join('');
}
function clearLogs() { logs.length = 0; renderLogs(); }

function openModal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

function setBtnLoading(btn, loading, text = 'Saving...') {
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${text}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || 'Save Panel';
    btn.disabled = false;
  }
}

// ─── Panels ───────────────────────────────────────────────
async function loadPanels() {
  try { panels = await api('GET', '/api/panels'); renderPanels(); }
  catch (e) { toast(e.message, false); }
}

function renderPanels() {
  const c = document.getElementById('panelsList');
  if (!panels.length) { c.innerHTML = '<div class="empty-state">No panels added yet. Click "Add Panel" to connect your 3X-UI instance.</div>'; return; }
  c.innerHTML = panels.map(p => `
    <div class="panel-card">
      <div class="card-head">
        <div><div class="card-name">${esc(p.name)}</div><div class="card-url">${esc(p.url)}</div></div>
        <span class="card-badge badge-ok">Connected</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 Test</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 Delete</button>
      </div>
    </div>`).join('');
}

function showAddPanel() {
  openModal('Add Panel', `
    <div class="form-group"><label>Panel Name</label><input class="form-input" id="pName" placeholder="My Server"/></div>
    <div class="form-group"><label>Panel URL</label><input class="form-input" id="pUrl" placeholder="https://domain.com:2053/subpath"/></div>
    <div class="form-group"><label>API Token (Bearer)</label><input class="form-input" id="pToken" placeholder="Token from Panel Settings > Security"/></div>
    <div class="form-group"><label>Path Prefix</label><input class="form-input" id="pPrefix" value="/panel"/><small style="color:var(--muted);margin-top:4px;display:block">Usually /panel</small></div>
    <button class="btn btn-primary" id="btnAddPanel" style="width:100%;margin-top:8px" onclick="addPanel()">Save Panel</button>
  `);
}

async function addPanel() {
  const btn = document.getElementById('btnAddPanel');
  const data = {
    name: document.getElementById('pName').value.trim(),
    url: document.getElementById('pUrl').value.trim().replace(/\/+$/, ''),
    token: document.getElementById('pToken').value.trim(),
    path_prefix: document.getElementById('pPrefix').value.trim() || '/panel',
  };
  if (!data.name || !data.url || !data.token) { toast('Please fill all fields', false); return; }
  setBtnLoading(btn, true, 'Saving...');
  try {
    await api('POST', '/api/panels', data);
    closeModal();
    toast('Panel saved! Click "Test" to check connectivity.');
    addLog('Panel "' + data.name + '" saved successfully', 'success');
    loadPanels();
  } catch (e) {
    toast('Error: ' + e.message, false);
    addLog('Panel add failed: ' + e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deletePanel(id) {
  if (!confirm('Delete this panel and all its schedules?')) return;
  try { await api('DELETE','/api/panels/'+id); toast('Panel deleted'); loadPanels(); loadSchedules(); }
  catch (e) { toast(e.message, false); }
}

async function testPanel(id) {
  const p = panels.find(x => x.id === id);
  try {
    const inbounds = await api('GET','/api/panels/'+id+'/inbounds');
    toast('Connected! Found ' + inbounds.length + ' inbound(s)');
    addLog('Test OK: ' + p.name + ' — ' + inbounds.length + ' inbound(s)', 'success');
  } catch (e) {
    toast('Test failed: ' + e.message, false);
    addLog('Test FAIL: ' + p.name + ' — ' + e.message, 'error');
  }
}

// ─── Schedules ────────────────────────────────────────────
async function loadSchedules() {
  try { schedules = await api('GET','/api/schedules'); renderSchedules(); }
  catch (e) { toast(e.message, false); }
}

function renderSchedules() {
  const body = document.getElementById('schedulesBody');
  const empty = document.getElementById('schedulesEmpty');
  if (!schedules.length) { body.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  body.innerHTML = schedules.map(s => {
    const pname = panels.find(p => p.id === s.panel_id)?.name || 'Unknown';
    return `<tr>
      <td><strong>${esc(s.inbound_remark)}</strong> <span style="color:var(--muted);font-size:11px">#${s.inbound_id}</span></td>
      <td>${esc(pname)}</td><td><code>${s.enable_time}</code></td><td><code>${s.disable_time}</code></td><td>${esc(s.timezone)}</td>
      <td><span class="toggle ${s.enabled?'on':''}" onclick="toggleSchedule('${s.id}')"></span></td>
      <td>
        <button class="btn btn-success btn-sm" onclick="runNow('${s.id}','enable')">▶ ON</button>
        <button class="btn btn-danger btn-sm" onclick="runNow('${s.id}','disable')">⏸ OFF</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')">🗑</button>
      </td></tr>`;
  }).join('');
}

async function showAddSchedule() {
  if (!panels.length) { toast('Add a panel first', false); return; }
  openModal('Add Schedule', `
    <div class="form-group"><label>Panel</label><select class="form-input" id="sPanel" onchange="loadInboundSelect()">${panels.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="form-group"><label>Inbound</label><select class="form-input" id="sInbound"><option>Loading...</option></select></div>
    <div class="form-row">
      <div class="form-group"><label>Enable Time</label><input type="time" class="form-input" id="sEnable" value="02:00"/></div>
      <div class="form-group"><label>Disable Time</label><input type="time" class="form-input" id="sDisable" value="07:00"/></div>
    </div>
    <div class="form-group"><label>Timezone</label><select class="form-input" id="sTz">
      <option value="Asia/Tehran" selected>Asia/Tehran</option><option value="UTC">UTC</option>
      <option value="Asia/Dubai">Asia/Dubai</option><option value="Europe/Istanbul">Europe/Istanbul</option>
    </select></div>
    <button class="btn btn-primary" id="btnAddSched" style="width:100%;margin-top:8px" onclick="addSchedule()">Create Schedule</button>
  `);
  loadInboundSelect();
}

async function loadInboundSelect() {
  const sel = document.getElementById('sInbound');
  sel.innerHTML = '<option>Loading...</option>';
  try {
    const inbounds = await api('GET','/api/panels/'+document.getElementById('sPanel').value+'/inbounds');
    sel.innerHTML = inbounds.map(i => `<option value="${i.id}" data-remark="${esc(i.remark)}">${esc(i.remark)} (#${i.id}) Port ${i.port} ${i.enable?'🟢':'🔴'}</option>`).join('');
  } catch (e) { sel.innerHTML = '<option>Error loading inbounds</option>'; toast(e.message, false); }
}

async function addSchedule() {
  const sel = document.getElementById('sInbound');
  const opt = sel.options[sel.selectedIndex];
  const data = { panel_id:document.getElementById('sPanel').value, inbound_id:parseInt(sel.value), inbound_remark:opt.dataset.remark||opt.textContent, enable_time:document.getElementById('sEnable').value, disable_time:document.getElementById('sDisable').value, timezone:document.getElementById('sTz').value };
  if (!data.inbound_id) { toast('Select an inbound', false); return; }
  try { await api('POST','/api/schedules',data); closeModal(); toast('Schedule created!'); addLog('Schedule: '+data.inbound_remark+' ON@'+data.enable_time+' OFF@'+data.disable_time,'success'); loadSchedules(); }
  catch (e) { toast(e.message, false); }
}

async function toggleSchedule(id) {
  try { await api('PATCH','/api/schedules/'+id+'/toggle'); toast('Schedule toggled'); loadSchedules(); }
  catch (e) { toast(e.message, false); }
}
async function deleteSchedule(id) {
  if (!confirm('Delete this schedule?')) return;
  try { await api('DELETE','/api/schedules/'+id); toast('Schedule deleted'); loadSchedules(); }
  catch (e) { toast(e.message, false); }
}
async function runNow(id, action) {
  try { await api('POST','/api/schedules/'+id+'/run/'+action); toast('Inbound '+action+'d manually!'); addLog('Manual '+action+' executed','success'); }
  catch (e) { toast(e.message, false); }
}

// ─── Settings ─────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await api('GET','/api/settings');
    if (s) { document.getElementById('setAdminUser').value = s.username||'admin'; document.getElementById('setPort').value = s.port||8181; }
  } catch(e) {}
}

async function saveSettingsForm() {
  const user = document.getElementById('setAdminUser').value.trim();
  const pass = document.getElementById('setAdminPass').value;
  const port = parseInt(document.getElementById('setPort').value);
  if (!user) { toast('Username cannot be empty', false); return; }
  if (!port || port < 1 || port > 65535) { toast('Invalid port number', false); return; }
  try {
    const res = await api('POST','/api/settings',{username:user, password:pass||null, port:port});
    toast(res.message);
    addLog('Settings saved','success');
  } catch (e) { toast(e.message, false); }
}

function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

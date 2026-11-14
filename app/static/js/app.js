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
  loadSettings();
});

function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(e => e.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const titles = {
    panels: 'مدیریت پنل‌ها',
    schedules: 'زمان‌بندی اینباندها',
    settings: 'تنظیمات سیستم',
    logs: 'گزارشات و لاگ‌ها'
  };
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
    throw new Error(e.detail || 'درخواست با خطا مواجه شد');
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
  setTimeout(() => d.remove(), 4000);
}

// ─── Log ──────────────────────────────────────────────────
function addLog(msg, type = '') {
  const t = new Date().toLocaleTimeString('fa-IR');
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
    c.innerHTML = '<div class="empty-state">هنوز پنلی اضافه نشده است. روی «افزودن پنل جدید» کلیک کنید.</div>';
    return;
  }
  c.innerHTML = panels.map(p => `
    <div class="panel-card">
      <div class="card-head">
        <div>
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-url">${esc(p.url)}</div>
        </div>
        <span class="card-badge badge-ok">متصل</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="testPanel('${p.id}')">🔌 تست اتصال</button>
        <button class="btn btn-danger btn-sm" onclick="deletePanel('${p.id}')">🗑 حذف</button>
      </div>
    </div>
  `).join('');
}

function showAddPanel() {
  openModal('افزودن پنل جدید', `
    <div class="form-group">
      <label>نام نمایشی پنل</label>
      <input class="form-input" id="pName" placeholder="مثلاً: سرور آلمان"/>
    </div>
    <div class="form-group">
      <label>آدرس پنل (URL)</label>
      <input class="form-input" id="pUrl" placeholder="http://1.2.3.4:2053"/>
    </div>
    <div class="form-group">
      <label>توکن اتصال (Bearer API Token)</label>
      <input class="form-input" id="pToken" placeholder="توکن دریافتی از بخش Security پنل"/>
    </div>
    <div class="form-group">
      <label>پیشوند مسیر (Path Prefix)</label>
      <input class="form-input" id="pPrefix" value="/panel"/>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="addPanel()">ذخیره و تست اتصال</button>
  `);
}

async function addPanel() {
  const data = {
    name: document.getElementById('pName').value.trim(),
    url: document.getElementById('pUrl').value.trim().replace(/\/+$/, ''),
    token: document.getElementById('pToken').value.trim(),
    path_prefix: document.getElementById('pPrefix').value.trim() || '/panel',
  };
  if (!data.name || !data.url || !data.token) { toast('لطفاً همه فیلدها را پر کنید', false); return; }
  try {
    await api('POST', '/api/panels', data);
    closeModal();
    toast('پنل با موفقیت اضافه و متصل شد!');
    addLog(`پنل «${data.name}» با موفقیت متصل گردید`, 'success');
    loadPanels();
  } catch (e) { toast(e.message, false); }
}

async function deletePanel(id) {
  if (!confirm('آیا از حذف این پنل و زمان‌بندی‌های متصل به آن اطمینان دارید؟')) return;
  try {
    await api('DELETE', '/api/panels/' + id);
    toast('پنل حذف شد');
    addLog('پنل حذف شد', '');
    loadPanels();
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function testPanel(id) {
  const p = panels.find(x => x.id === id);
  try {
    const inbounds = await api('GET', '/api/panels/' + id + '/inbounds');
    toast(`اتصال برقرار است! تعداد ${inbounds.length} اینباند یافت شد.`);
    addLog(`تست اتصال موفق: پنل «${p.name}» — تعداد ${inbounds.length} اینباند`, 'success');
  } catch (e) {
    toast('خطا در برقراری ارتباط: ' + e.message, false);
    addLog(`تست ناموفق: ${p.name} — ${e.message}`, 'error');
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
    const pname = panels.find(p => p.id === s.panel_id)?.name || 'نامشخص';
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
        <button class="btn btn-success btn-sm" onclick="runNow('${s.id}','enable')" title="روشن کردن دستی">▶ روشن</button>
        <button class="btn btn-danger btn-sm" onclick="runNow('${s.id}','disable')" title="خاموش کردن دستی">⏸ خاموش</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${s.id}')" title="حذف">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

async function showAddSchedule() {
  if (!panels.length) { toast('ابتدا باید حداقل یک پنل اضافه کنید', false); return; }
  const panelOpts = panels.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  openModal('ساخت زمان‌بندی جدید', `
    <div class="form-group">
      <label>انتخاب پنل</label>
      <select class="form-input" id="sPanel" onchange="loadInboundSelect()">${panelOpts}</select>
    </div>
    <div class="form-group">
      <label>انتخاب اینباند</label>
      <select class="form-input" id="sInbound"><option>در حال بارگذاری...</option></select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>ساعت روشن شدن</label>
        <input type="time" class="form-input" id="sEnable" value="02:00"/>
      </div>
      <div class="form-group">
        <label>ساعت خاموش شدن</label>
        <input type="time" class="form-input" id="sDisable" value="07:00"/>
      </div>
    </div>
    <div class="form-group">
      <label>منطقه زمانی (Timezone)</label>
      <select class="form-input" id="sTz">
        <option value="Asia/Tehran" selected>Asia/Tehran (ایران - پیش‌فرض)</option>
        <option value="UTC">UTC</option>
        <option value="Asia/Dubai">Asia/Dubai</option>
        <option value="Europe/Istanbul">Europe/Istanbul</option>
      </select>
    </div>
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="addSchedule()">ثبت زمان‌بندی</button>
  `);
  loadInboundSelect();
}

async function loadInboundSelect() {
  const pid = document.getElementById('sPanel').value;
  const sel = document.getElementById('sInbound');
  sel.innerHTML = '<option>در حال دریافت اینباندها...</option>';
  try {
    const inbounds = await api('GET', '/api/panels/' + pid + '/inbounds');
    sel.innerHTML = inbounds.map(i =>
      `<option value="${i.id}" data-remark="${esc(i.remark)}">${esc(i.remark)} (پورت ${i.port}) ${i.enable ? '🟢 فعال' : '🔴 غیرفعال'}</option>`
    ).join('');
  } catch (e) {
    sel.innerHTML = '<option>خطا در دریافت لیست اینباندها</option>';
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
  if (!data.inbound_id) { toast('اینباند را انتخاب کنید', false); return; }
  try {
    await api('POST', '/api/schedules', data);
    closeModal();
    toast('زمان‌بندی با موفقیت ساخته شد!');
    addLog(`زمان‌بندی: «${data.inbound_remark}» — روشن در ${data.enable_time} و خاموش در ${data.disable_time}`, 'success');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function toggleSchedule(id) {
  try {
    await api('PATCH', '/api/schedules/' + id + '/toggle');
    toast('وضعیت زمان‌بندی تغییر کرد');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function deleteSchedule(id) {
  if (!confirm('آیا از حذف این زمان‌بندی اطمینان دارید؟')) return;
  try {
    await api('DELETE', '/api/schedules/' + id);
    toast('زمان‌بندی حذف شد');
    addLog('زمان‌بندی حذف شد', '');
    loadSchedules();
  } catch (e) { toast(e.message, false); }
}

async function runNow(id, action) {
  try {
    await api('POST', `/api/schedules/${id}/run/${action}`);
    toast(`عملیات دستی با موفقیت انجام شد (${action === 'enable' ? 'روشن شد' : 'خاموش شد'})!`);
    addLog(`اجرای دستی ${action} انجام شد`, 'success');
  } catch (e) { toast(e.message, false); }
}

// ─── Settings ─────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    if (s) {
      document.getElementById('setAdminUser').value = s.username || 'admin';
      document.getElementById('setPort').value = s.port || 8181;
    }
  } catch (e) { console.error(e); }
}

async function saveSettingsForm() {
  const user = document.getElementById('setAdminUser').value.trim();
  const pass = document.getElementById('setAdminPass').value;
  const port = parseInt(document.getElementById('setPort').value);

  if (!user) { toast('نام کاربری نمی‌تواند خالی باشد', false); return; }
  if (!port || port < 1 || port > 65535) { toast('پورت نامعتبر است', false); return; }

  try {
    const res = await api('POST', '/api/settings', {
      username: user,
      password: pass || null,
      port: port
    });
    toast(res.message);
    addLog('تنظیمات امنیتی و پورت ذخیره شد', 'success');
  } catch (e) { toast(e.message, false); }
}

// ─── Util ─────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

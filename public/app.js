/* 餐會報到系統前端 (原生 JS SPA) */
const S = { token: null, role: null, lang: 'zh' };
try {
  S.token = localStorage.getItem('token'); S.role = localStorage.getItem('role');
  S.lang = localStorage.getItem('lang') || 'zh';
} catch (e) { /* 忽略 */ }

const $app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (k) => (I18N[S.lang] && I18N[S.lang][k]) || I18N.zh[k] || k;
const terr = (code) => t('err.' + code);

let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
function leave() { cleanups.forEach((f) => { try { f(); } catch (e) { /* 忽略 */ } }); cleanups = []; }

function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 3500);
}

class ApiError extends Error { constructor(code, data) { super(code); this.code = code; this.data = data || {}; } }
async function api(path, method, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new ApiError('NETWORK'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'UNAUTHORIZED' && S.token) { logout(); }
    throw new ApiError(data.error || 'SERVER_ERROR', data);
  }
  return data;
}
const dateMismatch = (vdate) => t('err.DATE_MISMATCH_A') + vdate + t('err.DATE_MISMATCH_B');
const errText = (e) => {
  if (e.code === 'OUT_OF_RANGE' && e.data.distance != null) return `${terr(e.code)} ${e.data.distance} ${t('meter')}`;
  if (e.code === 'VERIFY_FAILED') return `${terr(e.code)} ${e.data.vdate}`;
  if (e.code === 'DATE_MISMATCH') return dateMismatch(e.data.vdate);
  return terr(e.code || 'SERVER_ERROR');
};

function logout() {
  S.token = null; S.role = null;
  try { localStorage.removeItem('token'); localStorage.removeItem('role'); } catch (e) { /* 忽略 */ }
  render();
}

/* ---------- 共用 ---------- */
function applyLang() {
  document.title = t('title');
  document.documentElement.lang = { zh: 'zh-Hant', vi: 'vi', id: 'id' }[S.lang];
  const lo = document.getElementById('logout');
  lo.textContent = t('logout'); lo.classList.toggle('hidden', !S.token);
  document.getElementById('lang').value = S.lang;
}
document.getElementById('lang').onchange = (e) => {
  S.lang = e.target.value;
  try { localStorage.setItem('lang', S.lang); } catch (x) { /* 忽略 */ }
  render();
};
document.getElementById('logout').onclick = logout;

function tabs(container, items, initial) {
  const bar = document.createElement('div'); bar.className = 'tabs';
  const body = document.createElement('div');
  container.append(bar, body);
  const show = (key) => {
    leave();
    [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    body.innerHTML = '';
    items.find((i) => i.key === key).render(body);
  };
  items.forEach((i) => {
    const b = document.createElement('button');
    b.textContent = i.label; b.dataset.k = i.key; b.onclick = () => show(i.key);
    bar.appendChild(b);
  });
  show(initial || items[0].key);
}

/* ---------- 登入 ---------- */
function loginView() {
  $app.className = '';
  $app.innerHTML = `
    <div class="card">
      <h1>${esc(t('title'))}</h1><hr class="gold-line">
      <form id="f" autocomplete="on">
        <label>${esc(t('empNo'))}</label><input id="empNo" autocomplete="username" required>
        <label>${esc(t('password'))}</label><input id="pw" type="password" autocomplete="current-password" placeholder="${esc(t('pw_hint'))}" required>
        <div id="dateBox" class="hidden form-select"><label>${esc(t('choose_date'))}</label><select id="date"></select></div>
        <button class="block" type="submit">${esc(t('login'))}</button>
        <div id="err" class="msg-err"></div>
      </form>
    </div>`;
  const f = document.getElementById('f'), err = document.getElementById('err');
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api('/login', 'POST', {
        empNo: f.empNo.value, password: f.pw.value,
        date: document.getElementById('dateBox').classList.contains('hidden') ? '' : f.date.value,
      });
      if (r.needDate) {
        f.date.innerHTML = r.dates.map((d) => `<option>${esc(d)}</option>`).join('');
        document.getElementById('dateBox').classList.remove('hidden');
        return;
      }
      S.token = r.token; S.role = r.role;
      try { localStorage.setItem('token', r.token); localStorage.setItem('role', r.role); } catch (x) { /* 忽略 */ }
      render();
    } catch (x) { err.textContent = errText(x); }
  };
}

/* ---------- 員工前台 ---------- */
function meView(box) {
  box.classList.add('lg');
  box.innerHTML = `<div class="mute">${esc(t('loading'))}</div>`;
  api('/me').then((d) => {
    if (d.me.checked === 'Y') infoView(box, d); else checkinView(box, d);
  }).catch((e) => { box.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; });
}

function infoView(box, d) {
  const m = d.me;
  box.innerHTML = `
    <div class="card">
      <span class="badge ok">${esc(t('checked_done'))}</span>
      <div class="big" style="margin:12px 0">${esc(m.name)}</div>
      <dl class="kv">
        <dt>${esc(t('empNo'))}</dt><dd>${esc(m.empNo)}</dd>
        <dt>${esc(t('name'))}</dt><dd>${esc(m.name)}</dd>
        <dt>${esc(t('dept'))}</dt><dd>${esc(m.dept)}</dd>
        <dt>${esc(t('date'))}</dt><dd>${esc(m.date)}</dd>
        <dt>${esc(t('checkin_time'))}</dt><dd>${esc(m.checkedAt)}</dd>
      </dl>
    </div>
    <div class="card">
      <h2>${esc(t('table'))}:<span style="color:var(--gold)">${esc(m.table || '-')}</span></h2>
      <hr class="gold-line">
      <div class="mute" style="margin-bottom:6px">${esc(t('tablemates'))}</div>
      ${d.mates.map((x) => `
        <div class="mate ${x.self ? 'self' : ''}">
          <span class="no">${esc(x.empNo)}</span><span>${esc(x.name)}${x.self ? ' ' + esc(t('me')) : ''}</span>
          <span class="mute">${esc(x.dept)}</span>
        </div>`).join('')}
    </div>`;
}

function checkinView(box, d) {
  box.innerHTML = `
    <div class="card">
      <div class="big">${esc(t('need_checkin'))}</div>
      <div class="big" style="margin:12px 0">${esc(d.me.name)}</div>
      <div class="mute">${esc(d.me.empNo)} · ${esc(d.me.dept)} · ${esc(d.me.date)} · ${esc(t('table'))} ${esc(d.me.table || '-')}</div>
    </div>
    <div class="card">
      <h2>${esc(t('gps'))}</h2>
      <div id="gps" class="mute">${esc(t('gps_wait'))}</div>
      <div class="mute" style="margin-top:6px">${esc(t('gps_every'))}</div>
    </div>
    <div class="card">
      ${d.blocked ? `<div class="msg-err big-msg">${esc(dateMismatch(d.me.date))}</div>` : ''}
      <p class="mute" style="margin-top:0">${esc(t('checkin_hint'))}</p>
      <button id="scanBtn" class="block" style="margin-top:0" ${d.blocked ? 'disabled' : ''}>${esc(t('scan'))}</button>
      <div id="reader"></div>
      <div id="res"></div>
    </div>`;
  const gps = box.querySelector('#gps'), res = box.querySelector('#res'), btn = box.querySelector('#scanBtn');
  let pos = null, scanner = null, busy = false;

  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('nogeo'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  const tick = async () => {
    try {
      const p = await locate();
      pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      const dist = haversine(pos.lat, pos.lng, d.params.lat, d.params.lng);
      gps.className = '';
      gps.innerHTML = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}<br>
        <span class="mute">${esc(t('gps_dist'))} ${Math.round(dist)} ${esc(t('meter'))} · ${esc(t('gps_updated'))} ${new Date().toLocaleTimeString()}</span>`;
    } catch (e) { pos = null; gps.className = 'msg-err'; gps.textContent = t('gps_denied'); }
  };
  tick();
  const iv = setInterval(tick, 15000);
  const stop = async () => {
    if (scanner) { const s = scanner; scanner = null; try { await s.stop(); s.clear(); } catch (e) { /* 忽略 */ } }
    btn.textContent = t('scan');
  };
  onLeave(() => { clearInterval(iv); stop(); });

  btn.onclick = async () => {
    if (scanner) return stop();
    res.innerHTML = '';
    scanner = new Html5Qrcode('reader');
    btn.textContent = t('stop_scan');
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (text) => {
        if (busy) return; busy = true;
        try {
          await tick(); // 報到當下再取一次最新座標
          if (!pos) throw new ApiError('GPS_REQUIRED');
          await api('/checkin', 'POST', { qr: text, lat: pos.lat, lng: pos.lng });
          await stop();
          toast(t('checkin_ok'));
          meView(box);
        } catch (e) {
          res.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`;
          if (e.code === 'ALREADY_CHECKED') { await stop(); meView(box); }
        } finally { setTimeout(() => { busy = false; }, 1500); }
      });
    } catch (e) { await stop(); res.innerHTML = `<div class="msg-err">${esc(t('camera_err'))}</div>`; }
  };
}

function haversine(a, b, c, d) {
  const R = 6371000, r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function employeeView() {
  $app.className = '';
  $app.innerHTML = '<div id="box"></div>';
  meView(document.getElementById('box'));
}

/* ---------- 福委後台 ---------- */
function welfareView() {
  $app.className = 'wide';
  $app.innerHTML = '';
  tabs($app, [
    { key: 'qr', label: t('tab_qr'), render: wQr },
    { key: 'manual', label: t('tab_manual'), render: wManual },
    { key: 'list', label: t('tab_list'), render: wList },
    { key: 'tables', label: t('tab_tables'), render: (b) => wTables(b) },
    { key: 'me', label: t('tab_me'), render: meView },
  ]);
}

function wQr(box) {
  box.innerHTML = `
    <div class="card center">
      <h2>${esc(t('qr_hint'))}</h2>
      <div class="qrbox" id="qr"></div>
      <div class="bar"><i id="bar" style="width:100%"></i></div>
      <div class="mute" id="cd"></div>
      <div class="msg-err" id="qerr"></div>
    </div>`;
  const holder = box.querySelector('#qr'), bar = box.querySelector('#bar'), cd = box.querySelector('#cd'), qerr = box.querySelector('#qerr');
  let qrObj = null, seconds = 30, left = 0, loading = false;
  const size = Math.min(300, window.innerWidth - 100);
  async function refresh() {
    if (loading) return; loading = true;
    try {
      const r = await api('/qr');
      seconds = r.seconds; left = seconds; qerr.textContent = '';
      if (!qrObj) qrObj = new QRCode(holder, { text: r.qr, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
      else { qrObj.clear(); qrObj.makeCode(r.qr); }
    } catch (e) { qerr.textContent = errText(e); left = 3; } finally { loading = false; }
  }
  refresh();
  const iv = setInterval(() => {
    left -= 1;
    if (left <= 0) refresh();
    bar.style.width = Math.max(0, (left / seconds) * 100) + '%';
    cd.textContent = `${Math.max(0, left)} ${t('qr_refresh')}`;
  }, 1000);
  onLeave(() => clearInterval(iv));
}

function wManual(box) {
  box.classList.add('lg');
  box.innerHTML = `
    <div class="card">
      <p class="mute" style="margin-top:0">${esc(t('manual_hint'))}</p>
      <div class="row"><input id="no" placeholder="${esc(t('empNo'))}" autocomplete="off"><button id="find">${esc(t('lookup'))}</button></div>
      <div id="out"></div>
    </div>`;
  const out = box.querySelector('#out'), inp = box.querySelector('#no');
  const find = async () => {
    out.innerHTML = '';
    if (!inp.value.trim()) return;
    try {
      const m = await api('/lookup/' + encodeURIComponent(inp.value.trim()));
      out.innerHTML = `
        <dl class="kv" style="margin-top:16px">
          <dt>${esc(t('empNo'))}</dt><dd>${esc(m.empNo)}</dd>
          <dt>${esc(t('name'))}</dt><dd>${esc(m.name)}</dd>
          <dt>${esc(t('dept'))}</dt><dd>${esc(m.dept)}</dd>
          <dt>${esc(t('table'))}</dt><dd>${esc(m.table || '-')}</dd>
        </dl>
        ${m.checked === 'Y' ? `<div class="msg-ok">${esc(t('checked_done'))} ${esc(m.checkedAt)}</div>`
          : `<button id="ok" class="block">${esc(t('manual_ok'))}</button>`}`;
      const ok = out.querySelector('#ok');
      if (ok) ok.onclick = async () => {
        ok.disabled = true;
        try {
          await api('/manual-checkin', 'POST', { empNo: m.empNo });
          toast(t('checkin_ok')); inp.value = ''; out.innerHTML = `<div class="msg-ok">${esc(m.name)} ${esc(t('checkin_ok'))}</div>`;
        } catch (e) { ok.disabled = false; toast(errText(e), true); }
      };
    } catch (e) { out.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; }
  };
  box.querySelector('#find').onclick = find;
  inp.onkeydown = (e) => { if (e.key === 'Enter') find(); };
}

const HOLD_MS = 2000; // 長按多久觸發名單篩選

function wList(box, date, filter = 'all') {
  box.innerHTML = `<div class="mute">${esc(t('loading'))}</div>`;
  api('/stats' + (date ? '?date=' + encodeURIComponent(date) : '')).then((s) => {
    const rate = s.total ? Math.round((s.checked / s.total) * 100) : 0;
    const rows = s.list.filter((m) => filter === 'all' || (filter === 'checked') === (m.checked === 'Y'));
    // key 有值者可長按篩選(all / checked / unchecked)
    const stat = (label, v, key) => `<div class="stat${key ? ' pressable' : ''}${key && key === filter ? ' active' : ''}"${key ? ` data-f="${key}"` : ''}>
      <div class="mute">${esc(label)}</div><div class="big" style="font-size:26px">${v}</div></div>`;
    box.innerHTML = `
      <div class="card form-select">
        <label style="margin-top:0">${esc(t('date'))}</label>
        <select id="ld">${s.dates.map((x) => `<option ${x === s.date ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      </div>
      <div class="card">
        <h2 style="margin-bottom:6px">${esc(t('progress'))} · ${esc(s.date)}</h2>
        <div class="mute" style="font-size:13px;margin-bottom:12px">${esc(t('hold_filter_hint'))}</div>
        <div class="grid2" style="gap:14px 12px">
          ${stat(t('total'), s.total, 'all')}${stat(t('checked'), s.checked, 'checked')}
          ${stat(t('unchecked'), s.unchecked, 'unchecked')}${stat(t('rate'), rate + '%')}
          ${stat(t('by_qr'), s.byQr)}${stat(t('by_manual'), s.byManual)}
        </div>
      </div>
      <div class="mute" style="margin:0 4px 8px">${esc(t('showing'))} ${rows.length} / ${s.list.length}</div>
      <div class="card scroll"><table>
        <tr><th>${esc(t('empNo'))}</th><th>${esc(t('name'))}</th><th>${esc(t('dept'))}</th><th>${esc(t('table'))}</th><th></th></tr>
        ${rows.length ? '' : `<tr><td colspan="5" class="mute">${esc(t('no_data'))}</td></tr>`}
        ${rows.map((m) => `<tr><td>${esc(m.empNo)}</td><td>${esc(m.name)}</td><td>${esc(m.dept)}</td><td>${esc(m.table)}</td>
          <td>${m.checked === 'Y' ? `<span class="badge ok">${esc(t('checked'))}${m.verified === 'Y' ? ' ✓' : ''}</span>` : `<span class="mute">${esc(t('unchecked'))}</span>`}</td></tr>`).join('')}
      </table></div>`;
    box.querySelector('#ld').onchange = (e) => wList(box, e.target.value, filter);
    box.querySelectorAll('.pressable').forEach((el) => {
      let timer = null, x0 = 0, y0 = 0;
      const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('holding'); };
      el.addEventListener('pointerdown', (e) => {
        x0 = e.clientX; y0 = e.clientY;
        el.classList.add('holding');
        timer = setTimeout(() => wList(box, s.date, el.dataset.f), HOLD_MS);
      });
      el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, cancel));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }).catch((e) => { box.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; });
}

// 桌號統計:依桌號彙總已報到人數,供與餐廳人員對點;open 為展開名單的桌號
function wTables(box, date, open = new Set()) {
  box.innerHTML = `<div class="mute">${esc(t('loading'))}</div>`;
  api('/stats' + (date ? '?date=' + encodeURIComponent(date) : '')).then((s) => {
    const at = new Date().toLocaleTimeString();
    const groups = new Map();
    s.list.forEach((m) => { const k = m.table || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); });
    const rows = [...groups.entries()]
      .sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b, 'en', { numeric: true })) // 未分桌排最後
      .map(([table, ms]) => ({ table, ms, done: ms.filter((m) => m.checked === 'Y').length }));
    const seated = rows.filter((r) => r.done).length;

    const draw = () => {
      box.innerHTML = `
        <div class="card form-select">
          <label style="margin-top:0">${esc(t('date'))}</label>
          <select id="td">${s.dates.map((x) => `<option ${x === s.date ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>
        <div class="card">
          <h2 style="margin-bottom:12px">${esc(t('tab_tables'))} · ${esc(s.date)}</h2>
          <div class="grid2" style="gap:14px 12px">
            <div class="stat"><div class="mute">${esc(t('checked'))}</div><div class="big" style="font-size:26px">${s.checked}</div></div>
            <div class="stat"><div class="mute">${esc(t('tables_seated'))}</div><div class="big" style="font-size:26px">${seated} / ${rows.length}</div></div>
          </div>
          <div class="row" style="margin-top:12px">
            <span class="mute">${esc(t('gps_updated'))} ${esc(at)}</span>
            <button class="ghost" id="tr">${esc(t('refresh'))}</button>
          </div>
        </div>
        <div class="mute" style="margin:0 4px 8px">${esc(t('table_tap_hint'))}</div>
        <div class="card scroll"><table class="tcount">
          <tr><th>${esc(t('table'))}</th><th class="num">${esc(t('checked'))}</th><th class="num">${esc(t('expected'))}</th><th class="num">${esc(t('unchecked'))}</th></tr>
          ${rows.length ? '' : `<tr><td colspan="4" class="mute">${esc(t('no_data'))}</td></tr>`}
          ${rows.map((r) => `
            <tr class="trow${r.done === r.ms.length ? ' full' : ''}" data-t="${esc(r.table)}">
              <td>${r.table ? esc(r.table) : esc(t('no_table'))}</td><td class="num n">${r.done}</td>
              <td class="num">${r.ms.length}</td><td class="num">${r.ms.length - r.done || '-'}</td></tr>
            ${open.has(r.table) ? `<tr class="tdetail"><td colspan="4">${r.ms.map((m) =>
              `<span class="tn${m.checked === 'Y' ? '' : ' miss'}">${esc(m.empNo)} ${esc(m.name)}${m.checked === 'Y' ? '' : ' · ' + esc(t('unchecked'))}</span>`).join('')}</td></tr>` : ''}`).join('')}
          <tr class="sum"><td>${esc(t('sum'))}</td><td class="num">${s.checked}</td><td class="num">${s.total}</td><td class="num">${s.unchecked}</td></tr>
        </table></div>`;
      box.querySelector('#td').onchange = (e) => wTables(box, e.target.value);
      box.querySelector('#tr').onclick = () => wTables(box, s.date, open);
      box.querySelectorAll('.trow').forEach((tr) => {
        tr.onclick = () => { const k = tr.dataset.t; if (open.has(k)) open.delete(k); else open.add(k); draw(); };
      });
    };
    draw();
  }).catch((e) => { box.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; });
}

/* ---------- 管理者後台 ---------- */
function adminView() {
  $app.className = 'wide';
  $app.innerHTML = '';
  tabs($app, [
    { key: 'params', label: t('tab_params'), render: aParams },
    { key: 'emp', label: t('tab_emp'), render: aEmp },
    { key: 'import', label: t('tab_import'), render: aImport },
  ]);
}

function aParams(box) {
  api('/params').then((p) => {
    box.innerHTML = `
      <div class="card" style="max-width:480px">
        <label>${esc(t('p_lat'))}</label><input id="lat" type="number" step="any" value="${esc(p.lat)}">
        <label>${esc(t('p_lng'))}</label><input id="lng" type="number" step="any" value="${esc(p.lng)}">
        <button id="here" class="sub block" style="margin-top:10px">${esc(t('use_here'))}</button>
        <label>${esc(t('p_tol'))}</label><input id="tol" type="number" min="1" value="${esc(p.toleranceMeters)}">
        <label>${esc(t('p_qr'))}</label><input id="sec" type="number" min="5" value="${esc(p.qrResetSeconds)}">
        <label>${esc(t('p_vdate'))}</label>
        <select id="vdate" class="breathe">${p.dates.map((x) => `<option ${x === p.verifyDate ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button id="save" class="block">${esc(t('save'))}</button>
        <div class="mute" style="margin-top:14px">DB: ${esc(p.backend)}</div>
      </div>`;
    box.querySelector('#here').onclick = () => navigator.geolocation && navigator.geolocation.getCurrentPosition((g) => {
      box.querySelector('#lat').value = g.coords.latitude.toFixed(6);
      box.querySelector('#lng').value = g.coords.longitude.toFixed(6);
    }, () => toast(t('gps_denied'), true), { enableHighAccuracy: true });
    box.querySelector('#save').onclick = async () => {
      try {
        await api('/params', 'PUT', {
          lat: box.querySelector('#lat').value, lng: box.querySelector('#lng').value,
          toleranceMeters: box.querySelector('#tol').value, qrResetSeconds: box.querySelector('#sec').value,
          verifyDate: box.querySelector('#vdate').value,
        });
        toast(t('saved'));
      } catch (e) { toast(errText(e), true); }
    };
  }).catch((e) => { box.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; });
}

function aEmp(box) {
  let list = [], date = '', q = '';
  box.innerHTML = `
    <div class="card"><div class="row">
      <select id="d"><option value="">${esc(t('all'))}</option><option>10/03</option><option>10/11</option></select>
      <input id="q" placeholder="${esc(t('search'))}">
      <button id="add">${esc(t('add'))}</button>
    </div></div>
    <div class="card scroll" id="tbl"></div>`;
  const tbl = box.querySelector('#tbl');
  const draw = () => {
    const rows = list.filter((m) => !q || `${m.empNo}${m.name}${m.dept}`.toLowerCase().includes(q));
    tbl.innerHTML = `<table><tr>
      <th>${esc(t('date'))}</th><th>${esc(t('empNo'))}</th><th>${esc(t('name'))}</th><th>${esc(t('dept'))}</th><th>${esc(t('table'))}</th>
      <th>${esc(t('checked_yn'))}</th><th>${esc(t('verified_yn'))}</th><th>${esc(t('welfare_yn'))}</th><th>${esc(t('approver'))}</th>
      <th>${esc(t('location'))}</th><th>${esc(t('checkin_time'))}</th><th></th></tr>
      ${rows.map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.empNo)}</td><td>${esc(m.name)}</td><td>${esc(m.dept)}</td><td>${esc(m.table)}</td>
        <td>${esc(m.checked)}</td><td>${esc(m.verified)}</td><td>${esc(m.welfare)}</td><td>${esc(m.approver)}</td>
        <td>${esc(m.location)}</td><td>${esc(m.checkedAt)}</td>
        <td><button class="ghost" data-e="${esc(m.id)}">${esc(t('edit'))}</button>
            <button class="ghost" data-x="${esc(m.id)}">${esc(t('delete'))}</button></td></tr>`).join('')}</table>`;
    tbl.querySelectorAll('[data-e]').forEach((b) => { b.onclick = () => editor(list.find((m) => m.id === b.dataset.e)); });
    tbl.querySelectorAll('[data-x]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm(t('confirm_delete'))) return;
        try { await api('/emp/' + encodeURIComponent(b.dataset.x), 'DELETE'); load(); } catch (e) { toast(errText(e), true); }
      };
    });
  };
  const load = () => api('/emp' + (date ? '?date=' + encodeURIComponent(date) : '')).then((r) => { list = r; draw(); })
    .catch((e) => toast(errText(e), true));
  box.querySelector('#d').onchange = (e) => { date = e.target.value; load(); };
  box.querySelector('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  box.querySelector('#add').onclick = () => editor(null);
  load();

  function editor(m) {
    const isNew = !m; m = m || { date: '10/03', checked: 'N', verified: 'N', welfare: 'N' };
    const yn = (id, v) => `<select id="${id}"><option value="N" ${v === 'N' ? 'selected' : ''}>N</option><option value="Y" ${v === 'Y' ? 'selected' : ''}>Y</option></select>`;
    const ov = document.createElement('div'); ov.className = 'modal';
    ov.innerHTML = `<div class="card form-select">
      <h2>${esc(t(isNew ? 'add' : 'edit'))}</h2>
      <div class="grid2">
        <div><label>${esc(t('date'))}</label><select id="e_date"><option ${m.date === '10/03' ? 'selected' : ''}>10/03</option><option ${m.date === '10/11' ? 'selected' : ''}>10/11</option></select></div>
        <div><label>${esc(t('empNo'))}</label><input id="e_no" value="${esc(m.empNo)}" ${isNew ? '' : 'disabled'}></div>
        <div><label>${esc(t('name'))}</label><input id="e_name" value="${esc(m.name)}"></div>
        <div><label>${esc(t('dept'))}</label><input id="e_dept" value="${esc(m.dept)}"></div>
        <div><label>${esc(t('password'))} ${isNew ? '' : esc(t('pwd_keep'))}</label><input id="e_pw"></div>
        <div><label>${esc(t('table'))}</label><input id="e_table" value="${esc(m.table)}"></div>
        <div><label>${esc(t('checked_yn'))}</label>${yn('e_checked', m.checked)}</div>
        <div><label>${esc(t('verified_yn'))}</label>${yn('e_verified', m.verified)}</div>
        <div><label>${esc(t('welfare_yn'))}</label>${yn('e_welfare', m.welfare)}</div>
        <div><label>${esc(t('approver'))}</label><input id="e_appr" value="${esc(m.approver)}"></div>
        <div><label>${esc(t('location'))}</label><input id="e_loc" value="${esc(m.location)}"></div>
        <div><label>${esc(t('checkin_time'))}</label><input id="e_at" value="${esc(m.checkedAt)}"></div>
      </div>
      <div class="row" style="margin-top:18px"><button class="sub" id="c">${esc(t('cancel'))}</button><button id="s">${esc(t('save'))}</button></div>
      <div class="msg-err" id="e_err"></div></div>`;
    document.body.appendChild(ov);
    const g = (id) => ov.querySelector('#' + id).value;
    ov.querySelector('#c').onclick = () => ov.remove();
    ov.querySelector('#s').onclick = async () => {
      const body = {
        date: g('e_date'), empNo: g('e_no'), name: g('e_name'), dept: g('e_dept'), password: g('e_pw'), table: g('e_table'),
        checked: g('e_checked'), verified: g('e_verified'), welfare: g('e_welfare'), approver: g('e_appr'), location: g('e_loc'), checkedAt: g('e_at'),
      };
      try {
        if (isNew) await api('/emp', 'POST', body); else await api('/emp/' + encodeURIComponent(m.id), 'PUT', body);
        ov.remove(); load();
      } catch (e) { ov.querySelector('#e_err').textContent = errText(e); }
    };
  }
}

function aImport(box) {
  box.innerHTML = `
    <div class="card" style="max-width:560px">
      <p class="mute" style="margin-top:0">${esc(t('import_hint'))}</p>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="clr" style="width:auto"> ${esc(t('import_clear'))}</label>
      <input type="file" id="file" accept=".xlsx,.xls" class="hidden">
      <button id="pick" class="block">${esc(t('import_btn'))}</button>
      <div id="out"></div>
    </div>`;
  const out = box.querySelector('#out'), file = box.querySelector('#file');
  box.querySelector('#pick').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    out.innerHTML = '';
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '', blankrows: false });
      const cell = (v) => {
        if (v instanceof Date) { // 修正 SheetJS 日期時區位移,取 MM/DD
          const d = new Date(v.getTime() + 12 * 3600e3);
          if (d.getFullYear() < 1910) return '';
          return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
        }
        return v;
      };
      const body = aoa.filter((r, i) => !(i === 0 && String(r[0]).trim() === '日期') && r.some((c) => String(c).trim() !== ''))
        .map((r) => {
          const x = r.map(cell);
          return { date: x[0], empNo: x[1], name: x[2], dept: x[3], password: x[4], table: x[5], checked: x[6], verified: x[7],
            welfare: x[8], approver: x[9], location: x[10], checkedAt: x[11] };
        });
      const hasHeader = aoa.length && String(aoa[0][0]).trim() === '日期';
      const r = await api('/import', 'POST', { rows: body, clear: box.querySelector('#clr').checked });
      if (r.errors.length) {
        out.innerHTML = `<div class="msg-err">${esc(t('import_err'))}<br>${r.errors.slice(0, 30).map((e) =>
          `${esc(t('row'))} ${e.row + (hasHeader ? 0 : -1)}: ${esc(terr(e.error))}`).join('<br>')}</div>`;
      } else out.innerHTML = `<div class="msg-ok">${esc(t('import_ok'))}${r.imported}</div>`;
    } catch (e) { out.innerHTML = `<div class="msg-err">${esc(errText(e))}</div>`; }
    file.value = '';
  };
}

/* ---------- 路由 ---------- */
function render() {
  leave(); applyLang();
  if (!S.token) return loginView();
  if (S.role === 'admin') return adminView();
  if (S.role === 'welfare') return welfareView();
  return employeeView();
}
render();

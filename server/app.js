const express = require('express');
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const db = require('./db');
const { makeQr, verifyQr } = require('./qr');
const U = require('./util');

const app = express();
app.use(express.json({ limit: '4mb' }));

const api = express.Router();
const fail = (res, status, code) => res.status(status).json({ error: code });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  fail(res, 500, 'SERVER_ERROR');
});

// 對外欄位(不含密碼雜湊)
const pub = (d) => ({
  id: d.id, date: d.date, empNo: d.empNo, name: d.name, dept: d.dept, table: d.table || '',
  checked: d.checked || 'N', verified: d.verified || 'N', welfare: d.welfare || 'N',
  approver: d.approver || '', location: d.location || '', checkedAt: d.checkedAt || '',
});

/* ---------- 驗證 ---------- */
const sign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '12h' });

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const p = jwt.verify(h.replace(/^Bearer /, ''), cfg.JWT_SECRET);
    if (p.role === 'admin') { req.user = { role: 'admin' }; return next(); }
    const emp = await db.getEmp(p.id);
    if (!emp) return fail(res, 401, 'UNAUTHORIZED');
    req.emp = emp;
    req.user = { role: emp.welfare === 'Y' ? 'welfare' : 'employee' };
    next();
  } catch (e) {
    fail(res, 401, 'UNAUTHORIZED');
  }
}
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : fail(res, 403, 'FORBIDDEN');

/* ---------- 登入 ---------- */
api.post('/login', wrap(async (req, res) => {
  const empNo = String(req.body.empNo || '').trim();
  const password = String(req.body.password || '');
  const date = U.normDate(req.body.date);
  if (!empNo || !password) return fail(res, 400, 'LOGIN_FAILED');

  if (empNo === cfg.ADMIN_USER) {
    if (!U.safeEqual(password, cfg.ADMIN_PASSWORD)) return fail(res, 401, 'LOGIN_FAILED');
    return res.json({ token: sign({ role: 'admin' }), role: 'admin', name: 'Administrator' });
  }
  const h = U.hashPwd(password);
  let list = (await db.findByEmpNo(empNo)).filter((d) => d.pwd && U.safeEqual(d.pwd, h));
  if (!list.length) return fail(res, 401, 'LOGIN_FAILED');
  if (date) list = list.filter((d) => d.date === date);
  if (list.length > 1) return res.json({ needDate: true, dates: list.map((d) => d.date).sort() });
  if (!list.length) return fail(res, 401, 'LOGIN_FAILED');
  const emp = list[0];
  res.json({ token: sign({ id: emp.id }), role: emp.welfare === 'Y' ? 'welfare' : 'employee', name: emp.name });
}));

/* ---------- 員工前台 ---------- */
api.get('/me', auth, need('employee', 'welfare'), wrap(async (req, res) => {
  const me = pub(req.emp);
  const p = await db.getParamsWithDefaults();
  const out = { me, role: req.user.role, params: { lat: p.lat, lng: p.lng, toleranceMeters: p.toleranceMeters }, mates: [] };
  if (me.checked === 'Y' && me.table) {
    out.mates = (await db.listByTable(me.date, req.emp.table))
      .sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true }))
      .map((d) => ({ empNo: d.empNo, name: d.name, dept: d.dept, self: d.empNo === me.empNo }));
  }
  res.json(out);
}));

api.post('/checkin', auth, need('employee', 'welfare'), wrap(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, 400, 'GPS_REQUIRED');
  if (req.emp.checked === 'Y') return fail(res, 409, 'ALREADY_CHECKED');
  const p = await db.getParamsWithDefaults();
  const qrErr = verifyQr(req.body.qr, Number(p.qrResetSeconds));
  if (qrErr) return fail(res, 400, qrErr);
  const dist = U.distanceMeters(lat, lng, Number(p.lat), Number(p.lng));
  if (dist > Number(p.toleranceMeters)) {
    return res.status(400).json({ error: 'OUT_OF_RANGE', distance: Math.round(dist) });
  }
  const ok = await db.checkinTx(req.emp.id, {
    checked: 'Y', verified: 'N', approver: 'QR',
    location: `${lat.toFixed(6)},${lng.toFixed(6)}`, checkedAt: U.twDisplay(),
  });
  if (ok === false) return fail(res, 409, 'ALREADY_CHECKED');
  res.json({ ok: true });
}));

/* ---------- 福委 ---------- */
api.get('/qr', auth, need('welfare'), wrap(async (req, res) => {
  const p = await db.getParamsWithDefaults();
  res.json({ qr: makeQr(), seconds: Number(p.qrResetSeconds) });
}));

// 104 人員基本資料驗證:福委輸入員工手機上的工號 -> 完成報到
api.get('/lookup/:empNo', auth, need('welfare'), wrap(async (req, res) => {
  const emp = await db.getEmp(U.docId(req.emp.date, String(req.params.empNo).trim()));
  if (!emp) return fail(res, 404, 'EMP_NOT_FOUND');
  res.json(pub(emp));
}));

api.post('/manual-checkin', auth, need('welfare'), wrap(async (req, res) => {
  const empNo = String(req.body.empNo || '').trim();
  const emp = await db.getEmp(U.docId(req.emp.date, empNo));
  if (!emp) return fail(res, 404, 'EMP_NOT_FOUND');
  const ok = await db.checkinTx(emp.id, {
    checked: 'Y', verified: 'Y', approver: `${req.emp.empNo} ${req.emp.name}`.trim(),
    location: 'MANUAL', checkedAt: U.twDisplay(),
  });
  if (ok === false) return fail(res, 409, 'ALREADY_CHECKED');
  res.json({ ok: true });
}));

api.get('/stats', auth, need('welfare'), wrap(async (req, res) => {
  const list = await db.listEmp(req.emp.date);
  res.json({
    date: req.emp.date, total: list.length, checked: list.filter((d) => d.checked === 'Y').length,
    list: list.map(pub).sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true })),
  });
}));

/* ---------- 管理者 ---------- */
api.get('/params', auth, need('admin'), wrap(async (req, res) => {
  res.json({ ...(await db.getParamsWithDefaults()), dates: cfg.DATES, backend: db.name });
}));

api.put('/params', auth, need('admin'), wrap(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const tol = Number(req.body.toleranceMeters), sec = Number(req.body.qrResetSeconds);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || !(tol > 0) || !(sec >= 5)) return fail(res, 400, 'BAD_PARAMS');
  await db.setParams({ lat, lng, toleranceMeters: tol, qrResetSeconds: Math.round(sec) });
  res.json({ ok: true });
}));

api.get('/emp', auth, need('admin'), wrap(async (req, res) => {
  const list = await db.listEmp(U.normDate(req.query.date) || undefined);
  res.json(list.map(pub).sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true })));
}));

// 將輸入整理成 emp_file 文件;pwd 空白且為更新時保留原密碼
function toDoc(r, keepPwd) {
  const date = U.normDate(r.date), empNo = String(r.empNo == null ? '' : r.empNo).trim();
  if (!cfg.DATES.includes(date)) return { err: 'BAD_DATE' };
  if (!empNo) return { err: 'BAD_EMPNO' };
  let pw = String(r.password == null ? '' : r.password).trim();
  if (/^\d{1,4}$/.test(pw)) pw = pw.padStart(5, '0');
  if (!pw && !keepPwd) return { err: 'BAD_PASSWORD' };
  const doc = {
    id: U.docId(date, empNo), date, empNo,
    name: String(r.name == null ? '' : r.name).trim(), dept: String(r.dept == null ? '' : r.dept).trim(),
    table: String(r.table == null ? '' : r.table).trim(),
    checked: U.YN(r.checked), verified: U.YN(r.verified), welfare: U.YN(r.welfare),
    approver: String(r.approver == null ? '' : r.approver).trim(),
    location: String(r.location == null ? '' : r.location).trim(),
    checkedAt: String(r.checkedAt == null ? '' : r.checkedAt).trim(),
  };
  if (pw) doc.pwd = U.hashPwd(pw);
  return { doc };
}

api.post('/emp', auth, need('admin'), wrap(async (req, res) => {
  const { doc, err } = toDoc(req.body, false);
  if (err) return fail(res, 400, err);
  if (await db.getEmp(doc.id)) return fail(res, 409, 'EMP_EXISTS');
  const { id, ...rest } = doc;
  await db.upsertMany([{ id, ...rest }]);
  res.json({ ok: true });
}));

api.put('/emp/:id', auth, need('admin'), wrap(async (req, res) => {
  const old = await db.getEmp(req.params.id);
  if (!old) return fail(res, 404, 'EMP_NOT_FOUND');
  const { doc, err } = toDoc({ ...req.body, date: req.body.date || old.date, empNo: old.empNo }, true);
  if (err) return fail(res, 400, err);
  const { id, ...rest } = doc;
  if (id === old.id) {
    await db.update(old.id, rest);
  } else { // 日期變更 = 文件 ID 變更:寫入新文件後刪除舊文件
    if (await db.getEmp(id)) return fail(res, 409, 'EMP_EXISTS');
    if (!rest.pwd) rest.pwd = old.pwd;
    await db.upsertMany([{ id, ...rest }]);
    await db.remove(old.id);
  }
  res.json({ ok: true });
}));

api.delete('/emp/:id', auth, need('admin'), wrap(async (req, res) => {
  await db.remove(req.params.id);
  res.json({ ok: true });
}));

// rows: [{date, empNo, name, dept, password, table, checked, verified, welfare, approver, location, checkedAt}]
api.post('/import', auth, need('admin'), wrap(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const docs = [], errors = [], seen = new Set();
  rows.forEach((r, i) => {
    const { doc, err } = toDoc(r, false);
    if (err) return errors.push({ row: i + 2, error: err });
    if (seen.has(doc.id)) return errors.push({ row: i + 2, error: 'DUPLICATE' });
    seen.add(doc.id);
    docs.push(doc);
  });
  if (req.body.clear && !errors.length) await db.clearAll();
  if (!errors.length) await db.upsertMany(docs);
  res.json({ imported: errors.length ? 0 : docs.length, errors });
}));

app.use('/api', api);
app.use('/.netlify/functions/api', api);
module.exports = app;

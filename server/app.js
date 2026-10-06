const express = require('express');
const jwt = require('jsonwebtoken');
const cfg = require('./config');
const db = require('./db');
const { makeQr, verifyQr, makeCarLink, verifyCarLink } = require('./qr');
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
  id: d.id, date: d.date, empNo: d.empNo, name: d.name, dept: d.dept, table: d.table || '', carNo: d.carNo || '',
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
  const out = { me, role: req.user.role, params: { lat: p.lat, lng: p.lng, toleranceMeters: p.toleranceMeters, verifyDate: p.verifyDate }, mates: [] };
  // 一般員工須為當日梯次才可報到(福委、管理員不受限)
  out.blocked = req.user.role === 'employee' && me.date !== p.verifyDate;
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
  if (req.user.role === 'employee' && req.emp.date !== p.verifyDate) {
    return res.status(403).json({ error: 'DATE_MISMATCH', vdate: req.emp.date });
  }
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

// 員工修改自己的車號
api.put('/me/car', auth, need('employee', 'welfare'), wrap(async (req, res) => {
  const car = normCar(req.body.carNo);
  if (car.err) return fail(res, 400, car.err);
  await db.update(req.emp.id, { carNo: car.v });
  res.json({ ok: true, carNo: car.v });
}));

/* ---------- 福委 ---------- */
api.get('/qr', auth, need('welfare'), wrap(async (req, res) => {
  const p = await db.getParamsWithDefaults();
  res.json({ qr: makeQr(), seconds: Number(p.qrResetSeconds) });
}));

// 104 人員基本資料驗證:福委輸入員工手機上的工號 -> 完成報到
api.get('/lookup/:empNo', auth, need('welfare'), wrap(async (req, res) => {
  const emp = (await db.findByEmpNo(String(req.params.empNo).trim()))[0];
  if (!emp) return fail(res, 404, 'EMP_NOT_FOUND');
  const p = await db.getParamsWithDefaults();
  if (emp.date !== p.verifyDate) return res.status(400).json({ error: 'VERIFY_FAILED', vdate: emp.date });
  res.json(pub(emp));
}));

api.post('/manual-checkin', auth, need('welfare'), wrap(async (req, res) => {
  const empNo = String(req.body.empNo || '').trim();
  const emp = (await db.findByEmpNo(empNo))[0];
  if (!emp) return fail(res, 404, 'EMP_NOT_FOUND');
  const p = await db.getParamsWithDefaults();
  if (emp.date !== p.verifyDate) return res.status(400).json({ error: 'VERIFY_FAILED', vdate: emp.date }); // 不予記錄
  const patch = {
    checked: 'Y', verified: 'Y', approver: `${req.emp.empNo} ${req.emp.name}`.trim(),
    location: 'MANUAL', checkedAt: U.twDisplay(),
  };
  if (req.body.carNo !== undefined) { // 福委核對後的車號與報到同一筆交易寫入
    const car = normCar(req.body.carNo);
    if (car.err) return fail(res, 400, car.err);
    patch.carNo = car.v;
  }
  const ok = await db.checkinTx(emp.id, patch);
  if (ok === false) return fail(res, 409, 'ALREADY_CHECKED');
  res.json({ ok: true });
}));

api.get('/stats', auth, need('welfare'), wrap(async (req, res) => {
  const p = await db.getParamsWithDefaults();
  const date = U.normDate(req.query.date);
  const sel = cfg.DATES.includes(date) ? date : p.verifyDate; // 預設顯示「驗證日期」梯次
  const list = await db.listEmp(sel);
  const done = list.filter((d) => d.checked === 'Y');
  res.json({
    date: sel, dates: cfg.DATES, verifyDate: p.verifyDate, total: list.length, checked: done.length,
    unchecked: list.length - done.length,
    byQr: done.filter((d) => d.location !== 'MANUAL').length,
    byManual: done.filter((d) => d.location === 'MANUAL').length,
    verified: done.filter((d) => d.verified === 'Y').length,
    list: list.map(pub).sort((a, b) => String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true })),
  });
}));

// 該梯次已報到且有車號者的車號(去重、排序)
const checkedCars = async (date) => [...new Set((await db.listEmp(date))
  .filter((d) => d.checked === 'Y' && d.carNo).map((d) => d.carNo))]
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

// 福委產生車號清單連結(QRCode 內容由前端以 location.origin 組成)
api.get('/car-link', auth, need('welfare'), wrap(async (req, res) => {
  const p = await db.getParamsWithDefaults();
  const date = U.normDate(req.query.date);
  const sel = cfg.DATES.includes(date) ? date : p.verifyDate;
  const link = makeCarLink(sel);
  res.json({ date: sel, dates: cfg.DATES, ...link, expiresAt: U.twDisplay(link.e * 1000), count: (await checkedCars(sel)).length });
}));

/* ---------- 公開:車號清單(餐廳服務人員掃 QRCode 後查看,僅回傳車號) ---------- */
api.get('/cars', wrap(async (req, res) => {
  const v = verifyCarLink(req.query);
  if (v.err) return fail(res, 403, v.err);
  const cars = await checkedCars(v.date);
  res.json({ date: v.date, cars, count: cars.length, expiresAt: U.twDisplay(Number(req.query.e) * 1000) });
}));

/* ---------- 管理者 ---------- */
api.get('/params', auth, need('admin'), wrap(async (req, res) => {
  res.json({ ...(await db.getParamsWithDefaults()), dates: cfg.DATES, backend: db.name });
}));

api.put('/params', auth, need('admin'), wrap(async (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  const tol = Number(req.body.toleranceMeters), sec = Number(req.body.qrResetSeconds);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || !(tol > 0) || !(sec >= 5)
    || !cfg.DATES.includes(req.body.verifyDate)) return fail(res, 400, 'BAD_PARAMS');
  await db.setParams({ lat, lng, toleranceMeters: tol, qrResetSeconds: Math.round(sec), verifyDate: req.body.verifyDate });
  res.json({ ok: true });
}));

api.get('/emp', auth, need('admin'), wrap(async (req, res) => {
  const list = await db.listEmp(U.normDate(req.query.date) || undefined);
  res.json(list.map(pub).sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true })));
}));

const str = (v) => String(v == null ? '' : v).trim();

// 車號:去空白、轉大寫,最多 16 字元;空白表示未開車
function normCar(v) {
  const s = str(v).toUpperCase();
  return s.length > 16 ? { err: 'BAD_CARNO' } : { v: s };
}

// 將輸入整理成 emp_file 文件;pwd 空白且為更新時保留原密碼
function toDoc(r, keepPwd) {
  const date = U.normDate(r.date), empNo = String(r.empNo == null ? '' : r.empNo).trim();
  if (!cfg.DATES.includes(date)) return { err: 'BAD_DATE' };
  if (!empNo) return { err: 'BAD_EMPNO' };
  let pw = String(r.password == null ? '' : r.password).trim();
  if (/^\d{1,4}$/.test(pw)) pw = pw.padStart(5, '0');
  if (!pw && !keepPwd) return { err: 'BAD_PASSWORD' };
  const car = normCar(r.carNo);
  if (car.err) return { err: car.err };
  const doc = {
    id: U.docId(date, empNo), date, empNo,
    name: String(r.name == null ? '' : r.name).trim(), dept: String(r.dept == null ? '' : r.dept).trim(),
    table: String(r.table == null ? '' : r.table).trim(), carNo: car.v,
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
  if ((await db.findByEmpNo(doc.empNo)).length) return fail(res, 409, 'EMP_EXISTS'); // 工號唯一
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

// rows: [{date, empNo, name, dept, password, table, checked, verified, welfare, approver, location, checkedAt, carNo}]
// 不清空匯入:工號已存在 → 只更新 日期/部門/桌號/車號(空白保留原值),其餘欄位不動;不存在 → 新增
api.post('/import', auth, need('admin'), wrap(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const clear = !!req.body.clear;
  const ops = [], errors = [], seen = new Set();
  let inserted = 0, updated = 0;
  const existing = new Map(clear ? [] : (await db.listEmp()).map((d) => [d.empNo, d]));
  rows.forEach((r, i) => {
    const row = i + 2, empNo = str(r.empNo);
    if (empNo && seen.has(empNo)) return errors.push({ row, error: 'DUPLICATE' });
    const old = existing.get(empNo);
    if (old) {
      const date = U.normDate(r.date);
      if (!cfg.DATES.includes(date)) return errors.push({ row, error: 'BAD_DATE' });
      const car = normCar(r.carNo);
      if (car.err) return errors.push({ row, error: car.err });
      const patch = { date };
      if (str(r.dept)) patch.dept = str(r.dept);
      if (str(r.table)) patch.table = str(r.table);
      if (car.v) patch.carNo = car.v;
      const id = U.docId(date, empNo);
      if (id === old.id) {
        ops.push({ op: 'merge', id, data: patch });
      } else { // 日期變更 = 文件 ID 變更:搬到新文件(保留全部原欄位)後刪除舊文件
        const { id: oldId, ...rest } = old;
        ops.push({ op: 'set', id, data: { ...rest, ...patch } }, { op: 'delete', id: oldId });
      }
      updated += 1;
    } else {
      const { doc, err } = toDoc(r, false);
      if (err) return errors.push({ row, error: err });
      const { id, ...data } = doc;
      ops.push({ op: 'set', id, data });
      inserted += 1;
    }
    seen.add(empNo);
  });
  if (errors.length) return res.json({ imported: 0, inserted: 0, updated: 0, errors }); // 全有或全無
  if (clear) await db.clearAll();
  await db.writeOps(ops);
  res.json({ imported: inserted + updated, inserted, updated, errors });
}));

app.use('/api', api);
app.use('/.netlify/functions/api', api);
module.exports = app;

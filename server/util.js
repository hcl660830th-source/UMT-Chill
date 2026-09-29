const crypto = require('crypto');
const cfg = require('./config');

const hashPwd = (p) => crypto.createHmac('sha256', cfg.PWD_SECRET).update(String(p)).digest('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// 台灣時間 (UTC+8) 字串 yyyyMMdd HHmmss
const pad = (n, l = 2) => String(n).padStart(l, '0');
function twStamp(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600e3);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
function parseTwStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600e3;
}
function twDisplay(ms = Date.now()) {
  const s = twStamp(ms);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
}

// 日期正規化 -> 'MM/DD';無法辨識回傳空字串
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})$/.exec(s);
  return m ? `${pad(+m[1])}/${pad(+m[2])}` : '';
}
const dateKey = (d) => d.replace('/', '');
const docId = (date, empNo) => `${dateKey(date)}_${empNo}`;

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const YN = (v, def = 'N') => {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'Y' ? 'Y' : s === '' ? def : 'N';
};

module.exports = { hashPwd, safeEqual, twStamp, parseTwStamp, twDisplay, normDate, dateKey, docId, distanceMeters, YN };

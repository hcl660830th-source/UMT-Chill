const crypto = require('crypto');
const cfg = require('./config');
const { twStamp, parseTwStamp, safeEqual, dateKey } = require('./util');

const sign = (stamp) => crypto.createHmac('sha256', cfg.QR_SECRET).update(stamp).digest('hex').slice(0, 16);

// QRCode 內容:「yyyyMMdd HHmmss|驗證碼」
function makeQr(now = Date.now()) {
  const stamp = twStamp(now);
  return `${stamp}|${sign(stamp)}`;
}

// 回傳 null 表示通過,否則錯誤碼
function verifyQr(text, resetSeconds, now = Date.now()) {
  const s = String(text || '');
  const i = s.lastIndexOf('|');
  if (i < 0) return 'QR_INVALID';
  const stamp = s.slice(0, i), code = s.slice(i + 1);
  const t = parseTwStamp(stamp);
  if (Number.isNaN(t) || !safeEqual(code, sign(stamp))) return 'QR_INVALID';
  if (t - now > 3000) return 'QR_INVALID';
  if (now - t > resetSeconds * 1000) return 'QR_EXPIRED';
  return null;
}

// 車號清單連結:d = MMDD 梯次、e = 到期 unix 秒、s = 簽章
const carSig = (d, e) => sign(`cars|${d}|${e}`);

function makeCarLink(date, ttlHours = 12, now = Date.now()) {
  const d = dateKey(date), e = Math.floor(now / 1000) + Math.round(ttlHours * 3600);
  return { d, e, s: carSig(d, e) };
}

// 回傳 { date: 'MM/DD' } 或 { err }
function verifyCarLink({ d, e, s }, now = Date.now()) {
  d = String(d || ''); e = String(e || '');
  const date = cfg.DATES.find((x) => dateKey(x) === d);
  if (!date || !/^\d+$/.test(e) || !safeEqual(String(s || ''), carSig(d, e))) return { err: 'LINK_INVALID' };
  if (Number(e) * 1000 < now) return { err: 'LINK_EXPIRED' };
  return { date };
}

module.exports = { makeQr, verifyQr, makeCarLink, verifyCarLink };

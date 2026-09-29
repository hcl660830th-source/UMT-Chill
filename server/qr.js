const crypto = require('crypto');
const cfg = require('./config');
const { twStamp, parseTwStamp, safeEqual } = require('./util');

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

module.exports = { makeQr, verifyQr };

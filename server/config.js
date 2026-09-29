// 集中設定:梯次、預設參數、內建管理員
module.exports = {
  DATES: ['11/03', '11/10'],
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'umt@1003',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
  QR_SECRET: process.env.QR_SECRET || 'dev-only-qr-secret-change-me',
  PWD_SECRET: process.env.PWD_SECRET || process.env.JWT_SECRET || 'dev-only-pwd-secret-change-me',
  DEFAULT_PARAMS: {
    lat: 25.033964,
    lng: 121.564468,
    toleranceMeters: 200,
    qrResetSeconds: 30,
  },
};

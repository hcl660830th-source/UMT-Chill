# 餐會報到系統

手機優先的餐會報到網站(前台員工 / 後台福委+管理員),繁中/越/印尼三語。

## 本機執行(不需 Firebase,資料存 data/local-json)
    npm install
    npm run sample      # 產生 sample-emp.xlsx 範例
    npm start           # http://localhost:3000

管理員:admin / umt@1003 → 「匯入」上傳 xlsx。範例福委:A001、B001,密碼見範例檔第 5 欄(10037 / 10037)。

## 部署到 Netlify + Firebase
1. Firebase 建立專案 → 啟用 Firestore → 服務帳戶產生金鑰 JSON。
2. Netlify 環境變數:
   - `FIREBASE_SERVICE_ACCOUNT` = 金鑰 JSON(或其 base64)
   - `JWT_SECRET`、`QR_SECRET`、`PWD_SECRET` = 各自隨機長字串
   - (選用)`ADMIN_USER` / `ADMIN_PASSWORD`
3. `firestore.rules` 已設為全拒絕(只有伺服器 Admin SDK 可存取)。
4. `netlify deploy --prod`(或連結 Git 自動部署)。Netlify 自帶 HTTPS,手機 GPS/相機才可使用。

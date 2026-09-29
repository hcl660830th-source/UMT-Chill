// 本機開發伺服器:同一個 Express app + 靜態前端
const express = require('express');
const path = require('path');
const app = require('./server/app');
const db = require('./server/db');

app.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}  (資料庫: ${db.name})`));

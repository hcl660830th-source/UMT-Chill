// 產生範例員工清單 sample-emp.xlsx(欄位順序同匯入格式)
const XLSX = require('xlsx');
const path = require('path');

const head = ['日期', '工號', '姓名', '部門', '密碼', '桌號', '報到YN', '驗證YN', '福委YN', '核准人員', '報到位置', '報到時間'];
const depts = ['製造部', '品保部', '業務部', '人資部', '財務部'];
const rows = [head];
for (const date of ['10/03', '10/11']) {
  for (let i = 1; i <= 24; i++) {
    const no = `${date === '10/03' ? 'A' : 'B'}${String(i).padStart(3, '0')}`;
    rows.push([date, no, `員工${no}`, depts[i % depts.length], String(10000 + i * 37).slice(-5),
      Math.ceil(i / 4), 'N', 'N', i <= 2 ? 'Y' : 'N', '', '', '']);
  }
}
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'emp_file');
const out = path.join(__dirname, '..', 'sample-emp.xlsx');
XLSX.writeFile(wb, out);
console.log('已產生', out);

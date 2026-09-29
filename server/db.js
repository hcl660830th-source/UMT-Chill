// 資料層:設定 FIREBASE_SERVICE_ACCOUNT 時使用 Firestore,否則使用本機 JSON 檔(僅供開發測試)
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const useFirestore = !!process.env.FIREBASE_SERVICE_ACCOUNT;

/* ---------------- Firestore ---------------- */
function firestoreBackend() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  const fdb = admin.firestore();
  const emp = fdb.collection('emp_file');
  const paramDoc = fdb.collection('sys_param').doc('main');
  const rows = (q) => q.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    name: 'firestore',
    async getParams() { const s = await paramDoc.get(); return s.exists ? s.data() : {}; },
    async setParams(p) { await paramDoc.set(p, { merge: true }); },
    async getEmp(id) { const s = await emp.doc(id).get(); return s.exists ? { id, ...s.data() } : null; },
    async findByEmpNo(empNo) { return rows(await emp.where('empNo', '==', empNo).get()); },
    async listEmp(date) { return rows(date ? await emp.where('date', '==', date).get() : await emp.get()); },
    async listByTable(date, table) {
      return rows(await emp.where('date', '==', date).where('table', '==', table).get());
    },
    async upsertMany(docs) {
      for (let i = 0; i < docs.length; i += 400) {
        const b = fdb.batch();
        docs.slice(i, i + 400).forEach(({ id, ...d }) => b.set(emp.doc(id), d));
        await b.commit();
      }
    },
    async update(id, patch) { await emp.doc(id).update(patch); },
    async remove(id) { await emp.doc(id).delete(); },
    async clearAll() {
      const q = await emp.get();
      for (let i = 0; i < q.docs.length; i += 400) {
        const b = fdb.batch();
        q.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    },
    // 交易:不存在回傳 null,已報到回傳 false,成功回傳 true
    async checkinTx(id, patch) {
      return fdb.runTransaction(async (t) => {
        const ref = emp.doc(id), s = await t.get(ref);
        if (!s.exists) return null;
        if (s.data().checked === 'Y') return false;
        t.update(ref, patch);
        return true;
      });
    },
  };
}

/* ---------------- 本機 JSON ---------------- */
function localBackend() {
  const file = path.join(__dirname, '..', 'data', 'local-db.json');
  let mem = null;
  const load = () => {
    if (mem) return mem;
    try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { mem = { emp: {}, params: {} }; }
    return mem;
  };
  const save = () => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(mem)); } catch (e) { /* 唯讀環境略過 */ }
  };
  const all = () => Object.entries(load().emp).map(([id, d]) => ({ id, ...d }));
  return {
    name: 'local-json',
    async getParams() { return { ...load().params }; },
    async setParams(p) { load().params = { ...load().params, ...p }; save(); },
    async getEmp(id) { const d = load().emp[id]; return d ? { id, ...d } : null; },
    async findByEmpNo(empNo) { return all().filter((d) => d.empNo === empNo); },
    async listEmp(date) { return all().filter((d) => !date || d.date === date); },
    async listByTable(date, table) { return all().filter((d) => d.date === date && d.table === table); },
    async upsertMany(docs) { docs.forEach(({ id, ...d }) => { load().emp[id] = d; }); save(); },
    async update(id, patch) { Object.assign(load().emp[id], patch); save(); },
    async remove(id) { delete load().emp[id]; save(); },
    async clearAll() { load().emp = {}; save(); },
    async checkinTx(id, patch) {
      const d = load().emp[id];
      if (!d) return null;
      if (d.checked === 'Y') return false;
      Object.assign(d, patch); save();
      return true;
    },
  };
}

const backend = useFirestore ? firestoreBackend() : localBackend();
backend.getParamsWithDefaults = async () => ({ ...cfg.DEFAULT_PARAMS, ...(await backend.getParams()) });
module.exports = backend;

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'koi-panel-secret-change-me';
const PORT = process.env.PORT || 3001;

// simple JSON DB for Vercel serverless (sqlite3 native fails on Vercel)
const isVercel = !!process.env.VERCEL;
const DB_DIR = isVercel ? '/tmp' : path.join(__dirname, '..');
const DB_FILE = path.join(DB_DIR, 'data.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {}
  return { users: [], accounts: [], nextAid: 1 };
}
function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(dbData)); } catch {}
}
let dbData = loadDB();
if (dbData.users.length === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  dbData.users.push({ id: 'admin-' + Date.now(), username: 'admin', password_hash: hash, is_admin: 1, max_accounts: 999, created_at: Date.now() });
  saveDB();
  console.log('[seed] admin / admin123');
}

const PANELS = {
  koi: { name: 'Ksatria Online', maps: [
    { map_id: 1, name: 'Desa Serigala' },
    { map_id: 0, name: 'Hutan Serigala' },
    { map_id: 103, name: 'Mataram Empire' },
    { map_id: 109, name: 'Alas Roban' },
    { map_id: 110, name: 'Kastil Alas Roban' },
    { map_id: 116, name: 'Kastil Gelap' },
    { map_id: 45, name: 'Desa Bawah' },
    { map_id: 52, name: 'Gua Pocong' },
    { map_id: 62, name: 'Sarang Pocong' },
    { map_id: 42, name: 'Gunung Yeti' },
  ], boss: ['Lubu', 'Small Axe', 'Tiny Snow', 'Pocong', 'Yeti'] },
  dbo: { name: 'DragonBoy', maps: [{ map_id: 1, name: 'Làng Vũ Đại' }, { map_id: 2, name: 'Đảo Rồng' }], boss: ['Boss 1', 'Boss 2'] },
  aoi: { name: 'AOI', maps: [{ map_id: 1, name: 'Map 1' }], boss: ['Boss 1'] },
};
function getPanel(req) {
  const p = (req.query.panel || req.body?.panel || 'koi').toLowerCase();
  return PANELS[p] || PANELS.koi;
}

const app = express();
app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ detail: 'No token' });
  try { req.user = jwt.verify(tok, JWT_SECRET); next(); } catch { return res.status(401).json({ detail: 'Token invalid' }); }
}
function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ detail: 'Admin only' });
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password wajib' });
  const u = dbData.users.find(x => x.username === username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ detail: 'Username/password salah' });
  const token = jwt.sign({ uid: u.id, username: u.username, is_admin: !!u.is_admin }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

app.get('/api/me', auth, (req, res) => {
  const u = dbData.users.find(x => x.id === req.user.uid);
  if (!u) return res.status(404).json({ detail: 'User not found' });
  res.json({ uid: u.id, username: u.username, is_admin: !!u.is_admin, max_accounts: u.max_accounts });
});

app.get('/api/users', auth, adminOnly, (req, res) => {
  const users = dbData.users.map(u => ({
    id: u.id, username: u.username, is_admin: u.is_admin, max_accounts: u.max_accounts, created_at: u.created_at,
    account_count: dbData.accounts.filter(a => a.owner_id === u.id).length
  }));
  res.json(users);
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, max_accounts = 5, is_admin = false } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password wajib' });
  if (password.length < 6) return res.status(400).json({ detail: 'Password min 6' });
  if (dbData.users.find(x => x.username === username)) return res.status(400).json({ detail: 'Username sudah ada' });
  const id = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const hash = bcrypt.hashSync(password, 10);
  dbData.users.push({ id, username, password_hash: hash, is_admin: is_admin ? 1 : 0, max_accounts: +max_accounts || 5, created_at: Date.now() });
  saveDB();
  res.json({ msg: 'User dibuat', id });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (req.params.id === req.user.uid) return res.status(400).json({ detail: 'Tidak bisa hapus diri sendiri' });
  dbData.accounts = dbData.accounts.filter(a => a.owner_id !== req.params.id);
  dbData.users = dbData.users.filter(u => u.id !== req.params.id);
  saveDB();
  res.json({ msg: 'User dihapus' });
});

app.get('/api/maps', auth, (req, res) => {
  const panel = getPanel(req);
  res.json(panel.maps);
});
app.get('/api/boss', auth, (req, res) => {
  const panel = getPanel(req);
  res.json(panel.boss.map((name, idx) => ({ idx, name })));
});

app.get('/api/accounts', auth, (req, res) => {
  const panel = (req.query.panel || 'koi').toLowerCase();
  let rows = dbData.accounts.filter(a => a.panel === panel);
  if (!req.user.is_admin) rows = rows.filter(a => a.owner_id === req.user.uid);
  res.json(rows);
});

app.post('/api/accounts', auth, (req, res) => {
  const { label, username, password, boss_idx, panel = 'koi' } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password game wajib' });
  const me = dbData.users.find(x => x.id === req.user.uid);
  const cnt = dbData.accounts.filter(a => a.owner_id === req.user.uid).length;
  if (!req.user.is_admin && cnt >= me.max_accounts) return res.status(400).json({ detail: `Batas akun ${me.max_accounts} tercapai` });
  const acc = { id: dbData.nextAid++, owner_id: req.user.uid, panel, label: label || username, username, password, status: 'stopped', current_map: 1, current_area: 0, current_map_name: 'Desa Serigala', current_area_name: 'Area 1', boss_idx: boss_idx ?? 0, uptime: 0, last_error: null, fish_caught: 0, created_at: Date.now() };
  dbData.accounts.push(acc);
  saveDB();
  res.json({ msg: 'Akun ditambah', id: acc.id });
});

app.delete('/api/accounts/:id', auth, (req, res) => {
  const acc = dbData.accounts.find(x => x.id === +req.params.id);
  if (!acc) return res.status(404).json({ detail: 'Akun tidak ada' });
  if (!req.user.is_admin && acc.owner_id !== req.user.uid) return res.status(403).json({ detail: 'Forbidden' });
  dbData.accounts = dbData.accounts.filter(x => x.id !== acc.id);
  saveDB();
  res.json({ msg: 'Dihapus' });
});

app.post('/api/accounts/:id/:action', auth, (req, res) => {
  const acc = dbData.accounts.find(x => x.id === +req.params.id);
  if (!acc) return res.status(404).json({ detail: 'Akun tidak ada' });
  if (!req.user.is_admin && acc.owner_id !== req.user.uid) return res.status(403).json({ detail: 'Forbidden' });
  const act = req.params.action;
  if (act === 'start') { acc.status = 'running'; acc.last_error = null; saveDB(); return res.json({ msg: `Akun ${acc.label} START` }); }
  if (act === 'stop') { acc.status = 'stopped'; saveDB(); return res.json({ msg: `Akun ${acc.label} STOP` }); }
  if (act === 'pindah') {
    const { map_id, area_id } = req.body || {};
    const panel = getPanel(req);
    const m = panel.maps.find(x => x.map_id === +map_id);
    acc.current_map = +map_id; acc.current_map_name = m ? m.name : 'Map ' + map_id; acc.current_area = +area_id; acc.current_area_name = 'Area ' + (+area_id + 1); saveDB();
    return res.json({ msg: `Pindah ke ${acc.current_map_name} area ${+area_id + 1}` });
  }
  if (act === 'boss') {
    const { boss_idx } = req.body || {};
    const panel = getPanel(req);
    if (boss_idx == null || boss_idx < 0 || boss_idx >= panel.boss.length) return res.status(400).json({ detail: 'Boss idx invalid' });
    acc.boss_idx = +boss_idx; saveDB();
    return res.json({ msg: `Boss diset ke ${panel.boss[+boss_idx]}` });
  }
  return res.status(400).json({ detail: 'Action unknown: ' + act });
});

app.post('/api/accounts/start-all', auth, (req, res) => {
  const acts = req.user.is_admin ? dbData.accounts : dbData.accounts.filter(a => a.owner_id === req.user.uid);
  acts.forEach(a => a.status = 'running');
  saveDB();
  res.json({ msg: 'Semua START' });
});
app.post('/api/accounts/stop-all', auth, (req, res) => {
  const acts = req.user.is_admin ? dbData.accounts : dbData.accounts.filter(a => a.owner_id === req.user.uid);
  acts.forEach(a => a.status = 'stopped');
  saveDB();
  res.json({ msg: 'Semua STOP' });
});

const pubDir = path.join(__dirname, '..', 'public');
app.use(express.static(pubDir));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ detail: 'Not found' });
  res.sendFile(path.join(pubDir, 'index.html'));
});

export default app;

if (!isVercel) {
  app.listen(PORT, () => console.log(`[rawverse] http://localhost:${PORT} ${isVercel ? 'vercel' : 'local'}`));
}

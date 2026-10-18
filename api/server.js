import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data.db');
const JWT_SECRET = process.env.JWT_SECRET || 'koi-panel-secret-change-me';
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

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
  dbo: { name: 'DragonBoy', maps: [
    { map_id: 1, name: 'Làng Vũ Đại' },
    { map_id: 2, name: 'Đảo Rồng' },
  ], boss: ['Boss 1', 'Boss 2'] },
  aoi: { name: 'AOI', maps: [{ map_id: 1, name: 'Map 1' }], boss: ['Boss 1'] },
};
function getPanel(req) {
  const p = (req.query.panel || req.body?.panel || 'koi').toLowerCase();
  return PANELS[p] || PANELS.koi;
}

let db;
async function initDB() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      max_accounts INTEGER DEFAULT 5,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      panel TEXT DEFAULT 'koi',
      label TEXT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      status TEXT DEFAULT 'stopped',
      current_map INTEGER DEFAULT 1,
      current_area INTEGER DEFAULT 0,
      current_map_name TEXT DEFAULT 'Desa Serigala',
      current_area_name TEXT DEFAULT 'Area 1',
      boss_idx INTEGER DEFAULT 0,
      uptime INTEGER DEFAULT 0,
      last_error TEXT,
      fish_caught INTEGER DEFAULT 0,
      created_at INTEGER,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );
  `);
  const row = await db.get('SELECT COUNT(*) as c FROM users');
  if (row.c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    const id = 'admin-' + Date.now();
    await db.run('INSERT INTO users (id, username, password_hash, is_admin, max_accounts, created_at) VALUES (?,?,?,?,?,?)', id, 'admin', hash, 1, 999, Date.now());
    console.log('[seed] admin / admin123 created');
  }
}

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

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password wajib' });
  const u = await db.get('SELECT * FROM users WHERE username=?', username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ detail: 'Username/password salah' });
  const token = jwt.sign({ uid: u.id, username: u.username, is_admin: !!u.is_admin }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

app.get('/api/me', auth, async (req, res) => {
  const u = await db.get('SELECT id, username, is_admin, max_accounts FROM users WHERE id=?', req.user.uid);
  if (!u) return res.status(404).json({ detail: 'User not found' });
  res.json({ uid: u.id, username: u.username, is_admin: !!u.is_admin, max_accounts: u.max_accounts });
});

app.get('/api/users', auth, adminOnly, async (req, res) => {
  const users = await db.all('SELECT id, username, is_admin, max_accounts, created_at FROM users ORDER BY created_at');
  for (const u of users) {
    const r = await db.get('SELECT COUNT(*) as c FROM accounts WHERE owner_id=?', u.id);
    u.account_count = r.c;
  }
  res.json(users);
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, max_accounts = 5, is_admin = false } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password wajib' });
  if (password.length < 6) return res.status(400).json({ detail: 'Password min 6' });
  const ex = await db.get('SELECT 1 FROM users WHERE username=?', username);
  if (ex) return res.status(400).json({ detail: 'Username sudah ada' });
  const id = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const hash = bcrypt.hashSync(password, 10);
  await db.run('INSERT INTO users (id, username, password_hash, is_admin, max_accounts, created_at) VALUES (?,?,?,?,?,?)', id, username, hash, is_admin ? 1 : 0, +max_accounts || 5, Date.now());
  res.json({ msg: 'User dibuat', id });
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.uid) return res.status(400).json({ detail: 'Tidak bisa hapus diri sendiri' });
  await db.run('DELETE FROM accounts WHERE owner_id=?', req.params.id);
  await db.run('DELETE FROM users WHERE id=?', req.params.id);
  res.json({ msg: 'User dihapus' });
});

app.get('/api/maps', auth, async (req, res) => {
  const panel = getPanel(req);
  res.json(panel.maps);
});
app.get('/api/boss', auth, async (req, res) => {
  const panel = getPanel(req);
  res.json(panel.boss.map((name, idx) => ({ idx, name })));
});

app.get('/api/accounts', auth, async (req, res) => {
  const panel = (req.query.panel || 'koi').toLowerCase();
  let rows;
  if (req.user.is_admin) rows = await db.all('SELECT * FROM accounts WHERE panel=? ORDER BY created_at DESC', panel);
  else rows = await db.all('SELECT * FROM accounts WHERE owner_id=? AND panel=? ORDER BY created_at DESC', req.user.uid, panel);
  res.json(rows);
});

app.post('/api/accounts', auth, async (req, res) => {
  const { label, username, password, boss_idx, panel = 'koi' } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'Username & password game wajib' });
  const me = await db.get('SELECT max_accounts FROM users WHERE id=?', req.user.uid);
  const cnt = await db.get('SELECT COUNT(*) as c FROM accounts WHERE owner_id=?', req.user.uid);
  if (!req.user.is_admin && cnt.c >= me.max_accounts) return res.status(400).json({ detail: `Batas akun ${me.max_accounts} tercapai` });
  const r = await db.run('INSERT INTO accounts (owner_id, panel, label, username, password, boss_idx, created_at) VALUES (?,?,?,?,?,?,?)', req.user.uid, panel, label || username, username, password, boss_idx ?? 0, Date.now());
  res.json({ msg: 'Akun ditambah', id: r.lastID });
});

app.delete('/api/accounts/:id', auth, async (req, res) => {
  const acc = await db.get('SELECT * FROM accounts WHERE id=?', req.params.id);
  if (!acc) return res.status(404).json({ detail: 'Akun tidak ada' });
  if (!req.user.is_admin && acc.owner_id !== req.user.uid) return res.status(403).json({ detail: 'Forbidden' });
  await db.run('DELETE FROM accounts WHERE id=?', req.params.id);
  res.json({ msg: 'Dihapus' });
});

app.post('/api/accounts/:id/:action', auth, async (req, res) => {
  const acc = await db.get('SELECT * FROM accounts WHERE id=?', req.params.id);
  if (!acc) return res.status(404).json({ detail: 'Akun tidak ada' });
  if (!req.user.is_admin && acc.owner_id !== req.user.uid) return res.status(403).json({ detail: 'Forbidden' });
  const act = req.params.action;
  if (act === 'start') { await db.run("UPDATE accounts SET status='running', last_error=NULL WHERE id=?", acc.id); return res.json({ msg: `Akun ${acc.label} START` }); }
  if (act === 'stop') { await db.run("UPDATE accounts SET status='stopped' WHERE id=?", acc.id); return res.json({ msg: `Akun ${acc.label} STOP` }); }
  if (act === 'pindah') {
    const { map_id, area_id } = req.body || {};
    const panel = getPanel(req);
    const m = panel.maps.find(x => x.map_id === +map_id);
    await db.run('UPDATE accounts SET current_map=?, current_map_name=?, current_area=?, current_area_name=? WHERE id=?', +map_id, m ? m.name : 'Map ' + map_id, +area_id, 'Area ' + (+area_id + 1), acc.id);
    return res.json({ msg: `Pindah ke ${m ? m.name : map_id} area ${+area_id + 1}` });
  }
  if (act === 'boss') {
    const { boss_idx } = req.body || {};
    const panel = getPanel(req);
    if (boss_idx == null || boss_idx < 0 || boss_idx >= panel.boss.length) return res.status(400).json({ detail: 'Boss idx invalid' });
    await db.run('UPDATE accounts SET boss_idx=? WHERE id=?', +boss_idx, acc.id);
    return res.json({ msg: `Boss diset ke ${panel.boss[+boss_idx]}` });
  }
  return res.status(400).json({ detail: 'Action unknown: ' + act });
});

app.post('/api/accounts/start-all', auth, async (req, res) => {
  if (req.user.is_admin) await db.run('UPDATE accounts SET status="running"');
  else await db.run('UPDATE accounts SET status="running" WHERE owner_id=?', req.user.uid);
  res.json({ msg: 'Semua START' });
});
app.post('/api/accounts/stop-all', auth, async (req, res) => {
  if (req.user.is_admin) await db.run('UPDATE accounts SET status="stopped"');
  else await db.run('UPDATE accounts SET status="stopped" WHERE owner_id=?', req.user.uid);
  res.json({ msg: 'Semua STOP' });
});

const pubDir = path.join(__dirname, '..', 'public');
app.use(express.static(pubDir));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ detail: 'Not found' });
  res.sendFile(path.join(pubDir, 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`[panel-koi] http://localhost:${PORT}  db=${DB_PATH}`));
});

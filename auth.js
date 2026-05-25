const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const SECRET = 'todo-secret-key';

function register(username, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error('用户名已被注册');

  // 第一个注册的用户自动成为管理员
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const is_admin = userCount === 0 ? 1 : 0;

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(username, password_hash, is_admin);
  return { id: info.lastInsertRowid, username, is_admin };
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, is_admin: user.is_admin };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), SECRET);
    req.userId = decoded.id;
    req.username = decoded.username;
    req.isAdmin = decoded.is_admin;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

module.exports = { register, login, authMiddleware, adminMiddleware };

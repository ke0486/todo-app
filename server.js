const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { register, login, authMiddleware, adminMiddleware } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

const SECRET = 'todo-secret-key';

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET, { expiresIn: '7d' });
}

// ========== 用户 ==========
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  try {
    const user = register(username, password);
    const token = makeToken(user);
    res.json({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = login(username, password);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const token = makeToken(user);
  res.json({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
});

// ========== Todo CRUD ==========
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});
app.get('/api/todos', authMiddleware, (req, res) => {
  const todos = db.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json(todos);
});

app.post('/api/todos', authMiddleware, (req, res) => {
  const { title, due } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: '内容不能为空' });

  const info = db.prepare('INSERT INTO todos (user_id, title, due, done) VALUES (?, ?, ?, 0)')
    .run(req.userId, title.trim(), due || null);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid);
  res.json(todo);
});

app.put('/api/todos/:id', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });

  const { title, due, done } = req.body;
  db.prepare('UPDATE todos SET title = ?, due = ?, done = ? WHERE id = ?')
    .run(
      title !== undefined ? title : todo.title,
      due !== undefined ? due : todo.due,
      done !== undefined ? done : todo.done,
      todo.id
    );
  const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id);
  res.json(updated);
});

app.delete('/api/todos/:id', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });

  db.prepare('DELETE FROM todos WHERE id = ?').run(todo.id);
  res.json({ ok: true });
});

// ========== 账号注销 ==========
app.delete('/api/account', authMiddleware, (req, res) => {
  // 不允许注销最后一个管理员
  if (req.isAdmin) {
    const admins = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get().c;
    if (admins <= 1) return res.status(400).json({ error: '你是唯一的管理员，请先将其他用户提升为管理员后再注销' });
  }
  db.prepare('DELETE FROM todos WHERE user_id = ?').run(req.userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

// ========== 管理员接口 ==========
// 管理员删除用户
app.delete('/api/admin/users/:userId', authMiddleware, adminMiddleware, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) return res.status(400).json({ error: '不能删除自己，请使用注销功能' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('DELETE FROM todos WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  res.json({ ok: true });
});
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const users = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC').all();
  const allTodos = db.prepare('SELECT * FROM todos').all();
  const todoMap = {};
  allTodos.forEach(t => {
    if (!todoMap[t.user_id]) todoMap[t.user_id] = { total: 0, done: 0 };
    todoMap[t.user_id].total++;
    if (t.done) todoMap[t.user_id].done++;
  });

  res.json({
    current_user: { id: admin.id, username: admin.username },
    user_count: users.length,
    users: users.map(u => ({
      ...u,
      todos_total: (todoMap[u.id] && todoMap[u.id].total) || 0,
      todos_done: (todoMap[u.id] && todoMap[u.id].done) || 0,
    })),
  });
});

// 管理员提升其他用户为管理员
app.post('/api/admin/promote', authMiddleware, adminMiddleware, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  res.json({ ok: true, message: `${username} 已成为管理员` });
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
});

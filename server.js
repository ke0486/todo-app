const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { register, login, authMiddleware, adminMiddleware } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ========== 管理员接口 ==========
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const users = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC').all();
  const todoStats = db.prepare('SELECT user_id, COUNT(*) as total, SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) as done_count FROM todos GROUP BY user_id').all();
  const todoMap = {};
  todoStats.forEach(t => todoMap[t.user_id] = { total: t.total, done: t.done_count });

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

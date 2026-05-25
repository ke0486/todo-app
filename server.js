const express = require('express');
const path = require('path');
const db = require('./database');
const { register, login, authMiddleware } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== 用户 ==========
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  try {
    const user = register(username, password);
    const token = require('jsonwebtoken').sign({ id: user.id, username: user.username }, 'todo-secret-key', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = login(username, password);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const token = require('jsonwebtoken').sign({ id: user.id, username: user.username }, 'todo-secret-key', { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username } });
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

// ========== 用户列表（后端查看） ==========
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const users = db.prepare('SELECT id, username, created_at FROM users ORDER BY created_at DESC').all();
  const todos = db.prepare('SELECT user_id, COUNT(*) as total, SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) as done_count FROM todos GROUP BY user_id').all();
  const todoMap = {};
  todos.forEach(t => todoMap[t.user_id] = { total: t.total, done: t.done_count });

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

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`);
});

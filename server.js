const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { register, login, authMiddleware, adminMiddleware } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
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

// ========== 当前用户 ==========
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

// ========== Todo CRUD ==========
app.get('/api/todos', authMiddleware, (req, res) => {
  let todos = db.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC').all(req.userId);
  // 同时获取被分享的任务
  const shares = db.prepare('SELECT * FROM shares WHERE target_user_id = ?').all(req.userId);
  const sharedTodos = [];
  for (const s of shares) {
    const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(s.todo_id);
    if (t) { t.shared_by = s.owner_username; t.shared = true; t.share_id = s.id; sharedTodos.push(t); }
  }
  res.json([...todos, ...sharedTodos]);
});

app.post('/api/todos', authMiddleware, (req, res) => {
  const { title, due, priority, tag, note, repeat } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: '内容不能为空' });
  // sort_order 默认等于 id
  const data = load();
  const sortOrder = data._nextId;
  const info = db.prepare('INSERT INTO todos (user_id, title, due, done, priority, tag, subtasks, note, sort_order, repeat) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, title.trim(), due || null, priority ?? 1, tag || null, JSON.stringify([]), note || null, sortOrder, repeat || null);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid);
  res.json(todo);
});

app.put('/api/todos/:id', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });
  const { title, due, done, priority, tag, subtasks, note, sort_order, repeat } = req.body;
  db.prepare('UPDATE todos SET title = ?, due = ?, done = ?, priority = ?, tag = ?, subtasks = ?, note = ?, sort_order = ?, repeat = ? WHERE id = ?')
    .run(
      title !== undefined ? title : todo.title,
      due !== undefined ? due : todo.due,
      done !== undefined ? done : todo.done,
      priority !== undefined ? priority : todo.priority,
      tag !== undefined ? tag : todo.tag,
      subtasks !== undefined ? JSON.stringify(subtasks) : todo.subtasks,
      note !== undefined ? note : todo.note,
      sort_order !== undefined ? sort_order : todo.sort_order,
      repeat !== undefined ? repeat : todo.repeat,
      todo.id
    );
  const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id);
  res.json(updated);
});

app.delete('/api/todos/:id', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });
  db.prepare('DELETE FROM comments WHERE todo_id = ?').run(todo.id);
  db.prepare('DELETE FROM shares WHERE todo_id = ?').run(todo.id);
  db.prepare('DELETE FROM todos WHERE id = ?').run(todo.id);
  res.json({ ok: true });
});

// ========== 重复任务完成 ==========
app.post('/api/todos/:id/complete', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });
  if (!todo.repeat) return res.status(400).json({ error: '非重复任务' });

  // 标记当前为完成
  db.prepare('UPDATE todos SET done = 1 WHERE id = ?').run(todo.id);

  // 计算下次截止日期
  let nextDue = null;
  if (todo.due) {
    const d = new Date(todo.due);
    switch (todo.repeat) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
    }
    nextDue = d.toISOString().slice(0, 10);
  }

  // 创建下次任务
  const data = load();
  const info = db.prepare('INSERT INTO todos (user_id, title, due, done, priority, tag, subtasks, note, sort_order, repeat, repeat_from) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, todo.title, nextDue, todo.priority, todo.tag, todo.subtasks, todo.note, todo.sort_order, todo.repeat, todo.id);
  const newTodo = db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid);
  res.json({ done: todo, next: newTodo });
});

// ========== 评论 ==========
app.get('/api/todos/:id/comments', authMiddleware, (req, res) => {
  const comments = db.prepare('SELECT * FROM comments WHERE todo_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(comments);
});

app.post('/api/todos/:id/comments', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: '内容不能为空' });
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id);
  if (!todo) return res.status(404).json({ error: '任务不存在' });
  const info = db.prepare('INSERT INTO comments (todo_id, user_id, username, text) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.userId, req.username, text.trim());
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json(comment);
});

app.delete('/api/comments/:id', authMiddleware, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id !== req.userId && !req.isAdmin) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ========== 分享 ==========
app.post('/api/todos/:id/share', authMiddleware, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!todo) return res.status(404).json({ error: '任务不存在' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === req.userId) return res.status(400).json({ error: '不能分享给自己' });
  const exist = db.prepare('SELECT id FROM shares WHERE todo_id = ? AND target_user_id = ?').get(todo.id, target.id);
  if (exist) return res.status(400).json({ error: '已经分享给该用户' });
  db.prepare('INSERT INTO shares (todo_id, owner_id, owner_username, target_user_id) VALUES (?, ?, ?, ?)')
    .run(todo.id, req.userId, req.username, target.id);
  res.json({ ok: true });
});

app.delete('/api/todos/:id/share/:userId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM shares WHERE todo_id = ? AND target_user_id = ? AND owner_id = ?')
    .run(req.params.id, req.params.userId, req.userId);
  res.json({ ok: true });
});

// ========== 账号注销 ==========
app.delete('/api/account', authMiddleware, (req, res) => {
  if (req.isAdmin) {
    const admins = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 1').get().c;
    if (admins <= 1) return res.status(400).json({ error: '你是唯一的管理员，请先将其他用户提升为管理员后再注销' });
  }
  db.prepare('DELETE FROM comments WHERE user_id = ?').run(req.userId);
  db.prepare('DELETE FROM shares WHERE owner_id = ? OR target_user_id = ?').run(req.userId, req.userId);
  db.prepare('DELETE FROM todos WHERE user_id = ?').run(req.userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

// ========== 管理员接口 ==========
app.delete('/api/admin/users/:userId', authMiddleware, adminMiddleware, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId === req.userId) return res.status(400).json({ error: '不能删除自己，请使用注销功能' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('DELETE FROM comments WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM shares WHERE owner_id = ? OR target_user_id = ?').run(targetId, targetId);
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
    users: users.map(u => ({ ...u, todos_total: (todoMap[u.id] && todoMap[u.id].total) || 0, todos_done: (todoMap[u.id] && todoMap[u.id].done) || 0 })),
  });
});

app.post('/api/admin/promote', authMiddleware, adminMiddleware, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '请指定用户名' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  res.json({ ok: true, message: `${username} 已成为管理员` });
});

// ========== 数据库辅助 ==========
function load() {
  const fs = require('fs');
  const path = require('path');
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'db.json'), 'utf8')); }
  catch { return { users: [], todos: [], comments: [], shares: [], _nextId: 1 }; }
}

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`服务已启动: http://localhost:${PORT}`));

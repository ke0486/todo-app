// ========== 全局状态 ==========
let token = localStorage.getItem('token');
let currentUser = null; // 从服务器获取，不信任localStorage
let todos = [];
let filter = 'all';
let editingId = null;
let isAdmin = false;

// ========== API ==========
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ========== 页面切换 ==========
async function init() {
  const today = new Date();
  document.getElementById('today').textContent =
    today.toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  if (!token) { showAuthPage(); return; }

  // 从服务器获取真实用户信息
  try {
    currentUser = await api('/api/me');
    isAdmin = !!currentUser.is_admin;
    showTodoPage();
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    token = null;
    showAuthPage();
  }
}

function showAuthPage() {
  document.getElementById('authPage').style.display = 'flex';
  document.getElementById('todoPage').style.display = 'none';
}

function showTodoPage() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('todoPage').style.display = 'block';
  document.getElementById('displayName').textContent = currentUser.username + (isAdmin ? ' (管理员)' : '');

  if (isAdmin) buildAdminPanel();
  else document.getElementById('adminArea').innerHTML = '';

  loadTodos();
}

// ========== 登录/注册 ==========
let authTab = 'login';

document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    authTab = btn.dataset.tab;
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('loginForm').style.display = authTab === 'login' ? 'flex' : 'none';
    document.getElementById('registerForm').style.display = authTab === 'register' ? 'flex' : 'none';
    document.getElementById('loginError').textContent = '';
    document.getElementById('regError').textContent = '';
  });
});

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('loginError').textContent = '';
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    isAdmin = !!currentUser.is_admin;
    showTodoPage();
  } catch (err) {
    document.getElementById('loginError').textContent = err.message;
  }
});

document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('regError').textContent = '';
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  if (password.length < 4) { document.getElementById('regError').textContent = '密码至少4位'; return; }
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    isAdmin = !!currentUser.is_admin;
    showTodoPage();
  } catch (err) {
    document.getElementById('regError').textContent = err.message;
  }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  token = null; currentUser = null; isAdmin = false;
  localStorage.removeItem('token');
  showAuthPage();
});

// ========== 注销账号 ==========
document.getElementById('btnDeleteAccount').addEventListener('click', async () => {
  if (!confirm('确定注销账号吗？所有数据将被永久删除，不可恢复。')) return;
  try {
    await api('/api/account', { method: 'DELETE' });
    token = null; currentUser = null; isAdmin = false;
    localStorage.removeItem('token');
    alert('账号已注销');
    showAuthPage();
  } catch (err) {
    alert(err.message);
  }
});

// ========== 管理员面板（动态构建） ==========
function buildAdminPanel() {
  const container = document.getElementById('adminArea');
  container.innerHTML = `
    <details class="admin-panel" open>
      <summary>用户管理</summary>
      <div class="admin-content" id="adminContent">
        <p class="loading-text">加载中...</p>
      </div>
    </details>
  `;
  loadAdminPanel();
}

async function loadAdminPanel() {
  try {
    const data = await api('/api/admin/users');
    const content = document.getElementById('adminContent');
    content.innerHTML = `
      <p style="margin-bottom:10px;color:var(--text-secondary);">共 <strong>${data.user_count}</strong> 位用户</p>
      <table>
        <thead><tr><th>用户名</th><th>角色</th><th>Todo</th><th>已完成</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          ${data.users.map(u => `
            <tr>
              <td>${escHtml(u.username)}${u.id === currentUser.id ? ' (你)' : ''}</td>
              <td>${u.is_admin ? '管理员' : '用户'}</td>
              <td>${u.todos_total}</td>
              <td>${u.todos_done}</td>
              <td>${u.created_at}</td>
              <td class="admin-actions">
                ${!u.is_admin ? `<button class="promote-btn" data-action="promote" data-username="${escHtml(u.username)}">提升</button>` : ''}
                ${u.id !== currentUser.id ? `<button class="del-user-btn" data-action="delUser" data-userid="${u.id}" data-username="${escHtml(u.username)}">删除</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    content.querySelectorAll('[data-action="promote"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const r = await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ username: btn.dataset.username }) });
          alert(r.message);
          loadAdminPanel();
        } catch (err) { alert(err.message); }
      });
    });

    content.querySelectorAll('[data-action="delUser"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`确定删除用户 "${btn.dataset.username}" 及其所有数据吗？`)) return;
        try {
          await api(`/api/admin/users/${btn.dataset.userid}`, { method: 'DELETE' });
          loadAdminPanel();
        } catch (err) { alert(err.message); }
      });
    });
  } catch { /* 非管理员 */ }
}

// ========== Todo 逻辑 ==========
async function loadTodos() {
  try { todos = await api('/api/todos'); render(); }
  catch (err) { if (err.message.includes('登录')) showAuthPage(); }
}

function render() {
  const filtered = todos.filter(t => {
    if (filter === 'active') return !t.done;
    if (filter === 'completed') return t.done;
    return true;
  });
  const list = document.getElementById('todoList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    const msgs = { all: '还没有任务', active: '所有任务已完成!', completed: '还没有已完成的任务' };
    list.innerHTML = `<div class="empty"><div class="icon">📋</div><p>${msgs[filter]}</p></div>`;
    return renderStats();
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  filtered.forEach(t => {
    const isOverdue = t.due && t.due < todayStr && !t.done;
    const isEditing = editingId === t.id;
    const div = document.createElement('div');
    div.className = 'todo-item' + (t.done ? ' completed' : '');
    div.innerHTML = `
      <div class="checkbox" data-action="toggle"></div>
      ${isEditing
        ? `<input class="edit-input" value="${escHtml(t.title)}" data-action="save" />`
        : `<div class="content"><div class="title">${escHtml(t.title)}</div>${t.due ? `<div class="due ${isOverdue ? 'overdue' : ''}">截止: ${t.due}</div>` : ''}</div>`
      }
      <div class="actions">
        ${isEditing ? `<button data-action="save">保存</button>` : `<button data-action="edit">编辑</button>`}
        <button class="del-btn" data-action="delete">删除</button>
      </div>
    `;
    div.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        const a = e.target.dataset.action;
        if (a === 'toggle') toggleTodo(t.id);
        else if (a === 'edit') startEdit(t.id);
        else if (a === 'save') saveEdit(t.id);
        else if (a === 'delete') deleteTodo(t.id);
      });
    });
    if (isEditing) {
      const input = div.querySelector('.edit-input');
      input.addEventListener('keydown', e => { if (e.key === 'Enter') saveEdit(t.id); if (e.key === 'Escape') { editingId = null; render(); } });
      input.focus();
    }
    list.appendChild(div);
  });
  renderStats();
}

function renderStats() {
  const remaining = todos.filter(t => !t.done).length;
  document.getElementById('stats').style.display = todos.length > 0 ? 'flex' : 'none';
  document.getElementById('remainingText').textContent = `${remaining} 项未完成`;
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function addTodo() {
  const input = document.getElementById('inputTitle'), due = document.getElementById('inputDue');
  const title = input.value.trim();
  if (!title) return;
  try {
    const todo = await api('/api/todos', { method: 'POST', body: JSON.stringify({ title, due: due.value }) });
    todos.unshift(todo);
    input.value = ''; due.value = ''; input.focus();
    render();
  } catch (err) { alert(err.message); }
}

async function toggleTodo(id) {
  const t = todos.find(t => t.id === id);
  if (!t) return;
  try {
    const updated = await api(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify({ done: t.done ? 0 : 1 }) });
    Object.assign(t, updated); render();
  } catch (err) { alert(err.message); }
}

function startEdit(id) { editingId = id; render(); }

async function saveEdit(id) {
  const input = document.querySelector('.edit-input');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  try {
    const updated = await api(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify({ title }) });
    const t = todos.find(t => t.id === id);
    if (t) Object.assign(t, updated);
    editingId = null; render();
  } catch (err) { alert(err.message); }
}

async function deleteTodo(id) {
  try {
    await api(`/api/todos/${id}`, { method: 'DELETE' });
    todos = todos.filter(t => t.id !== id); editingId = null; render();
  } catch (err) { alert(err.message); }
}

async function clearDone() {
  const doneIds = todos.filter(t => t.done).map(t => t.id);
  for (const id of doneIds) await api(`/api/todos/${id}`, { method: 'DELETE' });
  todos = todos.filter(t => !t.done); render();
}

// ========== 事件 ==========
document.getElementById('btnAdd').addEventListener('click', addTodo);
document.getElementById('inputTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
document.querySelectorAll('.filters button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    render();
  });
});
document.getElementById('btnClearDone').addEventListener('click', clearDone);

// ========== 启动 ==========
init();

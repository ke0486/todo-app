// ===== 配置 =====
const TAG_COLORS = { work: 'tag-work', life: 'tag-life', study: 'tag-study', other: 'tag-other' };
const TAG_NAMES = { work: '工作', life: '生活', study: '学习', other: '其他' };
const REPEAT_LABELS = { daily: '每天', weekly: '每周', monthly: '每月' };
const PRIO_CLASS = { 2: 'priority-high', 1: 'priority-mid', 0: 'priority-low' };

// ===== 状态 =====
let token = localStorage.getItem('token');
let currentUser = null;
let todos = [];
let filter = 'all';
let tagFilter = '';
let searchText = '';
let editingId = null;
let isAdmin = false;
let expandedId = null; // 展开详情的任务ID
let priority = 1; // 默认中优先级
let notifTimer = null;

// ===== API =====
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ===== 初始化 =====
async function init() {
  document.getElementById('today').textContent =
    new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

  // 深色模式
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme:dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  if (!token) { showAuthPage(); return; }
  try {
    currentUser = await api('/api/me');
    isAdmin = !!currentUser.is_admin;
    showTodoPage();
  } catch {
    localStorage.removeItem('token'); token = null; showAuthPage();
  }
}

function showAuthPage() {
  document.getElementById('authPage').style.display = 'flex';
  document.getElementById('todoPage').style.display = 'none';
  if (notifTimer) clearInterval(notifTimer);
}

function showTodoPage() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('todoPage').style.display = 'block';
  document.getElementById('displayName').textContent = currentUser.username + (isAdmin ? ' (管理员)' : '');
  if (isAdmin) buildAdminPanel(); else document.getElementById('adminArea').innerHTML = '';
  loadTodos();
  setupNotifications();
}

// ===== 深色模式 =====
document.getElementById('btnTheme').addEventListener('click', () => {
  const el = document.documentElement;
  if (el.getAttribute('data-theme') === 'dark') { el.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
  else { el.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
});

// ===== 优先级选择 =====
document.getElementById('prioBtns').addEventListener('click', e => {
  const btn = e.target.closest('.prio-btn');
  if (!btn) return;
  document.querySelectorAll('.prio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  priority = parseInt(btn.dataset.p);
});

// ===== 登录/注册 =====
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
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  try {
    const d = await api('/api/login', { method:'POST', body:JSON.stringify({ username:u, password:p }) });
    token = d.token; localStorage.setItem('token', token);
    currentUser = d.user; isAdmin = !!currentUser.is_admin; showTodoPage();
  } catch(err) { document.getElementById('loginError').textContent = err.message; }
});

document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('regError').textContent = '';
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  if (p.length < 4) { document.getElementById('regError').textContent = '密码至少4位'; return; }
  try {
    const d = await api('/api/register', { method:'POST', body:JSON.stringify({ username:u, password:p }) });
    token = d.token; localStorage.setItem('token', token);
    currentUser = d.user; isAdmin = !!currentUser.is_admin; showTodoPage();
  } catch(err) { document.getElementById('regError').textContent = err.message; }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  token = null; currentUser = null; isAdmin = false; todos = [];
  localStorage.removeItem('token'); if (notifTimer) clearInterval(notifTimer);
  showAuthPage();
});

// 注销
document.getElementById('btnDeleteAccount').addEventListener('click', async () => {
  if (!confirm('确定注销账号吗？所有数据将被永久删除，不可恢复。')) return;
  try {
    await api('/api/account', { method:'DELETE' });
    token = null; currentUser = null; isAdmin = false;
    localStorage.removeItem('token'); alert('账号已注销'); showAuthPage();
  } catch(err) { alert(err.message); }
});

// ===== Todo 加载 =====
async function loadTodos() {
  try { todos = await api('/api/todos'); render(); }
  catch(err) { if (err.message.includes('登录')) showAuthPage(); }
}

// ===== 搜索 =====
document.getElementById('searchInput').addEventListener('input', e => {
  searchText = e.target.value.toLowerCase(); render();
});

// ===== 筛选 =====
document.getElementById('filters').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.filter !== undefined) {
    document.querySelectorAll('#filters button[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
  }
  if (btn.dataset.tag !== undefined) {
    document.querySelectorAll('#filters .tag-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tagFilter = btn.dataset.tag;
  }
  render();
});

// ===== 渲染 =====
function render() {
  let filtered = todos.filter(t => {
    if (filter === 'active') return !t.done;
    if (filter === 'completed') return t.done;
    return true;
  });
  if (tagFilter) filtered = filtered.filter(t => t.tag === tagFilter);
  if (searchText) filtered = filtered.filter(t =>
    t.title.toLowerCase().includes(searchText) ||
    (t.note && t.note.toLowerCase().includes(searchText)) ||
    (t.tag && TAG_NAMES[t.tag] && TAG_NAMES[t.tag].includes(searchText))
  );

  const list = document.getElementById('todoList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    const msgs = { all:'还没有任务', active:'全部完成!', completed:'还没有已完成的任务' };
    list.innerHTML = `<div class="empty"><div class="icon">📋</div><p>${msgs[filter]}</p></div>`;
    return renderStats();
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  filtered.forEach(t => {
    const isOverdue = t.due && t.due < todayStr && !t.done;
    const isEditing = editingId === t.id;
    const isExpanded = expandedId === t.id;

    // 自定义右上角优先级颜色
    let prioClass = t.priority != null ? (PRIO_CLASS[t.priority] || '') : 'priority-mid';
    if (t.shared) prioClass += ' shared';

    const div = document.createElement('div');
    div.className = 'todo-item' + (t.done ? ' completed' : '') + ' ' + prioClass;
    div.draggable = true;
    div.dataset.id = t.id;

    const subtaskCount = (t.subtasks && JSON.parse(t.subtasks||'[]').length) || 0;
    const subtaskDone = (t.subtasks && JSON.parse(t.subtasks||'[]').filter(s=>s.done).length) || 0;

    div.innerHTML = `
      <div class="top-row">
        <div class="checkbox" data-action="toggle"></div>
        <div class="content">
          ${isEditing
            ? `<input class="edit-input" value="${esc(t.title)}" data-action="save"/>`
            : `<span class="title">${esc(t.title)}</span>`
          }
          ${t.tag ? `<span class="tag-badge ${TAG_COLORS[t.tag]||'tag-other'}">${TAG_NAMES[t.tag]||t.tag}</span>` : ''}
          ${t.repeat ? `<span class="repeat-icon" title="${REPEAT_LABELS[t.repeat]}">🔁</span>` : ''}
          ${t.shared ? `<span class="shared-badge">来自 ${esc(t.shared_by)}</span>` : ''}
          ${t.due ? `<span class="due ${isOverdue?'overdue':''}">📅 ${t.due}</span>` : ''}
          ${subtaskCount > 0 ? `<span class="due">✓ ${subtaskDone}/${subtaskCount}</span>` : ''}
        </div>
        <div class="actions">
          ${!t.shared ? (isEditing
            ? `<button data-action="save">保存</button>`
            : `<button data-action="edit">编辑</button>`
          ) : ''}
          <button data-action="expand" style="font-size:.9rem">${isExpanded ? '▲' : '▼'}</button>
          ${!t.shared ? `<button class="del-btn" data-action="delete">删除</button>` : ''}
        </div>
      </div>
    `;

    // 展开详情区
    if (isExpanded) {
      const detailDiv = document.createElement('div');
      detailDiv.className = 'detail-section';
      const subtasks = JSON.parse(t.subtasks || '[]');
      detailDiv.innerHTML = buildDetailHTML(t, subtasks);
      div.appendChild(detailDiv);
      // 延迟绑定详情区事件
      setTimeout(() => bindDetailEvents(div, t), 0);
    }

    // 绑定基础事件
    div.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        const a = e.target.dataset.action;
        if (a === 'toggle') toggleTodo(t.id);
        else if (a === 'edit') startEdit(t.id);
        else if (a === 'save') saveEdit(t.id);
        else if (a === 'delete') deleteTodo(t.id);
        else if (a === 'expand') toggleExpand(t.id);
      });
    });

    if (isEditing) {
      const inp = div.querySelector('.edit-input');
      inp.addEventListener('keydown', e => { if (e.key==='Enter') saveEdit(t.id); if (e.key==='Escape'){editingId=null;render();} });
      inp.focus();
    }

    // 拖拽
    div.addEventListener('dragstart', dragStart);
    div.addEventListener('dragover', dragOver);
    div.addEventListener('dragleave', dragLeave);
    div.addEventListener('drop', drop);

    list.appendChild(div);
  });

  renderStats();
}

function buildDetailHTML(t, subtasks) {
  return `
    <!-- 子任务 -->
    <div class="subtasks-title" style="font-size:.8rem;color:var(--text-secondary);margin-bottom:4px">子任务</div>
    <div class="subtask-list">
      ${subtasks.map((s,i) => `
        <div class="subtask-row" data-sidx="${i}">
          <div class="sub-check ${s.done?'done':''}" data-action="toggleSub"></div>
          <span class="sub-text ${s.done?'done':''}">${esc(s.text)}</span>
          <button data-action="delSub" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:.7rem;margin-left:auto">✕</button>
        </div>
      `).join('')}
    </div>
    <div class="subtask-input">
      <input placeholder="添加子任务..." id="subInput_${t.id}" />
      <button data-action="addSub">+</button>
    </div>

    <!-- 备注 -->
    <div style="margin-top:10px;font-size:.8rem;color:var(--text-secondary)">备注</div>
    <textarea id="noteInput_${t.id}" placeholder="添加备注...">${esc(t.note||'')}</textarea>
    <button data-action="saveNote" style="margin-top:4px;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:.78rem;cursor:pointer">保存备注</button>

    <!-- 评论 -->
    <div style="margin-top:10px;font-size:.8rem;color:var(--text-secondary)">评论</div>
    <div class="comment-list" id="comments_${t.id}">加载中...</div>
    <div class="comment-input">
      <input placeholder="添加评论..." id="commentInput_${t.id}" />
      <button data-action="addComment">发送</button>
    </div>

    <!-- 分享（仅自己创建的任务） -->
    ${!t.shared ? `
    <div style="margin-top:8px;font-size:.8rem;color:var(--text-secondary)">分享给其他用户</div>
    <div class="share-row">
      <input placeholder="输入用户名..." id="shareInput_${t.id}" />
      <button data-action="share">分享</button>
    </div>
    ` : ''}
  `;
}

function bindDetailEvents(div, t) {
  const subtasks = JSON.parse(t.subtasks || '[]');

  div.querySelector('[data-action="addSub"]')?.addEventListener('click', async () => {
    const inp = document.getElementById('subInput_' + t.id);
    if (!inp || !inp.value.trim()) return;
    subtasks.push({ text: inp.value.trim(), done: false });
    await updateTodoField(t.id, { subtasks });
    inp.value = '';
  });

  div.querySelectorAll('[data-action="toggleSub"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.subtask-row');
      const i = parseInt(row.dataset.sidx);
      subtasks[i].done = !subtasks[i].done;
      await updateTodoField(t.id, { subtasks });
    });
  });

  div.querySelectorAll('[data-action="delSub"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.subtask-row');
      const i = parseInt(row.dataset.sidx);
      subtasks.splice(i, 1);
      await updateTodoField(t.id, { subtasks });
    });
  });

  div.querySelector('[data-action="saveNote"]')?.addEventListener('click', async () => {
    const ta = document.getElementById('noteInput_' + t.id);
    await updateTodoField(t.id, { note: ta.value });
  });

  div.querySelector('[data-action="addComment"]')?.addEventListener('click', async () => {
    const inp = document.getElementById('commentInput_' + t.id);
    if (!inp || !inp.value.trim()) return;
    try {
      await api(`/api/todos/${t.id}/comments`, { method:'POST', body:JSON.stringify({ text: inp.value.trim() }) });
      inp.value = '';
      loadComments(t.id);
    } catch(err) { alert(err.message); }
  });

  div.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
    const inp = document.getElementById('shareInput_' + t.id);
    if (!inp || !inp.value.trim()) return;
    try {
      await api(`/api/todos/${t.id}/share`, { method:'POST', body:JSON.stringify({ username: inp.value.trim() }) });
      inp.value = '';
      alert('分享成功');
    } catch(err) { alert(err.message); }
  });

  // 加载评论
  loadComments(t.id);
}

async function updateTodoField(id, fields) {
  try {
    const updated = await api(`/api/todos/${id}`, { method:'PUT', body:JSON.stringify(fields) });
    const idx = todos.findIndex(t => t.id === id);
    if (idx >= 0) todos[idx] = updated;
    render();
  } catch(err) { alert(err.message); }
}

async function loadComments(todoId) {
  const container = document.getElementById('comments_' + todoId);
  if (!container) return;
  try {
    const comments = await api(`/api/todos/${todoId}/comments`);
    container.innerHTML = comments.map(c => `
      <div class="comment-item">
        <span class="comment-user">${esc(c.username)}</span>
        <span class="comment-time">${c.created_at}</span>
        ${c.user_id === currentUser.id || isAdmin ? `<button class="comment-del" data-cid="${c.id}">删除</button>` : ''}
        <div>${esc(c.text)}</div>
      </div>
    `).join('');
    container.querySelectorAll('.comment-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await api(`/api/comments/${btn.dataset.cid}`, { method:'DELETE' }); loadComments(todoId); }
        catch(err) { alert(err.message); }
      });
    });
    if (comments.length === 0) container.innerHTML = '<div style="color:var(--text-secondary);font-size:.78rem">暂无评论</div>';
  } catch { container.innerHTML = ''; }
}

function toggleExpand(id) {
  expandedId = expandedId === id ? null : id;
  render();
}

// ===== Todo 操作 =====
async function addTodo() {
  const title = document.getElementById('inputTitle').value.trim();
  if (!title) return;
  const due = document.getElementById('inputDue').value;
  const tag = document.getElementById('inputTag').value;
  const repeat = document.getElementById('inputRepeat').value;
  try {
    const todo = await api('/api/todos', { method:'POST', body:JSON.stringify({ title, due, priority, tag: tag||null, repeat: repeat||null }) });
    todos.unshift(todo);
    document.getElementById('inputTitle').value = '';
    document.getElementById('inputDue').value = '';
    document.getElementById('inputTitle').focus();
    render();
  } catch(err) { alert(err.message); }
}

async function toggleTodo(id) {
  const t = todos.find(t => t.id === id);
  if (!t || t.shared) return;
  if (t.repeat && !t.done) {
    // 完成重复任务，生成下一个
    try {
      const result = await api(`/api/todos/${id}/complete`, { method:'POST' });
      const idx = todos.findIndex(x => x.id === id);
      if (idx >= 0) todos[idx] = result.done;
      todos.unshift(result.next);
      render();
    } catch(err) { alert(err.message); }
    return;
  }
  try {
    const updated = await api(`/api/todos/${id}`, { method:'PUT', body:JSON.stringify({ done: t.done?0:1 }) });
    const idx = todos.findIndex(x => x.id === id);
    if (idx >= 0) todos[idx] = updated;
    render();
  } catch(err) { alert(err.message); }
}

function startEdit(id) { editingId = id; expandedId = null; render(); }

async function saveEdit(id) {
  const inp = document.querySelector('.edit-input');
  if (!inp) return;
  const title = inp.value.trim();
  if (!title) return;
  try {
    const updated = await api(`/api/todos/${id}`, { method:'PUT', body:JSON.stringify({ title }) });
    const idx = todos.findIndex(t => t.id === id);
    if (idx >= 0) todos[idx] = updated;
    editingId = null; render();
  } catch(err) { alert(err.message); }
}

async function deleteTodo(id) {
  if (!confirm('确定删除此任务吗？')) return;
  try {
    await api(`/api/todos/${id}`, { method:'DELETE' });
    todos = todos.filter(t => t.id !== id);
    editingId = null; expandedId = null; render();
  } catch(err) { alert(err.message); }
}

async function clearDone() {
  const ids = todos.filter(t => t.done).map(t => t.id);
  for (const id of ids) await api(`/api/todos/${id}`, { method:'DELETE' });
  todos = todos.filter(t => !t.done); render();
}

// ===== 拖拽排序 =====
let dragId = null;
function dragStart(e) {
  dragId = parseInt(this.dataset.id);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function dragOver(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}
function dragLeave(e) { this.classList.remove('drag-over'); }
async function drop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('dragging'));
  const targetId = parseInt(this.dataset.id);
  if (!dragId || dragId === targetId || !this.closest('#todoList')) return;

  const dragIdx = todos.findIndex(t => t.id === dragId);
  const targetIdx = todos.findIndex(t => t.id === targetId);
  if (dragIdx < 0 || targetIdx < 0) return;

  // 计算新的 sort_order
  const dragged = todos.splice(dragIdx, 1)[0];
  todos.splice(targetIdx, 0, dragged);

  // 分配 sort_order
  for (let i = 0; i < todos.length; i++) {
    if (!todos[i].shared) todos[i].sort_order = i;
  }

  render();

  // 更新服务器
  const moved = todos.find(t => t.id === dragId);
  if (moved && !moved.shared) {
    try { await api(`/api/todos/${dragId}`, { method:'PUT', body:JSON.stringify({ sort_order: moved.sort_order }) }); }
    catch { loadTodos(); }
  }
  dragId = null;
}

// ===== 通知 =====
function setupNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(checkNotifications, 30000); // 30秒
  checkNotifications();
}

function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  todos.forEach(t => {
    if (t.done || !t.due) return;
    const dueDate = new Date(t.due);
    dueDate.setHours(0, 0, 0, 0);
    const diff = dueDate - now;
    if (diff > 0 && diff < 10 * 60 * 1000) { // 10分钟内
      new Notification('Todo 提醒', { body: `任务即将截止: ${t.title}`, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📋</text></svg>' });
    }
  });
}

// ===== 导出 =====
document.getElementById('btnExportJSON').addEventListener('click', () => {
  const data = todos.map(t => ({
    title: t.title, due: t.due, done: !!t.done, priority: t.priority,
    tag: t.tag, note: t.note, created_at: t.created_at,
    subtasks: JSON.parse(t.subtasks || '[]'), repeat: t.repeat
  }));
  download('todos.json', JSON.stringify(data, null, 2));
});

document.getElementById('btnExportCSV').addEventListener('click', () => {
  const header = '标题,截止日期,已完成,优先级,标签,备注,创建时间';
  const rows = todos.map(t =>
    [escCSV(t.title), t.due||'', t.done?'是':'否', ['低','中','高'][t.priority||1], TAG_NAMES[t.tag]||'', escCSV(t.note||''), t.created_at].join(',')
  );
  download('todos.csv', '﻿' + header + '\n' + rows.join('\n'));
});

function download(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

// ===== 管理员 =====
function buildAdminPanel() {
  document.getElementById('adminArea').innerHTML = `
    <details class="admin-panel">
      <summary>用户管理</summary>
      <div class="admin-content" id="adminContent"><p>加载中...</p></div>
    </details>
  `;
  loadAdminPanel();
}

async function loadAdminPanel() {
  try {
    const data = await api('/api/admin/users');
    document.getElementById('adminContent').innerHTML = `
      <p style="margin-bottom:10px;color:var(--text-secondary)">共 <strong>${data.user_count}</strong> 位用户</p>
      <table>
        <thead><tr><th>用户名</th><th>角色</th><th>Todo</th><th>已完成</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>${data.users.map(u => `
          <tr><td>${esc(u.username)}${u.id===currentUser.id?' (你)':''}</td>
          <td>${u.is_admin?'管理员':'用户'}</td>
          <td>${u.todos_total}</td><td>${u.todos_done}</td><td>${u.created_at}</td>
          <td>
            ${!u.is_admin?`<button class="promote-btn" data-promote="${esc(u.username)}">提升</button>`:''}
            ${u.id!==currentUser.id?`<button class="del-user-btn" data-deluser="${u.id}" data-delname="${esc(u.username)}">删除</button>`:''}
          </td></tr>
        `).join('')}</tbody>
      </table>
    `;
    document.querySelectorAll('[data-promote]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await api('/api/admin/promote',{method:'POST',body:JSON.stringify({username:b.dataset.promote})}); alert(r.message); loadAdminPanel(); }
      catch(err) { alert(err.message); }
    }));
    document.querySelectorAll('[data-deluser]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`确定删除用户 "${b.dataset.delname}" 吗？`)) return;
      try { await api(`/api/admin/users/${b.dataset.deluser}`,{method:'DELETE'}); loadAdminPanel(); }
      catch(err) { alert(err.message); }
    }));
  } catch {}
}

// ===== 工具 =====
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escCSV(s) { return '"' + (s||'').replace(/"/g,'""') + '"'; }
function renderStats() {
  const rem = todos.filter(t => !t.done).length;
  document.getElementById('stats').style.display = todos.length > 0 ? 'flex' : 'none';
  document.getElementById('remainingText').textContent = `${rem} 项未完成`;
}

// ===== 事件 =====
document.getElementById('btnAdd').addEventListener('click', addTodo);
document.getElementById('inputTitle').addEventListener('keydown', e => { if (e.key==='Enter') addTodo(); });
document.getElementById('btnClearDone').addEventListener('click', clearDone);

// ===== 启动 =====
init();

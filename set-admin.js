// 用法: node set-admin.js <用户名>
const db = require('./database');
const username = process.argv[2];

if (!username) {
  console.log('用法: node set-admin.js <用户名>');
  console.log('示例: node set-admin.js zhang san');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
if (!user) {
  console.log(`用户 "${username}" 不存在`);
  process.exit(1);
}

db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
console.log(`已将 "${username}" 提升为管理员`);

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'db.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); }
  catch { return { users: [], todos: [], _nextId: 1 }; }
}

function save(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data), 'utf8');
}

function now() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0') + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0') + ':' +
    String(d.getSeconds()).padStart(2,'0');
}

// 解析 WHERE 子句: col=? AND col=?
function parseWhere(whereStr) {
  if (!whereStr) return { conditions: [], paramCount: 0 };
  const conditions = [];
  let paramCount = 0;
  const parts = whereStr.split(/\s+AND\s+/i);
  for (const part of parts) {
    // col = ?  or  col = value
    const m = part.trim().match(/^(\w+)\s*(=|!=|>|<|>=|<=)\s*(.+)$/);
    if (m) {
      const [, col, op, rawVal] = m;
      let val = rawVal;
      if (rawVal === '?') { val = '__PARAM__'; paramCount++; }
      conditions.push({ col, op, val, isParam: rawVal === '?' });
    }
  }
  return { conditions, paramCount };
}

function matchAll(row, conditions, params) {
  let pi = 0;
  for (const c of conditions) {
    const actual = c.isParam ? params[pi++] : c.val;
    switch (c.op) {
      case '=': if (row[c.col] != actual) return false; break;
      case '!=': if (row[c.col] == actual) return false; break;
      case '>': if (!(row[c.col] > actual)) return false; break;
      case '<': if (!(row[c.col] < actual)) return false; break;
      case '>=': if (!(row[c.col] >= actual)) return false; break;
      case '<=': if (!(row[c.col] <= actual)) return false; break;
    }
  }
  return true;
}

function queryAll(table, whereStr, orderCol, orderDir, limitCount, params) {
  const data = load();
  let rows = data[table] || [];
  if (whereStr) {
    const { conditions } = parseWhere(whereStr);
    rows = rows.filter(r => matchAll(r, conditions, params));
  }
  if (orderCol) {
    rows.sort((a, b) => {
      if (a[orderCol] < b[orderCol]) return orderDir === 'DESC' ? 1 : -1;
      if (a[orderCol] > b[orderCol]) return orderDir === 'DESC' ? -1 : 1;
      return 0;
    });
  }
  if (limitCount) rows = rows.slice(0, limitCount);
  return rows;
}

function queryOne(table, whereStr, params) {
  const rows = queryAll(table, whereStr, null, 'ASC', 1, params);
  return rows[0] || undefined;
}

function insert(table, row) {
  const data = load();
  if (!data[table]) data[table] = [];
  row.id = data._nextId++;
  if (!row.created_at) row.created_at = now();
  data[table].push(row);
  save(data);
  return { lastInsertRowid: row.id, changes: 1 };
}

function update(table, sets, whereStr, params) {
  const data = load();
  let changes = 0;
  const { conditions } = parseWhere(whereStr);
  for (const row of data[table]) {
    if (matchAll(row, conditions, params)) {
      Object.assign(row, sets);
      changes++;
    }
  }
  save(data);
  return { changes };
}

function remove(table, whereStr, params) {
  const data = load();
  const before = data[table].length;
  const { conditions } = parseWhere(whereStr);
  data[table] = data[table].filter(r => !matchAll(r, conditions, params));
  save(data);
  return { changes: before - data[table].length };
}

// ========== SQL 语句统一解析 ==========
function parseSQL(sql) {
  sql = sql.trim().replace(/\s+/g, ' ');

  // SELECT
  let m = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?)?(?:\s+LIMIT\s+(\d+))?$/i);
  if (m) {
    const [, cols, table, whereStr, orderCol, orderDir, limitStr] = m;
    const colList = cols.split(',').map(s => s.trim());

    // COUNT(*) as alias
    const countMatch = cols.match(/^COUNT\(\*\)\s+as\s+(\w+)$/i);
    if (countMatch) {
      const alias = countMatch[1];
      return {
        type: 'SELECT',
        table,
        special: 'COUNT',
        alias,
        whereStr,
        params: (whereStr || '').split('?').length - 1,
      };
    }

    return {
      type: 'SELECT',
      table,
      colList,
      whereStr,
      orderCol: orderCol || null,
      orderDir: orderDir || 'ASC',
      limit: limitStr ? parseInt(limitStr) : null,
      params: (whereStr || '').split('?').length - 1,
    };
  }

  // INSERT INTO table (c1, c2, ...) VALUES (v1, v2, ...)
  m = sql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)$/i);
  if (m) {
    const [, table, colsStr, valsStr] = m;
    const cols = colsStr.split(',').map(s => s.trim());
    const vals = valsStr.split(',').map(s => s.trim());
    return { type: 'INSERT', table, cols, vals };
  }

  // UPDATE table SET c1=v1, c2=v2, ... WHERE ...
  m = sql.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
  if (m) {
    const [, table, setStr, whereStr] = m;
    const sets = {};
    let pi = 0;
    setStr.split(',').forEach(s => {
      const [col, val] = s.split('=').map(x => x.trim());
      sets[col] = val === '?' ? `__P${pi++}__` : val;
    });
    return { type: 'UPDATE', table, sets, whereStr, params: (whereStr || '').split('?').length - 1 };
  }

  // DELETE FROM table WHERE ...
  m = sql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)$/i);
  if (m) {
    const [, table, whereStr] = m;
    return { type: 'DELETE', table, whereStr, params: (whereStr || '').split('?').length - 1 };
  }

  return { type: 'UNKNOWN' };
}

// ========== 导出兼容接口 ==========
const db = {
  prepare(sql) {
    const parsed = parseSQL(sql);
    return {
      get(...params) {
        if (parsed.type !== 'SELECT') return undefined;
        if (parsed.special === 'COUNT') {
          const rows = queryAll(parsed.table, parsed.whereStr, null, 'ASC', null, params);
          const r = {};
          r[parsed.alias] = rows.length;
          return r;
        }
        return queryOne(parsed.table, parsed.whereStr, params);
      },
      all(...params) {
        if (parsed.type !== 'SELECT') return [];
        if (parsed.special === 'COUNT') {
          const rows = queryAll(parsed.table, parsed.whereStr, null, 'ASC', null, params);
          const r = {};
          r[parsed.alias] = rows.length;
          return [r];
        }
        return queryAll(parsed.table, parsed.whereStr, parsed.orderCol, parsed.orderDir, parsed.limit, params);
      },
      run(...params) {
        if (parsed.type === 'INSERT') {
          const row = {};
          let pi = 0;
          parsed.cols.forEach((col, i) => {
            const v = parsed.vals[i];
            row[col] = v === '?' ? params[pi++] : isNaN(v) ? v : Number(v);
          });
          return insert(parsed.table, row);
        }
        if (parsed.type === 'UPDATE') {
          const sets = {};
          let pi = 0;
          for (const [col, val] of Object.entries(parsed.sets)) {
            sets[col] = val.startsWith('__P') ? params[pi++] : (isNaN(val) ? val : Number(val));
          }
          return update(parsed.table, sets, parsed.whereStr, params.slice(pi));
        }
        if (parsed.type === 'DELETE') {
          return remove(parsed.table, parsed.whereStr, params);
        }
        return { changes: 0 };
      },
    };
  },
};

module.exports = db;

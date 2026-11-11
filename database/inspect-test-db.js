
const Database = require('better-sqlite3');

const db = new Database(
  './test-product-edit-1794389550699.db',
  { readonly: true }
);

try {
  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  console.log('\nWORKFLOWOS DATABASE TABLES\n');

  for (const table of tables) {
    const count = db.prepare(
      `SELECT COUNT(*) AS total FROM "${table.name}"`
    ).get().total;

    console.log(`${table.name}: ${count} records`);
  }
} finally {
  db.close();
}

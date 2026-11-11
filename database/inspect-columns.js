
const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database(
  './test-product-edit-1794389550699.db',
  { readonly: true }
);

const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

const result = {};

for (const { name } of tables) {
  result[name] = {
    columns: db.pragma(`table_info("${name}")`),
    foreignKeys: db.pragma(`foreign_key_list("${name}")`),
    indexes: db.pragma(`index_list("${name}")`)
  };
}

fs.writeFileSync(
  './workflowos-column-details.json',
  JSON.stringify(result, null, 2)
);

console.log('Column inspection completed.');
console.log('Tables inspected:', tables.length);

db.close();

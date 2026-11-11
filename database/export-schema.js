
const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database(
  './test-product-edit-1794389550699.db',
  { readonly: true }
);

const schema = db.prepare(`
  SELECT type, name, tbl_name, sql
  FROM sqlite_master
  WHERE sql IS NOT NULL
    AND name NOT LIKE 'sqlite_%'
  ORDER BY type, tbl_name, name
`).all();

fs.writeFileSync(
  './workflowos-schema.json',
  JSON.stringify(schema, null, 2),
  'utf8'
);

console.log('Schema exported successfully.');
console.log('Objects exported:', schema.length);

db.close();

const Database = require('better-sqlite3');

const db = new Database(
  './test-product-edit-1794389550699.db',
  { readonly: true }
);

for (const table of ['businesses', 'inventory']) {
  console.log(`\n--- ${table.toUpperCase()} ---`);

  const columns = db.pragma(`table_info("${table}")`);

  console.table(columns.map(column => ({
    name: column.name,
    type: column.type,
    notnull: column.notnull,
    default: column.dflt_value,
    primaryKey: column.pk
  })));
}

db.close();
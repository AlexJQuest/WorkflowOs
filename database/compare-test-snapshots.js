
const Database = require('better-sqlite3');
const path = require('node:path');

const sources = [
  'test-1794389548744.db',
  'test-business-data-1794389549172.db',
  'test-catalogue-1794389549591.db',
  'test-dashboard-1794389550109.db',
  'test-product-edit-1794389550699.db'
];

const databases = sources.map(filename => {
  const db = new Database(path.join(__dirname, filename), {
    readonly: true
  });

  return { filename, db };
});

function getTables(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function getPrimaryKey(db, table) {
  return db.pragma(`table_info("${table}")`)
    .filter(column => column.pk)
    .sort((a, b) => a.pk - b.pk)
    .map(column => column.name);
}

function rowKey(row, primaryKey) {
  if (!primaryKey.length) return JSON.stringify(row);

  return JSON.stringify(
    primaryKey.map(column => row[column])
  );
}

try {
  console.log('\nWORKFLOWOS FINAL SNAPSHOT COMPARISON\n');

  const allTables = new Set();

  for (const source of databases) {
    for (const table of getTables(source.db)) {
      allTables.add(table);
    }
  }

  for (const table of [...allTables].sort()) {
    console.log(`\n========== ${table} ==========`);

    const seen = new Map();

    for (const source of databases) {
      const tables = getTables(source.db);

      if (!tables.includes(table)) continue;

      const rows = source.db.prepare(
        `SELECT * FROM "${table}"`
      ).all();

      const primaryKey = getPrimaryKey(source.db, table);

      console.log(`${source.filename}: ${rows.length} records`);

      for (const row of rows) {
        const key = rowKey(row, primaryKey);
        const content = JSON.stringify(row);

        if (!seen.has(key)) {
          seen.set(key, {
            content,
            sources: [source.filename]
          });
          continue;
        }

        const previous = seen.get(key);

        if (!previous.sources.includes(source.filename)) {
          previous.sources.push(source.filename);
        }

        if (previous.content !== content) {
          console.log('\n  PRIMARY KEY CONFLICT');
          console.log('  Key:', key);
          console.log('  First version:', previous.sources[0]);
          console.log('  Conflicting version:', source.filename);
          console.log('  First row:', previous.content);
          console.log('  Other row:', content);
        }
      }
    }

    console.log('Distinct primary keys:', seen.size);
  }

  console.log('\nCOMPARISON COMPLETE');
} finally {
  for (const source of databases) {
    source.db.close();
  }
}

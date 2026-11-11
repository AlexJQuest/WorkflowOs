
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = __dirname;

function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function inspectDatabase(filename) {
  const fullPath = path.join(directory, filename);
  const db = new Database(fullPath, { readonly: true });

  try {
    const tables = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    const tableData = {};
    const counts = {};

    for (const table of tables) {
      const rows = db.prepare(
        `SELECT * FROM "${table.name.replace(/"/g, '""')}"`
      ).all();

      counts[table.name] = rows.length;

      tableData[table.name] = rows
        .map(row => JSON.stringify(row))
        .sort();
    }

    const schemaFingerprint = fingerprint(
      tables.map(table => ({
        name: table.name,
        sql: table.sql
      }))
    );

    const dataFingerprint = fingerprint(tableData);

    const totalRecords = Object.values(counts)
      .reduce((sum, count) => sum + count, 0);

    return {
      filename,
      totalRecords,
      tableCount: tables.length,
      counts,
      schemaFingerprint,
      dataFingerprint
    };
  } finally {
    db.close();
  }
}

const files = fs.readdirSync(directory)
  .filter(name =>
    /\.(db|sqlite|sqlite3)$/i.test(name) &&
    name !== 'dev.db'
  )
  .sort();

const results = files.map(inspectDatabase);

console.log('\nWORKFLOWOS TEST DATABASE AUDIT\n');

for (const result of results) {
  console.log(`\n${result.filename}`);
  console.log(`Tables: ${result.tableCount}`);
  console.log(`Total records: ${result.totalRecords}`);

  console.log(
    Object.entries(result.counts)
      .map(([table, count]) => `  ${table}: ${count}`)
      .join('\n')
  );
}

const groups = new Map();

for (const result of results) {
  const key = result.dataFingerprint;

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(result.filename);
}

console.log('\n\nIDENTICAL DATA GROUPS\n');

for (const [hash, filenames] of groups) {
  if (filenames.length > 1) {
    console.log(filenames.join('\n  = '));
    console.log('');
  }
}

console.log('\nAUDIT SUMMARY');
console.log('Database files:', results.length);
console.log(
  'Unique data sets:',
  groups.size
);
console.log('\nAudit complete.');

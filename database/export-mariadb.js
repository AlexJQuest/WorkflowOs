
const Database = require('better-sqlite3');
const fs = require('fs');

const SOURCE = 'test-product-edit-1794388470413.db';
const OUTPUT = './workflowos-mariadb-import1.sql';

const db = new Database(SOURCE, { readonly: true });

const quoteId = value => `\`${String(value).replace(/`/g, '``')}\``;

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric value');
    return String(value);
  }

  if (typeof value === 'bigint') return String(value);

  if (Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }

  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function getTables() {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function getIndexes(table) {
  return db.pragma(`index_list("${table}")`);
}

function getIndexColumns(indexName) {
  return db.pragma(`index_info("${indexName}")`)
    .sort((a, b) => a.seqno - b.seqno)
    .map(column => column.name);
}

function getForeignKeys(table) {
  const rows = db.pragma(`foreign_key_list("${table}")`);
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  }

  return [...groups.values()];
}

function getColumnType(column, indexedColumns) {
  const name = column.name;
  const type = String(column.type).toUpperCase();

  if (column.pk && type.includes('INT')) {
    return 'INT NOT NULL AUTO_INCREMENT';
  }

  if (type.includes('INT')) return 'BIGINT';
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) {
    return 'DOUBLE';
  }
  if (type.includes('BLOB')) return 'LONGBLOB';

  if (indexedColumns.has(name)) {
    if (name === 'email') return 'VARCHAR(254)';
    if (name === 'id' && column.type === 'TEXT') return 'VARCHAR(255)';
    if (name === 'version') return 'VARCHAR(191)';
    if (name === 'checksum') return 'VARCHAR(191)';
    return 'VARCHAR(191)';
  }

  if (/_at$/.test(name)) return 'VARCHAR(40)';
  return 'LONGTEXT';
}

function getDefault(value) {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();

  if (raw === 'CURRENT_TIMESTAMP') return ' DEFAULT CURRENT_TIMESTAMP';

  if (/^-?\d+(\.\d+)?$/.test(raw)) return ` DEFAULT ${raw}`;

  if (raw.startsWith("'") && raw.endsWith("'")) {
    return ` DEFAULT ${sqlValue(raw.slice(1, -1))}`;
  }

  return '';
}

function createTable(table) {
  const columns = db.pragma(`table_info("${table}")`);
  const indexes = getIndexes(table);

  const indexedColumns = new Set();

  for (const index of indexes) {
    for (const name of getIndexColumns(index.name)) {
      if (name) indexedColumns.add(name);
    }
  }

  const definitions = columns.map(column => {
    const type = getColumnType(column, indexedColumns);

    if (column.pk && String(column.type).toUpperCase().includes('INT')) {
      return `${quoteId(column.name)} ${type}`;
    }

    let definition = `${quoteId(column.name)} ${type}`;

    if (column.notnull) definition += ' NOT NULL';

    definition += getDefault(column.dflt_value);

    return definition;
  });

  const primaryKey = columns.filter(column => column.pk)
    .sort((a, b) => a.pk - b.pk)
    .map(column => quoteId(column.name));

  if (primaryKey.length) {
    definitions.push(`PRIMARY KEY (${primaryKey.join(', ')})`);
  }

  // Preserve table-level unique constraints.
  for (const index of indexes.filter(item => item.origin === 'u')) {
    const names = getIndexColumns(index.name);
    if (names.length) {
      definitions.push(
        `UNIQUE KEY ${quoteId(index.name)} (${names.map(quoteId).join(', ')})`
      );
    }
  }

  // MariaDB equivalents for SQLite partial unique indexes.
  if (table === 'products') {
    definitions.push(
      '`barcode_unique` VARCHAR(191) GENERATED ALWAYS AS ' +
      '(CASE WHEN `barcode` IS NOT NULL AND `barcode` <> ' +
      "'' THEN `barcode` ELSE NULL END) STORED"
    );
  }

  if (table === 'sales') {
    definitions.push(
      '`idempotency_key_unique` VARCHAR(191) GENERATED ALWAYS AS ' +
      '(`idempotency_key`) STORED'
    );
  }

  return `CREATE TABLE ${quoteId(table)} (\n  ${
    definitions.join(',\n  ')
  }\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n`;
}

function createIndexes(table) {
  const statements = [];

  for (const index of getIndexes(table)) {
    if (index.origin === 'pk' || index.origin === 'u') continue;

    const columns = getIndexColumns(index.name);
    if (!columns.length) continue;

    // This partial index is redundant: another full unique index
    // already guarantees uniqueness of product_barcodes.barcode.
    if (index.name === 'idx_product_barcodes_verified_unique') continue;

    if (index.name === 'idx_products_business_barcode_unique') {
      statements.push(
        'CREATE UNIQUE INDEX `idx_products_business_barcode_unique` ' +
        'ON `products` (`business_id`, `barcode_unique`);'
      );
      continue;
    }

    if (index.name === 'idx_sales_business_idempotency') {
      statements.push(
        'CREATE UNIQUE INDEX `idx_sales_business_idempotency` ' +
        'ON `sales` (`business_id`, `idempotency_key_unique`);'
      );
      continue;
    }

    const unique = index.unique ? 'UNIQUE ' : '';
    statements.push(
      `CREATE ${unique}INDEX ${quoteId(index.name)} ON ${quoteId(table)} ` +
      `(${columns.map(quoteId).join(', ')});`
    );
  }

  return statements.join('\n');
}

function createForeignKeys(table) {
  const statements = [];

  for (const group of getForeignKeys(table)) {
    const first = group[0];

    const from = group
      .sort((a, b) => a.seq - b.seq)
      .map(row => quoteId(row.from));

    const to = group
      .sort((a, b) => a.seq - b.seq)
      .map(row => quoteId(row.to));

    const constraintName =
      `fk_${table}_${first.id}`;

    statements.push(
      `ALTER TABLE ${quoteId(table)} ADD CONSTRAINT ${quoteId(constraintName)} ` +
      `FOREIGN KEY (${from.join(', ')}) REFERENCES ${quoteId(first.table)} ` +
      `(${to.join(', ')}) ON UPDATE RESTRICT ON DELETE RESTRICT;`
    );
  }

  return statements.join('\n');
}

try {
  const tables = getTables();
  const sections = [];

  sections.push('-- WorkflowOS SQLite to MariaDB export');
  sections.push('-- Source: test-product-edit-1794389550699.db');
  sections.push('SET NAMES utf8mb4;');
  sections.push('SET FOREIGN_KEY_CHECKS = 0;');
  sections.push('');

  // Create all tables first.
  for (const table of tables) {
    sections.push(createTable(table));
  }

  // Export all existing records with their original IDs.
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${quoteId(table)}`).all();
    const columns = db.pragma(`table_info("${table}")`)
      .map(column => column.name);

    sections.push(`-- Data: ${table}`);

    for (const row of rows) {
      const names = columns.map(quoteId).join(', ');
      const values = columns.map(name => sqlValue(row[name])).join(', ');

      sections.push(
        `INSERT INTO ${quoteId(table)} (${names}) VALUES (${values});`
      );
    }

    sections.push('');
  }

  // Create indexes after data has been inserted.
  for (const table of tables) {
    const indexes = createIndexes(table);
    if (indexes) sections.push(indexes);
  }

  // Add foreign keys after all referenced records exist.
  for (const table of tables) {
    const foreignKeys = createForeignKeys(table);
    if (foreignKeys) sections.push(foreignKeys);
  }

  sections.push('');
  sections.push('SET FOREIGN_KEY_CHECKS = 1;');

  fs.writeFileSync(OUTPUT, sections.join('\n'), 'utf8');

  const counts = tables.map(table => ({
    table,
    records: db.prepare(`SELECT COUNT(*) AS total FROM ${quoteId(table)}`).get().total
  }));

  console.log('\nEXPORT CREATED');
  console.table(counts);
  console.log('Tables:', tables.length);
  console.log('Records:', counts.reduce((sum, row) => sum + row.records, 0));
  console.log('File:', OUTPUT);
} finally {
  db.close();
}

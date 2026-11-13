const db = require('../src/api/database');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';
const PRODUCTION_HOST = 'workflowos-test-made-rapid.bulrush.cloud.layerbase.dev';

const root = path.resolve(__dirname, '..');
const exportDirectory = path.join(root, 'database', 'exports');

function log(message) {
  console.log(`[REPAIR] ${message}`);
}

function stop(message) {
  throw new Error(message);
}

async function rows(connection, sql, params = []) {
  const [result] = await connection.execute(sql, params);
  return result;
}

async function scalar(connection, sql) {
  const result = await rows(connection, sql);
  return Number(result[0].count);
}

async function verifySafety(connection) {
  const host = process.env.TEST_DB_HOST;
  const result = await rows(connection, 'SELECT DATABASE() AS db');

  if (host === PRODUCTION_HOST) {
    stop('SAFETY STOP: production host detected.');
  }

  if (host !== EXPECTED_HOST) {
    stop(`SAFETY STOP: unexpected host: ${host}`);
  }

  if (result[0].db !== EXPECTED_DATABASE) {
    stop(`SAFETY STOP: expected ${EXPECTED_DATABASE}, connected to ${result[0].db}`);
  }

  if (process.env.CONFIRM_TEST_DB_REPAIR !== 'YES') {
    stop('Set CONFIRM_TEST_DB_REPAIR=YES in PowerShell to authorise this repair.');
  }

  if (!fs.existsSync(exportDirectory)) {
    stop('Backup directory does not exist.');
  }

  const backups = fs.readdirSync(exportDirectory)
    .filter(name =>
      name.startsWith('workflowos-workflowos_test-') &&
      name.endsWith('.sql')
    )
    .map(name => ({
      name,
      path: path.join(exportDirectory, name),
    }))
    .filter(file => fs.statSync(file.path).size > 0)
    .sort((a, b) =>
      fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs
    );

  if (backups.length === 0) {
    stop('No valid TEST database export found.');
  }

  const latestBackup = backups[0];
  const backupAge = Date.now() - fs.statSync(latestBackup.path).mtimeMs;

  if (backupAge > 24 * 60 * 60 * 1000) {
    stop('Latest backup is older than 24 hours. Export the TEST database again.');
  }

  log(`Connected to ${result[0].db}`);
  log(`Host verified: ${host}`);
  log(`Backup verified: ${latestBackup.name}`);
}

async function verifyTables(connection) {
  const expected = [
    'users',
    'businesses',
    'business_memberships',
    'business_settings',
    'customers',
    'global_product_catalogue',
    'sessions',
    'products',
    'product_barcodes',
    'sales',
    'sale_items',
    'inventory',
    'inventory_movements',
  ];

  const existing = await rows(connection, `
    SELECT TABLE_NAME, ENGINE
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);

  const tableMap = new Map(existing.map(item => [item.TABLE_NAME, item.ENGINE]));

  for (const table of expected) {
    if (!tableMap.has(table)) {
      stop(`Required table is missing: ${table}`);
    }

    if (tableMap.get(table) !== 'InnoDB') {
      stop(`${table} is not using InnoDB.`);
    }
  }
}

// ------------------------------------------------------------
// 1. DEDUPLICATE EXACT COPIES
// ------------------------------------------------------------

async function deduplicateTable(connection, table, logicalDuplicateCheck) {
  const temporary = `tmp_repair_${table}`;

  log(`Checking duplicate records in ${table}`);

  await connection.query(`DROP TEMPORARY TABLE IF EXISTS \`${temporary}\``);
  await connection.query(
    `CREATE TEMPORARY TABLE \`${temporary}\` LIKE \`${table}\``
  );

  await connection.query(`
    INSERT INTO \`${temporary}\`
    SELECT DISTINCT * FROM \`${table}\`
  `);

  const duplicateIDs = await rows(connection, `
    SELECT id, COUNT(*) AS copies
    FROM \`${temporary}\`
    GROUP BY id
    HAVING COUNT(*) > 1
    LIMIT 5
  `);

  if (duplicateIDs.length > 0) {
    stop(
      `${table} contains conflicting records with the same ID. ` +
      `No records were removed. Examples: ${JSON.stringify(duplicateIDs)}`
    );
  }

  if (logicalDuplicateCheck) {
    const logicalDuplicates = await rows(
      connection,
      logicalDuplicateCheck
    );

    if (logicalDuplicates.length > 0) {
      stop(
        `${table} contains conflicting logical duplicates. ` +
        `No records were removed. Examples: ${JSON.stringify(logicalDuplicates)}`
      );
    }
  }

  const before = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM \`${table}\``
  );

  const after = await scalar(
    connection,
    `SELECT COUNT(*) AS count FROM \`${temporary}\``
  );

  if (before !== after) {
    await connection.query(`DELETE FROM \`${table}\``);
    await connection.query(`
      INSERT INTO \`${table}\`
      SELECT * FROM \`${temporary}\`
    `);
  }

  await connection.query(`DROP TEMPORARY TABLE \`${temporary}\``);

  log(`${table}: ${before} rows before, ${after} after.`);
}

async function repairDuplicates(connection) {
  await connection.beginTransaction();

  try {
    await deduplicateTable(
      connection,
      'businesses',
      null
    );

    await deduplicateTable(
      connection,
      'business_memberships',
      `
        SELECT user_id, business_id, COUNT(*) AS copies
        FROM tmp_repair_business_memberships
        GROUP BY user_id, business_id
        HAVING COUNT(*) > 1
        LIMIT 5
      `
    );

    await deduplicateTable(
      connection,
      'business_settings',
      `
        SELECT business_id, COUNT(*) AS copies
        FROM tmp_repair_business_settings
        GROUP BY business_id
        HAVING COUNT(*) > 1
        LIMIT 5
      `
    );

    await deduplicateTable(
      connection,
      'customers',
      `
        SELECT business_id, email, COUNT(*) AS copies
        FROM tmp_repair_customers
        WHERE email IS NOT NULL
        GROUP BY business_id, email
        HAVING COUNT(*) > 1
        LIMIT 5
      `
    );

    await connection.commit();
    log('Duplicate cleanup committed.');
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

// ------------------------------------------------------------
// 2. RESTORE PRIMARY KEYS AND AUTO_INCREMENT
// ------------------------------------------------------------

async function repairPrimaryKeys(connection) {
  const tables = [
    'businesses',
    'business_memberships',
    'business_settings',
    'customers',
  ];

  for (const table of tables) {
    const definition = await rows(connection, `
      SELECT COLUMN_KEY, EXTRA, COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = 'id'
    `, [table]);

    if (definition.length !== 1) {
      stop(`Could not inspect ${table}.id`);
    }

    if (definition[0].COLUMN_KEY === 'PRI') {
      if (!definition[0].EXTRA.includes('auto_increment')) {
        await connection.query(`
          ALTER TABLE \`${table}\`
          MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT
        `);
      }
    } else {
      if (definition[0].COLUMN_KEY !== '') {
        stop(`${table}.id has an unexpected existing index definition.`);
      }

      await connection.query(`
        ALTER TABLE \`${table}\`
        MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
        ADD PRIMARY KEY (id)
      `);
    }

    log(`${table}.id: primary key and AUTO_INCREMENT verified.`);
  }
}

// ------------------------------------------------------------
// 3. NORMALISE FOREIGN KEY COLUMN TYPES
// ------------------------------------------------------------

async function normaliseRelationshipTypes(connection) {
  const columns = [
    ['businesses', 'owner_user_id', 'INT NOT NULL'],

    ['business_memberships', 'user_id', 'INT NOT NULL'],
    ['business_memberships', 'business_id', 'INT NOT NULL'],

    ['business_settings', 'business_id', 'INT NOT NULL'],
    ['customers', 'business_id', 'INT NOT NULL'],

    ['sessions', 'user_id', 'INT NOT NULL'],
    ['sessions', 'business_id', 'INT NULL'],

    ['products', 'business_id', 'INT NOT NULL'],
    ['products', 'global_catalogue_id', 'INT NULL'],

    ['sales', 'business_id', 'INT NOT NULL'],
    ['sales', 'customer_id', 'INT NULL'],

    ['sale_items', 'sale_id', 'INT NOT NULL'],
    ['sale_items', 'product_id', 'INT NOT NULL'],

    ['inventory', 'business_id', 'INT NOT NULL'],
    ['inventory', 'product_id', 'INT NOT NULL'],

    ['inventory_movements', 'business_id', 'INT NOT NULL'],
    ['inventory_movements', 'product_id', 'INT NOT NULL'],

    ['product_barcodes', 'global_product_id', 'INT NOT NULL'],
  ];

  for (const [table, column, definition] of columns) {
    const exists = await rows(connection, `
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `, [table, column]);

    if (exists.length !== 1) {
      stop(`Missing relationship column: ${table}.${column}`);
    }

    await connection.query(`
      ALTER TABLE \`${table}\`
      MODIFY COLUMN \`${column}\` ${definition}
    `);

    log(`${table}.${column} normalised.`);
  }
}

// ------------------------------------------------------------
// 4. RESTORE MISSING UNIQUE INDEXES
// ------------------------------------------------------------

async function hasUniqueIndex(connection, table, expectedColumns) {
  const indexes = await rows(connection, `
    SELECT
      INDEX_NAME,
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
  `, [table]);

  const expected = expectedColumns.join(',');

  return indexes.some(index => index.indexed_columns === expected);
}

async function repairUniqueIndexes(connection) {
  const indexes = [
    {
      table: 'business_memberships',
      name: 'uq_memberships_user_business',
      columns: ['user_id', 'business_id'],
    },
    {
      table: 'business_settings',
      name: 'uq_business_settings_business',
      columns: ['business_id'],
    },
    {
      table: 'customers',
      name: 'uq_customers_business_email',
      columns: ['business_id', 'email'],
    },
  ];

  for (const index of indexes) {
    if (await hasUniqueIndex(connection, index.table, index.columns)) {
      log(`Unique index already exists: ${index.table}`);
      continue;
    }

    await connection.query(`
      ALTER TABLE \`${index.table}\`
      ADD UNIQUE INDEX \`${index.name}\`
      (${index.columns.map(column => `\`${column}\``).join(', ')})
    `);

    log(`Created unique index: ${index.table}`);
  }
}

// ------------------------------------------------------------
// 5. REPAIR INVALID OPTIONAL CATALOGUE REFERENCES
// ------------------------------------------------------------

async function repairCatalogueReferences(connection) {
  const orphanCount = await scalar(connection, `
    SELECT COUNT(*) AS count
    FROM products p
    LEFT JOIN global_product_catalogue g
      ON g.id = p.global_catalogue_id
    WHERE p.global_catalogue_id IS NOT NULL
      AND g.id IS NULL
  `);

  if (orphanCount > 0) {
    log(`Clearing ${orphanCount} invalid optional catalogue references.`);

    await connection.query(`
      UPDATE products p
      LEFT JOIN global_product_catalogue g
        ON g.id = p.global_catalogue_id
      SET p.global_catalogue_id = NULL
      WHERE p.global_catalogue_id IS NOT NULL
        AND g.id IS NULL
    `);
  }

  log('Product records and their other fields have been preserved.');
}

// ------------------------------------------------------------
// 6. VERIFY ALL RELATIONSHIPS BEFORE ADDING FOREIGN KEYS
// ------------------------------------------------------------

const relationships = [
  ['businesses', 'owner_user_id', 'users', 'id'],
  ['business_memberships', 'user_id', 'users', 'id'],
  ['business_memberships', 'business_id', 'businesses', 'id'],
  ['business_settings', 'business_id', 'businesses', 'id'],
  ['sessions', 'user_id', 'users', 'id'],
  ['sessions', 'business_id', 'businesses', 'id'],
  ['products', 'business_id', 'businesses', 'id'],
  ['products', 'global_catalogue_id', 'global_product_catalogue', 'id'],
  ['customers', 'business_id', 'businesses', 'id'],
  ['sales', 'business_id', 'businesses', 'id'],
  ['sales', 'customer_id', 'customers', 'id'],
  ['sale_items', 'sale_id', 'sales', 'id'],
  ['sale_items', 'product_id', 'products', 'id'],
  ['inventory', 'business_id', 'businesses', 'id'],
  ['inventory', 'product_id', 'products', 'id'],
  ['inventory_movements', 'business_id', 'businesses', 'id'],
  ['inventory_movements', 'product_id', 'products', 'id'],
  ['product_barcodes', 'global_product_id', 'global_product_catalogue', 'id'],
];

async function verifyNoOrphans(connection) {
  for (const [childTable, childColumn, parentTable, parentColumn] of relationships) {
    const orphanCount = await scalar(connection, `
      SELECT COUNT(*) AS count
      FROM \`${childTable}\` c
      LEFT JOIN \`${parentTable}\` p
        ON p.\`${parentColumn}\` = c.\`${childColumn}\`
      WHERE p.\`${parentColumn}\` IS NULL
        AND c.\`${childColumn}\` IS NOT NULL
    `);

    if (orphanCount > 0) {
      stop(
        `Cannot create foreign key: ${childTable}.${childColumn} ` +
        `has ${orphanCount} orphan records.`
      );
    }
  }

  log('All relationship columns passed orphan checks.');
}

// ------------------------------------------------------------
// 7. CREATE FOREIGN KEYS
// ------------------------------------------------------------

async function repairForeignKeys(connection) {
  for (const [childTable, childColumn, parentTable, parentColumn] of relationships) {
    const existing = await rows(connection, `
      SELECT
        CONSTRAINT_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [childTable, childColumn]);

    if (existing.length > 0) {
      const correct = existing.some(fk =>
        fk.REFERENCED_TABLE_NAME === parentTable &&
        fk.REFERENCED_COLUMN_NAME === parentColumn
      );

      if (!correct) {
        stop(`Unexpected existing foreign key on ${childTable}.${childColumn}`);
      }

      log(`Foreign key already exists: ${childTable}.${childColumn}`);
      continue;
    }

    const constraintName =
      `fk_wos_${childTable}_${childColumn}`;

    await connection.query(`
      ALTER TABLE \`${childTable}\`
      ADD CONSTRAINT \`${constraintName}\`
      FOREIGN KEY (\`${childColumn}\`)
      REFERENCES \`${parentTable}\` (\`${parentColumn}\`)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
    `);

    log(`Created: ${childTable}.${childColumn} -> ${parentTable}.${parentColumn}`);
  }
}

// ------------------------------------------------------------
// MASTER EXECUTION
// ------------------------------------------------------------

async function main() {
  const connection = await db.getConnection();

  try {
    console.log('\n============================================');
    console.log(' WORKFLOWOS TEST RELATIONSHIP REPAIR');
    console.log('============================================\n');

    await verifySafety(connection);
    await verifyTables(connection);

    log('Starting duplicate cleanup.');
    await repairDuplicates(connection);

    log('Restoring primary keys.');
    await repairPrimaryKeys(connection);

    log('Normalising relationship column types.');
    await normaliseRelationshipTypes(connection);

    log('Restoring unique indexes.');
    await repairUniqueIndexes(connection);

    log('Repairing invalid catalogue references.');
    await repairCatalogueReferences(connection);

    log('Checking for remaining orphan records.');
    await verifyNoOrphans(connection);

    log('Creating foreign keys.');
    await repairForeignKeys(connection);

    log('Verifying final foreign-key count.');

    const finalKeys = await scalar(connection, `
      SELECT COUNT(*) AS count
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.log('\n============================================');
    console.log(' REPAIR COMPLETED');
    console.log('============================================');
    console.log(`Foreign-key relationships present: ${finalKeys}`);
    console.log('Database: workflowos_test');
    console.log('Host: TEST staging');
    console.log('============================================\n');
  } finally {
    connection.release();
    await db.end();
  }
}

main().catch(error => {
  console.error('\nREPAIR STOPPED:', error.message);
  process.exitCode = 1;
});
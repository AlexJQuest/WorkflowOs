const db = require('../src/api/database');

// ============================================================
// WORKFLOWOS - MASTER TEST DATABASE AUDIT
// READ ONLY: This script never changes database records/schema.
// ============================================================

const EXPECTED_DATABASE = 'workflowos_test';
const PRODUCTION_HOST = 'workflowos-test-made-rapid.bulrush.cloud.layerbase.dev';

const results = {
  passed: 0,
  issues: [],
  warnings: [],
};

function issue(section, message) {
  results.issues.push({ section, message });
}

function warning(section, message) {
  results.warnings.push({ section, message });
}

function pass() {
  results.passed++;
}

async function query(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function count(sql, params = []) {
  const rows = await query(sql, params);
  return Number(rows[0].count);
}

// ============================================================
// CHECK 1: DATABASE AND SCHEMA
// ============================================================

async function checkSchema() {
  const section = 'SCHEMA';

  const expectedTables = [
    'businesses',
    'business_memberships',
    'business_settings',
    'customers',
    'global_product_catalogue',
    'inventory',
    'inventory_movements',
    'products',
    'product_barcodes',
    'product_barcode_duplicate_archive',
    'sales',
    'sale_items',
    'schema_migrations',
    'sessions',
    'users',
  ];

  const tables = await query(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);

  const existingTables = new Set(tables.map(row => row.TABLE_NAME));

  for (const table of expectedTables) {
    if (!existingTables.has(table)) {
      issue(section, `Missing table: ${table}`);
    } else {
      pass();
    }
  }

  const primaryKeys = {
    users: 'id',
    businesses: 'id',
    business_memberships: 'id',
    business_settings: 'id',
    customers: 'id',
    global_product_catalogue: 'id',
    inventory: 'id',
    inventory_movements: 'id',
    products: 'id',
    product_barcodes: 'id',
    product_barcode_duplicate_archive: 'archive_id',
    sales: 'id',
    sale_items: 'id',
    schema_migrations: 'version',
    sessions: 'id',
  };

  const autoIncrementTables = [
    'users',
    'businesses',
    'business_memberships',
    'business_settings',
    'customers',
    'global_product_catalogue',
    'inventory',
    'inventory_movements',
    'products',
    'product_barcodes',
    'product_barcode_duplicate_archive',
    'sales',
    'sale_items',
  ];

  const columns = await query(`
    SELECT
      TABLE_NAME,
      COLUMN_NAME,
      COLUMN_KEY,
      EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  for (const [table, expectedPK] of Object.entries(primaryKeys)) {
    if (!existingTables.has(table)) continue;

    const column = columns.find(
      row =>
        row.TABLE_NAME === table &&
        row.COLUMN_NAME === expectedPK
    );

    if (!column || column.COLUMN_KEY !== 'PRI') {
      issue(
        section,
        `${table}.${expectedPK} is missing its PRIMARY KEY`
      );
    } else {
      pass();
    }

    if (autoIncrementTables.includes(table)) {
      if (!column || !column.EXTRA.includes('auto_increment')) {
        issue(
          section,
          `${table}.${expectedPK} is missing AUTO_INCREMENT`
        );
      } else {
        pass();
      }
    }
  }
}

// ============================================================
// CHECK 2: DUPLICATE RECORDS
// ============================================================

async function checkDuplicates() {
  const section = 'DUPLICATES';

  const checks = [
    {
      table: 'businesses',
      sql: `
        SELECT id, COUNT(*) AS duplicate_count
        FROM businesses
        GROUP BY id
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate business IDs',
    },
    {
      table: 'business_memberships',
      sql: `
        SELECT id, COUNT(*) AS duplicate_count
        FROM business_memberships
        GROUP BY id
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate membership IDs',
    },
    {
      table: 'business_settings',
      sql: `
        SELECT id, COUNT(*) AS duplicate_count
        FROM business_settings
        GROUP BY id
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate settings IDs',
    },
    {
      table: 'customers',
      sql: `
        SELECT id, COUNT(*) AS duplicate_count
        FROM customers
        GROUP BY id
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate customer IDs',
    },
    {
      table: 'business_memberships',
      sql: `
        SELECT user_id, business_id, COUNT(*) AS duplicate_count
        FROM business_memberships
        GROUP BY user_id, business_id
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate user/business memberships',
    },
    {
      table: 'business_settings',
      sql: `
        SELECT business_id, COUNT(*) AS duplicate_count
        FROM business_settings
        GROUP BY business_id
        HAVING COUNT(*) > 1
      `,
      label: 'Multiple settings records per business',
    },
    {
      table: 'customers',
      sql: `
        SELECT business_id, COUNT(*) AS duplicate_count
        FROM customers
        WHERE email IS NOT NULL
        GROUP BY business_id, email
        HAVING COUNT(*) > 1
      `,
      label: 'Duplicate customer emails per business',
    },
  ];

  for (const check of checks) {
    const rows = await query(check.sql);

    if (rows.length > 0) {
      issue(
        section,
        `${check.label}: ${rows.length} duplicate groups. ` +
        `Examples: ${JSON.stringify(rows.slice(0, 5))}`
      );
    } else {
      pass();
    }
  }
}

// ============================================================
// CHECK 3: FOREIGN KEYS AND ORPHAN RECORDS
// ============================================================

async function checkRelationships() {
  const section = 'RELATIONSHIPS';

  const relationships = [
    ['businesses', 'owner_user_id', 'users', 'id', 'id'],
    ['business_memberships', 'user_id', 'users', 'id', 'id'],
    ['business_memberships', 'business_id', 'businesses', 'id', 'id'],
    ['business_settings', 'business_id', 'businesses', 'id', 'id'],
    ['sessions', 'user_id', 'users', 'id', 'id'],
    ['sessions', 'business_id', 'businesses', 'id', 'id'],
    ['products', 'business_id', 'businesses', 'id', 'id'],
    ['products', 'global_catalogue_id', 'global_product_catalogue', 'id', 'id'],
    ['customers', 'business_id', 'businesses', 'id', 'id'],
    ['sales', 'business_id', 'businesses', 'id', 'id'],
    ['sales', 'customer_id', 'customers', 'id', 'id'],
    ['sale_items', 'sale_id', 'sales', 'id', 'id'],
    ['sale_items', 'product_id', 'products', 'id', 'id'],
    ['inventory', 'business_id', 'businesses', 'id', 'id'],
    ['inventory', 'product_id', 'products', 'id', 'id'],
    ['inventory_movements', 'business_id', 'businesses', 'id', 'id'],
    ['inventory_movements', 'product_id', 'products', 'id', 'id'],
    ['product_barcodes', 'global_product_id', 'global_product_catalogue', 'id', 'id'],
  ];

  const foreignKeys = await query(`
    SELECT
      TABLE_NAME,
      COLUMN_NAME,
      REFERENCED_TABLE_NAME,
      REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `);

  const columns = await query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  for (const [childTable, childColumn, parentTable, parentColumn, childID] of relationships) {
    const child = `c.\`${childColumn}\``;
    const parent = `p.\`${parentColumn}\``;

    const nullable = [
      'sessions.business_id',
      'sales.customer_id',
      'products.global_catalogue_id',
    ].includes(`${childTable}.${childColumn}`);

    const nullCondition = nullable ? `AND ${child} IS NOT NULL` : '';

    const sql = `
      SELECT COUNT(*) AS count
      FROM \`${childTable}\` c
      LEFT JOIN \`${parentTable}\` p ON ${parent} = ${child}
      WHERE ${parent} IS NULL
      ${nullCondition}
    `;

    const orphanCount = await count(sql);

    if (orphanCount > 0) {
      const samples = await query(`
        SELECT c.\`${childID}\` AS record_id, ${child} AS missing_reference
        FROM \`${childTable}\` c
        LEFT JOIN \`${parentTable}\` p ON ${parent} = ${child}
        WHERE ${parent} IS NULL
        ${nullCondition}
        LIMIT 5
      `);

      issue(
        section,
        `${childTable}.${childColumn} -> ${parentTable}.${parentColumn}: ` +
        `${orphanCount} orphan records. Examples: ${JSON.stringify(samples)}`
      );
    } else {
      pass();
    }

    const fkExists = foreignKeys.some(
      fk =>
        fk.TABLE_NAME === childTable &&
        fk.COLUMN_NAME === childColumn &&
        fk.REFERENCED_TABLE_NAME === parentTable &&
        fk.REFERENCED_COLUMN_NAME === parentColumn
    );

    if (!fkExists) {
      issue(
        section,
        `Missing foreign key: ${childTable}.${childColumn} -> ${parentTable}.${parentColumn}`
      );
    } else {
      pass();
    }

    const childDefinition = columns.find(
      c => c.TABLE_NAME === childTable && c.COLUMN_NAME === childColumn
    );

    const parentDefinition = columns.find(
      c => c.TABLE_NAME === parentTable && c.COLUMN_NAME === parentColumn
    );

    if (childDefinition && parentDefinition) {
      const childUnsigned = childDefinition.COLUMN_TYPE.includes('unsigned');
      const parentUnsigned = parentDefinition.COLUMN_TYPE.includes('unsigned');

      if (
        childDefinition.DATA_TYPE !== parentDefinition.DATA_TYPE ||
        childUnsigned !== parentUnsigned
      ) {
        issue(
          section,
          `Incompatible relationship types: ${childTable}.${childColumn} ` +
          `(${childDefinition.COLUMN_TYPE}) -> ${parentTable}.${parentColumn} ` +
          `(${parentDefinition.COLUMN_TYPE})`
        );
      } else {
        pass();
      }
    }
  }
}

// ============================================================
// CHECK 4: UNIQUE INDEXES
// ============================================================

async function checkIndexes() {
  const section = 'INDEXES';

  const expectedUniqueIndexes = [
    ['users', ['email']],
    ['business_memberships', ['user_id', 'business_id']],
    ['business_settings', ['business_id']],
    ['customers', ['business_id', 'email']],
    ['products', ['business_id', 'sku']],
    ['products', ['business_id', 'barcode_unique']],
    ['inventory', ['business_id', 'product_id']],
    ['sales', ['business_id', 'transaction_reference']],
    ['sales', ['business_id', 'idempotency_key_unique']],
    ['product_barcodes', ['barcode']],
  ];

  const indexes = await query(`
    SELECT
      TABLE_NAME,
      INDEX_NAME,
      NON_UNIQUE,
      GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
  `);

  for (const [table, expectedColumns] of expectedUniqueIndexes) {
    const expected = expectedColumns.join(',');

    const exists = indexes.some(index =>
      index.TABLE_NAME === table &&
      Number(index.NON_UNIQUE) === 0 &&
      index.indexed_columns === expected
    );

    if (!exists) {
      issue(
        section,
        `Missing unique index: ${table} (${expected})`
      );
    } else {
      pass();
    }
  }
}

// ============================================================
// CHECK 5: GLOBAL PRODUCT CATALOGUE
// ============================================================

async function checkCatalogue() {
  const section = 'CATALOGUE';

  const catalogueCount = await count(`
    SELECT COUNT(*) AS count FROM global_product_catalogue
  `);

  const orphanProducts = await query(`
    SELECT
      p.id AS product_id,
      p.business_id,
      p.name,
      p.global_catalogue_id
    FROM products p
    LEFT JOIN global_product_catalogue g
      ON g.id = p.global_catalogue_id
    WHERE p.global_catalogue_id IS NOT NULL
      AND g.id IS NULL
    ORDER BY p.id
    LIMIT 10
  `);

  if (orphanProducts.length > 0) {
    issue(
      section,
      `${orphanProducts.length} or more products reference missing catalogue records: ` +
      JSON.stringify(orphanProducts)
    );
  } else {
    pass();
  }

  if (catalogueCount === 0) {
    warning(
      section,
      'Global product catalogue is empty. Candidate catalogue seed has not populated it.'
    );
  } else {
    pass();
  }
}

// ============================================================
// CHECK 6: MIGRATION TRACKING
// ============================================================

async function checkMigrations() {
  const section = 'MIGRATIONS';

  const tables = await query(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  const tableNames = new Set(tables.map(row => row.TABLE_NAME));

  if (!tableNames.has('schema_migrations')) {
    issue(section, 'Missing schema_migrations table.');
    return;
  }

  const rows = await query(`
    SELECT COUNT(*) AS count FROM schema_migrations
  `);

  const legacyCount = Number(rows[0].count);

  if (!tableNames.has('mariadb_schema_migrations')) {
    warning(
      section,
      'No MariaDB-specific migration ledger exists yet. Existing SQLite migration records do not prove MariaDB migrations were executed.'
    );
  } else {
    pass();
  }

  if (legacyCount > 0) {
    warning(
      section,
      `${legacyCount} legacy migration records exist in schema_migrations.`
    );
  }
}

// ============================================================
// MASTER EXECUTION AND SUMMARY
// ============================================================

async function main() {
  console.log('\n============================================');
  console.log('       WORKFLOWOS DATABASE AUDIT');
  console.log('============================================\n');

  const host = process.env.TEST_DB_HOST;
  const database = await query('SELECT DATABASE() AS name');

  console.log(`Database: ${database[0].name}`);
  console.log(`Host: ${host || 'not available'}`);
  console.log('Mode: READ ONLY\n');

  if (database[0].name !== EXPECTED_DATABASE) {
    throw new Error(
      `Safety stop: expected ${EXPECTED_DATABASE}, connected to ${database[0].name}.`
    );
  }

  if (host === PRODUCTION_HOST) {
    throw new Error(
      'Safety stop: TEST connection points to the production host.'
    );
  }

  const checks = [
    ['Schema', checkSchema],
    ['Duplicates', checkDuplicates],
    ['Relationships', checkRelationships],
    ['Indexes', checkIndexes],
    ['Catalogue', checkCatalogue],
    ['Migrations', checkMigrations],
  ];

  for (const [name, run] of checks) {
    try {
      await run();
    } catch (error) {
      issue(name.toUpperCase(), `Check could not complete: ${error.message}`);
    }
  }

  console.log('\n============================================');
  console.log('              AUDIT SUMMARY');
  console.log('============================================');

  console.log(`Checks completed: ${checks.length}`);
  console.log(`Passed checks:    ${results.passed}`);
  console.log(`Broken items:     ${results.issues.length}`);
  console.log(`Warnings:         ${results.warnings.length}`);

  if (results.issues.length > 0) {
    console.log('\nBROKEN ITEMS:\n');

    results.issues.forEach((item, index) => {
      console.log(`${index + 1}. [${item.section}] ${item.message}`);
    });
  } else {
    console.log('\nNo broken items detected.');
  }

  if (results.warnings.length > 0) {
    console.log('\nWARNINGS:\n');

    results.warnings.forEach((item, index) => {
      console.log(`${index + 1}. [${item.section}] ${item.message}`);
    });
  }

  console.log('\n============================================');
  console.log('       AUDIT COMPLETE - NO CHANGES MADE');
  console.log('============================================\n');

  if (results.issues.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error('\nAUDIT ABORTED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
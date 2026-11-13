const { spawnSync } = require('node:child_process');
const db = require('../src/api/database');

const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';

const requiredTables = [
  'users',
  'businesses',
  'business_memberships',
  'business_settings',
  'sessions',
  'products',
  'customers',
  'sales',
  'sale_items',
  'inventory',
  'inventory_movements',
  'global_product_catalogue',
  'product_barcodes',
];

async function checkDatabase() {
  const [identity] = await db.execute(
    'SELECT DATABASE() AS db, VERSION() AS version'
  );

  if (
    identity[0].db !== EXPECTED_DATABASE ||
    process.env.TEST_DB_HOST !== EXPECTED_HOST
  ) {
    throw new Error('Safety stop: incorrect database environment.');
  }

  const [tables] = await db.execute(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);

  const existing = new Set(tables.map(row => row.TABLE_NAME));
  const missing = requiredTables.filter(table => !existing.has(table));

  if (missing.length) {
    throw new Error(`Missing database tables: ${missing.join(', ')}`);
  }

  const checks = [
    ['businesses', 'id'],
    ['business_memberships', 'id'],
    ['business_settings', 'id'],
    ['customers', 'id'],
    ['products', 'id'],
    ['sales', 'id'],
    ['inventory', 'id'],
  ];

  for (const [table, column] of checks) {
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS total FROM \`${table}\` WHERE \`${column}\` IS NULL`
    );

    if (Number(rows[0].total) > 0) {
      throw new Error(`${table}.${column} contains NULL identifiers.`);
    }
  }

  const [catalogue] = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(verification_status = 'incomplete') AS incomplete,
      SUM(verification_status = 'verified') AS verified
    FROM global_product_catalogue
  `);

  console.log('\nDATABASE CHECKS');
  console.log('Database:', identity[0].db);
  console.log('MariaDB:', identity[0].version);
  console.log('Required tables:', requiredTables.length);
  console.log('Catalogue records:', catalogue[0].total);
  console.log('Catalogue verified:', catalogue[0].verified);
  console.log('Catalogue incomplete:', catalogue[0].incomplete);
  console.log('Database checks: PASSED');
}

async function runApplicationTests() {
  console.log('\nRUNNING EXISTING NODE TEST SUITE');
  console.log('Command: npm test\n');

  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const result = spawnSync(command, ['test'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Application test suite failed with exit code ${result.status}.`);
  }

  console.log('\nApplication test suite: PASSED');
}

async function main() {
  console.log('\n========================================');
  console.log('       WORKFLOWOS APPLICATION TEST');
  console.log('========================================');

  await checkDatabase();
  await db.end();

  await runApplicationTests();

  console.log('\n========================================');
  console.log('       ALL TESTS COMPLETED');
  console.log('========================================');
}

main()
  .catch(async error => {
    console.error('\nTEST FAILURE:', error.message);
    process.exitCode = 1;

    try {
      await db.end();
    } catch {
      // Connection may already be closed.
    }
  });
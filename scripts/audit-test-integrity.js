
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
});

const mysql = require('mysql2/promise');

const checks = [
  ['Duplicate business IDs', `
    SELECT id, COUNT(*) AS occurrences
    FROM businesses GROUP BY id HAVING COUNT(*) > 1
  `],
  ['Duplicate membership IDs', `
    SELECT id, COUNT(*) AS occurrences
    FROM business_memberships GROUP BY id HAVING COUNT(*) > 1
  `],
  ['Duplicate settings IDs', `
    SELECT id, COUNT(*) AS occurrences
    FROM business_settings GROUP BY id HAVING COUNT(*) > 1
  `],
  ['Duplicate customer IDs', `
    SELECT id, COUNT(*) AS occurrences
    FROM customers GROUP BY id HAVING COUNT(*) > 1
  `],
  ['Duplicate memberships', `
    SELECT user_id, business_id, COUNT(*) AS occurrences
    FROM business_memberships
    GROUP BY user_id, business_id HAVING COUNT(*) > 1
  `],
  ['Duplicate business settings', `
    SELECT business_id, COUNT(*) AS occurrences
    FROM business_settings GROUP BY business_id HAVING COUNT(*) > 1
  `],
  ['Duplicate customer emails', `
    SELECT business_id, email, COUNT(*) AS occurrences
    FROM customers
    WHERE email IS NOT NULL
    GROUP BY business_id, email HAVING COUNT(*) > 1
  `],
  ['Orphaned business owners', `
    SELECT b.id, b.owner_user_id
    FROM businesses b
    LEFT JOIN users u ON u.id = b.owner_user_id
    WHERE u.id IS NULL
  `],
  ['Orphaned memberships', `
    SELECT bm.id, bm.user_id, bm.business_id
    FROM business_memberships bm
    LEFT JOIN users u ON u.id = bm.user_id
    LEFT JOIN businesses b ON b.id = bm.business_id
    WHERE u.id IS NULL OR b.id IS NULL
  `],
  ['Orphaned business settings', `
    SELECT bs.id, bs.business_id
    FROM business_settings bs
    LEFT JOIN businesses b ON b.id = bs.business_id
    WHERE b.id IS NULL
  `],
  ['Orphaned customers', `
    SELECT c.id, c.business_id
    FROM customers c
    LEFT JOIN businesses b ON b.id = c.business_id
    WHERE b.id IS NULL
  `],
  ['Orphaned products', `
    SELECT p.id, p.business_id
    FROM products p
    LEFT JOIN businesses b ON b.id = p.business_id
    WHERE b.id IS NULL
  `],
];

async function main() {
  const required = [
    'TEST_DB_HOST',
    'TEST_DB_PORT',
    'TEST_DB_USER',
    'TEST_DB_PASSWORD',
    'TEST_DB_NAME',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
  });

  try {
    console.log('\n========== WORKFLOWOS TEST INTEGRITY AUDIT ==========');

    const [identity] = await connection.query(
      'SELECT DATABASE() AS database_name, VERSION() AS version'
    );

    console.log('Database:', identity[0].database_name);
    console.log('Version:', identity[0].version);

    if (identity[0].database_name !== process.env.TEST_DB_NAME) {
      throw new Error('Connected to an unexpected database.');
    }

    for (const [name, sql] of checks) {
      console.log(`\n========== ${name} ==========`);

      const [rows] = await connection.query(sql);

      if (rows.length === 0) {
        console.log('[PASS] No problems found.');
      } else {
        console.log(`[WARNING] ${rows.length} result(s) found.`);
        console.table(rows);
      }
    }

    console.log('\n========== AUDIT COMPLETE ==========');
    console.log('Read-only audit. No records were modified.');
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('\n[FAIL]', error.message);
  process.exitCode = 1;
});
const path = require('node:path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

const mysql = require('mysql2/promise');

const tables = [
  'businesses',
  'business_memberships',
  'business_settings',
  'customers',
];

const sensitive = /email|phone|mobile|name|address|password|token|secret|contact|description|notes/i;

function redact(row) {
  const result = {};

  for (const [key, value] of Object.entries(row)) {
    if (sensitive.test(key)) {
      result[key] = value == null ? null : '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
    ssl: { rejectUnauthorized: false },
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  try {
    console.log('WORKFLOWOS STAGING DATA INSPECTION');
    console.log('Database:', process.env.TEST_DB_NAME);
    console.log('Host:', process.env.TEST_DB_HOST);
    console.log('READ ONLY - NO CHANGES');

    for (const table of tables) {
      console.log('\n==================================================');
      console.log(`TABLE: ${table}`);
      console.log('==================================================');

      const [definition] = await db.query(
        `SHOW CREATE TABLE \`${table}\``
      );

      console.log('\nTABLE DEFINITION:');
      console.log(definition[0]['Create Table']);

      const [columns] = await db.execute(`
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
               COLUMN_KEY, EXTRA
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [table]);

      console.log('\nCOLUMN DETAILS:');
      console.table(columns);

      const [rows] = await db.query(
        `SELECT * FROM \`${table}\` ORDER BY id`
      );

      console.log(`\nALL RECORDS (${rows.length}):`);
      console.log(JSON.stringify(rows.map(redact), null, 2));

      if (table === 'business_memberships') {
        const [duplicates] = await db.query(`
          SELECT user_id, business_id, COUNT(*) AS occurrences
          FROM business_memberships
          GROUP BY user_id, business_id
          HAVING COUNT(*) > 1
        `);

        console.log('\nDUPLICATE MEMBERSHIP GROUPS:');
        console.table(duplicates);
      }

      if (table === 'business_settings') {
        const [duplicates] = await db.query(`
          SELECT business_id, COUNT(*) AS occurrences
          FROM business_settings
          GROUP BY business_id
          HAVING COUNT(*) > 1
        `);

        console.log('\nDUPLICATE SETTINGS GROUPS:');
        console.table(duplicates);
      }

      if (table === 'customers') {
        const [duplicates] = await db.query(`
          SELECT business_id, COUNT(*) AS occurrences
          FROM customers
          WHERE email IS NOT NULL
          GROUP BY business_id, email
          HAVING COUNT(*) > 1
        `);

        console.log('\nDUPLICATE CUSTOMER GROUPS:');
        console.table(duplicates);
      }
    }

    console.log('\n==================================================');
    console.log('RELATED ID COLUMN TYPES');
    console.log('==================================================');

    const [related] = await db.execute(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE,
             IS_NULLABLE, COLUMN_KEY, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          COLUMN_NAME IN (
            'id', 'user_id', 'business_id', 'owner_user_id',
            'customer_id', 'product_id', 'sale_id'
          )
        )
        AND TABLE_NAME IN (
          'users', 'businesses', 'business_memberships',
          'business_settings', 'customers', 'sessions',
          'products', 'sales', 'sale_items', 'inventory',
          'inventory_movements'
        )
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);

    console.table(related);

    console.log('\nInspection completed. No data was modified.');
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error('INSPECTION FAILED:', error.message);
  process.exitCode = 1;
});
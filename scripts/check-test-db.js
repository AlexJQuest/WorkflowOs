
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
});

const mysql = require('mysql2/promise');

const REQUIRED_ENV = [
  'TEST_DB_HOST',
  'TEST_DB_PORT',
  'TEST_DB_USER',
  'TEST_DB_PASSWORD',
  'TEST_DB_NAME',
];

function validateEnvironment() {
  const missing = REQUIRED_ENV.filter(
    key => !process.env[key] || !String(process.env[key]).trim()
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required TEST database environment variables: ${missing.join(', ')}`
    );
  }

  if (!/^\d+$/.test(process.env.TEST_DB_PORT)) {
    throw new Error('TEST_DB_PORT must be a valid port number.');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(process.env.TEST_DB_NAME)) {
    throw new Error('TEST_DB_NAME contains unsupported characters.');
  }
}

async function main() {
  validateEnvironment();

  let connection;

  try {
    console.log('\n========== WORKFLOWOS TEST DATABASE CHECK ==========');

    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT),
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD,
      database: process.env.TEST_DB_NAME,
      ssl: {
        rejectUnauthorized: false,
      },
      connectTimeout: 15000,
    });

    console.log('\n[PASS] MariaDB connection established.');

    // Verify database and server information.
    const [infoRows] = await connection.query(`
      SELECT
        DATABASE() AS database_name,
        VERSION() AS database_version,
        NOW() AS server_time
    `);

    const info = infoRows[0];

    if (info.database_name !== process.env.TEST_DB_NAME) {
      throw new Error(
        `Connected to unexpected database: ${info.database_name}`
      );
    }

    console.log('[PASS] Connected to expected TEST database.');
    console.log('Database:', info.database_name);
    console.log('MariaDB version:', info.database_version);
    console.log('Server time:', info.server_time);

    // Inspect tables.
    console.log('\n========== TABLE INSPECTION ==========');

    const [tables] = await connection.query('SHOW TABLES');

    console.log('Tables found:', tables.length);

    if (tables.length === 0) {
      console.log('[WARNING] Database contains no tables.');
    }

    let totalRecords = 0;

    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const safeName = String(tableName).replace(/`/g, '``');

      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM \`${safeName}\``
      );

      const count = Number(countRows[0].total);
      totalRecords += count;

      console.log(`${tableName}: ${count} records`);
    }

    console.log('Total records:', totalRecords);

    // Inspect migration history.
    console.log('\n========== MIGRATION HISTORY ==========');

    const migrationTableExists = tables.some(
      row => Object.values(row)[0] === 'schema_migrations'
    );

    if (migrationTableExists) {
      const [migrationColumns] = await connection.query(
        'SHOW COLUMNS FROM schema_migrations'
      );

      const availableColumns = migrationColumns.map(
        column => column.Field
      );

      console.log(
        'Migration columns:',
        availableColumns.join(', ')
      );

      const requiredColumns = [
        'version',
        'checksum',
        'applied_at',
      ];

      const missingColumns = requiredColumns.filter(
        column => !availableColumns.includes(column)
      );

      if (missingColumns.length > 0) {
        console.log(
          '[WARNING] Missing migration columns:',
          missingColumns.join(', ')
        );
      } else {
        const [migrations] = await connection.query(`
          SELECT version, checksum, applied_at
          FROM schema_migrations
          ORDER BY version
        `);

        console.log('Applied migrations:', migrations.length);
        console.table(migrations);
      }
    } else {
      console.log('[WARNING] schema_migrations table does not exist.');
    }

    // Inspect storage engines.
    console.log('\n========== STORAGE ENGINES ==========');

    const [engines] = await connection.query(`
      SELECT TABLE_NAME, ENGINE
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);

    console.table(engines);

    // Inspect foreign-key relationships.
    console.log('\n========== FOREIGN KEY RELATIONSHIPS ==========');

    const [foreignKeys] = await connection.query(`
      SELECT
        TABLE_NAME,
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME
    `);

    console.log('Foreign keys found:', foreignKeys.length);
    console.table(foreignKeys);

    // Final status.
    console.log('\n========== TEST DATABASE RESULT ==========');

    console.log('[PASS] Database connection verified.');
    console.log('[PASS] Database identity verified.');
    console.log('[PASS] Table inspection completed.');
    console.log('[PASS] Record counts completed.');
    console.log('[PASS] Schema inspection completed.');

    if (tables.length === 0) {
      console.log('[WARNING] TEST database is empty.');
    }

    console.log('\nTEST DATABASE CHECK COMPLETED.');

  } catch (error) {
    console.error('\n[FAIL] TEST database check failed.');
    console.error('Reason:', error.message);

    process.exitCode = 1;

  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main().catch(error => {
  console.error('Unexpected error:', error.message);
  process.exitCode = 1;
});

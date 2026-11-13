require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
});

const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('\n========== MIGRATION HISTORY ==========');

    const [migrations] = await connection.query(
      'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version'
    );

    console.table(migrations);

    console.log('\n========== TABLE ENGINES ==========');

    const [engines] = await connection.query(`
      SELECT TABLE_NAME, ENGINE
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);

    console.table(engines);

    console.log('\n========== FOREIGN KEY RELATIONSHIPS ==========');

    const [constraints] = await connection.query(`
      SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
             REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.table(constraints);

  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Schema inspection failed:', error.message);
  process.exitCode = 1;
});
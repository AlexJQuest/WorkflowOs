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
    const [tables] = await connection.query('SHOW TABLES');

    console.log('\n========== TEST DATABASE ROW COUNTS ==========');

    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const safeName = String(tableName).replace(/`/g, '``');

      const [count] = await connection.query(
        `SELECT COUNT(*) AS total FROM \`${safeName}\``
      );

      console.log(`${tableName}: ${count[0].total}`);
    }

    console.log('\n========== MIGRATION TABLE STRUCTURE ==========');

    const [columns] = await connection.query(
      'SHOW COLUMNS FROM schema_migrations'
    );

    console.log(columns.map(column => column.Field).join(', '));

    console.log('\n========== FOREIGN KEY COUNT ==========');

    const [foreignKeys] = await connection.query(`
      SELECT COUNT(*) AS total
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.log('Foreign keys:', foreignKeys[0].total);
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Verification failed:', error.message);
  process.exitCode = 1;
});

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

    for (const row of tables) {
      const table = Object.values(row)[0];

      const [result] = await connection.query(
        `SHOW CREATE TABLE \`${table}\``
      );

      console.log(`\n========== ${table} ==========`);
      console.log(result[0]['Create Table']);
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

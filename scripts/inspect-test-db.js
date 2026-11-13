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
    const [info] = await connection.query(`
      SELECT DATABASE() AS database_name,
             VERSION() AS database_version
    `);

    const [tables] = await connection.query('SHOW TABLES');

    console.log('Database:', info[0].database_name);
    console.log('Version:', info[0].database_version);
    console.log('Existing tables:');

    if (tables.length === 0) {
      console.log('No tables found.');
    }

    for (const table of tables) {
      console.log(Object.values(table)[0]);
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error('Inspection failed:', error.message);
  process.exitCode = 1;
});

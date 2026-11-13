
const mysql = require('mysql2/promise');
const path = require('node:path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: true,
});

const requiredVariables = [
  'TEST_DB_HOST',
  'TEST_DB_USER',
  'TEST_DB_PASSWORD',
  'TEST_DB_NAME',
];

const missingVariables = requiredVariables.filter(
  (variable) => !process.env[variable]
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing TEST database configuration: ${missingVariables.join(', ')}`
  );
}

const db = mysql.createPool({
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD,
  database: process.env.TEST_DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',

  ssl: {
    rejectUnauthorized: false,
  },
});

async function testConnection() {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.ping();

    const [rows] = await connection.query(
      'SELECT DATABASE() AS databaseName, VERSION() AS version'
    );

    console.log('TEST MariaDB connection successful.');
    console.log(`Database: ${rows[0].databaseName}`);
    console.log(`Version: ${rows[0].version}`);

    return true;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = db;
module.exports.testConnection = testConnection;

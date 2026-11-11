
const mysql = require('mysql2/promise');
const path = require('node:path');

// Always load the project's root .env file.
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
});

const requiredVariables = [
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
];

const missingVariables = requiredVariables.filter(
  (variable) => process.env[variable] === undefined
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing database configuration: ${missingVariables.join(', ')}`
  );
}

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',

  ssl: process.env.MYSQL_SSL_CA
    ? {
        ca: require('node:fs').readFileSync(process.env.MYSQL_SSL_CA),
        rejectUnauthorized: true,
      }
    : undefined,
});

async function testConnection() {
  let connection;

  try {
    connection = await db.getConnection();

    await connection.ping();

    const [rows] = await connection.query(
      'SELECT DATABASE() AS databaseName, VERSION() AS version'
    );

    console.log('Connected to MariaDB successfully.');
    console.log(`Database: ${rows[0].databaseName}`);
    console.log(`Version: ${rows[0].version}`);

    return true;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = db;
module.exports.testConnection = testConnection;

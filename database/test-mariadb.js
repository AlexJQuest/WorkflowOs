require('dotenv').config();

const db = require('../src/api/database');

async function main() {
  try {
    await db.testConnection();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
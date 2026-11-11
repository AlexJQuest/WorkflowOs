const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations } = require('./migrate');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'database', 'dev.db');
const databaseDir = path.dirname(dbPath);
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
applyMigrations(db);

module.exports = db;

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations } = require('../src/api/migrate');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'dev.db');
const databaseDir = path.dirname(dbPath);
if (!fs.existsSync(databaseDir)) fs.mkdirSync(databaseDir, { recursive: true });

const db = new Database(dbPath);
const files = applyMigrations(db);
console.log(`Applied ${files.length} new migration(s) to ${dbPath}`);
db.close();

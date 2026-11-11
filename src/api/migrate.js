const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEGACY_MIGRATION_CHECKSUMS = new Map([
  ['004_barcode_and_shared_catalogue.sql', new Set(['bd19f5f59830abad6808fe77bc4319566a298a20dde34fe420acd3c59b38965a'])],
]);

function applyMigrations(db, migrationDirectory = path.join(__dirname, '..', '..', 'database', 'migrations')) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = fs.existsSync(migrationDirectory)
    ? fs.readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql')).sort()
    : [];
  const applied = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(file);

    if (existing) {
      if (existing.checksum !== checksum) {
        const knownLegacyChecksums = LEGACY_MIGRATION_CHECKSUMS.get(file);
        if (!knownLegacyChecksums?.has(existing.checksum)) {
          throw new Error(`Applied migration checksum changed: ${file}`);
        }
      }
      continue;
    }

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)').run(file, checksum);
    })();
    applied.push(file);
  }

  return applied;
}

module.exports = {
  applyMigrations,
};

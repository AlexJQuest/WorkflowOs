
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../src/api/database');

const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';
const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations-mariadb');
const APPLY = process.argv.includes('--apply');

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(statement => statement && !statement.startsWith('--'));
}

async function main() {
  const [identity] = await db.execute(
    'SELECT DATABASE() AS db, @@hostname AS server'
  );

  if (
    identity[0].db !== EXPECTED_DATABASE ||
    process.env.TEST_DB_HOST !== EXPECTED_HOST
  ) {
    throw new Error('Safety stop: connection is not the approved TEST database.');
  }

  console.log('\nWORKFLOWOS MARIADB MIGRATION RUNNER');
  console.log('Database:', identity[0].db);
  console.log('Host:', process.env.TEST_DB_HOST);
  console.log('Mode:', APPLY ? 'APPLY' : 'PREVIEW');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }

  if (APPLY) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS mariadb_schema_migrations (
        version VARCHAR(190) NOT NULL PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  const [ledgerExists] = await db.execute(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'mariadb_schema_migrations'
  `);

  const ledgerReady = Number(ledgerExists[0].total) > 0;

  if (!ledgerReady && !APPLY) {
    console.log('\nMigration ledger does not exist yet.');
    console.log('Run with --apply to create it.');
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length === 0) {
    console.log('\nNo MariaDB migration SQL files found.');
    console.log('Add numbered .sql files to database/migrations-mariadb.');
    return;
  }

  let pending = 0;

  for (const file of files) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const hash = checksum(content);

    let [existing] = [ [] ];

    if (ledgerReady || APPLY) {
      [existing] = await db.execute(
        'SELECT checksum FROM mariadb_schema_migrations WHERE version = ?',
        [file]
      );
    }

    if (existing.length > 0) {
      if (existing[0].checksum !== hash) {
        throw new Error(
          `Checksum mismatch for ${file}. Never edit an applied migration.`
        );
      }

      console.log(`[APPLIED] ${file}`);
      continue;
    }

    pending++;
    console.log(`[PENDING] ${file}`);

    if (!APPLY) continue;

    const statements = splitStatements(content);

    if (statements.length === 0) {
      throw new Error(`Migration ${file} contains no SQL statements.`);
    }

    for (const statement of statements) {
      await db.query(statement);
    }

    await db.execute(
      `INSERT INTO mariadb_schema_migrations (version, checksum)
       VALUES (?, ?)`,
      [file, hash]
    );

    console.log(`[SUCCESS] ${file}`);
  }

  console.log('\n================================');
  console.log('Migration files:', files.length);
  console.log('Pending files:', pending);
  console.log('================================');

  if (!APPLY && pending > 0) {
    console.log('\nPreview only. Nothing was changed.');
    console.log('Use node scripts/run-mariadb-migrations.js --apply to execute.');
  }
}

main()
  .catch(error => {
    console.error('\nMIGRATION ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
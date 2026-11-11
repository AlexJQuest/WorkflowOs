
const db = require('../src/api/database');
const { applyMigrations } = require('../src/api/migrate');

async function main() {
  try {
    const files = await applyMigrations(db);

    console.log(
      `Applied ${files.length} new MariaDB migration(s).`
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('MariaDB migration failed:', error);
  process.exitCode = 1;
});

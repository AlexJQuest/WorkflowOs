const db = require('../src/api/database');

async function main() {
  const [rows] = await db.execute(
    'SELECT id, email FROM users WHERE email = ?',
    ['alice@example.com']
  );

  console.log('\nTEST USER LOOKUP');

  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.log('No matching user found.');
  }
}

main()
  .catch((error) => {
    console.error('Lookup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

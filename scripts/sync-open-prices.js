'use strict';

require('dotenv').config();

const { syncOpenPrices } = require('../src/integrations/open-prices/importer');
const db = require('../src/api/database');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;
  const exportArg = args.find((arg) => arg.startsWith('--exports='));
  const exports = exportArg
    ? exportArg.slice('--exports='.length).split(',').map((item) => item.trim()).filter(Boolean)
    : ['products', 'locations', 'prices'];

  console.log('\nWORKFLOWOS - OPEN PRICES SYNC');
  console.log('Mode:', dryRun ? 'DRY RUN (no database changes)' : 'APPLY');
  console.log('Exports:', exports.join(', '));

  const result = await syncOpenPrices({ dryRun, exports });

  console.log('\nSYNC SUMMARY');
  for (const [key, value] of Object.entries(result)) {
    console.log(`${key}:`, value);
  }

  if (dryRun) {
    console.log('\nDry run complete. Review the counts, then run with --apply to import.');
  }
}

main()
  .catch((error) => {
    console.error('\nOPEN PRICES SYNC FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

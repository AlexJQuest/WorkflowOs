const db = require('../src/api/database');

const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';

const SOURCE =
  'WorkflowOS South African retail candidate seed v1 - product identity and barcode not independently verified';

const products = [
  ['Eggs', null, 'Groceries'],
  ['Butter', null, 'Dairy'],
  ['Margarine', null, 'Dairy'],
  ['Cheese', null, 'Dairy'],
  ['Milk', null, 'Dairy'],
  ['Bread', null, 'Bakery'],
  ['Rice', null, 'Groceries'],
  ['Sugar', null, 'Groceries'],
  ['Flour', null, 'Groceries'],
  ['Cooking oil', null, 'Groceries'],
  ['Pasta', null, 'Groceries'],
  ['Canned foods', null, 'Groceries'],
  ['Cereal', null, 'Breakfast'],
  ['Tea', null, 'Beverages'],
  ['Bottled water', null, 'Beverages'],
  ['Fruit juice', null, 'Beverages'],
  ['Energy drink', null, 'Beverages'],
  ['Carbonated drink', 'Pepsi', 'Beverages'],
  ['Carbonated drink', 'Sprite', 'Beverages'],
  ['Carbonated drink', 'Fanta', 'Beverages'],
  ['Corn snack', 'NikNaks', 'Snacks'],
  ['Tortilla chips', 'Doritos', 'Snacks'],
  ['Biscuits', null, 'Snacks'],
  ['Packaged snacks', null, 'Snacks'],
  ['Dishwashing liquid', 'Sunlight', 'Cleaning'],
  ['Laundry detergent', 'Ariel', 'Cleaning'],
  ['Multi-purpose cleaner', 'Handy Andy', 'Cleaning'],
  ['Bleach', null, 'Cleaning'],
  ['Toilet paper', null, 'Household'],
  ['Refuse bags', null, 'Household'],
  ['Cleaning products', null, 'Cleaning'],
  ['Toothpaste', 'Colgate', 'Personal Care'],
  ['Toothbrush', null, 'Personal Care'],
  ['Soap', null, 'Personal Care'],
  ['Shampoo', null, 'Personal Care'],
  ['Conditioner', null, 'Personal Care'],
  ['Deodorant', null, 'Personal Care'],
  ['Body lotion', null, 'Personal Care'],
  ['Sanitary products', null, 'Personal Care'],
];

async function main() {
  const [identity] = await db.execute('SELECT DATABASE() AS db');

  if (
    identity[0].db !== EXPECTED_DATABASE ||
    process.env.TEST_DB_HOST !== EXPECTED_HOST
  ) {
    throw new Error('Safety stop: not connected to the approved TEST database.');
  }

  console.log('\nWORKFLOWOS GLOBAL CATALOGUE SEED');
  console.log('Database:', identity[0].db);
  console.log('Candidate records:', products.length);

  const [tables] = await db.execute(`
    SELECT COUNT(*) AS total
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'global_product_catalogue'
  `);

  if (Number(tables[0].total) !== 1) {
    throw new Error('global_product_catalogue table does not exist.');
  }

  let inserted = 0;
  let skipped = 0;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    for (const [name, brand, category] of products) {
      const [existing] = await connection.execute(`
        SELECT id
        FROM global_product_catalogue
        WHERE LOWER(product_name) = LOWER(?)
          AND COALESCE(LOWER(brand), '') = COALESCE(LOWER(?), '')
          AND COALESCE(LOWER(category), '') = COALESCE(LOWER(?), '')
        LIMIT 1
      `, [name, brand, category]);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await connection.execute(`
        INSERT INTO global_product_catalogue (
          product_name,
          brand,
          packaging_size,
          category,
          description,
          verification_status,
          data_source
        )
        VALUES (?, ?, NULL, ?, NULL, 'incomplete', ?)
      `, [name, brand, category, SOURCE]);

      inserted++;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [totals] = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(verification_status = 'incomplete') AS incomplete,
      SUM(verification_status = 'verified') AS verified
    FROM global_product_catalogue
  `);

  console.log('\nSEED SUMMARY');
  console.log('Inserted:', inserted);
  console.log('Already existed:', skipped);
  console.log('Total catalogue records:', totals[0].total);
  console.log('Incomplete:', totals[0].incomplete);
  console.log('Verified:', totals[0].verified);
  console.log('\nNo existing catalogue records were overwritten.');
}

main()
  .catch(error => {
    console.error('\nCATALOGUE SEED FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
const db = require('../src/api/database');

const relationships = [
  ['businesses.owner_user_id -> users.id',
    `SELECT COUNT(*) AS count FROM businesses c
     LEFT JOIN users p ON p.id = c.owner_user_id
     WHERE p.id IS NULL`],

  ['business_memberships.user_id -> users.id',
    `SELECT COUNT(*) AS count FROM business_memberships c
     LEFT JOIN users p ON p.id = c.user_id
     WHERE p.id IS NULL`],

  ['business_memberships.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM business_memberships c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['business_settings.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM business_settings c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['sessions.user_id -> users.id',
    `SELECT COUNT(*) AS count FROM sessions c
     LEFT JOIN users p ON p.id = c.user_id
     WHERE p.id IS NULL`],

  ['sessions.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM sessions c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE c.business_id IS NOT NULL AND p.id IS NULL`],

  ['products.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM products c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['products.global_catalogue_id -> global_product_catalogue.id',
    `SELECT COUNT(*) AS count FROM products c
     LEFT JOIN global_product_catalogue p ON p.id = c.global_catalogue_id
     WHERE c.global_catalogue_id IS NOT NULL AND p.id IS NULL`],

  ['customers.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM customers c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['sales.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM sales c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['sales.customer_id -> customers.id',
    `SELECT COUNT(*) AS count FROM sales c
     LEFT JOIN customers p ON p.id = c.customer_id
     WHERE c.customer_id IS NOT NULL AND p.id IS NULL`],

  ['sale_items.sale_id -> sales.id',
    `SELECT COUNT(*) AS count FROM sale_items c
     LEFT JOIN sales p ON p.id = c.sale_id
     WHERE p.id IS NULL`],

  ['sale_items.product_id -> products.id',
    `SELECT COUNT(*) AS count FROM sale_items c
     LEFT JOIN products p ON p.id = c.product_id
     WHERE p.id IS NULL`],

  ['inventory.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM inventory c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['inventory.product_id -> products.id',
    `SELECT COUNT(*) AS count FROM inventory c
     LEFT JOIN products p ON p.id = c.product_id
     WHERE p.id IS NULL`],

  ['inventory_movements.business_id -> businesses.id',
    `SELECT COUNT(*) AS count FROM inventory_movements c
     LEFT JOIN businesses p ON p.id = c.business_id
     WHERE p.id IS NULL`],

  ['inventory_movements.product_id -> products.id',
    `SELECT COUNT(*) AS count FROM inventory_movements c
     LEFT JOIN products p ON p.id = c.product_id
     WHERE p.id IS NULL`],

  ['product_barcodes.global_product_id -> global_product_catalogue.id',
    `SELECT COUNT(*) AS count FROM product_barcodes c
     LEFT JOIN global_product_catalogue p ON p.id = c.global_product_id
     WHERE p.id IS NULL`],
];

async function main() {
  console.log('\nWORKFLOWOS TEST - FOREIGN KEY INTEGRITY');
  console.log('Read-only check. No database changes will be made.\n');

  let totalOrphans = 0;

  for (const [label, sql] of relationships) {
    const [rows] = await db.query(sql);
    const count = Number(rows[0].count);

    totalOrphans += count;

    console.log(
      `${count === 0 ? 'PASS' : 'FAIL'} | ${label} | Orphans: ${count}`
    );
  }

  console.log('\n----------------------------------------');
  console.log(`Total orphan records: ${totalOrphans}`);
  console.log('----------------------------------------\n');
}

main()
  .catch(error => {
    console.error('Integrity inspection failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
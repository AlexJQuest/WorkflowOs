async function cleanupBusiness(db, businessId, userId) {
  if (!businessId) {
    if (userId) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    return;
  }

  await db.execute(
    'DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE business_id = ?)',
    [businessId]
  );
  await db.execute('DELETE FROM sales WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM inventory_movements WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM product_cost_history WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM inventory WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM products WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM customers WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
  await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
  if (userId) {
    await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }
  await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
  if (userId) {
    await db.execute('DELETE FROM users WHERE id = ?', [userId]);
  }
}

async function cleanupGlobalCatalogueProduct(db, productId) {
  if (!productId) return;
  await db.execute('DELETE FROM product_barcodes WHERE global_product_id = ?', [productId]);
  await db.execute('DELETE FROM global_product_catalogue WHERE id = ?', [productId]);
}

module.exports = { cleanupBusiness, cleanupGlobalCatalogueProduct };

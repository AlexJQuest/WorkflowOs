-- Candidate records only. No package size or barcode is asserted by this seed.
-- Exact retailer SKU/pack identity and GTIN require later human source review.
INSERT INTO global_product_catalogue (product_name, brand, packaging_size, category, description, verification_status, data_source)
SELECT candidate.product_name, candidate.brand, NULL, candidate.category,
       'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.',
       'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified'
FROM (
  SELECT 'Eggs' AS product_name, NULL AS brand, 'Groceries' AS category UNION ALL
  SELECT 'Butter', NULL, 'Groceries' UNION ALL
  SELECT 'Margarine', NULL, 'Groceries' UNION ALL
  SELECT 'Cheese', NULL, 'Groceries' UNION ALL
  SELECT 'Rice', NULL, 'Groceries' UNION ALL
  SELECT 'Sugar', NULL, 'Groceries' UNION ALL
  SELECT 'Flour', NULL, 'Groceries' UNION ALL
  SELECT 'Cooking oil', NULL, 'Groceries' UNION ALL
  SELECT 'Pasta', NULL, 'Groceries' UNION ALL
  SELECT 'Canned foods', NULL, 'Groceries' UNION ALL
  SELECT 'Cereal', NULL, 'Groceries' UNION ALL
  SELECT 'Tea', NULL, 'Groceries' UNION ALL
  SELECT 'Bottled water', NULL, 'Beverages' UNION ALL
  SELECT 'Fruit juice', NULL, 'Beverages' UNION ALL
  SELECT 'Energy drink', NULL, 'Beverages' UNION ALL
  SELECT 'Carbonated soft drink', 'Pepsi', 'Beverages' UNION ALL
  SELECT 'Carbonated soft drink', 'Sprite', 'Beverages' UNION ALL
  SELECT 'Carbonated soft drink', 'Fanta', 'Beverages' UNION ALL
  SELECT 'Corn snack', 'NikNaks', 'Snacks and confectionery' UNION ALL
  SELECT 'Tortilla chips', 'Doritos', 'Snacks and confectionery' UNION ALL
  SELECT 'Biscuits', NULL, 'Snacks and confectionery' UNION ALL
  SELECT 'Packaged snacks', NULL, 'Snacks and confectionery' UNION ALL
  SELECT 'Laundry detergent', 'Ariel', 'Household products' UNION ALL
  SELECT 'All-purpose cleaner', 'Handy Andy', 'Household products' UNION ALL
  SELECT 'Bleach', NULL, 'Household products' UNION ALL
  SELECT 'Toilet paper', NULL, 'Household products' UNION ALL
  SELECT 'Refuse bags', NULL, 'Household products' UNION ALL
  SELECT 'Cleaning products', NULL, 'Household products' UNION ALL
  SELECT 'Toothpaste', 'Colgate', 'Personal care' UNION ALL
  SELECT 'Toothbrush', NULL, 'Personal care' UNION ALL
  SELECT 'Soap', NULL, 'Personal care' UNION ALL
  SELECT 'Shampoo', NULL, 'Personal care' UNION ALL
  SELECT 'Conditioner', NULL, 'Personal care' UNION ALL
  SELECT 'Deodorant', NULL, 'Personal care' UNION ALL
  SELECT 'Body lotion', NULL, 'Personal care' UNION ALL
  SELECT 'Sanitary products', NULL, 'Personal care'
) AS candidate
WHERE NOT EXISTS (
  SELECT 1 FROM global_product_catalogue existing
  WHERE existing.product_name = candidate.product_name
    AND COALESCE(existing.brand, '') = COALESCE(candidate.brand, '')
    AND COALESCE(existing.packaging_size, '') = ''
    AND existing.verification_status = 'incomplete'
);

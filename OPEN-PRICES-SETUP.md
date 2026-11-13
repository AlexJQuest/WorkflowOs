# WorkflowOS Open Prices integration

This integration imports the public worldwide Open Prices exports into the MariaDB TEST database.

## Included files

- `src/integrations/open-prices/importer.js`
- `scripts/sync-open-prices.js`
- `src/api/open-prices.service.js`
- `database/migrations-mariadb/001_open_prices.sql`

## Source and licence

Exports are published daily by Open Prices:
- https://prices.openfoodfacts.org/data/products.jsonl.gz
- https://prices.openfoodfacts.org/data/locations.jsonl.gz
- https://prices.openfoodfacts.org/data/prices.jsonl.gz

Source: Open Prices / Open Food Facts. Database licence: ODbL 1.0.
Keep attribution and comply with ODbL share-alike obligations when redistributing a database derived from these data.

## Install

Copy the files into the matching paths in the WorkflowOS repository.

Check that `.env` points to the approved Layerbase TEST database:
- `TEST_DB_HOST=workflow-main-idle-pine.bulrush.cloud.layerbase.dev`
- `TEST_DB_NAME=workflowos_test`

Run the migration using the existing MariaDB migration runner:

```powershell
node .\scripts\run-mariadb-migrations.js
```

If your runner requires explicit application, use its existing `--apply` option:

```powershell
node .\scripts\run-mariadb-migrations.js --apply
```

## Run

Dry-run is the default and makes no database changes:

```powershell
node .\scripts\sync-open-prices.js
```

Apply the import:

```powershell
node .\scripts\sync-open-prices.js --apply
```

Optionally import only selected exports:

```powershell
node .\scripts\sync-open-prices.js --exports=products,prices
```

## Service methods

`src/api/open-prices.service.js` exports:

- `getOpenPricesStatus()`
- `updateOpenPrices({ dryRun, exports })`
- `searchWorldwidePrices({ barcode, query, countryCode, limit })`

These are service functions; no HTTP route is added automatically.

## Behaviour and safeguards

- The importer refuses to run unless the configured database is `workflowos_test` on the approved Layerbase TEST host.
- Existing catalogue names, brands and packaging values are not overwritten; source values only fill blank fields.
- New catalogue entries are marked `incomplete`.
- Imported barcodes are marked `unverified` and must pass the existing EAN/UPC checksum validator.
- A barcode already associated with a different catalogue product is not reassigned.
- Price observations are stored separately from business POS prices.
- Original currencies and observation dates are retained.
- Re-running the import updates the same source price record using its Open Prices ID.
- Price observations that cannot be matched to a catalogue product are still retained with a null catalogue link.
- The importer does not import proof images or contributor identities.

## Important implementation note

The source is crowdsourced. Its product and price records should be treated as external observations, not guaranteed verified facts. The migration creates the two integration tables only; it does not change existing business data.

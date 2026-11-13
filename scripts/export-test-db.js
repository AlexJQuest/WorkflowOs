require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
});

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = [
  'TEST_DB_HOST',
  'TEST_DB_PORT',
  'TEST_DB_USER',
  'TEST_DB_PASSWORD',
  'TEST_DB_NAME',
];

function validateEnvironment() {
  const missing = REQUIRED_ENV.filter(
    key => !process.env[key] || !String(process.env[key]).trim()
  );

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}`
    );
  }

  if (!/^\d+$/.test(process.env.TEST_DB_PORT)) {
    throw new Error('TEST_DB_PORT must be a valid port.');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(process.env.TEST_DB_NAME)) {
    throw new Error('Invalid TEST_DB_NAME.');
  }
}

function quoteIdentifier(value) {
  return '`' + String(value).replace(/`/g, '``') + '`';
}

function escapeString(value) {
  return "'" + String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\b/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z')
    .replace(/'/g, "''") + "'";
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (Buffer.isBuffer(value)) {
    return "X'" + value.toString('hex') + "'";
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot export invalid number: ${value}`);
    }

    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return escapeString(value);
}

function write(output, content) {
  output.write(content + '\n');
}

async function main() {
  validateEnvironment();

  const databaseName = process.env.TEST_DB_NAME;

  const exportDirectory = path.resolve(
    __dirname,
    '..',
    'database',
    'exports'
  );

  fs.mkdirSync(exportDirectory, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const outputPath = path.join(
    exportDirectory,
    `workflowos-${databaseName}-${timestamp}.sql`
  );

  let connection;
  let output;

  try {
    console.log('\n========== WORKFLOWOS DATABASE EXPORT ==========');

    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT),
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD,
      database: databaseName,
      ssl: {
        rejectUnauthorized: false,
      },
      connectTimeout: 15000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    });

    const [identity] = await connection.query(`
      SELECT DATABASE() AS database_name, VERSION() AS version
    `);

    if (identity[0].database_name !== databaseName) {
      throw new Error('Connected to an unexpected database.');
    }

    console.log('Source database:', identity[0].database_name);
    console.log('MariaDB version:', identity[0].version);

    output = fs.createWriteStream(outputPath, {
      encoding: 'utf8',
    });

    const writeSql = content => {
      if (!output.write(content + '\n')) {
        throw new Error('Unable to write SQL export.');
      }
    };

    writeSql('-- ===============================================');
    writeSql('-- WORKFLOWOS DATABASE EXPORT');
    writeSql('-- Generated: ' + new Date().toISOString());
    writeSql('-- Source: ' + databaseName);
    writeSql('-- MariaDB: ' + identity[0].version);
    writeSql('-- ===============================================');
    writeSql('');

    writeSql('SET NAMES utf8mb4;');
    writeSql('SET FOREIGN_KEY_CHECKS = 0;');
    writeSql('SET UNIQUE_CHECKS = 0;');
    writeSql('');

    writeSql(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
    );

    writeSql(`USE ${quoteIdentifier(databaseName)};`);
    writeSql('');

    // Discover all tables and views.
    const [objects] = await connection.query(
      `SHOW FULL TABLES FROM ${quoteIdentifier(databaseName)}`
    );

    const objectTypeColumn = Object.keys(objects[0] || {})
      .find(key => key.startsWith('Table_type'));

    const objectNameColumn = Object.keys(objects[0] || {})
      .find(key => key.startsWith('Tables_in_'));

    if (!objects.length) {
      console.log('[WARNING] Database contains no tables or views.');
    }

    const tables = objects.filter(
      row => row[objectTypeColumn] === 'BASE TABLE'
    );

    const views = objects.filter(
      row => row[objectTypeColumn] === 'VIEW'
    );

    console.log('Tables found:', tables.length);
    console.log('Views found:', views.length);

    let totalRecords = 0;

    // Export table definitions.
    writeSql('-- ===============================================');
    writeSql('-- TABLE DEFINITIONS');
    writeSql('-- ===============================================');

    for (const object of tables) {
      const tableName = object[objectNameColumn];

      console.log('[SCHEMA]', tableName);

      const [definitions] = await connection.query(
        `SHOW CREATE TABLE ${quoteIdentifier(tableName)}`
      );

      const createStatement =
        definitions[0]['Create Table'] ||
        definitions[0]['Create View'];

      if (!createStatement) {
        throw new Error(`Could not export table definition: ${tableName}`);
      }

      writeSql('');
      writeSql(`-- Table: ${tableName}`);
      writeSql('DROP TABLE IF EXISTS ' + quoteIdentifier(tableName) + ';');
      writeSql(createStatement + ';');
      writeSql('');
    }

    // Export table data.
    writeSql('-- ===============================================');
    writeSql('-- TABLE DATA');
    writeSql('-- ===============================================');

    for (const object of tables) {
      const tableName = object[objectNameColumn];

      console.log('[DATA]', tableName);

      const [columns] = await connection.query(
        `
          SELECT COLUMN_NAME, EXTRA
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION
        `,
        [databaseName, tableName]
      );

      // Generated columns must be omitted from INSERT statements.
      const insertableColumns = columns.filter(
        column => !String(column.EXTRA || '')
          .toUpperCase()
          .includes('GENERATED')
      );

      if (!insertableColumns.length) {
        console.log('[SKIP] No insertable columns:', tableName);
        continue;
      }

      const columnNames = insertableColumns.map(
        column => quoteIdentifier(column.COLUMN_NAME)
      );

      const selectColumns = columnNames.join(', ');

      const [rows] = await connection.query(
        `SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}`
      );

      console.log(`  Records: ${rows.length}`);

      totalRecords += rows.length;

      const batchSize = 100;

      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);

        const valueRows = batch.map(row => {
          const values = insertableColumns.map(
            column => sqlValue(row[column.COLUMN_NAME])
          );

          return '(' + values.join(', ') + ')';
        });

        writeSql('');
        writeSql(`-- ${tableName}: records ${start + 1} to ${start + batch.length}`);

        writeSql(
          `INSERT INTO ${quoteIdentifier(tableName)} ` +
          `(${selectColumns}) VALUES\n` +
          valueRows.join(',\n') + ';'
        );
      }

      writeSql('');
    }

    // Export views after their underlying tables.
    writeSql('-- ===============================================');
    writeSql('-- VIEWS');
    writeSql('-- ===============================================');

    for (const object of views) {
      const viewName = object[objectNameColumn];

      console.log('[VIEW]', viewName);

      const [definitions] = await connection.query(
        `SHOW CREATE VIEW ${quoteIdentifier(viewName)}`
      );

      const createView = definitions[0]['Create View'];

      if (createView) {
        writeSql('');
        writeSql(createView + ';');
        writeSql('');
      }
    }

    // Export triggers after data to avoid firing them during import.
    writeSql('-- ===============================================');
    writeSql('-- TRIGGERS');
    writeSql('-- ===============================================');

    const [triggers] = await connection.query(
      `
        SELECT TRIGGER_NAME
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = ?
        ORDER BY EVENT_OBJECT_TABLE, ACTION_ORDER
      `,
      [databaseName]
    );

    console.log('Triggers found:', triggers.length);

    for (const trigger of triggers) {
      const triggerName = trigger.TRIGGER_NAME;

      console.log('[TRIGGER]', triggerName);

      const [definitions] = await connection.query(
        `SHOW CREATE TRIGGER ${quoteIdentifier(triggerName)}`
      );

      let createTrigger =
        definitions[0]['SQL Original Statement'] ||
        definitions[0]['Create Trigger'];

      if (createTrigger) {
        createTrigger = createTrigger.replace(
          /DEFINER\s*=\s*`[^`]+`@`[^`]+`\s*/i,
          ''
        );

        writeSql('');
        writeSql('DELIMITER //');
        writeSql(createTrigger + '//');
        writeSql('DELIMITER ;');
        writeSql('');
      }
    }

    writeSql('SET UNIQUE_CHECKS = 1;');
    writeSql('SET FOREIGN_KEY_CHECKS = 1;');

    writeSql('');
    writeSql('-- ===============================================');
    writeSql('-- EXPORT COMPLETE');
    writeSql('-- ===============================================');

    await new Promise((resolve, reject) => {
      output.end(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    output = null;

    console.log('\n========== EXPORT SUMMARY ==========');
    console.log('Source database:', databaseName);
    console.log('Tables exported:', tables.length);
    console.log('Views exported:', views.length);
    console.log('Triggers exported:', triggers.length);
    console.log('Records exported:', totalRecords);
    console.log('SQL file:', outputPath);
    console.log('\n[PASS] Database export completed.');

  } catch (error) {
    if (output) {
      output.destroy();
    }

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    console.error('\n[FAIL] Database export failed.');
    console.error('Reason:', error.message);

    process.exitCode = 1;

  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main().catch(error => {
  console.error('[UNEXPECTED ERROR]', error.message);
  process.exitCode = 1;
});
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

const mysql = require('mysql2/promise');

const required = [
  'TEST_DB_HOST',
  'TEST_DB_USER',
  'TEST_DB_PASSWORD',
  'TEST_DB_NAME',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  throw new Error(`Missing TEST database settings: ${missing.join(', ')}`);
}

const outputDirectory = path.resolve(__dirname, '../database/exports');

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function getCreateStatement(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key]) return row[key];
  }

  const matchingKey = Object.keys(row).find((key) =>
    possibleKeys.some((candidate) =>
      key.toLowerCase() === candidate.toLowerCase()
    )
  );

  return matchingKey ? row[matchingKey] : null;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
    ssl: { rejectUnauthorized: false },
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  });

  try {
    const [[identity]] = await connection.query(`
      SELECT DATABASE() AS database_name,
             VERSION() AS server_version
    `);

    if (identity.database_name !== process.env.TEST_DB_NAME) {
      throw new Error(
        `Safety check failed. Connected to ${identity.database_name}, expected ${process.env.TEST_DB_NAME}`
      );
    }

    console.log('Connected to TEST database:', identity.database_name);
    console.log('MariaDB version:', identity.server_version);
    console.log('Preparing SQL export...');

    const [objects] = await connection.query(`
      SELECT TABLE_NAME, TABLE_TYPE
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_TYPE, TABLE_NAME
    `);

    const tables = objects.filter((item) => item.TABLE_TYPE === 'BASE TABLE');
    const views = objects.filter((item) => item.TABLE_TYPE === 'VIEW');

    const sql = [];

    sql.push('-- WorkflowOS TEST database export');
    sql.push(`-- Database: ${identity.database_name}`);
    sql.push(`-- Exported: ${new Date().toISOString()}`);
    sql.push('-- Contains table definitions, table data, views and triggers.');
    sql.push('-- Review this file before importing. DROP statements are destructive.');
    sql.push('');
    sql.push('SET NAMES utf8mb4;');
    sql.push('SET FOREIGN_KEY_CHECKS = 0;');
    sql.push('');

    // Remove existing views first.
    for (const view of views) {
      sql.push(`DROP VIEW IF EXISTS ${quoteIdentifier(view.TABLE_NAME)};`);
    }

    // Remove existing tables so this file can rebuild a clean database.
    for (const table of tables) {
      sql.push(`DROP TABLE IF EXISTS ${quoteIdentifier(table.TABLE_NAME)};`);
    }

    sql.push('');

    let totalRows = 0;

    // Export table definitions and records.
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      const quotedTable = quoteIdentifier(tableName);

      console.log(`Exporting table: ${tableName}`);

      const [createRows] = await connection.query(
        `SHOW CREATE TABLE ${quotedTable}`
      );

      const createStatement = getCreateStatement(createRows[0], [
        'Create Table',
        'Create Table',
      ]);

      if (!createStatement) {
        throw new Error(`Could not retrieve CREATE TABLE for ${tableName}`);
      }

      sql.push('');
      sql.push(`-- Structure: ${tableName}`);
      sql.push(`${createStatement};`);
      sql.push('');

      const [columns] = await connection.execute(`
        SELECT COLUMN_NAME, EXTRA
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [tableName]);

      // Generated columns are calculated by MariaDB and must not be inserted.
      const insertColumns = columns
        .filter((column) =>
          !/VIRTUAL GENERATED|STORED GENERATED|PERSISTENT GENERATED/i.test(
            column.EXTRA || ''
          )
        )
        .map((column) => column.COLUMN_NAME);

      const [rows] = await connection.query(
        `SELECT * FROM ${quotedTable}`
      );

      totalRows += rows.length;

      if (rows.length && insertColumns.length) {
        const columnSql = insertColumns.map(quoteIdentifier).join(', ');

        sql.push(`-- Data: ${tableName} (${rows.length} rows)`);

        for (const row of rows) {
          const values = insertColumns
            .map((column) => connection.escape(row[column]))
            .join(', ');

          sql.push(
            `INSERT INTO ${quotedTable} (${columnSql}) VALUES (${values});`
          );
        }

        sql.push('');
      }

      console.log(`  ${rows.length} rows exported`);
    }

    // Export views after their underlying tables.
    for (const view of views) {
      const viewName = view.TABLE_NAME;

      console.log(`Exporting view: ${viewName}`);

      const [createRows] = await connection.query(
        `SHOW CREATE VIEW ${quoteIdentifier(viewName)}`
      );

      const createStatement = getCreateStatement(createRows[0], [
        'Create View',
      ]);

      if (createStatement) {
        sql.push('');
        sql.push(`-- View: ${viewName}`);
        sql.push(`${createStatement};`);
        sql.push('');
      }
    }

    // Export triggers after tables and data.
    const [triggers] = await connection.query('SHOW TRIGGERS');

    for (const trigger of triggers) {
      console.log(`Exporting trigger: ${trigger.Trigger}`);

      const [createRows] = await connection.query(
        `SHOW CREATE TRIGGER ${quoteIdentifier(trigger.Trigger)}`
      );

      const createStatement = getCreateStatement(createRows[0], [
        'SQL Original Statement',
        'Create Trigger',
      ]);

      if (createStatement) {
        sql.push('');
        sql.push(`-- Trigger: ${trigger.Trigger}`);
        sql.push('DELIMITER //');
        sql.push(`${createStatement}//`);
        sql.push('DELIMITER ;');
        sql.push('');
      }
    }

    sql.push('');
    sql.push('SET FOREIGN_KEY_CHECKS = 1;');
    sql.push('');
    sql.push('-- End of WorkflowOS TEST database export.');

    fs.mkdirSync(outputDirectory, { recursive: true });

    const safeName = identity.database_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(
      outputDirectory,
      `workflowos-${safeName}-${timestamp}.sql`
    );

    fs.writeFileSync(outputFile, sql.join('\n'), 'utf8');

    const stats = fs.statSync(outputFile);

    console.log('\n========================================');
    console.log('DATABASE EXPORT SUCCESSFUL');
    console.log('========================================');
    console.log('Database:', identity.database_name);
    console.log('Tables:', tables.length);
    console.log('Views:', views.length);
    console.log('Triggers:', triggers.length);
    console.log('Rows:', totalRows);
    console.log('File:', outputFile);
    console.log('Size:', `${(stats.size / 1024).toFixed(2)} KB`);
    console.log('========================================');
    console.log('The source database was not modified.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('\nDATABASE EXPORT FAILED');
  console.error(error.message);
  process.exitCode = 1;
});
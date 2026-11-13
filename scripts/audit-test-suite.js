const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';

const TEST_DIRECTORY = path.resolve(__dirname, '../tests');

const REQUIRED_TEST_FILES = [
  'auth-flow.test.js',
  'business-data.test.js',
  'catalogue.test.js',
  'dashboard.test.js',
  'product-edit.test.js',
];

const EMAIL_REGEX =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const SQLITE_PATTERNS = [
  { label: 'DATABASE_PATH', regex: /DATABASE_PATH/g },
  { label: 'better-sqlite3', regex: /better-sqlite3/g },
  { label: 'db.close()', regex: /\.close\s*\(\s*\)/g },
  { label: 'SQLite constraint codes', regex: /SQLITE_CONSTRAINT/g },
  { label: 'SQLite file references', regex: /\.db['"`]/g },
];

const results = {
  checks: 0,
  passed: 0,
  warnings: 0,
  failed: 0,
};

function check(label, passed, detail = '') {
  results.checks++;

  if (passed) {
    results.passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    results.failed++;
    console.log(`  [FAIL] ${label}`);
  }

  if (detail) console.log(`         ${detail}`);
}

function warning(label, detail = '') {
  results.warnings++;
  console.log(`  [WARN] ${label}`);

  if (detail) console.log(`         ${detail}`);
}

function heading(title) {
  console.log('\n========================================');
  console.log(`  ${title}`);
  console.log('========================================');
}

function getTestFiles() {
  return REQUIRED_TEST_FILES.map((name) => ({
    name,
    path: path.join(TEST_DIRECTORY, name),
  }));
}

async function main() {
  let db;

  try {
    heading('WORKFLOWOS TEST SUITE AUDIT');

    console.log(`Expected database: ${EXPECTED_DATABASE}`);
    console.log(`Expected host: ${EXPECTED_HOST}`);

    heading('1. ENVIRONMENT CONFIGURATION');

    const requiredVariables = [
      'TEST_DB_HOST',
      'TEST_DB_USER',
      'TEST_DB_PASSWORD',
      'TEST_DB_NAME',
    ];

    const missingVariables = requiredVariables.filter(
      (name) => !process.env[name]
    );

    check(
      'Required TEST database variables exist',
      missingVariables.length === 0,
      missingVariables.length
        ? `Missing: ${missingVariables.join(', ')}`
        : 'All required variables are present'
    );

    if (missingVariables.length > 0) {
      throw new Error('Cannot continue without TEST database configuration.');
    }

    check(
      'Database name is the expected TEST database',
      process.env.TEST_DB_NAME === EXPECTED_DATABASE,
      `Configured: ${process.env.TEST_DB_NAME}`
    );

    check(
      'Database host is the expected staging host',
      process.env.TEST_DB_HOST === EXPECTED_HOST,
      `Configured: ${process.env.TEST_DB_HOST}`
    );

    if (
      process.env.TEST_DB_NAME !== EXPECTED_DATABASE ||
      process.env.TEST_DB_HOST !== EXPECTED_HOST
    ) {
      throw new Error('Database safety check failed. No database query performed.');
    }

    heading('2. TEST FILE DISCOVERY');

    const files = getTestFiles();
    const readableFiles = [];

    for (const file of files) {
      const exists = fs.existsSync(file.path);

      check(
        `${file.name} exists`,
        exists,
        file.path
      );

      if (exists) {
        readableFiles.push({
          ...file,
          content: fs.readFileSync(file.path, 'utf8'),
        });
      }
    }

    heading('3. TEST EMAIL INVENTORY');

    const emailOccurrences = [];

    for (const file of readableFiles) {
      const lines = file.content.split(/\r?\n/);

      lines.forEach((line, index) => {
        const matches = line.match(EMAIL_REGEX);

        if (!matches) return;

        for (const email of matches) {
          emailOccurrences.push({
            email: email.toLowerCase(),
            file: file.name,
            line: index + 1,
          });
        }
      });
    }

    const uniqueEmails = [
      ...new Set(emailOccurrences.map((item) => item.email)),
    ];

    console.log(`Email occurrences: ${emailOccurrences.length}`);
    console.log(`Unique email addresses: ${uniqueEmails.length}`);

    for (const email of uniqueEmails) {
      const locations = emailOccurrences
        .filter((item) => item.email === email)
        .map((item) => `${item.file}:${item.line}`);

      console.log(`  ${email}`);
      console.log(`    Found in: ${locations.join(', ')}`);
    }

    const registrationEmails = emailOccurrences.filter((item) => {
      const file = readableFiles.find((entry) => entry.name === item.file);
      if (!file) return false;

      const lines = file.content.split(/\r?\n/);
      const line = lines[item.line - 1] || '';

      return /register|email\s*:/.test(line);
    });

    heading('4. MARIADB READ-ONLY CHECK');

    db = mysql.createPool({
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD,
      database: process.env.TEST_DB_NAME,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: 'Z',
      ssl: { rejectUnauthorized: false },
    });

    const [databaseRows] = await db.query(
      'SELECT DATABASE() AS database_name, VERSION() AS version'
    );

    check(
      'MariaDB connection successful',
      databaseRows.length === 1,
      `${databaseRows[0].database_name} | ${databaseRows[0].version}`
    );

    const emailsToCheck = uniqueEmails;

    let existingUsers = [];

    if (emailsToCheck.length > 0) {
      const placeholders = emailsToCheck.map(() => '?').join(', ');

      const [rows] = await db.execute(
        `SELECT id, email FROM users WHERE LOWER(email) IN (${placeholders})`,
        emailsToCheck
      );

      existingUsers = rows;
    }

    console.log('\nExisting database email matches:');

    if (existingUsers.length === 0) {
      console.log('  None found.');
    } else {
      for (const user of existingUsers) {
        const locations = emailOccurrences
          .filter((item) => item.email === user.email.toLowerCase())
          .map((item) => `${item.file}:${item.line}`);

        console.log(
          `  USER ID ${user.id} | ${user.email} | ${locations.join(', ')}`
        );
      }
    }

    check(
      'No hard-coded test emails already exist in users',
      existingUsers.length === 0,
      `${existingUsers.length} existing matches found`
    );

    heading('5. SQLITE COMPATIBILITY CHECK');

    let sqliteIssues = 0;

    for (const file of readableFiles) {
      for (const pattern of SQLITE_PATTERNS) {
        const matches = [...file.content.matchAll(pattern.regex)];

        if (matches.length > 0) {
          sqliteIssues += matches.length;

          warning(
            `${file.name} contains ${pattern.label}`,
            `${matches.length} occurrence(s)`
          );
        }
      }
    }

    check(
      'No obvious SQLite-specific test assumptions',
      sqliteIssues === 0,
      `${sqliteIssues} potential SQLite reference(s)`
    );

    heading('6. RECURSIVE TEST RUNNER CHECK');

    const packagePath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(
      fs.readFileSync(packagePath, 'utf8')
    );

    const testCommand = packageJson.scripts?.test || '';

    console.log(`npm test: ${testCommand}`);

    const runnerIssues = readableFiles.filter((file) =>
      /npm\s+test|execSync\s*\(\s*['"`]npm|spawnSync\s*\(\s*['"`]npm/.test(
        file.content
      )
    );

    check(
      'No test file launches npm test recursively',
      runnerIssues.length === 0,
      runnerIssues.length
        ? runnerIssues.map((file) => file.name).join(', ')
        : 'No recursive npm test calls found'
    );

    check(
      'Test command targets the tests directory',
      /node\s+--test.*tests\/?/.test(testCommand),
      testCommand
    );

    heading('7. FINAL AUDIT SUMMARY');

    console.log(`Checks performed: ${results.checks}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Warnings: ${results.warnings}`);
    console.log(`Failed: ${results.failed}`);

    console.log('\nDATABASE CHANGES: NONE');
    console.log('User registrations: NONE');
    console.log('Business creation: NONE');
    console.log('Data deletion: NONE');

    if (results.failed > 0 || results.warnings > 0) {
      console.log('\nRESULT: REVIEW REQUIRED');
    } else {
      console.log('\nRESULT: PREFLIGHT PASSED');
    }

    console.log(
      '\nThis audit does not execute the integration tests. ' +
      'It checks whether the suite is ready to be made safe to run.'
    );
  } catch (error) {
    console.error('\nAUDIT STOPPED:', error.message);
    process.exitCode = 1;
  } finally {
    if (db) await db.end();
  }
}

main();

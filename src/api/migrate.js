
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATION_DIRECTORY = path.resolve(
  __dirname,
  '../../database/migrations-mariadb'
);

const MIGRATION_LOCK_NAME = 'workflowos_schema_migrations';

function splitSqlStatements(sql) {
  const statements = [];

  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += char;

      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;

      if (char === '*' && next === '/') {
        current += next;
        i += 1;
        blockComment = false;
      }

      continue;
    }

    if (quote) {
      current += char;

      if (char === '\\' && next) {
        current += next;
        i += 1;
        continue;
      }

      if (char === quote) {
        if (next === quote) {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }

      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '-' && next === '-' && /\s/.test(sql[i + 2] || ' ')) {
      lineComment = true;
      current += char + next;
      i += 1;
      continue;
    }

    if (char === '#') {
      lineComment = true;
      current += char;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      current += char + next;
      i += 1;
      continue;
    }

    if (char === ';') {
      if (hasExecutableSql(current)) {
        statements.push(current.trim());
      }

      current = '';
      continue;
    }

    current += char;
  }

  if (quote || blockComment) {
    throw new Error('Invalid SQL migration: unclosed quote or comment.');
  }

  if (hasExecutableSql(current)) {
    statements.push(current.trim());
  }

  return statements;
}

function hasExecutableSql(statement) {
  const withoutComments = statement
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)--[^\r\n]*/g, '$1')
    .replace(/(^|\s)#[^\r\n]*/g, '$1');

  return withoutComments.trim().length > 0;
}

async function applyMigrations(
  db,
  migrationDirectory = DEFAULT_MIGRATION_DIRECTORY
) {
  if (!db || typeof db.getConnection !== 'function') {
    throw new Error('A MariaDB connection pool is required.');
  }

  if (!fs.existsSync(migrationDirectory)) {
    throw new Error(
      `MariaDB migration directory not found: ${migrationDirectory}`
    );
  }

  const files = fs.readdirSync(migrationDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = [];
  const connection = await db.getConnection();

  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query(
      'SELECT GET_LOCK(?, 10) AS acquired',
      [MIGRATION_LOCK_NAME]
    );

    lockAcquired = Number(lockRows[0]?.acquired) === 1;

    if (!lockAcquired) {
      throw new Error('Could not acquire the database migration lock.');
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) NOT NULL PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    for (const file of files) {
      const filePath = path.join(migrationDirectory, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const checksum = crypto
        .createHash('sha256')
        .update(sql)
        .digest('hex');

      const [existingRows] = await connection.execute(
        'SELECT checksum FROM schema_migrations WHERE version = ?',
        [file]
      );

      if (existingRows.length > 0) {
        if (existingRows[0].checksum !== checksum) {
          throw new Error(
            `Applied migration checksum changed: ${file}`
          );
        }

        continue;
      }

      const statements = splitSqlStatements(sql);

      for (const statement of statements) {
        await connection.query(statement);
      }

      await connection.execute(
        `INSERT INTO schema_migrations (version, checksum)
         VALUES (?, ?)`,
        [file, checksum]
      );

      applied.push(file);
      console.log(`Applied MariaDB migration: ${file}`);
    }

    return applied;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query(
          'SELECT RELEASE_LOCK(?)',
          [MIGRATION_LOCK_NAME]
        );
      } catch (error) {
        console.error('Could not release migration lock:', error.message);
      }
    }

    connection.release();
  }
}

module.exports = {
  applyMigrations,
  splitSqlStatements,
};

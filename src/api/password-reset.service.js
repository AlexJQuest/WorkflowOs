const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');

function digestToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createPasswordResetToken(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const [users] = await db.execute(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [normalizedEmail]
  );
  if (!users[0]) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = digestToken(token);
  await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [users[0].id]);
  await db.execute(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))`,
    [users[0].id, tokenHash]
  );
  return token;
}

async function completePasswordReset(token, password) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return false;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()
       LIMIT 1 FOR UPDATE`,
      [digestToken(token)]
    );
    if (!rows[0]) {
      await connection.rollback();
      return false;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await connection.execute(
      'UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [passwordHash, rows[0].user_id]
    );
    await connection.execute(
      'DELETE FROM password_reset_tokens WHERE user_id = ?',
      [rows[0].user_id]
    );
    await connection.execute(
      'DELETE FROM sessions WHERE user_id = ?',
      [rows[0].user_id]
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deletePasswordResetToken(token) {
  if (!token) return;
  await db.execute(
    'DELETE FROM password_reset_tokens WHERE token_hash = ?',
    [digestToken(token)]
  );
}

module.exports = {
  createPasswordResetToken,
  completePasswordReset,
  deletePasswordResetToken,
};

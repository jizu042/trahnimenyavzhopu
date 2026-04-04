const pool = require("../connection");

/**
 * Найти или создать пользователя по Ely.by ID
 */
async function findOrCreateUser(elyId, username, accessToken, refreshToken, expiresAt) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let result = await client.query("SELECT * FROM users WHERE ely_id = $1", [elyId]);

    if (result.rows.length === 0) {
      result = await client.query(
        `INSERT INTO users (ely_id, username, access_token, refresh_token, token_expires_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [elyId, username, accessToken, refreshToken, expiresAt]
      );
    } else {
      result = await client.query(
        `UPDATE users
         SET username = $2, access_token = $3, refresh_token = $4, token_expires_at = $5, updated_at = NOW()
         WHERE ely_id = $1
         RETURNING *`,
        [elyId, username, accessToken, refreshToken, expiresAt]
      );
    }

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Найти пользователя по ID
 */
async function findUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

/**
 * Найти пользователя по Ely.by ID
 */
async function findUserByElyId(elyId) {
  const result = await pool.query("SELECT * FROM users WHERE ely_id = $1", [elyId]);
  return result.rows[0] || null;
}

/**
 * Обновить токены пользователя
 */
async function updateUserTokens(userId, accessToken, refreshToken, expiresAt) {
  const result = await pool.query(
    `UPDATE users
     SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId, accessToken, refreshToken, expiresAt]
  );
  return result.rows[0] || null;
}

/**
 * Проверить, является ли пользователь админом
 */
async function isAdmin(userId) {
  const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.is_admin || false;
}

/**
 * Забанить/разбанить пользователя
 */
async function setBanStatus(userId, isBanned) {
  const result = await pool.query(
    "UPDATE users SET is_banned = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [userId, isBanned]
  );
  return result.rows[0] || null;
}

/**
 * Получить всех пользователей (для админ-панели)
 */
async function getAllUsers(limit = 100, offset = 0) {
  const result = await pool.query(
    "SELECT id, ely_id, username, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return result.rows;
}

module.exports = {
  findOrCreateUser,
  findUserById,
  findUserByElyId,
  updateUserTokens,
  isAdmin,
  setBanStatus,
  getAllUsers
};

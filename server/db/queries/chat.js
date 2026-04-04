const pool = require("../connection");

/**
 * Сохранить сообщение в чат
 */
async function saveMessage(userId, username, message) {
  const result = await pool.query(
    "INSERT INTO chat_messages (user_id, username, message, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
    [userId, username, message]
  );
  return result.rows[0];
}

/**
 * Получить последние сообщения
 */
async function getRecentMessages(limit = 50) {
  const result = await pool.query(
    "SELECT id, user_id, username, message, created_at FROM chat_messages ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return result.rows.reverse();
}

/**
 * Удалить сообщение (для модерации)
 */
async function deleteMessage(messageId) {
  const result = await pool.query("DELETE FROM chat_messages WHERE id = $1 RETURNING *", [
    messageId
  ]);
  return result.rows[0] || null;
}

/**
 * Удалить старые сообщения (старше N дней)
 */
async function deleteOldMessages(days = 7) {
  const result = await pool.query(
    "DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '$1 days' RETURNING id",
    [days]
  );
  return result.rowCount;
}

/**
 * Получить количество сообщений пользователя за последние N минут (для rate limiting)
 */
async function getUserMessageCount(userId, minutes = 1) {
  const result = await pool.query(
    "SELECT COUNT(*) as count FROM chat_messages WHERE user_id = $1 AND created_at > NOW() - INTERVAL '$2 minutes'",
    [userId, minutes]
  );
  return parseInt(result.rows[0]?.count || 0);
}

module.exports = {
  saveMessage,
  getRecentMessages,
  deleteMessage,
  deleteOldMessages,
  getUserMessageCount
};

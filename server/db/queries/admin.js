const pool = require("../connection");

/**
 * Получить значение конфигурации
 */
async function getConfig(key) {
  const result = await pool.query("SELECT value FROM admin_config WHERE key = $1", [key]);
  return result.rows[0]?.value || null;
}

/**
 * Установить значение конфигурации
 */
async function setConfig(key, value, description = null) {
  const result = await pool.query(
    `INSERT INTO admin_config (key, value, description, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = $2, description = COALESCE($3, admin_config.description), updated_at = NOW()
     RETURNING *`,
    [key, value, description]
  );
  return result.rows[0];
}

/**
 * Получить все конфигурации
 */
async function getAllConfig() {
  const result = await pool.query("SELECT * FROM admin_config ORDER BY key");
  return result.rows;
}

/**
 * Удалить конфигурацию
 */
async function deleteConfig(key) {
  const result = await pool.query("DELETE FROM admin_config WHERE key = $1 RETURNING *", [key]);
  return result.rows[0] || null;
}

/**
 * Получить общую статистику для админ-панели
 */
async function getAdminStats() {
  const usersCount = await pool.query("SELECT COUNT(*) as count FROM users");
  const messagesCount = await pool.query("SELECT COUNT(*) as count FROM chat_messages");
  const sessionsCount = await pool.query("SELECT COUNT(*) as count FROM player_sessions");
  const activeSessionsCount = await pool.query(
    "SELECT COUNT(*) as count FROM player_sessions WHERE logout_time IS NULL"
  );

  return {
    totalUsers: parseInt(usersCount.rows[0].count),
    totalMessages: parseInt(messagesCount.rows[0].count),
    totalSessions: parseInt(sessionsCount.rows[0].count),
    activeSessions: parseInt(activeSessionsCount.rows[0].count)
  };
}

module.exports = {
  getConfig,
  setConfig,
  getAllConfig,
  deleteConfig,
  getAdminStats
};

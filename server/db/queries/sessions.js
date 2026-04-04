const pool = require("../connection");

/**
 * Создать новую сессию игрока
 */
async function createSession(serverAddress, username, loginTime) {
  const result = await pool.query(
    "INSERT INTO player_sessions (server_address, username, login_time, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
    [serverAddress, username, loginTime]
  );
  return result.rows[0];
}

/**
 * Завершить сессию игрока
 */
async function endSession(serverAddress, username, logoutTime) {
  const result = await pool.query(
    `UPDATE player_sessions
     SET logout_time = $3, duration_seconds = EXTRACT(EPOCH FROM ($3 - login_time))::INTEGER
     WHERE server_address = $1 AND username = $2 AND logout_time IS NULL
     RETURNING *`,
    [serverAddress, username, logoutTime]
  );
  return result.rows;
}

/**
 * Получить активные сессии для сервера
 */
async function getActiveSessions(serverAddress) {
  const result = await pool.query(
    "SELECT * FROM player_sessions WHERE server_address = $1 AND logout_time IS NULL ORDER BY login_time DESC",
    [serverAddress]
  );
  return result.rows;
}

/**
 * Получить статистику игрока
 */
async function getPlayerStats(username, serverAddress = null) {
  const query = serverAddress
    ? `SELECT
         COUNT(*) as total_sessions,
         SUM(duration_seconds) as total_seconds,
         AVG(duration_seconds) as avg_seconds,
         MIN(login_time) as first_seen,
         MAX(login_time) as last_seen
       FROM player_sessions
       WHERE username = $1 AND server_address = $2 AND logout_time IS NOT NULL`
    : `SELECT
         COUNT(*) as total_sessions,
         SUM(duration_seconds) as total_seconds,
         AVG(duration_seconds) as avg_seconds,
         MIN(login_time) as first_seen,
         MAX(login_time) as last_seen
       FROM player_sessions
       WHERE username = $1 AND logout_time IS NOT NULL`;

  const params = serverAddress ? [username, serverAddress] : [username];
  const result = await pool.query(query, params);
  return result.rows[0];
}

/**
 * Получить историю сессий игрока
 */
async function getPlayerSessions(username, limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM player_sessions
     WHERE username = $1
     ORDER BY login_time DESC
     LIMIT $2 OFFSET $3`,
    [username, limit, offset]
  );
  return result.rows;
}

/**
 * Удалить старые сессии (старше N дней)
 */
async function deleteOldSessions(days = 7) {
  const result = await pool.query(
    "DELETE FROM player_sessions WHERE created_at < NOW() - INTERVAL '$1 days' RETURNING id",
    [days]
  );
  return result.rowCount;
}

module.exports = {
  createSession,
  endSession,
  getActiveSessions,
  getPlayerStats,
  getPlayerSessions,
  deleteOldSessions
};

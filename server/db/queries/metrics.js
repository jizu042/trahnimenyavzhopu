const pool = require("../connection");

/**
 * Обновить или создать запись uptime для сервера
 */
async function upsertServerUptime(serverAddress, online, onlineSince, lastCheck) {
  const result = await pool.query(
    `INSERT INTO server_uptime (server_address, online, online_since, last_check, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (server_address)
     DO UPDATE SET
       online = $2,
       online_since = $3,
       last_check = $4,
       updated_at = NOW()
     RETURNING *`,
    [serverAddress, online, onlineSince, lastCheck]
  );
  return result.rows[0];
}

/**
 * Получить uptime сервера
 */
async function getServerUptime(serverAddress) {
  const result = await pool.query("SELECT * FROM server_uptime WHERE server_address = $1", [
    serverAddress
  ]);
  return result.rows[0] || null;
}

/**
 * Сохранить метрики сервера
 */
async function saveServerMetrics(serverAddress, online, pingMs, playersOnline, playersMax, version) {
  const result = await pool.query(
    `INSERT INTO server_metrics (server_address, online, ping_ms, players_online, players_max, version, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [serverAddress, online, pingMs, playersOnline, playersMax, version]
  );
  return result.rows[0];
}

/**
 * Получить последние метрики сервера
 */
async function getRecentMetrics(serverAddress, limit = 100) {
  const result = await pool.query(
    "SELECT * FROM server_metrics WHERE server_address = $1 ORDER BY recorded_at DESC LIMIT $2",
    [serverAddress, limit]
  );
  return result.rows;
}

/**
 * Удалить старые метрики (старше N дней)
 */
async function deleteOldMetrics(days = 7) {
  const result = await pool.query(
    "DELETE FROM server_metrics WHERE recorded_at < NOW() - INTERVAL '$1 days' RETURNING id",
    [days]
  );
  return result.rowCount;
}

module.exports = {
  upsertServerUptime,
  getServerUptime,
  saveServerMetrics,
  getRecentMetrics,
  deleteOldMetrics
};

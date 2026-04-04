const { deleteOldMessages } = require("../db/queries/chat");
const { deleteOldSessions } = require("../db/queries/sessions");
const { deleteOldMetrics } = require("../db/queries/metrics");

/**
 * Запустить периодическую очистку старых данных
 */
function startCleanupJob() {
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа
  const RETENTION_DAYS = 7;

  async function cleanup() {
    try {
      console.log("Running cleanup job...");

      const deletedMessages = await deleteOldMessages(RETENTION_DAYS);
      const deletedSessions = await deleteOldSessions(RETENTION_DAYS);
      const deletedMetrics = await deleteOldMetrics(RETENTION_DAYS);

      console.log(
        `Cleanup completed: ${deletedMessages} messages, ${deletedSessions} sessions, ${deletedMetrics} metrics deleted`
      );
    } catch (error) {
      console.error("Cleanup job error:", error);
    }
  }

  // Запустить сразу при старте
  cleanup();

  // Затем запускать каждые 24 часа
  setInterval(cleanup, CLEANUP_INTERVAL);
}

module.exports = { startCleanupJob };

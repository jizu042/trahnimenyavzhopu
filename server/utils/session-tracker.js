const { createSession, endSession, getActiveSessions } = require("../db/queries/sessions");

/**
 * Отслеживание сессий игроков
 */
class SessionTracker {
  constructor() {
    // Кэш последнего известного списка игроков для каждого сервера
    this.lastKnownPlayers = new Map();
  }

  /**
   * Обновить сессии на основе текущего списка игроков
   */
  async updateSessions(serverAddress, currentPlayers) {
    const now = new Date();
    const lastPlayers = this.lastKnownPlayers.get(serverAddress) || [];
    const currentPlayerNames = new Set(currentPlayers);
    const lastPlayerNames = new Set(lastPlayers);

    // Найти новых игроков (зашли на сервер)
    for (const player of currentPlayers) {
      if (!lastPlayerNames.has(player)) {
        try {
          await createSession(serverAddress, player, now);
          console.log(`Player joined: ${player} on ${serverAddress}`);
        } catch (error) {
          console.error(`Failed to create session for ${player}:`, error);
        }
      }
    }

    // Найти ушедших игроков (вышли с сервера)
    for (const player of lastPlayers) {
      if (!currentPlayerNames.has(player)) {
        try {
          await endSession(serverAddress, player, now);
          console.log(`Player left: ${player} from ${serverAddress}`);
        } catch (error) {
          console.error(`Failed to end session for ${player}:`, error);
        }
      }
    }

    // Обновить кэш
    this.lastKnownPlayers.set(serverAddress, currentPlayers);
  }

  /**
   * Восстановить состояние из БД при старте сервера
   */
  async restoreFromDatabase(serverAddress) {
    try {
      const activeSessions = await getActiveSessions(serverAddress);
      const players = activeSessions.map((s) => s.username);
      this.lastKnownPlayers.set(serverAddress, players);
      console.log(`Restored ${players.length} active sessions for ${serverAddress}`);
    } catch (error) {
      console.error(`Failed to restore sessions for ${serverAddress}:`, error);
    }
  }

  /**
   * Получить текущий список игроков из кэша
   */
  getLastKnownPlayers(serverAddress) {
    return this.lastKnownPlayers.get(serverAddress) || [];
  }
}

// Singleton instance
const sessionTracker = new SessionTracker();

module.exports = sessionTracker;

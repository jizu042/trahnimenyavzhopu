const express = require("express");
const { getPlayerStats, getPlayerSessions } = require("../db/queries/sessions");

const router = express.Router();

/**
 * Получить статистику игрока
 * GET /api/v1/stats/player/:username
 */
router.get("/player/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const serverAddress = req.query.server || null;

    const stats = await getPlayerStats(username, serverAddress);

    res.json({
      success: true,
      data: {
        username,
        totalSessions: parseInt(stats.total_sessions) || 0,
        totalSeconds: parseInt(stats.total_seconds) || 0,
        avgSeconds: parseFloat(stats.avg_seconds) || 0,
        firstSeen: stats.first_seen,
        lastSeen: stats.last_seen
      },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error fetching player stats:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: "FETCH_ERROR",
        message: "Failed to fetch player statistics"
      },
      meta: null
    });
  }
});

/**
 * Получить историю сессий игрока
 * GET /api/v1/stats/sessions?username=X&limit=50&offset=0
 */
router.get("/sessions", async (req, res) => {
  try {
    const username = req.query.username;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    if (!username) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: "BAD_REQUEST",
          message: "Username is required"
        },
        meta: null
      });
    }

    const sessions = await getPlayerSessions(username, limit, offset);

    res.json({
      success: true,
      data: { sessions },
      error: null,
      meta: { count: sessions.length, limit, offset }
    });
  } catch (error) {
    console.error("Error fetching player sessions:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: "FETCH_ERROR",
        message: "Failed to fetch player sessions"
      },
      meta: null
    });
  }
});

module.exports = router;

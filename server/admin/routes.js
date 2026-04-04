const express = require("express");
const { requireAdmin } = require("../auth/middleware");
const { getAllConfig, setConfig, deleteConfig, getAdminStats } = require("../db/queries/admin");
const { getAllUsers, setBanStatus } = require("../db/queries/users");
const { deleteMessage } = require("../db/queries/chat");

const router = express.Router();

/**
 * Получить все настройки
 * GET /api/v1/admin/config
 */
router.get("/config", requireAdmin, async (req, res) => {
  try {
    const config = await getAllConfig();
    res.json({
      success: true,
      data: { config },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error fetching admin config:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "FETCH_ERROR", message: "Failed to fetch configuration" },
      meta: null
    });
  }
});

/**
 * Установить настройку
 * POST /api/v1/admin/config
 */
router.post("/config", requireAdmin, async (req, res) => {
  try {
    const { key, value, description } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: "BAD_REQUEST", message: "Key is required" },
        meta: null
      });
    }

    const config = await setConfig(key, value, description);
    res.json({
      success: true,
      data: { config },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error setting admin config:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "UPDATE_ERROR", message: "Failed to update configuration" },
      meta: null
    });
  }
});

/**
 * Удалить настройку
 * DELETE /api/v1/admin/config/:key
 */
router.delete("/config/:key", requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteConfig(req.params.key);
    res.json({
      success: true,
      data: { deleted: !!deleted },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error deleting admin config:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "DELETE_ERROR", message: "Failed to delete configuration" },
      meta: null
    });
  }
});

/**
 * Получить список пользователей
 * GET /api/v1/admin/users
 */
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const users = await getAllUsers(limit, offset);
    res.json({
      success: true,
      data: { users },
      error: null,
      meta: { count: users.length, limit, offset }
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "FETCH_ERROR", message: "Failed to fetch users" },
      meta: null
    });
  }
});

/**
 * Забанить/разбанить пользователя
 * POST /api/v1/admin/users/:id/ban
 */
router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { banned } = req.body;

    if (typeof banned !== "boolean") {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: "BAD_REQUEST", message: "banned field must be boolean" },
        meta: null
      });
    }

    const user = await setBanStatus(userId, banned);
    res.json({
      success: true,
      data: { user },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error updating ban status:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "UPDATE_ERROR", message: "Failed to update ban status" },
      meta: null
    });
  }
});

/**
 * Получить общую статистику
 * GET /api/v1/admin/stats
 */
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminStats();
    res.json({
      success: true,
      data: stats,
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "FETCH_ERROR", message: "Failed to fetch statistics" },
      meta: null
    });
  }
});

module.exports = router;

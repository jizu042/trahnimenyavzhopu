const express = require("express");
const { getRecentMessages, deleteMessage } = require("../db/queries/chat");
const { requireAdmin } = require("../auth/middleware");

const router = express.Router();

/**
 * Получить историю чата
 * GET /api/v1/chat/messages?limit=50
 */
router.get("/messages", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const messages = await getRecentMessages(limit);

    res.json({
      success: true,
      data: { messages },
      error: null,
      meta: { count: messages.length }
    });
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: "FETCH_ERROR",
        message: "Failed to fetch chat messages"
      },
      meta: null
    });
  }
});

/**
 * Удалить сообщение (только для админов)
 * DELETE /api/v1/chat/messages/:id
 */
router.delete("/messages/:id", requireAdmin, async (req, res) => {
  try {
    const messageId = parseInt(req.params.id);
    const deleted = await deleteMessage(messageId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "Message not found"
        },
        meta: null
      });
    }

    res.json({
      success: true,
      data: { deleted: true, messageId },
      error: null,
      meta: null
    });
  } catch (error) {
    console.error("Error deleting chat message:", error);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: "DELETE_ERROR",
        message: "Failed to delete message"
      },
      meta: null
    });
  }
});

module.exports = router;

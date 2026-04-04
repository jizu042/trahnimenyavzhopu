const express = require("express");
const passport = require("./passport");

const router = express.Router();

/**
 * Начать OAuth авторизацию через Ely.by
 */
router.get("/ely/login", passport.authenticate("ely"));

/**
 * Callback после авторизации Ely.by
 */
router.get(
  "/ely/callback",
  passport.authenticate("ely", {
    failureRedirect: process.env.FRONTEND_URL || "/"
  }),
  (req, res) => {
    // Успешная авторизация - редирект на фронтенд
    const frontendUrl = process.env.FRONTEND_URL || "/";
    res.redirect(frontendUrl);
  }
);

/**
 * Выход из системы
 */
router.get("/ely/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        data: null,
        error: {
          code: "LOGOUT_ERROR",
          message: "Failed to logout"
        },
        meta: null
      });
    }
    res.json({
      success: true,
      data: { message: "Logged out successfully" },
      error: null,
      meta: null
    });
  });
});

/**
 * Получить информацию о текущем пользователе
 */
router.get("/me", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({
      success: true,
      data: { authenticated: false, user: null },
      error: null,
      meta: null
    });
  }

  const { id, ely_id, username, is_admin, is_banned, created_at } = req.user;

  res.json({
    success: true,
    data: {
      authenticated: true,
      user: {
        id,
        ely_id,
        username,
        is_admin,
        is_banned,
        created_at
      }
    },
    error: null,
    meta: null
  });
});

module.exports = router;

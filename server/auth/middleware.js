/**
 * Middleware для проверки авторизации
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({
    success: false,
    data: null,
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required"
    },
    meta: null
  });
}

/**
 * Middleware для проверки прав администратора
 */
function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      success: false,
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required"
      },
      meta: null
    });
  }

  if (!req.user.is_admin) {
    return res.status(403).json({
      success: false,
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Admin access required"
      },
      meta: null
    });
  }

  return next();
}

/**
 * Middleware для проверки бана пользователя
 */
function checkBan(req, res, next) {
  if (req.isAuthenticated() && req.user.is_banned) {
    return res.status(403).json({
      success: false,
      data: null,
      error: {
        code: "BANNED",
        message: "Your account has been banned"
      },
      meta: null
    });
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  checkBan
};

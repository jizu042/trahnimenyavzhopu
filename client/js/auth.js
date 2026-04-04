/**
 * Управление состоянием авторизации
 */

import { getCurrentUser, logout as apiLogout, API_BASE } from "./api.js";

let currentUser = null;
let authListeners = [];

/**
 * Инициализировать модуль авторизации
 */
async function initAuth() {
  try {
    const data = await getCurrentUser();
    currentUser = data.authenticated ? data.user : null;
    notifyListeners();
  } catch (error) {
    console.error("Failed to fetch current user:", error);
    currentUser = null;
  }
}

/**
 * Получить текущего пользователя
 */
function getUser() {
  return currentUser;
}

/**
 * Проверить, авторизован ли пользователь
 */
function isAuthenticated() {
  return currentUser !== null;
}

/**
 * Начать OAuth авторизацию
 */
function login() {
  window.location.href = `${API_BASE}/auth/ely/login`;
}

/**
 * Выйти из системы
 */
async function logout() {
  try {
    await apiLogout();
    currentUser = null;
    notifyListeners();
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

/**
 * Подписаться на изменения состояния авторизации
 */
function onAuthChange(callback) {
  authListeners.push(callback);
  return () => {
    authListeners = authListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Уведомить подписчиков об изменении состояния
 */
function notifyListeners() {
  authListeners.forEach((callback) => callback(currentUser));
}

export { initAuth, getUser, isAuthenticated, login, logout, onAuthChange };

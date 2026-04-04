/**
 * API клиент для взаимодействия с backend
 */

const API_BASE = window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "https://trahnimenyavzhopu.onrender.com";

/**
 * Выполнить fetch запрос с credentials
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message || `HTTP ${response.status}`);
  }

  return data.data;
}

/**
 * Получить информацию о текущем пользователе
 */
async function getCurrentUser() {
  return await apiFetch("/auth/me");
}

/**
 * Выйти из системы
 */
async function logout() {
  return await apiFetch("/auth/ely/logout");
}

/**
 * Получить историю чата
 */
async function getChatMessages(limit = 50) {
  return await apiFetch(`/api/v1/chat/messages?limit=${limit}`);
}

/**
 * Получить статус сервера
 */
async function getServerStatus(address, token = "") {
  const params = new URLSearchParams({ address });
  if (token) params.set("token", token);
  return await apiFetch(`/api/v1/status?${params.toString()}`);
}

export { API_BASE, apiFetch, getCurrentUser, logout, getChatMessages, getServerStatus };

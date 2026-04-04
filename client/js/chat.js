/**
 * WebSocket чат клиент
 */

import { isAuthenticated, getUser, onAuthChange } from "./auth.js";
import { getChatMessages, API_BASE } from "./api.js";

const WS_URL = API_BASE.replace("http", "ws") + "/ws";

let ws = null;
let reconnectTimer = null;
let messageListeners = [];
let connectionListeners = [];

/**
 * Инициализировать WebSocket соединение
 */
function initChat() {
  connect();

  // Переподключаться при изменении авторизации
  onAuthChange(() => {
    if (ws) {
      ws.close();
    }
    setTimeout(connect, 1000);
  });
}

/**
 * Подключиться к WebSocket серверу
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("WebSocket connected");
      notifyConnectionListeners(true);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      notifyConnectionListeners(false);

      // Переподключиться через 5 секунд
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 5000);
      }
    };
  } catch (error) {
    console.error("Failed to create WebSocket:", error);
  }
}

/**
 * Обработать сообщение от сервера
 */
function handleMessage(message) {
  const { type, data } = message;

  switch (type) {
    case "connected":
      console.log("Connected to chat:", data);
      break;

    case "chat_message":
      notifyMessageListeners(data);
      break;

    case "user_join":
      console.log("User joined:", data.username);
      break;

    case "user_leave":
      console.log("User left:", data.username);
      break;

    case "error":
      console.error("Chat error:", data.message);
      showToast(data.message);
      break;

    default:
      console.log("Unknown message type:", type);
  }
}

/**
 * Отправить сообщение в чат
 */
function sendMessage(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast("Not connected to chat");
    return false;
  }

  if (!isAuthenticated()) {
    showToast("You must be logged in to send messages");
    return false;
  }

  ws.send(
    JSON.stringify({
      type: "chat_message",
      data: { message }
    })
  );

  return true;
}

/**
 * Подписаться на новые сообщения
 */
function onMessage(callback) {
  messageListeners.push(callback);
  return () => {
    messageListeners = messageListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Подписаться на изменения соединения
 */
function onConnectionChange(callback) {
  connectionListeners.push(callback);
  return () => {
    connectionListeners = connectionListeners.filter((cb) => cb !== callback);
  };
}

/**
 * Уведомить подписчиков о новом сообщении
 */
function notifyMessageListeners(message) {
  messageListeners.forEach((callback) => callback(message));
}

/**
 * Уведомить подписчиков об изменении соединения
 */
function notifyConnectionListeners(connected) {
  connectionListeners.forEach((callback) => callback(connected));
}

/**
 * Загрузить историю чата
 */
async function loadChatHistory() {
  try {
    const data = await getChatMessages(50);
    return data.messages || [];
  } catch (error) {
    console.error("Failed to load chat history:", error);
    return [];
  }
}

/**
 * Показать toast уведомление
 */
function showToast(message) {
  const root = document.getElementById("toasts");
  if (!root) return;

  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

export { initChat, sendMessage, onMessage, onConnectionChange, loadChatHistory };

const WebSocket = require("ws");
const url = require("url");
const { saveMessage, getUserMessageCount } = require("../db/queries/chat");

// Rate limiting: максимум сообщений в минуту на пользователя
const RATE_LIMIT_MESSAGES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 1;

/**
 * Инициализировать WebSocket сервер
 */
function initWebSocket(server, sessionParser) {
  const wss = new WebSocket.Server({ noServer: true });

  // Upgrade HTTP соединения в WebSocket
  server.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === "/ws") {
      // Парсим сессию из cookie
      sessionParser(request, {}, () => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      });
    } else {
      socket.destroy();
    }
  });

  // Обработка подключений
  wss.on("connection", async (ws, request) => {
    const session = request.session;
    const user = request.session?.passport?.user
      ? await getUserFromSession(request.session.passport.user)
      : null;

    ws.isAlive = true;
    ws.user = user;

    // Отправить приветственное сообщение
    ws.send(
      JSON.stringify({
        type: "connected",
        data: {
          authenticated: !!user,
          username: user?.username || null
        }
      })
    );

    // Обработка сообщений от клиента
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message, wss);
      } catch (error) {
        console.error("WebSocket message error:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            data: { message: "Invalid message format" }
          })
        );
      }
    });

    // Pong для keep-alive
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Обработка отключения
    ws.on("close", () => {
      if (user) {
        broadcast(wss, {
          type: "user_leave",
          data: { username: user.username }
        });
      }
    });

    // Уведомить всех о новом пользователе
    if (user) {
      broadcast(wss, {
        type: "user_join",
        data: { username: user.username }
      });
    }
  });

  // Ping клиентов каждые 30 секунд для keep-alive
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Получить пользователя из сессии
 */
async function getUserFromSession(userId) {
  const { findUserById } = require("../db/queries/users");
  return await findUserById(userId);
}

/**
 * Обработать сообщение от клиента
 */
async function handleMessage(ws, message, wss) {
  const { type, data } = message;

  switch (type) {
    case "chat_message":
      await handleChatMessage(ws, data, wss);
      break;

    case "ping":
      ws.send(JSON.stringify({ type: "pong", data: {} }));
      break;

    default:
      ws.send(
        JSON.stringify({
          type: "error",
          data: { message: "Unknown message type" }
        })
      );
  }
}

/**
 * Обработать сообщение чата
 */
async function handleChatMessage(ws, data, wss) {
  const user = ws.user;

  // Проверка авторизации
  if (!user) {
    return ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Authentication required to send messages" }
      })
    );
  }

  // Проверка бана
  if (user.is_banned) {
    return ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "You are banned from chat" }
      })
    );
  }

  const messageText = String(data.message || "").trim();

  // Валидация сообщения
  if (!messageText) {
    return ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Message cannot be empty" }
      })
    );
  }

  if (messageText.length > 500) {
    return ws.send(
      JSON.stringify({
        type: "error",
        data: { message: "Message too long (max 500 characters)" }
      })
    );
  }

  // Rate limiting
  const messageCount = await getUserMessageCount(user.id, RATE_LIMIT_WINDOW_MINUTES);
  if (messageCount >= RATE_LIMIT_MESSAGES) {
    return ws.send(
      JSON.stringify({
        type: "error",
        data: {
          message: `Rate limit exceeded. Max ${RATE_LIMIT_MESSAGES} messages per ${RATE_LIMIT_WINDOW_MINUTES} minute(s)`
        }
      })
    );
  }

  // Сохранить сообщение в БД
  const savedMessage = await saveMessage(user.id, user.username, messageText);

  // Broadcast сообщение всем подключенным клиентам
  broadcast(wss, {
    type: "chat_message",
    data: {
      id: savedMessage.id,
      username: savedMessage.username,
      message: savedMessage.message,
      created_at: savedMessage.created_at
    }
  });
}

/**
 * Отправить сообщение всем подключенным клиентам
 */
function broadcast(wss, message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

module.exports = { initWebSocket };

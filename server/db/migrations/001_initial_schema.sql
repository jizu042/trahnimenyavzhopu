-- Пользователи (OAuth через Ely.by)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  ely_id VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(16) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  is_admin BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_ely_id ON users(ely_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Сообщения чата (7 дней хранения)
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at DESC);

-- Сессии игроков (7 дней хранения)
CREATE TABLE IF NOT EXISTS player_sessions (
  id SERIAL PRIMARY KEY,
  server_address VARCHAR(255) NOT NULL,
  username VARCHAR(16) NOT NULL,
  login_time TIMESTAMP NOT NULL,
  logout_time TIMESTAMP,
  duration_seconds INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_server_username ON player_sessions(server_address, username);
CREATE INDEX IF NOT EXISTS idx_sessions_login_time ON player_sessions(login_time DESC);

-- Uptime сервера (персистентное хранение)
CREATE TABLE IF NOT EXISTS server_uptime (
  id SERIAL PRIMARY KEY,
  server_address VARCHAR(255) UNIQUE NOT NULL,
  online BOOLEAN NOT NULL,
  online_since TIMESTAMP,
  last_check TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Метрики сервера (7 дней хранения)
CREATE TABLE IF NOT EXISTS server_metrics (
  id SERIAL PRIMARY KEY,
  server_address VARCHAR(255) NOT NULL,
  online BOOLEAN NOT NULL,
  ping_ms INTEGER,
  players_online INTEGER,
  players_max INTEGER,
  version VARCHAR(255),
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_server_time ON server_metrics(server_address, recorded_at DESC);

-- Конфигурация админ-панели
CREATE TABLE IF NOT EXISTS admin_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Сессии Express (для connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);

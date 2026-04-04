require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("./auth/passport");
const authRoutes = require("./auth/routes");
const pool = require("./db/connection");
const sessionTracker = require("./utils/session-tracker");
const { upsertServerUptime, getServerUptime, saveServerMetrics } = require("./db/queries/metrics");
const net = require("net");

/**
 * @typedef {{success:boolean,data:any,error:any,meta:any}} ApiEnvelope
 */

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const MCSTATUS_API_BASE = process.env.MCSTATUS_API_BASE || "https://api.mcstatus.io/v2";
const ISMCSERVER_API_BASE =
  process.env.ISMCSERVER_API_BASE || "https://api.ismcserver.online";
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 9000);
const REALTIME_CHECK_TIMEOUT_MS = Number(process.env.REALTIME_CHECK_TIMEOUT_MS || 1500);
const ELY_SKIN_BASE = process.env.ELY_SKIN_BASE || "https://skinsystem.ely.by/skins";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-in-production";

// In-memory state to estimate server \"online since\" time.
// Important: upstream APIs do not provide real uptime.
// This is the best possible approximation without a persistent data store.
/** @type {Map<string, { lastOnline: boolean | null, onlineSinceMs: number | null }>} */
const presence = new Map();

/**
 * @param {string} address
 * @returns {{host: string, port: number} | null}
 */
function parseHostPort(address) {
  const raw = String(address || "").trim();
  if (!raw) return null;
  const [host, portRaw] = raw.split(":");
  if (!host) return null;
  const port = portRaw ? Number(portRaw) : 25565;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/**
 * Realtime TCP connectivity check with ping measurement.
 * @param {string} address
 * @returns {Promise<{online: boolean|null, pingMs: number|null}>}
 */
function realtimeTcpOnline(address) {
  const hp = parseHostPort(address);
  if (!hp) return Promise.resolve({ online: null, pingMs: null });

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const startTime = Date.now();

    const finish = (online, pingMs = null) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve({ online, pingMs });
    };

    socket.setTimeout(REALTIME_CHECK_TIMEOUT_MS);
    socket.once("connect", () => {
      const pingMs = Date.now() - startTime;
      finish(true, pingMs);
    });
    socket.once("timeout", () => finish(false, null));
    socket.once("error", () => finish(false, null));
    socket.connect(hp.port, hp.host);
  });
}

app.set("trust proxy", 1);
app.use(
  helmet({
    // Allow cross-origin use of proxied skin PNGs (canvas / WebGL texture uploads).
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? "*" : FRONTEND_URL.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  })
);

// Session middleware (должен быть перед passport)
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "session",
      createTableIfMissing: false
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: NODE_ENV === "production" ? "none" : "lax"
    }
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());
app.use(
  morgan(NODE_ENV === "production" ? "combined" : "dev", {
    skip: () => NODE_ENV === "test"
  })
);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PER_MIN || 120),
    standardHeaders: true,
    legacyHeaders: false
  })
);

/**
 * @param {express.Response} res
 * @param {number} status
 * @param {any} data
 * @param {any} [meta]
 */
function sendOk(res, status, data, meta = null) {
  /** @type {ApiEnvelope} */
  const envelope = { success: true, data, error: null, meta };
  res.status(status).json(envelope);
}

/**
 * @param {express.Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {any} [details]
 */
function sendErr(res, status, code, message, details = null) {
  /** @type {ApiEnvelope} */
  const envelope = {
    success: false,
    data: null,
    error: { code, message, details: NODE_ENV === "production" ? null : details },
    meta: null
  };
  res.status(status).json(envelope);
}

/**
 * Basic hostname[:port] validator; allows DNS names and IPv4.
 * @param {string} input
 */
function normalizeAddress(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const ok = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(raw);
  if (!ok) return null;
  return raw;
}

/**
 * Keep ':' in path segment for host:port style addresses.
 * @param {string} address
 */
function encodeAddressPath(address) {
  return encodeURI(address);
}

/**
 * @param {string} url
 * @param {Record<string,string>} [headers]
 */
async function fetchJsonWithTimeout(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      redirect: "follow",
      signal: controller.signal
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { _raw: text.slice(0, 1000) };
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

// Root: avoids "backend is broken" confusion when opening the service URL in a browser
function rootPayload() {
  return {
    service: "mc-monitor-server",
    message: "Use GET /api/v1/status?address=host:port or /api/v1/health",
    endpoints: ["/ping", "/api/v1/health", "/api/v1/status", "/api/v1/skin/:username"]
  };
}
app.get("/", (req, res) => {
  sendOk(res, 200, rootPayload());
});
app.head("/", (req, res) => {
  res.status(200).end();
});

// Render anti-sleep endpoint
app.get("/ping", (req, res) => {
  sendOk(res, 200, { status: "ok", timestamp: new Date().toISOString() });
});

// Auth routes
app.use("/auth", authRoutes);

// Chat routes
const chatRoutes = require("./chat/routes");
app.use("/api/v1/chat", chatRoutes);

// Stats routes
const statsRoutes = require("./stats/routes");
app.use("/api/v1/stats", statsRoutes);

// Admin routes
const adminRoutes = require("./admin/routes");
app.use("/api/v1/admin", adminRoutes);

app.get("/api/v1/health", (req, res) => {
  sendOk(res, 200, {
    status: "ok",
    env: NODE_ENV,
    uptimeSec: Math.round(process.uptime())
  });
});

/**
 * Proxy Ely.by skin PNG so the browser can use it in canvas/WebGL without CORS taint.
 * GET /api/v1/skin/:username
 */
app.get("/api/v1/skin/:username", async (req, res) => {
  const raw = String(req.params.username || "").trim();
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(raw)) {
    return sendErr(res, 400, "BAD_USERNAME", "Invalid username");
  }
  const url = `${ELY_SKIN_BASE}/${encodeURIComponent(raw)}.png`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!upstream.ok) {
      return sendErr(res, upstream.status === 404 ? 404 : 502, "SKIN_UPSTREAM", `HTTP ${upstream.status}`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).send(buf);
  } catch (e) {
    return sendErr(res, 502, "SKIN_FETCH_FAILED", "Skin fetch failed");
  } finally {
    clearTimeout(timeout);
  }
});

/**
 * Aggregated status endpoint for frontend.
 * GET /api/v1/status?address=host:port&token=...
 */
app.get("/api/v1/status", async (req, res) => {
  const address = normalizeAddress(req.query.address);
  const token = String(req.query.token || "").trim();
  if (!address) {
    return sendErr(res, 400, "BAD_ADDRESS", "Query param 'address' is invalid");
  }

  const mcstatusUrl = `${MCSTATUS_API_BASE}/status/java/${encodeAddressPath(
    address
  )}?query=true&timeout=5`;

  let mcstatus = null;
  let mcstatusError = null;
  let ismc = null;
  let ismcError = null;
  let startedAt = Date.now();
  let realtimeOnline = null;
  let realPingMs = null;

  try {
    const out = await fetchJsonWithTimeout(mcstatusUrl);
    if (out.status >= 200 && out.status < 300) mcstatus = out.body;
    else mcstatusError = `HTTP ${out.status}`;
  } catch (e) {
    mcstatusError = String(e && e.message ? e.message : e);
  }

  try {
    const result = await realtimeTcpOnline(address);
    realtimeOnline = result.online;
    realPingMs = result.pingMs;
  } catch {
    realtimeOnline = null;
    realPingMs = null;
  }

  if (token) {
    const ismcUrl = `${ISMCSERVER_API_BASE}/${encodeAddressPath(address)}`;
    try {
      let out = await fetchJsonWithTimeout(ismcUrl, { Authorization: token });
      if (out.status === 404) {
        // fallback for providers expecting raw host:port route
        out = await fetchJsonWithTimeout(`${ISMCSERVER_API_BASE}/${address}`, {
          Authorization: token
        });
      }
      if (out.status >= 200 && out.status < 300) ismc = out.body;
      else ismcError = `HTTP ${out.status}`;
    } catch (e) {
      ismcError = String(e && e.message ? e.message : e);
    }
  }

  const latencyMs = Date.now() - startedAt;
  const upstreamOnline = mcstatus?.online ?? ismc?.online ?? null;
  const online =
    realtimeOnline === true ? true : realtimeOnline === false ? false : upstreamOnline ?? null;
  const playersOnline = ismc?.players?.online ?? mcstatus?.players?.online ?? null;
  const playersMax = ismc?.players?.max ?? mcstatus?.players?.max ?? null;
  const playerNames = Array.isArray(ismc?.players?.list)
    ? ismc.players.list.map((p) => p?.name || p?.name_clean).filter(Boolean)
    : Array.isArray(mcstatus?.players?.list)
      ? mcstatus.players.list
          .map((p) => p?.name_clean || p?.name_raw || p?.name)
          .filter(Boolean)
      : [];

  // Обновить uptime в БД
  const now = Date.now();
  let dbUptime = null;
  try {
    const existingUptime = await getServerUptime(address);
    let onlineSince = existingUptime?.online_since ? new Date(existingUptime.online_since) : null;

    if (online === true) {
      if (!existingUptime || existingUptime.online !== true) {
        onlineSince = new Date(now);
      }
    } else {
      onlineSince = null;
    }

    dbUptime = await upsertServerUptime(address, online === true, onlineSince, new Date(now));
  } catch (error) {
    console.error("Failed to update server uptime:", error);
  }

  const uptimeMs =
    online === true && dbUptime?.online_since
      ? now - new Date(dbUptime.online_since).getTime()
      : null;

  // Сохранить метрики в БД
  try {
    await saveServerMetrics(
      address,
      online === true,
      realPingMs || latencyMs,
      playersOnline,
      playersMax,
      mcstatus?.version?.name_clean || mcstatus?.version?.name_raw || ismc?.version?.string || null
    );
  } catch (error) {
    console.error("Failed to save server metrics:", error);
  }

  // Обновить сессии игроков
  try {
    await sessionTracker.updateSessions(address, playerNames);
  } catch (error) {
    console.error("Failed to update player sessions:", error);
  }

  return sendOk(
    res,
    200,
    {
      address,
      online,
      players: { online: playersOnline, max: playersMax, list: playerNames },
      version:
        mcstatus?.version?.name_clean ||
        mcstatus?.version?.name_raw ||
        ismc?.version?.string ||
        null,
      motd:
        mcstatus?.motd?.clean || ismc?.motd?.clean || mcstatus?.motd?.raw || ismc?.motd?.raw || "",
      pingMs: realPingMs || latencyMs,
      onlineSinceMs: dbUptime?.online_since ? new Date(dbUptime.online_since).getTime() : null,
      uptimeMs,
      realtime: { tcpOnline: realtimeOnline, tcpPingMs: realPingMs },
      upstream: { mcstatus, ismc },
      upstreamErrors: { mcstatus: mcstatusError, ismc: ismcError }
    },
    { latencyMs }
  );
});

app.use((req, res) => {
  sendErr(res, 404, "NOT_FOUND", "Route not found");
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  sendErr(
    res,
    500,
    "INTERNAL_ERROR",
    "Unexpected server error",
    String(err && err.message ? err.message : err)
  );
});

// Создать HTTP сервер
const server = app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Server running",
      port: PORT,
      env: NODE_ENV
    })
  );
});

// Инициализировать WebSocket
const { initWebSocket } = require("./chat/websocket");
const sessionMiddleware = session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: NODE_ENV === "production" ? "none" : "lax"
  }
});

initWebSocket(server, sessionMiddleware);

// Запустить cleanup job
const { startCleanupJob } = require("./utils/cleanup");
startCleanupJob();


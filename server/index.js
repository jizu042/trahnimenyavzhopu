const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");

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

// In-memory state to estimate server \"online since\" time.
// Important: upstream APIs do not provide real uptime.
// This is the best possible approximation without a persistent data store.
/** @type {Map<string, { lastOnline: boolean | null, onlineSinceMs: number | null }>} */
const presence = new Map();

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? "*" : FRONTEND_URL.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);
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
    endpoints: ["/ping", "/api/v1/health", "/api/v1/status"]
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

app.get("/api/v1/health", (req, res) => {
  sendOk(res, 200, {
    status: "ok",
    env: NODE_ENV,
    uptimeSec: Math.round(process.uptime())
  });
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

  try {
    const out = await fetchJsonWithTimeout(mcstatusUrl);
    if (out.status >= 200 && out.status < 300) mcstatus = out.body;
    else mcstatusError = `HTTP ${out.status}`;
  } catch (e) {
    mcstatusError = String(e && e.message ? e.message : e);
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
  const online = mcstatus?.online ?? ismc?.online ?? null;
  const playersOnline = ismc?.players?.online ?? mcstatus?.players?.online ?? null;
  const playersMax = ismc?.players?.max ?? mcstatus?.players?.max ?? null;
  const playerNames = Array.isArray(ismc?.players?.list)
    ? ismc.players.list.map((p) => p?.name || p?.name_clean).filter(Boolean)
    : Array.isArray(mcstatus?.players?.list)
      ? mcstatus.players.list
          .map((p) => p?.name_clean || p?.name_raw || p?.name)
          .filter(Boolean)
      : [];

  // Update presence state
  const prev = presence.get(address) || { lastOnline: null, onlineSinceMs: null };
  const now = Date.now();
  let onlineSinceMs = prev.onlineSinceMs;
  if (online === true) {
    // Start counting when we first observe the server as online after a non-online state.
    if (prev.lastOnline !== true) onlineSinceMs = now;
  } else {
    onlineSinceMs = null;
  }
  presence.set(address, { lastOnline: online === true ? true : online === false ? false : null, onlineSinceMs });

  const uptimeMs = online === true && onlineSinceMs ? now - onlineSinceMs : null;

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
      pingMs: latencyMs,
      onlineSinceMs,
      uptimeMs,
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

app.listen(PORT, () => {
  // Structured-ish startup line
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Server running",
      port: PORT,
      env: NODE_ENV
    })
  );
});


const KEYS = {
  settings: "monitor_settings",
  theme: "monitor_theme",
  notify: "monitor_notify",
  lastOnline: "monitor_last_online"
};

const LS_ONLINE_SINCE = "monitor_online_since_v1";

const DEFAULTS = {
  address: "",
  apiBase: "",
  token: "",
  intervalSec: 10
};

/** @type {string | null} */
let trackedAddress = null;
/** @type {boolean | null} */
let lastPollOnline = null;
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
let hasRenderedOnce = false;
let skinviewLoading = false;
let skinviewReady = false;
/** @type {any | null} */
let activeSkinViewer = null;
/** @type {string | null} */
let skinPreviewFor = null;

function canHoverSkinPreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function getSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEYS.settings) || "{}")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(next) {
  localStorage.setItem(KEYS.settings, JSON.stringify(next));
}

/**
 * @param {string} address
 * @returns {number | null}
 */
function getOnlineSince(address) {
  try {
    const raw = localStorage.getItem(LS_ONLINE_SINCE);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o.address !== address) return null;
    return typeof o.startedAt === "number" ? o.startedAt : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} address
 * @param {number} startedAt
 */
function setOnlineSince(address, startedAt) {
  localStorage.setItem(LS_ONLINE_SINCE, JSON.stringify({ address, startedAt }));
}

function clearOnlineSince() {
  localStorage.removeItem(LS_ONLINE_SINCE);
}

/**
 * @param {number} ms
 */
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (days > 0) return `${days} д. ${h} ч ${m}м ${s}с`;
  if (h > 0) return `${h} ч ${m}м ${s}с`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function tickUptime() {
  const el = document.getElementById("uptimeView");
  if (!el) return;
  const settings = getSettings();
  const started = getOnlineSince(settings.address);
  if (!started || lastPollOnline !== true) {
    el.textContent = "—";
    return;
  }
  el.textContent = formatDuration(Date.now() - started);
}

function showToast(message) {
  const root = document.getElementById("toasts");
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

async function requestNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function renderBadge(online) {
  const node = document.getElementById("statusBadge");
  node.className = "pill pill--lg";
  if (online === true) {
    node.classList.add("online");
    node.textContent = "Онлайн";
  } else if (online === false) {
    node.classList.add("offline");
    node.textContent = "Оффлайн";
  } else {
    node.classList.add("unknown");
    node.textContent = "Неизвестно";
  }
}

function renderRows(tbodyId, rows) {
  const body = document.getElementById(tbodyId);
  body.innerHTML = "";
  for (const [k, v] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = k;
    const td = document.createElement("td");
    td.textContent = v == null || v === "" ? "—" : String(v);
    tr.append(th, td);
    body.appendChild(tr);
  }
}

/**
 * @param {string} raw
 */
function normalizeApiBase(raw) {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "");
}

async function fetchStatus(settings) {
  const params = new URLSearchParams({ address: settings.address });
  if (settings.token) params.set("token", settings.token);
  const base = normalizeApiBase(settings.apiBase);
  const url = `${base}/api/v1/status?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data;
}

function parseNames(data) {
  return Array.isArray(data?.players?.list) ? data.players.list.filter(Boolean) : [];
}

function el(id) {
  return document.getElementById(id);
}

/**
 * Direct Ely.by skin URL (fallback; canvas may be tainted without backend proxy).
 * @param {string} username
 */
function elySkinUrlDirect(username) {
  return `https://skinsystem.ely.by/skins/${encodeURIComponent(username)}.png`;
}

/**
 * Prefer backend proxy (same CORS as API) so canvas/WebGL can read pixels.
 * @param {string} username
 */
function skinUrlForUser(username) {
  const base = normalizeApiBase(getSettings().apiBase);
  if (base) return `${base}/api/v1/skin/${encodeURIComponent(username)}`;
  return elySkinUrlDirect(username);
}

/**
 * Draw a Minecraft head (with hat layer) to a canvas.
 * Works with standard 64x64 skins.
 * @param {HTMLCanvasElement} canvas
 * @param {string} username
 */
async function drawHead(canvas, username) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  ctx.imageSmoothingEnabled = false;

  const base = normalizeApiBase(getSettings().apiBase);
  if (!base) {
    ctx.fillStyle = colorMixSurface();
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(username).slice(0, 1).toUpperCase(), size / 2, size / 2);
    canvas.title = "Укажите API Base (бэкенд) в настройках — скины Ely.by идут через /api/v1/skin";
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "no-referrer";
  img.src = skinUrlForUser(username);

  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  });

  if (!img.naturalWidth || !img.naturalHeight) {
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, 0, size, size);
    return;
  }

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
}

function colorMixSurface() {
  return getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
}

/**
 * Load skinview3d bundle lazily (jsDelivr).
 * @returns {Promise<boolean>}
 */
async function ensureSkinview3d() {
  if (skinviewReady) return true;
  if (skinviewLoading) {
    await new Promise((r) => setTimeout(r, 100));
    return skinviewReady;
  }
  skinviewLoading = true;
  try {
    // Global: skinview3d
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/skinview3d@3.4.1/bundles/skinview3d.bundle.js";
    s.async = true;
    const ok = await new Promise((resolve) => {
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    // Some builds expose window.skinview3d, some window.Skinview3d.
    skinviewReady = Boolean(ok && (window.skinview3d || window.Skinview3d));
    return skinviewReady;
  } finally {
    skinviewLoading = false;
  }
}

function disposeActiveSkinViewer() {
  if (activeSkinViewer && typeof activeSkinViewer.dispose === "function") {
    try {
      activeSkinViewer.dispose();
    } catch {
      // ignore
    }
  }
  activeSkinViewer = null;
  skinPreviewFor = null;
}

function hideSkinTooltip() {
  const tip = el("skinTooltip");
  if (!tip) return;
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  disposeActiveSkinViewer();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} username
 */
async function renderSkin2dFull(canvas, username) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const base = normalizeApiBase(getSettings().apiBase);
  if (!base) {
    ctx.fillStyle = "#64748b";
    ctx.font = "14px system-ui";
    ctx.fillText("Нужен API Base (бэкенд) для скинов", 8, 28);
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "no-referrer";
  img.src = skinUrlForUser(username);
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  });
  if (!img.naturalWidth) return;
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = Math.floor(img.naturalWidth * scale);
  const h = Math.floor(img.naturalHeight * scale);
  const ox = Math.floor((canvas.width - w) / 2);
  const oy = Math.floor((canvas.height - h) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, ox, oy, w, h);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} username
 */
async function mountSkinViewer3d(canvas, username) {
  const ready = await ensureSkinview3d();
  if (!ready) return false;
  const api = window.skinview3d || window.Skinview3d;
  disposeActiveSkinViewer();
  try {
    activeSkinViewer = new api.SkinViewer({
      canvas,
      width: canvas.width,
      height: canvas.height,
      skin: skinUrlForUser(username)
    });
    activeSkinViewer.animation = new api.WalkingAnimation();
    activeSkinViewer.animation.speed = 0.6;
    activeSkinViewer.camera.rotation.x = -0.2;
    activeSkinViewer.camera.rotation.y = 0.7;
    activeSkinViewer.camera.position.z = 45;
    skinPreviewFor = username;
    return true;
  } catch {
    disposeActiveSkinViewer();
    return false;
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} username
 */
async function renderSkinPreviewCanvas(canvas, username) {
  disposeActiveSkinViewer();
  const ok = await mountSkinViewer3d(canvas, username);
  if (!ok) await renderSkin2dFull(canvas, username);
}

/**
 * @param {string} username
 * @param {MouseEvent} ev
 */
async function showSkinTooltip(username, ev) {
  const tip = el("skinTooltip");
  const title = el("skinTooltipTitle");
  const canvas = /** @type {HTMLCanvasElement} */ (el("skinTooltipCanvas"));
  if (!tip || !title || !canvas) return;

  title.textContent = username;

  const margin = 14;
  const x = Math.min(window.innerWidth - tip.offsetWidth - margin, ev.clientX + margin);
  const y = Math.min(window.innerHeight - tip.offsetHeight - margin, ev.clientY + margin);
  tip.style.left = `${Math.max(margin, x)}px`;
  tip.style.top = `${Math.max(margin, y)}px`;
  tip.hidden = false;
  tip.setAttribute("aria-hidden", "false");

  if (skinPreviewFor === username && activeSkinViewer) return;

  await renderSkinPreviewCanvas(canvas, username);
}

/**
 * @param {string} username
 */
async function openSkinPreviewDialog(username) {
  hideSkinTooltip();
  const dlg = el("skinPreviewDialog");
  const title = el("skinDialogTitle");
  const canvas = /** @type {HTMLCanvasElement} */ (el("skinDialogCanvas"));
  if (!dlg || !title || !canvas || !username) return;
  title.textContent = username;
  if (!dlg.open) dlg.showModal();
  await renderSkinPreviewCanvas(canvas, username);
}

function wireSkinPreviewDialog() {
  const dlg = el("skinPreviewDialog");
  if (!dlg) return;
  dlg.addEventListener("close", () => {
    disposeActiveSkinViewer();
  });
}

/**
 * @param {boolean} loading
 */
function setDashboardLoading(loading) {
  const panel = document.getElementById("dashboard");
  const badge = document.getElementById("statusBadge");

  if (panel) panel.setAttribute("aria-busy", loading ? "true" : "false");

  // Only subtle indicator near the status badge (no fullscreen overlay).
  if (badge) badge.classList.toggle("is-refreshing", loading);
}

async function refresh() {
  const settings = getSettings();
  if (trackedAddress !== null && trackedAddress !== settings.address) {
    lastPollOnline = null;
    clearOnlineSince();
  }
  trackedAddress = settings.address;

  const addrTrim = String(settings.address || "").trim();
  if (!addrTrim) {
    setDashboardLoading(false);
    document.getElementById("errorBanner").hidden = true;
    lastPollOnline = null;
    clearOnlineSince();
    tickUptime();
    renderBadge(null);
    document.getElementById("addressView").textContent = "—";
    document.getElementById("pingView").textContent = "—";
    document.getElementById("playersView").textContent = "—";
    document.getElementById("uptimeView").textContent = "—";
    document.getElementById("playersList").innerHTML = "";
    document.getElementById("playersEmpty").hidden = false;
    document.getElementById("playersEmpty").textContent =
      "Укажите адрес сервера в «Настройках» (в репозитории адрес по умолчанию не задан).";
    document.getElementById("versionLine").textContent = "";
    document.getElementById("motdLine").textContent = "";
    renderRows("infoTbody", []);
    renderRows("fullInfoTbody", []);
    document.getElementById("updateHint").textContent = "Задайте адрес сервера в настройках, чтобы начать мониторинг.";
    return;
  }

  setDashboardLoading(true);
  document.getElementById("errorBanner").hidden = true;
  try {
    const data = await fetchStatus(settings);
    const online = data.online === true;

    // Prefer backend-provided onlineSinceMs (more accurate than \"since page opened\").
    if (online) {
      const fromBackend = typeof data.onlineSinceMs === "number" ? data.onlineSinceMs : null;
      if (fromBackend) {
        setOnlineSince(settings.address, fromBackend);
      } else if (lastPollOnline !== true) {
        setOnlineSince(settings.address, Date.now());
      }
    } else {
      clearOnlineSince();
    }
    lastPollOnline = online;

    tickUptime();

    renderBadge(data.online);
    document.getElementById("addressView").textContent = data.address || settings.address;

    document.getElementById("pingView").textContent = data.pingMs != null ? `${data.pingMs} мс` : "—";
    const p = data.players || {};
    document.getElementById("playersView").textContent =
      p.online != null && p.max != null ? `${p.online} / ${p.max}` : String(p.online ?? "—");

    const chips = document.getElementById("playersList");
    const emptyHint = document.getElementById("playersEmpty");
    emptyHint.textContent = "Нет данных об игроках (сервер скрывает список или офлайн)";
    chips.innerHTML = "";
    const names = parseNames(data);
    if (names.length) {
      emptyHint.hidden = true;
      const hoverPreview = canHoverSkinPreview();
      for (const name of names) {
        const chip = document.createElement("div");
        chip.className = "player-chip";
        chip.dataset.player = name;
        chip.tabIndex = 0;
        chip.setAttribute("role", "button");
        chip.setAttribute("aria-label", `Игрок ${name}, открыть скин`);

        const head = document.createElement("canvas");
        head.className = "player-chip__head";
        head.width = 28;
        head.height = 28;
        head.setAttribute("role", "img");
        head.setAttribute("aria-hidden", "true");

        await drawHead(head, name);

        if (hoverPreview) {
          head.addEventListener("mouseenter", (ev) => {
            void showSkinTooltip(name, ev);
          });
          head.addEventListener("mousemove", (ev) => {
            void showSkinTooltip(name, ev);
          });
          head.addEventListener("mouseleave", () => hideSkinTooltip());
        }

        const label = document.createElement("span");
        label.className = "player-chip__name";
        label.textContent = name;

        chip.addEventListener("click", () => void openSkinPreviewDialog(name));
        chip.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void openSkinPreviewDialog(name);
          }
        });

        chip.append(head, label);
        chips.appendChild(chip);
      }
    } else {
      emptyHint.hidden = false;
    }

    const ver = data.version ? `Версия: ${data.version}` : "";
    document.getElementById("versionLine").textContent = ver;
    document.getElementById("motdLine").textContent = data.motd || "";

    renderRows("infoTbody", [
      ["Host", data.upstream?.ismc?.host || data.upstream?.mcstatus?.host],
      ["Port", data.upstream?.ismc?.port || data.upstream?.mcstatus?.port],
      ["IP", data.upstream?.mcstatus?.ip_address],
      ["Protocol", data.upstream?.mcstatus?.version?.protocol || data.upstream?.ismc?.protocol],
      ["Software", data.upstream?.mcstatus?.software || data.upstream?.ismc?.software],
      ["Retrieved", data.upstream?.mcstatus?.retrieved_at || null],
      ["Expires", data.upstream?.mcstatus?.expires_at || null]
    ]);

    const plugins = Array.isArray(data.upstream?.mcstatus?.plugins)
      ? data.upstream.mcstatus.plugins.map((x) => x.name).join(", ")
      : null;
    const mods = Array.isArray(data.upstream?.mcstatus?.mods)
      ? data.upstream.mcstatus.mods.map((x) => x.name).join(", ")
      : null;
    renderRows("fullInfoTbody", [
      ["online", data.online],
      ["players.online", data.players?.online],
      ["players.max", data.players?.max],
      ["players.list", names.join(", ")],
      ["version", data.version],
      ["motd", data.motd],
      ["mcstatus.host", data.upstream?.mcstatus?.host],
      ["mcstatus.port", data.upstream?.mcstatus?.port],
      ["mcstatus.eula_blocked", data.upstream?.mcstatus?.eula_blocked],
      ["mcstatus.srv_record", JSON.stringify(data.upstream?.mcstatus?.srv_record || null)],
      ["mcstatus.plugins", plugins],
      ["mcstatus.mods", mods],
      ["ismc.debug.status", data.upstream?.ismc?.debug?.status],
      ["ismc.debug.query", data.upstream?.ismc?.debug?.query],
      ["ismc.debug.legacy", data.upstream?.ismc?.debug?.legacy],
      ["upstreamErrors.mcstatus", data.upstreamErrors?.mcstatus],
      ["upstreamErrors.ismc", data.upstreamErrors?.ismc]
    ]);

    document.getElementById("updateHint").textContent = `Обновлено: ${new Date().toLocaleTimeString()}`;

    const notifyEnabled = localStorage.getItem(KEYS.notify) === "true";
    const prev = localStorage.getItem(KEYS.lastOnline); // "true" | "false" | null
    // Notify when we transition into online. Treat missing prev as not-online.
    if (notifyEnabled && prev !== "true" && online) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Сервер Minecraft в сети", {
          body: `${data.address || settings.address}\nИгроки: ${document.getElementById("playersView").textContent}`
        });
      }
    }
    // Only update transition state on successful fetch; avoids false triggers on network errors.
    localStorage.setItem(KEYS.lastOnline, online ? "true" : "false");
    hasRenderedOnce = true;
  } catch (e) {
    const banner = document.getElementById("errorBanner");
    banner.hidden = false;
    banner.textContent = String(e && e.message ? e.message : e);
    lastPollOnline = null;
    clearOnlineSince();
    tickUptime();
  } finally {
    setDashboardLoading(false);
  }
}

function setupUI() {
  const settings = getSettings();
  document.getElementById("setAddress").value = settings.address;
  document.getElementById("setApiBase").value = settings.apiBase;
  document.getElementById("setToken").value = settings.token;
  document.getElementById("setInterval").value = String(settings.intervalSec);

  document.getElementById("settingsOpen").addEventListener("click", () => {
    document.getElementById("settingsDialog").showModal();
  });
  document.getElementById("settingsCancel").addEventListener("click", () => {
    document.getElementById("settingsDialog").close();
  });
  document.getElementById("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = {
      address: document.getElementById("setAddress").value.trim(),
      apiBase: normalizeApiBase(document.getElementById("setApiBase").value),
      token: document.getElementById("setToken").value.trim(),
      intervalSec: Math.max(5, Math.min(3600, Number(document.getElementById("setInterval").value) || 10))
    };
    saveSettings(next);
    document.getElementById("settingsDialog").close();
    showToast("Настройки сохранены");
    refresh();
    restartTimer();
  });

  document.getElementById("detailsOpen").addEventListener("click", () => {
    document.getElementById("detailsDialog").showModal();
    hideSkinTooltip();
  });

  wireSkinPreviewDialog();

  document.getElementById("themeToggle").addEventListener("click", () => {
    const cur = localStorage.getItem(KEYS.theme) || "light";
    const next = cur === "light" ? "dark" : "light";
    localStorage.setItem(KEYS.theme, next);
    document.documentElement.setAttribute("data-theme", next);
  });

  document.getElementById("notifyToggle").addEventListener("click", async () => {
    const enabled = localStorage.getItem(KEYS.notify) === "true";
    if (enabled) {
      localStorage.setItem(KEYS.notify, "false");
      document.getElementById("notifyToggle").textContent = "Уведомления: выкл";
      return;
    }
    const ok = await requestNotifyPermission();
    localStorage.setItem(KEYS.notify, ok ? "true" : "false");
    document.getElementById("notifyToggle").textContent = ok ? "Уведомления: вкл" : "Уведомления: выкл";
    if (ok) {
      // Initialize transition state from current known value (if any) to avoid confusion.
      if (lastPollOnline === true) localStorage.setItem(KEYS.lastOnline, "true");
      else if (lastPollOnline === false) localStorage.setItem(KEYS.lastOnline, "false");
    }
    showToast(ok ? "Уведомления включены (проверьте, что сайт разрешён в системе)" : "Разрешение не выдано");
  });

  document.documentElement.setAttribute("data-theme", localStorage.getItem(KEYS.theme) || "light");
  document.getElementById("notifyToggle").textContent =
    localStorage.getItem(KEYS.notify) === "true" ? "Уведомления: вкл" : "Уведомления: выкл";

  window.addEventListener("scroll", () => hideSkinTooltip(), { passive: true });
  window.addEventListener("blur", () => hideSkinTooltip());
}

function restartTimer() {
  if (pollTimer) clearInterval(pollTimer);
  const sec = getSettings().intervalSec || 10;
  pollTimer = setInterval(() => {
    refresh();
  }, sec * 1000);
}

setupUI();
setInterval(tickUptime, 1000);
refresh();
restartTimer();

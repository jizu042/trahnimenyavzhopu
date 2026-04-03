const KEYS = {
  settings: "monitor_settings",
  theme: "monitor_theme",
  notify: "monitor_notify",
  lastOnline: "monitor_last_online"
};

const LS_ONLINE_SINCE = "monitor_online_since_v1";

const DEFAULTS = {
  address: "143.14.50.57:25566",
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
/** @type {ReturnType<typeof setTimeout> | null} */
let loadingDelayTimer = null;
/** @type {number | null} */
let loadingShownAt = null;

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

/**
 * @param {boolean} loading
 */
function setDashboardLoading(loading) {
  const panel = document.getElementById("dashboard");
  const overlay = document.getElementById("dashboardLoading");
  const badge = document.getElementById("statusBadge");

  if (panel) panel.setAttribute("aria-busy", loading ? "true" : "false");

  // Always show a subtle refresh indicator, but avoid an annoying full overlay
  // on every 10s poll. The overlay is only used for the very first render or
  // if a request takes noticeably long.
  if (badge) badge.classList.toggle("is-refreshing", loading);

  if (!overlay) return;

  if (!loading) {
    if (loadingDelayTimer) {
      clearTimeout(loadingDelayTimer);
      loadingDelayTimer = null;
    }
    // Prevent flash: if we already showed it, keep for a minimum duration.
    if (loadingShownAt != null) {
      const elapsed = Date.now() - loadingShownAt;
      const minVisible = 450;
      if (elapsed < minVisible) {
        setTimeout(() => {
          overlay.hidden = true;
          loadingShownAt = null;
        }, minVisible - elapsed);
        return;
      }
    }
    overlay.hidden = true;
    loadingShownAt = null;
    return;
  }

  // Loading=true
  if (hasRenderedOnce) {
    // Only show overlay if the request is slow.
    if (loadingDelayTimer) clearTimeout(loadingDelayTimer);
    loadingDelayTimer = setTimeout(() => {
      overlay.hidden = false;
      loadingShownAt = Date.now();
    }, 700);
    return;
  }

  // First paint: show quickly (still with a tiny delay to avoid micro-flash)
  if (loadingDelayTimer) clearTimeout(loadingDelayTimer);
  loadingDelayTimer = setTimeout(() => {
    overlay.hidden = false;
    loadingShownAt = Date.now();
  }, 150);
}

async function refresh() {
  const settings = getSettings();
  if (trackedAddress !== null && trackedAddress !== settings.address) {
    lastPollOnline = null;
    clearOnlineSince();
  }
  trackedAddress = settings.address;

  setDashboardLoading(true);
  document.getElementById("errorBanner").hidden = true;
  try {
    const data = await fetchStatus(settings);
    const online = data.online === true;

    if (online) {
      if (lastPollOnline !== true) {
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
    chips.innerHTML = "";
    const names = parseNames(data);
    if (names.length) {
      emptyHint.hidden = true;
      for (const name of names) {
        const chip = document.createElement("span");
        chip.textContent = name;
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
  });

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

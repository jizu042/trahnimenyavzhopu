const KEYS = {
  settings: "monitor_settings",
  theme: "monitor_theme",
  notify: "monitor_notify",
  lastOnline: "monitor_last_online"
};

const DEFAULTS = {
  address: "143.14.50.57:25566",
  apiBase: "",
  token: "",
  intervalSec: 10
};

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
  node.className = "pill";
  if (online === true) {
    node.classList.add("online");
    node.textContent = "Online";
  } else if (online === false) {
    node.classList.add("offline");
    node.textContent = "Offline";
  } else {
    node.classList.add("unknown");
    node.textContent = "Unknown";
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

async function fetchStatus(settings) {
  const params = new URLSearchParams({ address: settings.address });
  if (settings.token) params.set("token", settings.token);
  const base = settings.apiBase || "";
  const url = `${base}/api/v1/status?${params.toString()}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data;
}

function parseNames(data) {
  return Array.isArray(data?.players?.list) ? data.players.list.filter(Boolean) : [];
}

function setSkeleton(loading) {
  document.getElementById("summarySkeleton").hidden = !loading;
}

async function refresh() {
  const settings = getSettings();
  setSkeleton(true);
  document.getElementById("errorBanner").hidden = true;
  try {
    const data = await fetchStatus(settings);
    const online = data.online === true;
    renderBadge(data.online);
    document.getElementById("addressView").textContent = data.address || settings.address;
    document.getElementById("versionView").textContent = data.version ? `Version ${data.version}` : "";
    document.getElementById("pingView").textContent = data.pingMs != null ? `${data.pingMs} ms` : "—";
    const p = data.players || {};
    document.getElementById("playersView").textContent =
      p.online != null && p.max != null ? `${p.online}/${p.max}` : p.online ?? "—";
    const chips = document.getElementById("playersList");
    chips.innerHTML = "";
    const names = parseNames(data);
    if (names.length) {
      for (const name of names) {
        const chip = document.createElement("span");
        chip.textContent = name;
        chips.appendChild(chip);
      }
    }
    document.getElementById("motdView").textContent = data.motd || "";

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

    document.getElementById("updateHint").textContent = `Updated ${new Date().toLocaleTimeString()}`;

    const notifyEnabled = localStorage.getItem(KEYS.notify) === "true";
    const prev = localStorage.getItem(KEYS.lastOnline);
    if (notifyEnabled && prev === "false" && online) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Minecraft server ONLINE", {
          body: `${data.address || settings.address}\nPlayers: ${document.getElementById("playersView").textContent}`
        });
      }
    }
    localStorage.setItem(KEYS.lastOnline, String(Boolean(online)));
  } catch (e) {
    const banner = document.getElementById("errorBanner");
    banner.hidden = false;
    banner.textContent = String(e && e.message ? e.message : e);
  } finally {
    setSkeleton(false);
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
      apiBase: document.getElementById("setApiBase").value.trim(),
      token: document.getElementById("setToken").value.trim(),
      intervalSec: Math.max(5, Math.min(3600, Number(document.getElementById("setInterval").value) || 10))
    };
    saveSettings(next);
    document.getElementById("settingsDialog").close();
    showToast("Settings saved");
    refresh();
    restartTimer();
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
      document.getElementById("notifyToggle").textContent = "Notify: Off";
      return;
    }
    const ok = await requestNotifyPermission();
    localStorage.setItem(KEYS.notify, ok ? "true" : "false");
    document.getElementById("notifyToggle").textContent = ok ? "Notify: On" : "Notify: Off";
    showToast(ok ? "Notifications enabled" : "Notification permission denied");
  });

  document.documentElement.setAttribute("data-theme", localStorage.getItem(KEYS.theme) || "light");
  document.getElementById("notifyToggle").textContent =
    localStorage.getItem(KEYS.notify) === "true" ? "Notify: On" : "Notify: Off";
}

function restartTimer() {
  if (pollTimer) clearInterval(pollTimer);
  const sec = getSettings().intervalSec || 10;
  pollTimer = setInterval(() => {
    refresh();
  }, sec * 1000);
}

setupUI();
refresh();
restartTimer();


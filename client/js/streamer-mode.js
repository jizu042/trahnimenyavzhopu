/**
 * Streamer Mode - скрыть/показать IP адрес сервера
 */

const STORAGE_KEY = "streamer_mode_enabled";

let isEnabled = false;

function initStreamerMode() {
  // Загрузить состояние из localStorage
  isEnabled = localStorage.getItem(STORAGE_KEY) === "true";

  // Создать кнопку
  const addressView = document.getElementById("addressView");
  if (!addressView) return;

  const button = document.createElement("button");
  button.id = "streamerModeBtn";
  button.className = "btn ghost";
  button.style.cssText = "margin-left:12px;padding:8px 12px;font-size:1.2rem;";
  button.setAttribute("aria-label", "Режим стримера");
  button.textContent = isEnabled ? "👁️" : "👁️‍🗨️";
  button.title = isEnabled ? "Показать IP" : "Скрыть IP";

  addressView.parentElement.appendChild(button);

  // Применить начальное состояние
  applyStreamerMode();

  // Обработчик клика
  button.addEventListener("click", toggleStreamerMode);
}

function toggleStreamerMode() {
  isEnabled = !isEnabled;
  localStorage.setItem(STORAGE_KEY, isEnabled ? "true" : "false");
  applyStreamerMode();

  const button = document.getElementById("streamerModeBtn");
  if (button) {
    button.textContent = isEnabled ? "👁️" : "👁️‍🗨️";
    button.title = isEnabled ? "Показать IP" : "Скрыть IP";
  }
}

function applyStreamerMode() {
  const addressView = document.getElementById("addressView");
  if (!addressView) return;

  if (isEnabled) {
    addressView.style.filter = "blur(8px)";
    addressView.style.userSelect = "none";
    addressView.style.transition = "filter 0.3s ease";
  } else {
    addressView.style.filter = "none";
    addressView.style.userSelect = "auto";
  }
}

export { initStreamerMode };

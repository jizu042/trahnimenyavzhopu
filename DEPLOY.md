# Инструкция по деплою на Render

## ✅ Что выполнено

Все 8 задач завершены:
1. ✅ PostgreSQL подключение и миграции
2. ✅ OAuth авторизация через Ely.by
3. ✅ WebSocket чат (backend)
4. ✅ WebSocket чат (frontend)
5. ✅ Исправлены метрики (uptime, ping, сессии)
6. ✅ Расширенная статистика игроков
7. ✅ Админ-панель API
8. ✅ Streamer Mode + UI обновления

## 🚀 Шаги для деплоя

### 1. Настройка Ely.by OAuth приложения

Зайдите на https://account.ely.by/dev/applications и создайте приложение:

**Ссылка на сайт:**
```
https://trahnimenyavzhopu-1.onrender.com
```

**Адрес переадресации (Redirect URI):**
```
https://trahnimenyavzhopu.onrender.com/auth/ely/callback
```

**Scopes:** Выберите `account_info` и `minecraft_server_session`

Скопируйте **Client ID** и **Client Secret**.

### 2. Настройка переменных окружения на Render

#### Web Service (trahnimenyavzhopu - backend)

Зайдите в Render Dashboard → Web Service "trahnimenyavzhopu" → Environment

Добавьте следующие переменные:

```bash
# База данных (уже есть)
DATABASE_URL=postgresql://base_t9ge_user:b08U60y0Kh3sgUFOYOvi14uxpszIWPuT@dpg-d781fa2dbo4c73b3msg0-a.frankfurt-postgres.render.com/base_t9ge

# Ely.by OAuth (замените на ваши реальные значения)
ELY_CLIENT_ID=ваш_client_id_из_ely_by
ELY_CLIENT_SECRET=ваш_client_secret_из_ely_by
ELY_CALLBACK_URL=https://trahnimenyavzhopu.onrender.com/auth/ely/callback

# Session (сгенерируйте случайную строку)
SESSION_SECRET=сгенерируйте_случайную_строку_32_символа

# Frontend
FRONTEND_URL=https://trahnimenyavzhopu-1.onrender.com

# Остальные (уже есть)
NODE_ENV=production
PORT=3000
API_TIMEOUT_MS=9000
RATE_LIMIT_PER_MIN=120
MCSTATUS_API_BASE=https://api.mcstatus.io/v2
ISMCSERVER_API_BASE=https://api.ismcserver.online
ELY_SKIN_BASE=https://skinsystem.ely.by/skins

# Опционально: первый админ (ваш Ely.by ID)
ADMIN_ELY_ID=ваш_ely_id_для_админ_доступа
```

**Генерация SESSION_SECRET:**
Выполните локально:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Обновление Build Command на Render

Web Service → Settings → Build & Deploy → Build Command:
```bash
npm install && node server/db/migrations/run.js
```

Это установит зависимости и запустит миграции БД.

### 4. Push изменений в GitHub

```bash
git push origin main
```

Render автоматически задеплоит изменения.

### 5. Запуск миграций БД (КРИТИЧНО - выполнить первым делом!)

**ВАЖНО:** Если приложение уже задеплоено, но миграции не запускались, выполните:

Зайдите в Render Dashboard → Web Service "trahnimenyavzhopu" → Shell и выполните:

```bash
node server/db/migrations/run.js
```

Это создаст все таблицы в PostgreSQL. После этого перезапустите сервис через Render Dashboard.

**Проверка успешности:**
Логи должны показать:
```
✓ PostgreSQL connected successfully
Running migrations...
✓ Migration 001_initial_schema.sql completed
```

### 6. Проверка работы

1. Откройте https://trahnimenyavzhopu-1.onrender.com
2. Перейдите на таб "Чат"
3. Нажмите "Войти через Ely.by"
4. Авторизуйтесь
5. Попробуйте отправить сообщение в чат

## 📋 Новые возможности

### Для пользователей:
- **OAuth авторизация** через Ely.by
- **Real-time чат** с отображением скинов
- **Streamer Mode** - кнопка 👁️ рядом с IP для скрытия адреса
- **Статистика игроков** - клик на ник → статистика сессий
- **Персистентный uptime** - не сбрасывается при перезапуске
- **Реальный ping** - TCP соединение вместо API latency

### Для админов:
- **API админ-панели** на `/api/v1/admin/*`
- Управление пользователями (бан/разбан)
- Удаление сообщений чата
- Конфигурация через API
- Общая статистика

### Backend API:
- `GET /auth/ely/login` - начать OAuth
- `GET /auth/ely/callback` - OAuth callback
- `GET /auth/ely/logout` - выход
- `GET /auth/me` - текущий пользователь
- `GET /api/v1/chat/messages` - история чата
- `WebSocket /ws` - real-time чат
- `GET /api/v1/stats/player/:username` - статистика игрока
- `GET /api/v1/stats/sessions` - история сессий
- `GET /api/v1/admin/*` - админ API (требует is_admin=true)

## 🔧 Локальная разработка

1. Создайте `server/.env`:
```bash
DATABASE_URL=postgresql://localhost/mc_monitor
ELY_CLIENT_ID=ваш_client_id
ELY_CLIENT_SECRET=ваш_client_secret
ELY_CALLBACK_URL=http://localhost:3000/auth/ely/callback
SESSION_SECRET=local_dev_secret
FRONTEND_URL=http://localhost:8080
NODE_ENV=development
```

2. Добавьте в Ely.by приложение второй Redirect URI:
```
http://localhost:3000/auth/ely/callback
```

3. Запустите PostgreSQL локально и выполните миграции:
```bash
cd server
npm install
node db/migrations/run.js
npm start
```

4. Запустите frontend:
```bash
cd client
python -m http.server 8080
```

## 📊 Автоматическая очистка данных

Каждые 24 часа автоматически удаляются:
- Сообщения чата старше 7 дней
- Сессии игроков старше 7 дней
- Метрики сервера старше 7 дней

Это экономит место на Render free tier PostgreSQL (1GB).

## 🐛 Troubleshooting

**"Can not find application you are trying to authorize"**
- Проверьте Client ID и Secret в переменных окружения
- Убедитесь что Redirect URI точно совпадает
- Проверьте что приложение опубликовано на Ely.by

**WebSocket не подключается**
- Проверьте что FRONTEND_URL правильный
- Убедитесь что CORS настроен с credentials: true
- Проверьте что SESSION_SECRET установлен

**База данных не работает**
- Проверьте DATABASE_URL
- Запустите миграции: `node db/migrations/run.js`
- Проверьте логи в Render Dashboard

## 📝 Следующие шаги (опционально)

Не реализовано в текущей версии, но можно добавить:
- Админ-панель UI (сейчас только API)
- Интеграции со сторонними сервисами (minecraft-server-list.com и т.д.)
- Графики статистики (Chart.js)
- Полный редизайн UI в gaming-стиле
- Webhook уведомления (Discord/Telegram)

Все основные функции работают и готовы к использованию!

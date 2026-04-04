const passport = require("passport");
const OAuth2Strategy = require("passport-oauth2").Strategy;
const { findOrCreateUser, findUserById } = require("../db/queries/users");

const ELY_CLIENT_ID = process.env.ELY_CLIENT_ID;
const ELY_CLIENT_SECRET = process.env.ELY_CLIENT_SECRET;
const ELY_CALLBACK_URL = process.env.ELY_CALLBACK_URL;

if (!ELY_CLIENT_ID || !ELY_CLIENT_SECRET || !ELY_CALLBACK_URL) {
  console.warn("Warning: Ely.by OAuth credentials not configured");
}

// Настройка Ely.by OAuth2 стратегии
passport.use(
  "ely",
  new OAuth2Strategy(
    {
      authorizationURL: "https://account.ely.by/oauth2/v1/authorize",
      tokenURL: "https://account.ely.by/oauth2/v1/token",
      clientID: ELY_CLIENT_ID,
      clientSecret: ELY_CLIENT_SECRET,
      callbackURL: ELY_CALLBACK_URL,
      scope: ["account_info", "minecraft_server_session"]
    },
    async (accessToken, refreshToken, params, profile, done) => {
      try {
        console.log("OAuth callback received, fetching user profile...");

        // Получить информацию о пользователе из Ely.by API
        const response = await fetch("https://account.ely.by/api/account/v1/info", {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        if (!response.ok) {
          console.error("Failed to fetch Ely.by profile:", response.status, response.statusText);
          return done(new Error(`Failed to fetch user profile from Ely.by: ${response.status}`));
        }

        const elyProfile = await response.json();
        console.log("Ely.by profile received:", elyProfile.username);

        const elyId = String(elyProfile.id);
        const username = elyProfile.username;

        // Вычислить время истечения токена
        const expiresIn = params.expires_in || 3600;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        // Найти или создать пользователя в БД
        console.log("Creating/updating user in database...");
        const user = await findOrCreateUser(elyId, username, accessToken, refreshToken, expiresAt);
        console.log("User authenticated:", user.username);

        // Проверить, является ли пользователь первым админом
        const adminElyId = process.env.ADMIN_ELY_ID;
        if (adminElyId && elyId === adminElyId && !user.is_admin) {
          const pool = require("../db/connection");
          await pool.query("UPDATE users SET is_admin = TRUE WHERE id = $1", [user.id]);
          user.is_admin = true;
          console.log("User promoted to admin:", user.username);
        }

        return done(null, user);
      } catch (error) {
        console.error("OAuth error:", error);
        return done(error);
      }
    }
  )
);

// Сериализация пользователя в сессию
passport.serializeUser((user, done) => {
  console.log("Serializing user:", user.id);
  done(null, user.id);
});

// Десериализация пользователя из сессии
passport.deserializeUser(async (id, done) => {
  try {
    console.log("Deserializing user:", id);
    const user = await findUserById(id);
    done(null, user);
  } catch (error) {
    console.error("Deserialize error:", error);
    done(error);
  }
});

module.exports = passport;

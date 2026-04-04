const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

// Валидация ДО создания Pool
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set");
  console.error("Please set DATABASE_URL in Render Dashboard -> Environment");
  process.exit(1);
}

if (!DATABASE_URL.startsWith("postgres://") && !DATABASE_URL.startsWith("postgresql://")) {
  console.error("FATAL: DATABASE_URL is invalid. Must start with postgres:// or postgresql://");
  console.error("Current value starts with:", DATABASE_URL.substring(0, 20));
  console.error("\nExpected format:");
  console.error("postgresql://username:password@host:port/database");
  console.error("\nGet the correct URL from:");
  console.error("Render Dashboard -> PostgreSQL 'base' -> Info -> Internal Database URL");
  process.exit(1);
}

// Проверка что URL не обрезан
if (DATABASE_URL.length < 50) {
  console.error("FATAL: DATABASE_URL seems too short (possibly truncated)");
  console.error("Length:", DATABASE_URL.length, "characters");
  console.error("Expected: ~150+ characters");
  console.error("\nPlease copy the FULL Internal Database URL from Render PostgreSQL dashboard");
  process.exit(1);
}

console.log("DATABASE_URL validation passed, creating connection pool...");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// Проверить подключение при старте
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("FATAL: Failed to connect to PostgreSQL:", err.message);
    console.error("\nPlease verify:");
    console.error("1. DATABASE_URL is correct in Render Environment variables");
    console.error("2. PostgreSQL service 'base' is running");
    console.error("3. Network connectivity between services");
    process.exit(1);
  }
  console.log("✓ PostgreSQL connected successfully at", res.rows[0].now);
});

module.exports = pool;

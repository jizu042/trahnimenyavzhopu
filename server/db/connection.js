const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is not set");
  process.exit(1);
}

if (!DATABASE_URL.startsWith("postgres://") && !DATABASE_URL.startsWith("postgresql://")) {
  console.error("FATAL: DATABASE_URL is invalid. Must start with postgres:// or postgresql://");
  console.error("Current value:", DATABASE_URL.substring(0, 20) + "...");
  process.exit(1);
}

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
    process.exit(1);
  }
  console.log("PostgreSQL connected successfully at", res.rows[0].now);
});

module.exports = pool;

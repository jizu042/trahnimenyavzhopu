const fs = require("fs");
const path = require("path");
const pool = require("../connection");

async function runMigrations() {
  try {
    console.log("Starting database migrations...");

    const migrationFile = path.join(__dirname, "001_initial_schema.sql");
    const sql = fs.readFileSync(migrationFile, "utf8");

    await pool.query(sql);

    console.log("✓ Migration 001_initial_schema.sql completed successfully");
    console.log("Database schema is up to date");

    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();

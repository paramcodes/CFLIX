import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema.js';

/**
 * Initializes the SQLite database and ensures all required tables exist.
 *
 * Supports:
 *   - File-backed database: data/cflix.db (default in production)
 *   - In-memory database: :memory: (useful for tests and ephemeral runs)
 *
 * @param {string} [customPath]
 */
export function createDatabaseConnection(customPath) {
  const dbPath =
    customPath ||
    process.env.CFLIX_DB_PATH ||
    join(process.cwd(), 'data', 'cflix.db');

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Enable WAL (Write-Ahead Logging) mode for concurrent read/write throughput
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }

  // Idempotently create tables matching schema.js
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      password_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      maturity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS progress (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  const orm = drizzle(sqlite, { schema });

  return { sqlite, orm, dbPath };
}

// Global default connection instance
const defaultConn = createDatabaseConnection();
export const sqlite = defaultConn.sqlite;
export const orm = defaultConn.orm;

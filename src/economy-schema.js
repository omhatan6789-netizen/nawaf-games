import { pool } from "./db.js";

export async function ensureEconomySchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games_settings (
      id BIGINT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'on'
    );
    INSERT INTO games_settings(id,status) VALUES(1,'on')
    ON CONFLICT(id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS bank_accounts (
      user_id BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      account_number VARCHAR(17) UNIQUE NOT NULL,
      bank TEXT NOT NULL,
      card_type TEXT NOT NULL,
      robbery_balance BIGINT NOT NULL DEFAULT 0 CHECK (robbery_balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasliyat_cooldowns (
      user_id BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      salary_until BIGINT NOT NULL DEFAULT 0,
      tip_until BIGINT NOT NULL DEFAULT 0,
      robber_until BIGINT NOT NULL DEFAULT 0,
      victim_rob_until BIGINT NOT NULL DEFAULT 0,
      investment_until BIGINT NOT NULL DEFAULT 0,
      luck_until BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS possessions (
      user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      PRIMARY KEY(user_id,item_key)
    );

    CREATE TABLE IF NOT EXISTS store_prices (
      item_key TEXT PRIMARY KEY,
      price BIGINT NOT NULL CHECK(price >= 0),
      hour_key BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bank_accounts_number ON bank_accounts(account_number);
    CREATE INDEX IF NOT EXISTS idx_possessions_user ON possessions(user_id);
  `);
  console.log("Economy database schema is ready.");
}

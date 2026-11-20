import { pool } from "./db.js";

export async function ensureConnect4Schema() {
  if (!pool) return;
  const statements = [
    "CREATE TABLE IF NOT EXISTS connect4_games (id UUID PRIMARY KEY, user_id BIGINT NOT NULL, difficulty TEXT NOT NULL DEFAULT 'متوسط', board JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'playing', turn_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_move INTEGER, winning_cells JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    "ALTER TABLE connect4_games ADD COLUMN IF NOT EXISTS game_mode TEXT NOT NULL DEFAULT 'bot', ADD COLUMN IF NOT EXISTS chat_id BIGINT, ADD COLUMN IF NOT EXISTS player2_id BIGINT, ADD COLUMN IF NOT EXISTS player1_name TEXT, ADD COLUMN IF NOT EXISTS player2_name TEXT, ADD COLUMN IF NOT EXISTS turn_player_id BIGINT, ADD COLUMN IF NOT EXISTS winner_id BIGINT, ADD COLUMN IF NOT EXISTS wager BIGINT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS bot_id BIGINT, ADD COLUMN IF NOT EXISTS bot_name TEXT NOT NULL DEFAULT 'بوت نواف', ADD COLUMN IF NOT EXISTS bot_move_pending BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS wager_settled BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE INDEX IF NOT EXISTS connect4_games_player2_idx ON connect4_games(player2_id, created_at DESC)",
    "CREATE TABLE IF NOT EXISTS connect4_challenges (id UUID PRIMARY KEY, chat_id BIGINT NOT NULL, message_id BIGINT, challenger_id BIGINT NOT NULL, challenger_name TEXT NOT NULL, opponent_id BIGINT NOT NULL, opponent_name TEXT NOT NULL, wager BIGINT NOT NULL CHECK (wager > 0), status TEXT NOT NULL DEFAULT 'pending', challenger_choice TEXT, opponent_choice TEXT, rps_message_id BIGINT, game_id UUID, rps_result TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    "ALTER TABLE connect4_challenges ADD COLUMN IF NOT EXISTS rps_result TEXT",
    "CREATE INDEX IF NOT EXISTS connect4_challenges_chat_idx ON connect4_challenges(chat_id, created_at DESC)"
  ];
  for (const statement of statements) await pool.query(statement);
}
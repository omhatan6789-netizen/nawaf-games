export async function ensureDartsSchema(pool){if(!pool)return;const statements=[`CREATE TABLE IF NOT EXISTS darts_games (
      id UUID PRIMARY KEY,
      lobby_id UUID,
      red_player_id BIGINT NOT NULL,
      red_player_name TEXT NOT NULL,
      blue_player_id BIGINT NOT NULL,
      blue_player_name TEXT NOT NULL,
      starting_score INTEGER NOT NULL DEFAULT 300,
      red_score INTEGER NOT NULL DEFAULT 300,
      blue_score INTEGER NOT NULL DEFAULT 300,
      status TEXT NOT NULL DEFAULT 'playing',
      phase TEXT NOT NULL DEFAULT 'turn_intro',
      active_side TEXT NOT NULL DEFAULT 'red',
      round INTEGER NOT NULL DEFAULT 1,
      locked_x DOUBLE PRECISION NOT NULL DEFAULT 0,
      winner_side TEXT,
      winner_name TEXT,
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      phase_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,`CREATE TABLE IF NOT EXISTS darts_game_events (
      id BIGSERIAL PRIMARY KEY,
      game_id UUID NOT NULL REFERENCES darts_games(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,`CREATE INDEX IF NOT EXISTS darts_game_events_game_idx ON darts_game_events(game_id,id)`,`CREATE INDEX IF NOT EXISTS darts_games_created_idx ON darts_games(created_at DESC)`];for(const statement of statements)await pool.query(statement);}
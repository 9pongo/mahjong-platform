-- ════════════════════════════════════════
--  009_tournament.sql  — 賽事系統
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tournaments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  description  TEXT,
  type         TEXT        NOT NULL DEFAULT 'special',  -- daily | weekly | special
  entry_fee    INT         NOT NULL DEFAULT 0,
  prize_pool   INT         NOT NULL DEFAULT 0,
  max_players  INT         NOT NULL DEFAULT 100,
  status       TEXT        NOT NULL DEFAULT 'upcoming', -- upcoming | active | ended
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  uid            UUID        NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  score          INT         NOT NULL DEFAULT 0,
  wins           INT         NOT NULL DEFAULT 0,
  rank           INT,
  prize_coins    INT         NOT NULL DEFAULT 0,
  registered_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tournament_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_te_tournament ON tournament_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_te_uid        ON tournament_entries(uid);
CREATE INDEX IF NOT EXISTS idx_t_status      ON tournaments(status);

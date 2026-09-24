-- Email + WhatsApp upgrade (24 Sept 2026). Additive only: nothing existing changes.

-- How WhatsApp knows a manager, and a chemist.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;
ALTER TABLE outlets  ADD COLUMN IF NOT EXISTS phone TEXT;

-- The first email sent about an order. Every later email about it (approved,
-- rejected, invoice) replies to this one, so the whole story is one thread.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mail_message_id TEXT;

-- What rivals are doing, as reps see it at the counter. One row per sighting.
-- The model proposes brand/product/offer from the rep's words; the raw words
-- are kept beside them so a wrong reading can always be checked.
CREATE TABLE IF NOT EXISTS competitor_intel (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL REFERENCES outlets(id),
  rep_id      TEXT REFERENCES reps(id),
  brand       TEXT NOT NULL,              -- 'Cipla'
  product     TEXT,                       -- 'paracetamol 650'
  offer       TEXT,                       -- '10+2'
  our_sku_id  TEXT REFERENCES skus(id),   -- the Meridian product it competes with, when known
  raw         TEXT NOT NULL,              -- exactly what the rep said
  source      TEXT NOT NULL DEFAULT 'rep' CHECK (source IN ('rep', 'chemist', 'photo')),
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS competitor_intel_seen ON competitor_intel (seen_at);
CREATE INDEX IF NOT EXISTS competitor_intel_brand ON competitor_intel (lower(brand), seen_at);

-- =============================================================================
-- MERIDIAN HEALTHCARE — field CRM schema
--
-- Three ideas run through this file. Each one is a decision, not a convention:
--
--   1. MONEY IS INTEGER PAISE. Never a float, never a decimal type.
--      Floats lose fractions of a rupee. A CRM that quietly loses money
--      is worse than no CRM, because people trust it for a year first.
--
--   2. A BATCH IS THE PHYSICAL THING. An SKU is a catalogue entry.
--      "Paracetamol 650" has no expiry date. The box on the shelf at
--      Sharma Medical does. So returns, shelf stock and near-expiry all
--      point at a batch. Get this wrong and returns never reconcile.
--
--   3. A VISIT IS DERIVED, NEVER CLAIMED. There is no column a rep can
--      set to say "I was here". A visit row exists only because some real
--      work was recorded with evidence that code checked.
-- =============================================================================

-- Trigram matching. Reps spell shop names three ways in a week, so outlet and
-- SKU resolution leans on similarity() rather than exact string equality.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP TABLE IF EXISTS competitor_intel, agent_events, rep_positions, drafts, approvals, returns, payments, invoices,
  order_lines, orders, visits, schemes, batches, sku_aliases, skus,
  beat_outlets, beats, outlet_aliases, outlets, reps, managers CASCADE;

-- =============================================================================
-- PEOPLE
-- =============================================================================

CREATE TABLE managers (
  id          TEXT PRIMARY KEY,           -- 'M-01'
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('asm', 'regional_head')),
  region      TEXT,                       -- NULL for the regional head (sees all)
  email       TEXT UNIQUE,                -- how the email channel knows who is asking
  phone       TEXT UNIQUE                 -- how WhatsApp knows who is asking
);

CREATE TABLE reps (
  id          TEXT PRIMARY KEY,           -- 'R-07'
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,       -- how WhatsApp would identify them
  asm_id      TEXT NOT NULL REFERENCES managers(id),
  region      TEXT NOT NULL,
  -- The language he chose in the app. The agent's tools read it and write
  -- their replies in it, so it never depends on the model remembering.
  lang        TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'hi')),
  email       TEXT UNIQUE                 -- how the email channel knows who is writing
);

-- =============================================================================
-- PLACES
-- =============================================================================

CREATE TABLE outlets (
  id                  TEXT PRIMARY KEY,   -- 'OUT-014'
  name                TEXT NOT NULL,
  area                TEXT NOT NULL,
  region              TEXT NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,

  drug_licence        TEXT,               -- required by law to sell medicine
  gstin               TEXT,
  email               TEXT,               -- where the order confirmation goes

  credit_limit_paise  BIGINT NOT NULL DEFAULT 0,
  credit_terms_days   INT    NOT NULL DEFAULT 15,

  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'pending_onboarding', 'dormant')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reps spell shop names three different ways in a week. This table is the
-- product's memory of how they actually talk. 'seed' rows are ones we knew
-- up front; 'learned' rows are added every time a fuzzy match is confirmed
-- by a human, so the matcher needs fewer questions each week.
CREATE TABLE outlet_aliases (
  id         BIGSERIAL PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'learned')),
  hits       INT  NOT NULL DEFAULT 0,
  UNIQUE (outlet_id, alias)
);
CREATE INDEX ON outlet_aliases (alias);

-- =============================================================================
-- ROUTES ("beats")
-- A beat is a rep's fixed list of shops for one weekday. Monday is always
-- the same twenty shops. This is how coverage is planned and judged.
-- =============================================================================

CREATE TABLE beats (
  id       TEXT PRIMARY KEY,              -- 'BEAT-R07-MON'
  rep_id   TEXT NOT NULL REFERENCES reps(id),
  weekday  INT  NOT NULL CHECK (weekday BETWEEN 1 AND 6),   -- 1 = Monday
  name     TEXT NOT NULL,
  UNIQUE (rep_id, weekday)
);

CREATE TABLE beat_outlets (
  beat_id    TEXT NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  seq        INT  NOT NULL,               -- position along the route; lets us
                                          -- spot a visit that arrives out of order
  PRIMARY KEY (beat_id, outlet_id)
);

-- =============================================================================
-- CATALOGUE
-- =============================================================================

CREATE TABLE skus (
  id            TEXT PRIMARY KEY,         -- 'SKU-PCM650-10X10'
  name          TEXT NOT NULL,
  brand         TEXT NOT NULL,
  molecule      TEXT,                     -- 'Paracetamol 650mg' — what a rep says
  pack_desc     TEXT NOT NULL,            -- '10x10 tablets'
  units_per_box INT  NOT NULL DEFAULT 1,
  category      TEXT NOT NULL,
  mrp_paise     BIGINT NOT NULL,          -- printed on the pack
  ptr_paise     BIGINT NOT NULL,          -- price to retailer — what we bill
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE sku_aliases (
  id      BIGSERIAL PRIMARY KEY,
  sku_id  TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  alias   TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'learned')),
  hits    INT  NOT NULL DEFAULT 0,
  UNIQUE (sku_id, alias)
);
CREATE INDEX ON sku_aliases (alias);

-- The physical thing. An SKU has no expiry date; a batch does.
CREATE TABLE batches (
  id           TEXT PRIMARY KEY,          -- 'B-PCM650-2411'
  sku_id       TEXT NOT NULL REFERENCES skus(id),
  batch_no     TEXT NOT NULL,
  mfg_date     DATE NOT NULL,
  expiry_date  DATE NOT NULL,
  UNIQUE (sku_id, batch_no)
);
CREATE INDEX ON batches (expiry_date);

-- This month's trade offer. Buy 10, get 2 free.
CREATE TABLE schemes (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  sku_id       TEXT REFERENCES skus(id),  -- NULL = applies to a whole category
  category     TEXT,
  buy_qty      INT NOT NULL,
  free_qty     INT NOT NULL,
  valid_from   DATE NOT NULL,
  valid_to     DATE NOT NULL
);

-- =============================================================================
-- THE WORK
-- =============================================================================

-- A visit is the record that a rep did real work at a real shop.
-- It is never written from a conversation directly: it is created by the
-- same code path that records an order, a collection or a stated reason,
-- and it carries the evidence that code checked.
CREATE TABLE visits (
  id               TEXT PRIMARY KEY,      -- 'V-0001'
  outlet_id        TEXT NOT NULL REFERENCES outlets(id),
  rep_id           TEXT NOT NULL REFERENCES reps(id),
  occurred_at      TIMESTAMPTZ NOT NULL,

  -- What actually happened. 'no_order' is a first-class outcome, not a blank:
  -- a pharmacist saying "Cipla gave me an offer" is more valuable than an order.
  outcome          TEXT NOT NULL CHECK (outcome IN
                     ('order', 'no_order', 'collection', 'stock_note', 'competitor')),
  no_order_reason  TEXT,

  -- Was this shop on today's route? We record it, we never block on it —
  -- a rep covering for a colleague who is ill must still be able to work.
  on_beat          BOOLEAN NOT NULL,
  beat_seq         INT,                   -- expected position on the route
  out_of_sequence  BOOLEAN NOT NULL DEFAULT false,

  -- Evidence. Checked by code, never asserted by the model.
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  gps_distance_m   INT,                   -- computed distance to the outlet
  photo_url        TEXT,

  verification     TEXT NOT NULL DEFAULT 'unverified'
                     CHECK (verification IN ('verified', 'unverified', 'flagged')),
  verification_note TEXT,

  raw_message      TEXT,                  -- exactly what the rep typed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON visits (rep_id, occurred_at);
CREATE INDEX ON visits (outlet_id, occurred_at);

CREATE TABLE orders (
  id                    TEXT PRIMARY KEY, -- 'ORD-1184'
  outlet_id             TEXT NOT NULL REFERENCES outlets(id),
  rep_id                TEXT NOT NULL REFERENCES reps(id),
  visit_id              TEXT REFERENCES visits(id),

  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                          ('draft',            -- agent built it, rep hasn't confirmed
                           'confirmed',
                           'held_credit',      -- over the limit; waiting on a human
                           'cancelled',
                           'dispatched')),

  credit_terms_days     INT NOT NULL DEFAULT 15,

  subtotal_paise        BIGINT NOT NULL DEFAULT 0,
  scheme_discount_paise BIGINT NOT NULL DEFAULT 0,
  total_paise           BIGINT NOT NULL DEFAULT 0,

  -- rep + outlet + sorted (sku, qty) list. Two orders with the same
  -- fingerprint inside a short window are a probable double-send —
  -- probable, not certain, which is why a human is asked once.
  fingerprint           TEXT,

  source_message        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at          TIMESTAMPTZ
);
CREATE INDEX ON orders (outlet_id, created_at);
CREATE INDEX ON orders (rep_id, created_at);
CREATE INDEX ON orders (fingerprint, created_at);

CREATE TABLE order_lines (
  id                BIGSERIAL PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku_id            TEXT NOT NULL REFERENCES skus(id),
  qty               INT  NOT NULL CHECK (qty > 0),
  unit_price_paise  BIGINT NOT NULL,
  line_total_paise  BIGINT NOT NULL,

  scheme_id         TEXT REFERENCES schemes(id),
  free_qty          INT NOT NULL DEFAULT 0,

  -- Kept so we can audit how a messy phrase became a real product, and so
  -- the /health page can show how often the matcher needed to ask.
  matched_from      TEXT,                 -- '650 tablets'
  match_confidence  REAL,                 -- 0..1
  match_method      TEXT                  -- 'alias' | 'fuzzy' | 'asked'
);

-- =============================================================================
-- DRAFTS
-- A counter conversation in progress. It exists as a table rather than as
-- conversation state for one reason: the one-question budget has to be
-- enforced somewhere the model cannot reach. `questions_asked` is a column,
-- not a sentence in a prompt, so no amount of persuasion raises it.
-- A draft that is never committed is the early-warning signal on /health.
-- =============================================================================
CREATE TABLE drafts (
  id               TEXT PRIMARY KEY,
  rep_id           TEXT NOT NULL REFERENCES reps(id),
  outlet_id        TEXT REFERENCES outlets(id),
  thread_id        TEXT,
  raw_message      TEXT NOT NULL,
  state            JSONB NOT NULL,
  questions_asked  INT  NOT NULL DEFAULT 0,
  gps_lat          DOUBLE PRECISION,
  gps_lng          DOUBLE PRECISION,
  photo_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'committed', 'parked', 'abandoned')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON drafts (rep_id, status, created_at);

-- =============================================================================
-- MONEY
-- =============================================================================

CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,
  order_id      TEXT REFERENCES orders(id),
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  amount_paise  BIGINT NOT NULL,
  issued_on     DATE NOT NULL,
  due_on        DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'part_paid', 'paid'))
);
CREATE INDEX ON invoices (outlet_id, status);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT REFERENCES invoices(id),
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  rep_id        TEXT REFERENCES reps(id),
  visit_id      TEXT REFERENCES visits(id),
  amount_paise  BIGINT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('cash', 'cheque', 'upi', 'neft')),
  collected_at  TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- RETURNS — against a batch, never a product
-- =============================================================================

CREATE TABLE returns (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  rep_id       TEXT NOT NULL REFERENCES reps(id),
  batch_id     TEXT NOT NULL REFERENCES batches(id),   -- the physical thing
  qty          INT  NOT NULL CHECK (qty > 0),
  reason       TEXT NOT NULL CHECK (reason IN ('expired', 'near_expiry', 'damaged')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by  TEXT REFERENCES managers(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- CONTROL — anything a model is not allowed to decide lands here
-- =============================================================================

CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('credit_override', 'return', 'price_exception',
                   'order_change')),        -- a rep asking to fix an order already placed
  subject_id    TEXT NOT NULL,            -- order id, return id, ...
  outlet_id     TEXT REFERENCES outlets(id),
  requested_by  TEXT REFERENCES reps(id),
  assigned_to   TEXT REFERENCES managers(id),
  reason        TEXT NOT NULL,            -- why it needs a human, in one line
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by    TEXT REFERENCES managers(id),
  decided_at    TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON approvals (status, assigned_to);

-- =============================================================================
-- REP POSITION
-- Evidence arrives out of band. The rep's phone publishes its own location
-- here; the order pipeline reads it server-side when a visit is written.
-- The model never receives a coordinate and has no tool that accepts one, so
-- there is no path by which a persuasive message can produce a location. That
-- is the difference between evidence and a claim.
-- =============================================================================
CREATE TABLE rep_positions (
  rep_id      TEXT PRIMARY KEY REFERENCES reps(id),
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  accuracy_m  INT,
  photo_url   TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- INSTRUMENTATION
-- Every turn the agent takes writes a row. This is how we answer
-- "is this actually working" rather than "did it not crash".
-- =============================================================================

CREATE TABLE agent_events (
  id                BIGSERIAL PRIMARY KEY,
  at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  rep_id            TEXT REFERENCES reps(id),
  thread_id         TEXT,                 -- one counter conversation
  event             TEXT NOT NULL CHECK (event IN
                      ('message_in',
                       'draft_built',
                       'question_asked',
                       'confirmed',
                       'abandoned',       -- started, never finished: the early warning
                       'blocked',
                       'duplicate_suspected',
                       'credit_held')),
  order_id          TEXT,
  visit_id          TEXT,
  ms_since_first    INT,                  -- the 30-second promise, measured
  questions_so_far  INT NOT NULL DEFAULT 0,
  meta              JSONB
);
CREATE INDEX ON agent_events (thread_id);
CREATE INDEX ON agent_events (at);


-- =============================================================================
-- 24 Sept 2026: email + WhatsApp upgrade (also in migrations/2026-09-24-channels.sql)
-- =============================================================================

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

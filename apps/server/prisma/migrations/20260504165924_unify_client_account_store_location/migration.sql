-- Unify customer-side Account/Location into Client/Store.
--
-- Strategy: additive ALTERs + backfill + constraint flip + DROPs, all in one
-- transaction so the DB never sees an inconsistent state. We reuse account.id
-- as the new client.id and location.id as the new store.id, which makes
-- backfill of join tables (memberships, subscriptions, player_bindings) a
-- straight column rename without an id-mapping table.
--
-- Hendrix is untouched.

BEGIN;

-- ===================================================================
-- 1. Add new columns (additive, no constraints yet)
-- ===================================================================

ALTER TABLE clients
  ADD COLUMN stripe_customer_id text;

ALTER TABLE stores
  ADD COLUMN slug text,
  ADD COLUMN tier text NOT NULL DEFAULT 'mvp_pilot',
  ADD COLUMN paused_until timestamptz,
  ADD COLUMN archived_at timestamptz;

CREATE TABLE client_memberships (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_memberships_client_id_user_id_key UNIQUE (client_id, user_id)
);
CREATE INDEX client_memberships_user_id_idx   ON client_memberships(user_id);
CREATE INDEX client_memberships_client_id_idx ON client_memberships(client_id);

ALTER TABLE subscriptions  ADD COLUMN store_id uuid;
ALTER TABLE player_bindings ADD COLUMN store_id uuid;

-- ===================================================================
-- 2. Backfill: Account → Client (reuse UUIDs)
-- ===================================================================

INSERT INTO clients (
  id, company_name, plan, stripe_customer_id, created_at, updated_at
)
SELECT
  a.id,                            -- reuse Account.id as new Client.id
  a.name,                          -- Account.name = email local part
  'mvp_pilot'::"ClientPlan",        -- placeholder; actual tier lives on Store
  a.stripe_customer_id,
  a.created_at,
  a.updated_at
FROM accounts a;

-- ===================================================================
-- 3. Backfill: AccountMembership → ClientMembership (reuse UUIDs)
-- ===================================================================

INSERT INTO client_memberships (id, client_id, user_id, role, created_at)
SELECT id, account_id, user_id, role, created_at
FROM account_memberships;

-- ===================================================================
-- 4. Backfill: Location → Store (reuse UUIDs as store.id)
--    accountId → clientId works because we reused UUIDs above.
-- ===================================================================

INSERT INTO stores (
  id, client_id, name, timezone, slug, tier, paused_until, archived_at,
  created_at, updated_at
)
SELECT
  l.id,                              -- reuse Location.id as new Store.id
  l.account_id,                      -- = new Client.id (UUIDs preserved)
  l.name,
  'America/Denver',                  -- default per Daniel's call
  l.slug,
  l.tier,
  l.paused_until,
  l.archived_at,
  l.created_at,
  l.created_at                       -- Location had no updated_at; seed equal
FROM locations l;

-- ===================================================================
-- 5. Backfill slug for existing operator-side Stores (which had no slug).
--    Pattern: <client_company>-<store_name>-<4hex>, lowercased / dashed.
-- ===================================================================

UPDATE stores s
SET slug = LOWER(
  REGEXP_REPLACE(c.company_name || '-' || s.name, '[^a-zA-Z0-9]+', '-', 'g')
) || '-' || SUBSTR(MD5(s.id::text), 1, 4)
FROM clients c
WHERE s.client_id = c.id AND s.slug IS NULL;

-- ===================================================================
-- 6. Repoint Subscription / PlayerBinding FKs (location_id → store_id)
--    Same UUIDs since store.id = location.id.
-- ===================================================================

UPDATE subscriptions   SET store_id = location_id;
UPDATE player_bindings SET store_id = location_id;

-- ===================================================================
-- 7. Constrain + drop deprecated columns/tables
-- ===================================================================

-- Subscription
ALTER TABLE subscriptions ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_location_id_fkey;
ALTER TABLE subscriptions DROP COLUMN location_id;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_store_id_key UNIQUE (store_id);

-- PlayerBinding
ALTER TABLE player_bindings ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE player_bindings DROP CONSTRAINT IF EXISTS player_bindings_location_id_fkey;
ALTER TABLE player_bindings DROP COLUMN location_id;
ALTER TABLE player_bindings
  ADD CONSTRAINT player_bindings_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE player_bindings
  ADD CONSTRAINT player_bindings_store_id_key UNIQUE (store_id);

-- Stores: slug NOT NULL + UNIQUE (after backfill)
ALTER TABLE stores ALTER COLUMN slug SET NOT NULL;
ALTER TABLE stores ADD CONSTRAINT stores_slug_key UNIQUE (slug);

-- Clients: stripe_customer_id UNIQUE when set
ALTER TABLE clients ADD CONSTRAINT clients_stripe_customer_id_key UNIQUE (stripe_customer_id);

-- Drop the deprecated tables
DROP TABLE account_memberships;
DROP TABLE locations;
DROP TABLE accounts;

COMMIT;

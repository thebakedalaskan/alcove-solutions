-- Plans (docs: Plans and usage). Each account's plan, its USD balance and what it bought, sealed under the service
-- accounting key as billing was: the row says only whose it is and when upkeep should next look at it (a period ending,
-- paid time running out, a grace period ending). Made the first time an account is touched after this release, on Free.
CREATE TABLE plan_accounts (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  state_ciphertext bytea NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  due_at timestamptz
);
CREATE INDEX plan_accounts_due ON plan_accounts(due_at) WHERE due_at IS NOT NULL;

-- Each account's AI allowance for its current period: what it brings, what's been spent, what requests in flight and
-- live calls' notes hold, sealed under the service accounting key. Kept apart from plan_accounts so the many small
-- charges of a live call never wait behind a purchase.
CREATE TABLE ai_meters (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  state_ciphertext bytea NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);

-- When this release's migration ran: a deposit the previous release settles after it, while both serve, added credits
-- that no longer count, and is credited again as dollars (features/billing/deposits.ts). billing_accounts is no longer
-- read, and goes in a later release.
CREATE TABLE billing_cutover (
  at timestamptz NOT NULL
);
INSERT INTO billing_cutover (at) VALUES (now());

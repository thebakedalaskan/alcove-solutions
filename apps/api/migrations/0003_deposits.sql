-- Payments into the treasury (docs: Payments and usage). What a deposit is (address, chain, token, amounts,
-- the provider's quote) is sealed under the service accounting key; the columns say only whose it is and when to look.
CREATE TABLE deposits (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  deposit_id alcove_id128 NOT NULL,
  provider text NOT NULL CHECK (provider IN ('oneclick')),
  state text NOT NULL CHECK (state IN ('waiting', 'arriving', 'short', 'credited', 'held', 'failed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  check_after timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  give_up_at timestamptz NOT NULL,
  record_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, deposit_id)
);
CREATE INDEX deposits_due ON deposits(check_after) WHERE state IN ('waiting', 'arriving', 'short', 'cancelled');

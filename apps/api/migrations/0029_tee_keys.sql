-- Carrying accounts into the TEE (docs: Privacy, keys and sessions › Moving to confidential computing). Inside the TEE the
-- master key is the TEE's own, so each account's root key is wrapped again under it, as a key envelope of keyVersion 2 in
-- root_envelope_v2. Rows written before this column read as having only the old envelope, which the API rewraps. While the
-- old master is held, new accounts get both envelopes, so the release before, which reads only root_envelope, still opens
-- them; once it's retired, new accounts get no old envelope, so root_envelope may be null. Nothing writes a null there
-- while the release before still serves.
ALTER TABLE owners ADD COLUMN root_envelope_v2 bytea;
ALTER TABLE owners ALTER COLUMN root_envelope DROP NOT NULL;

-- The TEE's keys, two rows read when the API starts. `master`: the master, made inside the TEE the first time it starts on
-- this database, as Cloud KMS wrapped it (its ciphertext, which only attested builds can have unwrapped). `bundle`: what the
-- TEE carries over to open this database, sealed under the master as a record of kind server-keys: the blind-index key,
-- KSERVICE, and the old master until it's retired.
CREATE TABLE server_keys (
  id text PRIMARY KEY CHECK (id IN ('master', 'bundle')),
  record bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

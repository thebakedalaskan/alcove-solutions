-- Plans support gave an account through the operator route, as Alcove, with no money involved (apps/api/src/features/billing/
-- operator/operator.ts): a keyed hash of the account and the ticket's reference, so one ticket gives an account a plan once,
-- and the key that gave it, so a key's grants in a UTC day are counted on any instance. No account ID, kind, months or
-- licenses are kept.
CREATE TABLE operator_grants (digest bytea PRIMARY KEY, key_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

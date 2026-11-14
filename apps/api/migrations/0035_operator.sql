-- Operating Alcove from outside the enclave, by requests each operator signs with a key of their own (apps/api/src/http/operator.ts).
-- Nothing here is anyone's content: a nonce is random, a key ID is a public key's fingerprint, and a digest is a keyed hash.

-- Each signed request's nonce, so a request can be used once, on any instance. Upkeep forgets one after 10 minutes, long
-- after the minute a signed request is good for either way.
CREATE TABLE operator_nonces (nonce text PRIMARY KEY, key_id text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX operator_nonces_seen ON operator_nonces (seen_at);

-- Money support added to an account by its ID, through the operator route: a keyed hash of the account and the ticket's
-- reference, so one ticket adds money to an account once. No amount and no account ID are kept.
CREATE TABLE operator_credits (digest bytea PRIMARY KEY, key_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- Someone moving their place in a live call to another device. Found by the SHA-256 of the move's current secret
-- (the code in the new device's link, then the claim that replaces it), never the secret itself. Who's moving, the
-- stage, and the new device's connection are sealed under the organizer's keys. Deleted when it runs out, and with
-- every other move of the call when the call ends.
CREATE TABLE call_moves (
  owner_id alcove_owner_id NOT NULL,
  call_id alcove_id128 NOT NULL,
  move_id alcove_id128 NOT NULL,
  secret_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, call_id, move_id),
  FOREIGN KEY (owner_id, call_id) REFERENCES calls(owner_id, call_id) ON DELETE CASCADE
);
CREATE INDEX call_moves_expiry ON call_moves(expires_at);

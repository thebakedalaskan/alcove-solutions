-- Live call attention has its own bounded sealed record. No plaintext questions, identities or audiences.
CREATE TABLE call_attention (
  owner_id alcove_owner_id NOT NULL,
  call_id alcove_id128 NOT NULL,
  ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, call_id),
  FOREIGN KEY (owner_id, call_id) REFERENCES calls(owner_id, call_id) ON DELETE CASCADE
);

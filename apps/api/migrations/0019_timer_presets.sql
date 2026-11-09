-- Names, presenters and ordered segments live only inside the owner's sealed preset record.
CREATE TABLE timer_presets (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  preset_id alcove_id128 NOT NULL,
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, preset_id)
);

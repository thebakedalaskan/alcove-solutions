-- Independent Google Drive consent and export policy, always sealed under the exporting account.
CREATE TABLE drive_connections (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  state_ciphertext bytea NOT NULL
);
CREATE TABLE drive_call_exports (
  owner_id alcove_owner_id NOT NULL REFERENCES drive_connections(owner_id) ON DELETE CASCADE,
  source_owner_id alcove_owner_id NOT NULL,
  note_id alcove_id128 NOT NULL,
  state_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, note_id),
  FOREIGN KEY (source_owner_id, note_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE TABLE drive_export_jobs (
  owner_id alcove_owner_id NOT NULL REFERENCES drive_connections(owner_id) ON DELETE CASCADE,
  job_id alcove_id128 NOT NULL,
  source_owner_id alcove_owner_id NOT NULL,
  note_id alcove_id128 NOT NULL,
  format text NOT NULL CHECK (format IN ('notes-markdown', 'transcript-text', 'recording-zip')),
  state text NOT NULL CHECK (state IN ('pending', 'uploading', 'uploaded', 'failed', 'reconnect')),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_id alcove_id128,
  attempt integer NOT NULL DEFAULT 0,
  state_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, job_id),
  UNIQUE (owner_id, note_id, format),
  FOREIGN KEY (source_owner_id, note_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX drive_export_jobs_due ON drive_export_jobs(state, due_at, lease_until);

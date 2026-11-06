-- Delegations hold sealed readable metadata; credentials only hold hashes. Disconnect/account deletion
-- physically removes a grant, every access/refresh credential, authorization code and retry receipt.
CREATE TABLE agent_grants (
  id alcove_id128 PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  info_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  UNIQUE (owner_id, id)
);
CREATE INDEX agent_grants_owner ON agent_grants(owner_id);
CREATE INDEX agent_grants_expiry ON agent_grants(expires_at);
CREATE TABLE agent_tokens (
  token_hash bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL,
  grant_id alcove_id128 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('personal', 'access', 'refresh')),
  consumed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, grant_id) REFERENCES agent_grants(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_tokens_grant ON agent_tokens(grant_id);
CREATE TABLE agent_clients (
  id alcove_id128 PRIMARY KEY,
  info_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX agent_clients_expiry ON agent_clients(expires_at);
CREATE TABLE agent_authorizations (
  id alcove_owner_id PRIMARY KEY,
  info_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX agent_authorizations_expiry ON agent_authorizations(expires_at);
CREATE TABLE agent_codes (
  code_hash bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL,
  grant_id alcove_id128 NOT NULL,
  info_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, grant_id) REFERENCES agent_grants(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_codes_grant ON agent_codes(grant_id);
CREATE INDEX agent_codes_expiry ON agent_codes(expires_at);
CREATE TABLE agent_operations (
  owner_id alcove_owner_id NOT NULL,
  grant_id alcove_id128 NOT NULL,
  operation_id alcove_id128 NOT NULL,
  args_hash bytea NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'complete')),
  result_sealed bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (grant_id, operation_id),
  FOREIGN KEY (owner_id, grant_id) REFERENCES agent_grants(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_operations_expiry ON agent_operations(expires_at);

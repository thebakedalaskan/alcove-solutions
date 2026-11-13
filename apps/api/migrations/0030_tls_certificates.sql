-- The TLS certificate the API's edge serves (docs: System architecture › The edge): one certificate naming every TLS host,
-- for the key the TEE's master makes, as the ACME CA issued it, chain and all, and when it runs out. A certificate is
-- public, and Certificate Transparency logs publish it anyway, so it's kept as it is. Every instance serves the one stored
-- here; whichever holds the advisory lock orders the next one, so new instances never ask the CA again.
CREATE TABLE tls_certificates (
  id text PRIMARY KEY CHECK (id = 'current'),
  chain_pem text NOT NULL,
  not_after timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

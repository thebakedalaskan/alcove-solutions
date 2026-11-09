-- Recipient-only browser ciphertext is additionally sealed, including its private routing metadata.
CREATE TABLE call_private_messages (
  owner_id alcove_owner_id NOT NULL,
  call_id alcove_id128 NOT NULL,
  message_id alcove_id128 NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  sender_tag bytea NOT NULL,
  recipient_tag bytea NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, call_id, message_id),
  FOREIGN KEY (owner_id, call_id) REFERENCES calls(owner_id, call_id) ON DELETE CASCADE
);
CREATE INDEX call_private_messages_sender ON call_private_messages(owner_id, call_id, sender_tag, seq);
CREATE INDEX call_private_messages_recipient ON call_private_messages(owner_id, call_id, recipient_tag, seq);

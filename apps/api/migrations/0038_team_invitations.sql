-- Invitations to a team (docs: Plans and usage › Team › Invitations; Privacy, keys and sessions › Invitations): someone on
-- a team asked one address to join it. The address, and when it was made, are sealed under the team's key (record kind
-- `team-invitation`, bound to the team and the invitation). The row finds it by a blind index of the address
-- (`team-invitee`, never the same as identities.email_index, so the two can't be joined), and by the SHA-256 of its own
-- link's secret, which is worked out from the team's root and the invitation's ID and never kept. `invited_by` is the member
-- who asked: what they asked goes when they're off the team. `sent_at` is when the team last sent it, whether or not an
-- email went. One for each address on a team; it goes when it's used, cancelled or runs out, and with its team. Whether
-- whoever it's to put it aside (Not now) is theirs alone, kept in their own sealed profile, never here.
CREATE TABLE team_invitations (
  invitation_id alcove_id128 PRIMARY KEY,
  team_id alcove_id128 NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  invited_by alcove_id128 NOT NULL REFERENCES team_members(member_id) ON DELETE CASCADE,
  invitee_index bytea NOT NULL,
  secret_sha256 bytea NOT NULL UNIQUE,
  ciphertext bytea NOT NULL,
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (team_id, invitee_index)
);
CREATE INDEX team_invitations_invitee ON team_invitations(invitee_index);
CREATE INDEX team_invitations_expiry ON team_invitations(expires_at);
CREATE INDEX team_invitations_inviter ON team_invitations(invited_by);

-- Each time a team sent an address an invitation (docs: Privacy, keys and sessions › Email), for the caps on one address:
-- how often one team sends it (mail.address_per_team, by `sender_index`, a keyed hash of the team's ID, blind index
-- `mail-sender`) and how many emails it's had in a day from all of Alcove (mail.address_per_day, by `emailed_at`, set as an
-- email of it goes). The address is a blind index of its canonical form (`mail-address`: lower-cased, a +tag dropped, and
-- at Gmail its dots), so every way of writing one mailbox shares its caps; never the `team-invitee` index an invitation is
-- found by, nor identities.email_index. No key to `teams`: deleting a team takes none of it with it, so an address's emails
-- that day still count, and a team made anew counts only its own sends.
-- Upkeep keeps team.invitation_seconds of it, and a day at least.
CREATE TABLE mail_sends (
  send_id alcove_id128 PRIMARY KEY,
  address_index bytea NOT NULL,
  sender_index bytea NOT NULL,
  sent_at timestamptz NOT NULL,
  emailed_at timestamptz
);
CREATE INDEX mail_sends_sender ON mail_sends(sender_index, address_index, sent_at);
CREATE INDEX mail_sends_emailed ON mail_sends(address_index, emailed_at) WHERE emailed_at IS NOT NULL;
CREATE INDEX mail_sends_age ON mail_sends(sent_at);

-- How many invitations each account made, and sent again, each day (UTC), for team.invitations_per_day. It goes with the
-- account, and upkeep keeps today and yesterday. Numbers only.
CREATE TABLE team_invitation_days (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  day date NOT NULL,
  made integer NOT NULL CHECK (made >= 0),
  PRIMARY KEY (owner_id, day)
);

-- Email waiting to go (docs: Privacy, keys and sessions › Email): each row one email, sealed under a key of its own worked out
-- from KSERVICE (`alcove/mail-outbox/v1`, record kind `mail`, bound to the row's ID): who it's to, the reply-to, its
-- subject, both bodies, its headers, its pictures and the send it's of (mail_sends). Written for every invitation made or
-- sent again, in the transaction that asks for it, whether or not it will go: the sender decides as it goes (an address
-- that stopped them, its caps, the day's). Sent right after and by upkeep, and deleted once sent or given up on, or with the
-- invitation it's of (`invitation_id`): cancelled, used, run out, or gone with whoever made it, nothing of it goes.
-- `attempts`: the sends tried; `send_after`: when it's next due (a send under way holds it for a few minutes, and the day's
-- limit until the next day).
CREATE TABLE mail_outbox (
  mail_id alcove_id128 PRIMARY KEY,
  invitation_id alcove_id128 REFERENCES team_invitations(invitation_id) ON DELETE CASCADE,
  send_after timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_due ON mail_outbox(send_after);
CREATE INDEX mail_outbox_invitation ON mail_outbox(invitation_id) WHERE invitation_id IS NOT NULL;

-- How many emails went each day (UTC), all of Alcove's, for mail.per_day. Upkeep keeps today and yesterday. Numbers only.
CREATE TABLE mail_days (
  day date PRIMARY KEY,
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0)
);

-- Addresses that asked Alcove to stop emailing them invitations, from the link or header every email carries: by a blind
-- index (`mail-stop`) of what the email's stop token names, a keyed hash of the address's canonical form, never the
-- address. Their invitations are still made, and are never emailed. Kept for good: stopping doesn't run out.
CREATE TABLE mail_stops (
  address_index bytea PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

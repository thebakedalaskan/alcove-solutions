-- Teams (docs: Plans and usage › Team). A team is an owner of its own, like a workspace: its key seals the team's name
-- and who's on it. What it bought (its unconsumed licenses and what each cost, auto-purchase, the alerts it has given and
-- its storage pool's grace) is sealed under the service accounting key, as an account's plan is. The rows hold only IDs,
-- times, states and roles.
CREATE TABLE teams (
  team_id alcove_id128 PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL UNIQUE REFERENCES owners(owner_id) ON DELETE CASCADE,
  -- Whoever made it: they keep its settings, licensed or not. Deleting their account deletes the team first, or is refused.
  admin_owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  -- When upkeep should next look at it: a license ending (its pool shrinks), or the pool's grace ending.
  due_at timestamptz,
  name_ciphertext bytea NOT NULL,
  billing_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_due ON teams(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX teams_admin ON teams(admin_owner_id);

-- Who's on a team: one team for each account. `member_id` is what the API calls them, so no account's owner ID reaches
-- anyone else. Their name and address are sealed under the team's key (`person_ciphertext`), kept as their account has
-- them. A license is live from `licensed_from` until `licensed_until`; `wanted_at` is when they last needed one and none
-- was there.
CREATE TABLE team_members (
  member_id alcove_id128 PRIMARY KEY,
  team_id alcove_id128 NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  account_owner_id alcove_owner_id NOT NULL UNIQUE REFERENCES owners(owner_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  person_ciphertext bytea NOT NULL,
  licensed_from timestamptz,
  licensed_until timestamptz,
  wanted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_members_team ON team_members(team_id);

-- One-time links to join a team: only a hash of the secret, deleted when it's used, or by upkeep once it has expired.
CREATE TABLE team_invites (
  secret_sha256 bytea PRIMARY KEY,
  team_id alcove_id128 NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_invites_team ON team_invites(team_id);
CREATE INDEX team_invites_expiry ON team_invites(expires_at);

-- Notes their organizer made visible to their team (read and ask only). They stay after the organizer leaves the team,
-- and go with the note or the team.
CREATE TABLE team_notes (
  owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  team_id alcove_id128 NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, note_item_id),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX team_notes_team ON team_notes(team_id);

-- A team's workspace: which team, and who's in it (`team`: every licensed member; `added`: only the people added). Both
-- null on every other workspace. `team_id` is `text`, not `alcove_id128`, as `payer_owner_id` is (0030): a new column of a
-- domain with a CHECK makes Postgres rewrite the whole table under its lock, and the foreign key already holds it to a team.
ALTER TABLE workspaces ADD COLUMN team_id text REFERENCES teams(team_id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN team_access text CHECK (team_access IN ('team', 'added'));
CREATE INDEX workspaces_team ON workspaces(team_id) WHERE team_id IS NOT NULL;

-- Feature flags (docs: engineering/feature-flags.md). A flag only switches something on, and only a name the code lists
-- (packages/api/src/feature-flags/names.ts) can be: a row naming any other is ignored. Nobody is readable here: a person is the
-- keyed hash of their address, blindIndex 'email', as in identities and workspace_members, so a grant follows the address
-- and can be made before they sign up. Flag and group names are operators' labels, like limit names.

-- A flag switched on for everyone: signed in or not.
CREATE TABLE feature_flags_everyone (
  name text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hand-picked groups of people (staff, beta-testers), and who's in each. Deleting a group deletes its members and grants.
CREATE TABLE feature_flag_groups (
  name text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feature_flag_group_members (
  group_name text NOT NULL REFERENCES feature_flag_groups(name) ON DELETE CASCADE,
  email_index bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_name, email_index)
);
CREATE INDEX feature_flag_group_members_email ON feature_flag_group_members(email_index);

-- A flag switched on for a group's members.
CREATE TABLE feature_flag_group_grants (
  feature_flag text NOT NULL,
  group_name text NOT NULL REFERENCES feature_flag_groups(name) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_flag, group_name)
);

-- A flag switched on for one person, by their address's hash.
CREATE TABLE feature_flag_person_grants (
  feature_flag text NOT NULL,
  email_index bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature_flag, email_index)
);
CREATE INDEX feature_flag_person_grants_email ON feature_flag_person_grants(email_index);

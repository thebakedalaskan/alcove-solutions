# Data and storage

[Docs home](../README.md) · [Privacy, keys and sessions](privacy-keys-and-sessions.md) · [Calls and recordings](calls-and-recordings.md)

Postgres (`D01`) holds ciphertext plus the minimum clear projection: opaque IDs, relationships, states,
timestamps, byte counts and sequence numbers. The object store (`O01`: RustFS locally, Cloudflare R2 in
production) holds immutable ciphertext objects under random IDs (`o/<Id128>`). The authoritative schema is
`apps/api/migrations/*.sql`; this page explains it.

## Tables

| Table | Clear columns | Ciphertext |
| --- | --- | --- |
| `owners` | `owner_id`, first passkey's public key, WebAuthn user handle, `stored_bytes`, `reserved_bytes`, `version`, `created_at` | `root_check` (HMAC) |
| `passkeys` | credential ID, owner, public key, counter, transports, `uses_prf`, created/last used | `root_envelope`, `label_ciphertext` |
| `items` | owner, item ID, `kind` (`profile`, `meeting`, `note`, plus reserved `page`, `file`, `transcript`, `chat`), current revision, `deleted_at`, `version` | — |
| `revisions` | owner, item, revision, parent revision, `index_state`, `created_at` | `key_envelope`, `manifest_ciphertext` |
| `calls` | owner, call, meeting item, `live`/`ended`, start/end, `version` | `state_ciphertext` (notes settings, chat, presentation) |
| `recordings` | owner, recording, note item, `recording`/`paused`/`stopped`, start/end, `version` | `key_envelope` (`Krec`) |
| `recording_pieces` | owner, recording, segment, seq, object ID, ciphertext SHA-256 and length, duration, codec | (the object) |
| `content_jobs` | owner, job, revision, kind (`notes`), state (`awaiting_inference`), lease, attempt | `job_ciphertext` |
| `operations` | owner, operation ID, method, completion time | `request_commitment` (HMAC), `result_ciphertext` |
| `billing_accounts` | owner | `state_ciphertext` (balance, history; `Kservice`) |
| `object_gc` | object ID, owner, queued time, attempts, last error | — |
| `object_refs`, `uploads`, `upload_parts` | From the original files design; unused until file uploads exist | — |

Constraints follow the original spec: checked domains for `mvp_id128` (22 characters) and `mvp_owner_id`
(43 characters), composite owner-scoped foreign keys, deferred item-head and parent-revision constraints, and
cascading deletes from items to revisions, calls and recordings.

## Manifests (encrypted)

| Item kind | Manifest fields |
| --- | --- |
| `profile` | name, preferences (`notesDefault`, `keep`) |
| `meeting` | title, start, end, guests (email, RSVP), notes setting, audience, code, status, duration, note ID |
| `note` | kind (`call`/`room`), title, start, duration, meeting ID, keep, audience, recording ID, status, summary, decisions, action items, chapters, screens, transcript (or null), suggested questions |

Every save writes a full new revision with a fresh `Krecord` and compare-and-set on the item head
(`409 conflict` if someone else saved first). Reads decrypt the head revision; listing decrypts every live item
of a kind (bounded by the vault limit of 500 items).

## Writes, reads and deletes

- **Audio pieces** are sealed with the recording's `Krec`, written to the object store, read back and checked
  (length and SHA-256), and only then recorded in SQL. A failed or duplicate write queues the object for deletion.
- **Streaming** a segment reads pieces in order, checks each digest, decrypts, and streams. Only while unlocked,
  with an allow-listed content type and `nosniff`.
- **Deleting** is physical (see [Privacy › Deletion](privacy-keys-and-sessions.md#deletion)).

## Operations

```
pnpm db:up      # Postgres 17 + RustFS in Docker
pnpm migrate    # apply migrations (the API also applies them at start)
pnpm db:down
```

Production runs migrations as the Cloud Run job `alcove-migrate` before each deploy.

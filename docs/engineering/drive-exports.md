# Google Drive exports

[Docs home](../README.md) · [Privacy and keys](privacy-keys-and-sessions.md) · [Notes and inference](notes-and-inference.md)

Google Drive exports are explicit readable copies of selected call artifacts. Google and everyone who can read the destination folder can read these copies. Alcove never creates public links, changes the folder's permissions or adds recipients. Deleting a source or disconnecting Drive stops subsequent exports; it does not delete copies already in Drive.

## Connection and destination

Drive consent is separate from ordinary Alcove sign-in and Calendar access. The OAuth authorization-code flow uses state bound to the signed-in owner and initiating live session, a short-lived sealed attempt cookie and PKCE. Signing out or switching Alcove accounts ends the pending authorization. It requests only `https://www.googleapis.com/auth/drive.file`, with Google's redirect folder picker. The picker grants access to the selected folder without requesting access to all files. The connected account comes from Drive's `about.user`; it need not be the Google account used for Alcove sign-in.

Settings shows that account, the selected folder and whether it belongs to a shared drive. Folder references are provider IDs, not paths or names. The server checks that a destination is a non-trashed folder to which the connected account can add children, including shared-drive destinations. A folder that is deleted or becomes inaccessible causes an actionable failure. Nothing redirects an export to My Drive or another folder.

Formats are finalized call notes as Markdown, transcripts as plain text, and retained original audio segments in a ZIP64 archive. Standalone room recordings are excluded. Missing, disabled, unfinished and failed artifacts are not substitutes for successful finalization. Personal notes are never included. Source access is checked using the same domain rules as a normal note read; original audio is exported only for the organizer, to avoid widening access to raw participant material.

## Durable background work

The notes feature owns the connection, policy and export worker (`apps/api/src/features/notes/drive-*`). `AlcoveApi.drive` exposes settings, authorized folders, per-note choices, job status and safe retry through the normal schema-parsed HTTP client. Settings controls future calls; a per-call choice explicitly opts an existing call in or out.

Maintenance discovers ready artifacts and resumes durable jobs. A call ending alone does not mark an artifact ready. Each run checks the current connection, selected format, destination and source permissions again. A revoked grant asks the person to reconnect; transient provider failures are retried. Jobs expose pending, uploading, uploaded, failed and reconnect states. Uploaded jobs link to the resulting Drive file.

A provider-generated file ID is saved before uploading. Resumable upload-session URLs and acknowledged offsets are sealed with the job. After an interruption, the worker probes the session and resumes from Google's acknowledged offset, keeping memory bounded to an 8 MiB chunk. After an uncertain final response it reconciles the reserved file ID rather than creating another file.

A regenerated artifact replaces the content of its existing export, preserving the file and its sharing rules. Changing defaults does not silently relocate an existing exported file. If someone explicitly chooses another destination and retries a failed export, Alcove reconciles the previous reservation, keeps its prior-copy information sealed and creates an intentional copy in the newly chosen folder. Changing the connected Google account disables automatic exports; an existing call requires explicit per-call consent before a copy is sent to that new account. Reconnecting the same account resumes jobs waiting on that connection with their original file IDs.

## Keys, records and deletion

Migration `0020_drive_exports.sql` only adds tables and an index. Existing migrations, rows and sealed source schemas are unchanged, so the previous release keeps reading its data while the migration runs.

Credentials, account details, folder names and references, export configuration, upload-session URLs and private job metadata are sealed under the exporting owner's root, with record kind `drive-export` and an exact scope identifying the connection, call or job. A job's seal also binds its source owner, note and format. The queue's clear columns carry only opaque owner/source/job/lease IDs, artifact format, processing state, attempt count and scheduling/lease timestamps. The provider never receives the Alcove owner keys.

Background access follows the existing notes-worker trust model: the API opens the owner's wrapped root through `openOwner` using the master key supplied by the configured key source, and closes and wipes that owner after the job. It does not store unlocked owner or session keys, keep browser sessions alive, or introduce a second key-access path. The existing production attestation requirements still apply; Drive export consent does not weaken them.

Disconnect physically removes stored Drive credentials, per-call choices and queue records. Account and source deletion remove related records through foreign keys. Already exported files remain under the Google account and destination's control.

## Deployment and verification

Enable the Google Drive API and Google Picker API in the OAuth client's Google Cloud project. Register `$API_URL/v1/drive/callback` as an authorized redirect URI in addition to the existing sign-in callback, and declare `drive.file` in the consent configuration. The existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` configure the client; secrets stay in the existing secret store. Keep the two callbacks registered, since Drive and sign-in serve different purposes.

The integration suites use the real server, HTTP client, Postgres and object store, with a Google provider fixture. Live acceptance additionally needs a person to complete Google's consent and folder picker on a supported account, finalize an artifact and open the uploaded file. A successful fixture run is not evidence that a production OAuth client has been configured or that live Google consent succeeded.

Provider references: [minimum Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [redirect folder picker](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker), [upload and retry rules](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

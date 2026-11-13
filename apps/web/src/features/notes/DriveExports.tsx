import { errorMessage, type DriveCallExports, type DriveExportInput } from '@alcove/api';
import { Button, DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderButton, DriveFolderLocation, Icon, IconButton, Modal, Spinner, Switch, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DriveFolderPicker } from '~/features/settings/DriveFolderPicker';
import { q, useDriveNote, useRetryDriveExport } from '~/lib/queries';
import { wentAt } from '~/lib/time';

/**
 * What the panel says of a call that follows the defaults: whether automatic exports cover it, by the rule they follow.
 * A call they don't cover may have gone before: while they covered it (they were turned off, or off and on again, which
 * covers only calls that end after), or by its own export, since stopped. Those files stay in Drive, and the exports
 * leave them as they are, so it says that rather than that the call isn't exported.
 */
function followsDefaults(data: DriveCallExports, available: number): string {
  const sent = data.jobs.some((job) => job.status === 'uploaded');
  if (data.automatic === 'before') return sent
    ? 'This call ended before automatic exports were last turned on, so they don’t cover it. Its files already in Drive stay there, and changes to the notes aren’t sent.'
    : 'This call ended before automatic exports were on, so it isn’t exported.';
  if (data.automatic === 'off') return sent
    ? 'Automatic exports are off, so they don’t cover this call. Its files already in Drive stay there, and changes to the notes aren’t sent.'
    : 'Automatic exports are off, so this call isn’t exported.';
  return available ? 'Uses your automatic export settings.' : 'No selected files are available to export from this call.';
}

/**
 * This person's export choices for this call. Personal notes and private participant material never enter an export.
 * Export to Google Drive sends this call now, whenever it ended and whether or not automatic exports are on: it saves the
 * call's own choice, with the folder and files shown, and its uploads start at once.
 */
export function NoteDriveExports({ noteId, recordingAllowed, recordingKept }: { noteId: string; recordingAllowed: boolean; recordingKept: boolean }) {
  const read = useQuery(q.driveNote(noteId));
  const connection = useQuery(q.drive());
  const change = useDriveNote(noteId);
  const retry = useRetryDriveExport();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const data = read.data;
  const connected = connection.data?.connection.status === 'connected';
  const recordingReason = recordingAllowed ? undefined : !recordingKept ? 'This call did not retain its original audio.' : 'Only the organizer can export original audio.';
  const availableFormats = data?.effective.formats.filter((format) => format !== 'recording-zip' || recordingAllowed) ?? [];
  const fail = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const save = async (patch: Partial<DriveExportInput>) => {
    if (!data) return;
    const choice = data.effective;
    const next = { enabled: choice.enabled, destinationId: choice.destination?.id ?? null, formats: choice.formats, ...patch };
    next.formats = next.formats.filter((format) => format !== 'recording-zip' || recordingAllowed);
    if (!next.formats.length) next.enabled = false;
    await change.mutateAsync(next);
  };
  const canExport = !!data?.effective.destination && availableFormats.length > 0;
  const exportCall = () => void save({ enabled: true }).catch(fail);
  const exportButton = <Button variant="secondary" size="sm" icon="cloudUpload" className="cd-drive-go" loading={change.isPending} disabled={!canExport} onClick={exportCall}>Export to Google Drive</Button>;
  return <section className="cd-drive" aria-label="Google Drive exports for this call">
    <h2><Icon name="cloudUpload" size={18} />Google Drive{change.isPending && <span className="cd-drive-saving" role="status"><Spinner />Saving…</span>}</h2>
    {read.isPending || connection.isPending ? <p className="cd-drive-wait"><Spinner />Loading exports…</p> : read.isError || connection.isError ? <div className="cd-drive-refused"><p>{errorMessage(read.error ?? connection.error)}</p><Button size="sm" icon="retry" onClick={() => { void read.refetch(); void connection.refetch(); }}>Try again</Button></div> : data && <>
      {!connected ? <p className="cd-drive-info">{connection.data?.connection.status === 'reconnect' ? 'Reconnect Google Drive to resume exports.' : 'Connect Google Drive to send completed call files to a folder you choose.'} <Link to="/settings" hash="google-drive">{connection.data?.connection.status === 'reconnect' ? 'Reconnect' : 'Set up exports'}<Icon name="right" size={13} /></Link></p> : <>
        <div className="cd-drive-line"><span>Use custom settings</span><Switch label="Use custom export settings for this call" checked={data.override !== null} disabled={change.isPending} onChange={(on) => { if (on) void save({}).catch(fail); else change.mutate(null, { onError: fail }); }} /></div>
        {data.override === null ? <div className="cd-drive-default">
          <p>{followsDefaults(data, availableFormats.length)}</p>
          {data.effective.destination && <DriveFolderLocation folder={data.effective.destination} />}
          {data.automatic !== 'on' && canExport && exportButton}
          <Link to="/settings" hash="google-drive">Change defaults<Icon name="right" size={13} /></Link>
        </div> : <div className="cd-drive-custom">
          <DriveFolderButton folder={data.effective.destination} aria-label="Choose Google Drive folder for this call" disabled={change.isPending} onClick={() => setPicking(true)} />
          <DriveExportFormats selected={data.effective.formats} unavailable={recordingReason ? { 'recording-zip': recordingReason } : undefined} disabled={change.isPending} onChange={(formats) => void save({ formats }).catch(fail)} />
          {/* Exporting is something to do, not a switch: once it's on, the copies follow the notes until it's stopped. */}
          {data.override.enabled && canExport
            ? <div className="cd-drive-line"><span>Goes to this folder. The copies follow the notes when they change.</span><Button variant="quiet" size="sm" disabled={change.isPending} onClick={() => void save({ enabled: false }).catch(fail)}>Stop exporting</Button></div>
            : exportButton}
          {!canExport && <p className="cd-drive-info">Choose a folder and at least one file type to export this call.</p>}
        </div>}
      </>}
      {data.override === null && recordingReason && <p className="cd-drive-info">{recordingReason}</p>}
      {data.jobs.some((job) => job.status === 'failed') && <p className="cd-drive-info">Existing copies stay in their original folder. Choosing another destination and retrying a failed export creates a new copy there.</p>}
      <DriveExportHistory jobs={data.jobs} when={wentAt} empty="Nothing exported from this call" onRetry={(id) => retry.mutate(id, { onError: fail })} retrying={retry.isPending ? retry.variables : undefined} />
      <details className="cd-drive-about"><summary>About these copies<Icon name="down" size={13} /></summary><DriveExportDisclosure /></details>
    </>}
    {picking && data && <DriveFolderPicker current={data.effective.destination} allowGoogle={false} onClose={() => setPicking(false)} onPick={(folder) => save({ destinationId: folder.id })} />}
  </section>;
}

/** The call's own Google Drive exports, from its More: one window, closed by Escape or ×. */
export function DriveExportsModal({ open, onClose, noteId, recordingAllowed, recordingKept }: { open: boolean; onClose: () => void; noteId: string; recordingAllowed: boolean; recordingKept: boolean }) {
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} label="Google Drive exports for this call" className="cd-drive-modal">
      <div className="cd-drive-x"><IconButton icon="x" label="Close" onClick={onClose} /></div>
      {open && <NoteDriveExports noteId={noteId} recordingAllowed={recordingAllowed} recordingKept={recordingKept} />}
    </Modal>
  );
}

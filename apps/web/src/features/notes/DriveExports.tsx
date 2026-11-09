import { errorMessage, type DriveExportInput } from '@alcove/api';
import { Button, DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderButton, DriveFolderLocation, Icon, Spinner, Switch, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DriveFolderPicker } from '~/features/settings/DriveFolderPicker';
import { q, useDriveNote, useRetryDriveExport } from '~/lib/queries';
import { wentAt } from '~/lib/time';

/** This person's export choices for this call. Personal notes and private participant material never enter an export. */
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
  return <section className="nd-drive" aria-label="Google Drive exports for this call">
    <h2><Icon name="cloudUpload" size={18} />Google Drive{change.isPending && <span className="nd-drive-saving" role="status"><Spinner />Saving…</span>}</h2>
    {read.isPending || connection.isPending ? <p className="nd-drive-wait"><Spinner />Loading exports…</p> : read.isError || connection.isError ? <div className="nd-drive-refused"><p>{errorMessage(read.error ?? connection.error)}</p><Button size="sm" icon="retry" onClick={() => { void read.refetch(); void connection.refetch(); }}>Try again</Button></div> : data && <>
      {!connected ? <p className="nd-drive-info">{connection.data?.connection.status === 'reconnect' ? 'Reconnect Google Drive to resume exports.' : 'Connect Google Drive to send completed call files to a folder you choose.'} <Link to="/settings" hash="google-drive">{connection.data?.connection.status === 'reconnect' ? 'Reconnect' : 'Set up exports'}<Icon name="right" size={13} /></Link></p> : <>
        <div className="nd-drive-line"><span>Use custom settings</span><Switch label="Use custom export settings for this call" checked={data.override !== null} disabled={change.isPending} onChange={(on) => { if (on) void save({}).catch(fail); else change.mutate(null, { onError: fail }); }} /></div>
        {data.override === null ? <div className="nd-drive-default"><p>{!availableFormats.length && data.effective.enabled ? 'No selected files are available to export from this call.' : data.effective.enabled ? 'Uses your automatic export settings.' : 'Automatic exports are off for this call.'}</p>{data.effective.destination && <DriveFolderLocation folder={data.effective.destination} />}<Link to="/settings" hash="google-drive">Change defaults<Icon name="right" size={13} /></Link></div> : <div className="nd-drive-custom">
          <DriveFolderButton folder={data.effective.destination} aria-label="Choose Google Drive folder for this call" disabled={change.isPending} onClick={() => setPicking(true)} />
          <DriveExportFormats selected={data.effective.formats} unavailable={recordingReason ? { 'recording-zip': recordingReason } : undefined} disabled={change.isPending} onChange={(formats) => void save({ formats }).catch(fail)} />
          <div className="nd-drive-line"><span>Export completed files</span><Switch label="Export completed files from this call" checked={data.effective.enabled} disabled={change.isPending || !data.effective.destination || !availableFormats.length} onChange={(enabled) => void save({ enabled }).catch(fail)} /></div>
          {(!data.effective.destination || !availableFormats.length) && <p className="nd-drive-info">Choose a folder and at least one file type to turn exports on.</p>}
        </div>}
      </>}
      {data.override === null && recordingReason && <p className="nd-drive-info">{recordingReason}</p>}
      {data.jobs.some((job) => job.status === 'failed') && <p className="nd-drive-info">Existing copies stay in their original folder. Choosing another destination and retrying a failed export creates a new copy there.</p>}
      <DriveExportHistory jobs={data.jobs} when={wentAt} empty="Nothing exported from this call" onRetry={(id) => retry.mutate(id, { onError: fail })} retrying={retry.isPending ? retry.variables : undefined} />
      <details className="nd-drive-about"><summary>About these copies<Icon name="down" size={13} /></summary><DriveExportDisclosure /></details>
    </>}
    {picking && data && <DriveFolderPicker current={data.effective.destination} allowGoogle={false} onClose={() => setPicking(false)} onPick={(folder) => save({ destinationId: folder.id })} />}
  </section>;
}

import { errorMessage, type DriveExportInput } from '@alcove/api';
import { Button, DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderLocation, Notice, ProviderMark, SettingFact, SettingRow, SettingsPart, Spinner, Switch, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { q, useConnectDrive, useDisconnectDrive, useRetryDriveExport, useUpdateDrive } from '~/lib/queries';
import { DriveFolderPicker } from './DriveFolderPicker';
import { Setting, useSaved } from './save';

export function DriveExportsPart({ result }: { result?: string | undefined }) {
  const settings = useQuery(q.drive());
  const jobs = useQuery(q.driveJobs());
  const notes = useQuery(q.notes());
  const connect = useConnectDrive();
  const disconnect = useDisconnectDrive();
  const update = useUpdateDrive();
  const retry = useRetryDriveExport();
  const [picking, setPicking] = useState(false);
  const accountRow = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const saved = useSaved();
  const data = settings.data;
  const connected = data?.connection.status === 'connected';
  const busy = update.isPending || disconnect.isPending || connect.isPending;
  const go = async () => {
    try { const { url } = await connect.mutateAsync(); location.assign(url); }
    catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  const off = async () => {
    try { await disconnect.mutateAsync(); toast('Google Drive disconnected. Copies already exported stay in Drive.', { icon: 'check' }); }
    catch (e) { toast(errorMessage(e), { icon: 'x' }); }
    finally { accountRow.current?.focus({ preventScroll: true }); }
  };
  const save = async (patch: Partial<DriveExportInput>, name: string) => {
    if (!data) return;
    const next = { enabled: data.enabled, destinationId: data.destination?.id ?? null, formats: data.formats, ...patch };
    if (!next.formats.length) next.enabled = false;
    await update.mutateAsync(next);
    saved(name);
  };
  const change = (patch: Partial<DriveExportInput>, name: string) => void save(patch, name).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  const retryJob = (id: string) => retry.mutate(id, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  return <SettingsPart id="google-drive" title="Google Drive" tag={update.isPending ? 'Saving…' : 'Exports'}>
    {result && (result !== 'connected' || connected) && <Notice tone={result === 'failed' ? 'caution' : 'info'} icon={result === 'connected' ? 'check' : result === 'failed' ? 'alert' : 'info'}>{result === 'connected' ? 'Google Drive connected. Choose the files to export and turn automatic exports on when you’re ready.' : result === 'cancelled' ? 'Google Drive access wasn’t changed. You can connect again when you’re ready.' : 'Google Drive couldn’t be connected. Try again; your existing settings are unchanged.'}</Notice>}
    {settings.isPending ? <SettingRow label="Loading Google Drive…" control={<Spinner />} /> : settings.isError ? <SettingRow label="Google Drive couldn’t be loaded" problem help={errorMessage(settings.error)} control={<Button size="sm" loading={settings.isFetching} onClick={() => void settings.refetch()}>Try again</Button>} /> : data && <>
      <SettingRow ref={accountRow} tabIndex={-1} mark={<ProviderMark provider="google" />} label={data.connection.email ?? 'Connect Google Drive'}
        help={data.connection.status === 'disconnected' ? 'Choose a Google account for exported calls. This connection is separate from your Alcove sign-in and calendar.' : data.connection.status === 'reconnect' ? 'Google access has ended. Reconnect this account to resume exports.' : 'Connected for exports. Your Alcove sign-in and calendar are separate.'}
        problem={data.connection.status === 'reconnect'} wide
        control={<div className="set-line">{connected ? <><SettingFact icon="check">Connected</SettingFact><Button size="sm" variant="quiet" loading={disconnect.isPending} disabled={busy} onClick={() => void off()}>Disconnect</Button></> : <Button size="sm" variant={data.connection.status === 'reconnect' ? 'primary' : 'secondary'} loading={connect.isPending} disabled={busy} onClick={() => void go()}>{data.connection.status === 'reconnect' ? 'Reconnect Google Drive' : 'Connect Google Drive'}</Button>}{data.connection.status === 'reconnect' && <Button size="sm" variant="quiet" loading={disconnect.isPending} disabled={busy} onClick={() => void off()}>Disconnect</Button>}</div>} />
      {data.connection.status !== 'disconnected' && <>
        <Setting label="Default destination" help="For new exports, unless you choose another folder on a call. Shared-drive folders are supported." wide
          control={<button type="button" className="set-drive-destination" aria-label="Choose default Google Drive folder" disabled={!connected || busy} onClick={() => setPicking(true)}><DriveFolderLocation folder={data.destination} /><span className="set-drive-change">{data.destination ? 'Change' : 'Choose'}</span></button>} />
        <Setting label="Files to export" help="Each file uploads only after it is finalized. A recording exports only when the call kept it and you can still read it." className="set-drive-formats-row" />
        <DriveExportFormats selected={data.formats} disabled={!connected || busy} onChange={(formats) => change({ formats }, 'Files to export')} />
        <Setting label="Automatic exports" help={!data.destination ? 'Choose a destination folder first.' : !data.formats.length ? 'Choose at least one file type first.' : 'Completed files upload in the background, even after you leave the call.'} off={!connected || !data.destination || !data.formats.length}
          control={<Switch label="Automatic Google Drive exports" checked={data.enabled} disabled={!connected || !data.destination || !data.formats.length || busy} onChange={(enabled) => change({ enabled }, 'Automatic exports')} />} />
      </>}
      <div className="set-drive-disclosure"><DriveExportDisclosure /></div>
      {data.connection.status !== 'disconnected' && <div className="set-drive-history"><h3>Recent exports</h3>{jobs.data?.some((job) => job.status === 'failed') && <p className="set-drive-history-help">Existing copies stay in their original folder. Choosing another destination and retrying a failed export creates a new copy there.</p>}{jobs.isPending ? <p className="set-drive-wait"><Spinner />Loading exports…</p> : jobs.isError ? <SettingRow label="Exports couldn’t be loaded" problem help={errorMessage(jobs.error)} control={<Button size="sm" onClick={() => void jobs.refetch()}>Try again</Button>} /> : <DriveExportHistory jobs={jobs.data.slice(0, 8)} source={(id) => <Link to="/notes/$noteId" params={{ noteId: id }} className="ac-clamp-1">{notes.data?.find((note) => note.id === id)?.title ?? 'View call'}</Link>} onRetry={retryJob} retrying={retry.isPending ? retry.variables : undefined} onReconnect={() => void go()} />}</div>}
    </>}
    {picking && data && <DriveFolderPicker current={data.destination} onClose={() => setPicking(false)} onPick={(folder) => save({ destinationId: folder.id }, 'Default destination')} />}
  </SettingsPart>;
}

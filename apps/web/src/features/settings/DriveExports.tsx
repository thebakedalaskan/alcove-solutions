/*
 * Google Drive, under the calendar in Connections: one line that says where notes go, until Manage opens the rest in place
 * and Done folds it again. It's its own Google connection, apart from signing in and the calendar. Google sends you back
 * here with `?drive=` saying how it went, which opens it and says so. Connect and Reconnect first say what Google shares
 * and what Alcove sends, and only Continue to Google goes there. Each change saves as it's made, one at a time: the
 * controls wait while one is on its way, and focus stays where it was.
 */
import { errorMessage, type DriveConnectResult, type DriveExportFormat, type DriveExportInput, type DriveSettings } from '@alcove/api';
import {
  Button, DriveExportDisclosure, DriveExportFormats, DriveExportHistory, DriveFolderButton, Icon, Modal, ProviderMark, SettingFact, SettingFoot, SettingNote, SettingRow, Switch, useToast,
  type SettingRowProps
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { q, useConnectDrive, useDisconnectDrive, useRetryDriveExport, useUpdateDrive } from '~/lib/queries';
import { wentAt } from '~/lib/time';
import { DriveFolderPicker } from './DriveFolderPicker';
import { Setting, useSaving } from './save';

const ORDER: readonly DriveExportFormat[] = ['notes-markdown', 'transcript-text', 'recording-zip'];
const WORD: Record<DriveExportFormat, string> = { 'notes-markdown': 'notes', 'transcript-text': 'transcript', 'recording-zip': 'recording' };

/** What goes, in words: "notes and transcript", "notes, transcript and recording". */
function listed(formats: readonly DriveExportFormat[]): string {
  const words = ORDER.filter((f) => formats.includes(f)).map((f) => WORD[f]);
  const last = words.pop() ?? '';
  return words.length ? `${words.join(', ')} and ${last}` : last;
}

/** Where notes go, in one line: what the folded row says. */
function whereNotesGo(s: DriveSettings): string {
  if (!s.destination) return s.connection.email ? `Connected as ${s.connection.email}. Choose a folder.` : 'Connected. Choose a folder.';
  if (s.enabled && s.formats.length) return `After each call: ${listed(s.formats)} to ${s.destination.name}.`;
  return 'Paused. Nothing is exported until you turn it on.';
}

/** What Google's return did, said inside the open panel. */
function returned(result: DriveConnectResult, s: DriveSettings): string {
  if (result === 'cancelled') return 'Google Drive access wasn’t changed. You can connect again when you’re ready.';
  if (result === 'failed') return 'Google Drive couldn’t be connected. Try again; your settings are as they were.';
  return s.destination ? 'Google Drive is connected.' : 'Google Drive is connected. Choose a folder, and what to send to it.';
}

export function GoogleDrive({ result }: { result?: DriveConnectResult | undefined }) {
  const settings = useQuery(q.drive());
  const data = settings.data;
  const status = data?.connection.status;
  const connected = status === 'connected';
  // Back from Google, it opens to say how that went.
  const [open, setOpen] = useState(result !== undefined);
  const [said, setSaid] = useState(result !== undefined);
  const shown = open && status !== undefined && status !== 'disconnected';
  // What went lately, only while it's open to show it.
  const jobs = useQuery({ ...q.driveJobs(), enabled: shown });
  const notes = useQuery({ ...q.notes(), enabled: shown });
  const connect = useConnectDrive();
  const disconnect = useDisconnectDrive();
  const update = useUpdateDrive();
  const retry = useRetryDriveExport();
  /** What's open over the page: what connecting allows, or the folders. */
  const [dialog, setDialog] = useState<'connect' | 'pick' | null>(null);
  const [going, setGoing] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const saving = useSaving();
  // Back from Google, the browser can bring this page back just as it was left.
  useEffect(() => {
    const back = (e: PageTransitionEvent) => { if (e.persisted) setGoing(false); };
    addEventListener('pageshow', back);
    return () => removeEventListener('pageshow', back);
  }, []);
  const busy = update.isPending || disconnect.isPending || connect.isPending || going;
  // Busy, a button can't hold focus, and some of them go: it stays on the row rather than falling back to the page.
  const stay = () => row.current?.focus({ preventScroll: true });
  /** Once a change is kept, the control pressed has focus again: it couldn't hold it while it waited. */
  const refocus = (was: Element | null, frames = 3) => requestAnimationFrame(() => {
    const at = document.activeElement;
    if (at && at !== document.body && at !== was) return;
    if (!(was instanceof HTMLElement) || !was.isConnected) { stay(); return; }
    if (was.matches(':disabled')) { if (frames > 0) refocus(was, frames - 1); else stay(); return; }
    was.focus({ preventScroll: true });
  });
  /** Connect and Reconnect say what Google shares and what Alcove sends, before anything goes to Google. */
  const askToConnect = () => {
    connect.reset();
    setDialog('connect');
  };
  const go = async () => {
    if (busy) return;
    setGoing(true);
    try {
      const { url } = await connect.mutateAsync();
      setDialog(null);
      location.assign(url);
    } catch (e) { setGoing(false); toast(errorMessage(e), { icon: 'x' }); }
  };
  const off = async () => {
    try {
      await disconnect.mutateAsync();
      setOpen(false);
      setSaid(false);
      toast('Google Drive is disconnected. Copies already there stay.', { icon: 'check' });
    } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
    finally { stay(); }
  };
  /** Saves a change as the row named `name`, which says how it stands. Refused, it rejects, for whoever asked to say why. */
  const save = async (patch: Partial<DriveExportInput>, name: string) => {
    if (!data) return;
    const next = { enabled: data.enabled, destinationId: data.destination?.id ?? null, formats: data.formats, ...patch };
    if (!next.formats.length) next.enabled = false;
    await saving(name, async () => {
      await update.mutateAsync(next);
      // What Google's way back said is done with once something's kept.
      setSaid(false);
    });
  };
  const change = (patch: Partial<DriveExportInput>, name: string) => {
    const was = document.activeElement;
    void save(patch, name).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => refocus(was));
  };
  const retryJob = (id: string) => retry.mutate(id, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const toggle = () => { setOpen(!open); setSaid(false); };
  const reconnect = status === 'reconnect';
  /** The one line: what it says and its control, however Drive stands. It's the same row throughout, so focus can stay on it. */
  const line: Pick<SettingRowProps, 'help' | 'problem' | 'control'> =
    !data ? (settings.isError
      ? { help: errorMessage(settings.error), problem: true, control: <Button variant="secondary" size="sm" icon="retry" loading={settings.isFetching} onClick={() => void settings.refetch().then(stay)}>Try again</Button> }
      : { control: <SettingFact>Looking…</SettingFact> })
      : status === 'disconnected' ? { help: 'Copy notes and transcripts to a folder after each call.', control: <Button variant="secondary" size="sm" loading={busy} onClick={askToConnect}>{going ? 'Opening Google' : 'Connect'}</Button> }
        : {
          help: reconnect ? 'Google access has ended. Reconnect to resume exports.' : whereNotesGo(data), problem: reconnect,
          control: (
            <div className="set-line">
              {reconnect
                ? <Button variant="primary" size="sm" loading={going || connect.isPending} disabled={busy} onClick={askToConnect}>{going ? 'Opening Google' : 'Reconnect'}</Button>
                : data.destination && <SettingFact icon={data.enabled ? 'check' : undefined} tone={data.enabled ? 'yes' : undefined}>{data.enabled ? 'Exporting' : 'Paused'}</SettingFact>}
              <Button variant="secondary" size="sm" iconRight={open ? 'up' : 'down'} aria-expanded={open} onClick={toggle}>{open ? 'Done' : 'Manage'}</Button>
            </div>
          )
        };
  const ready = connected && data !== undefined && data.destination !== null && data.formats.length > 0;
  return (
    <>
      <SettingRow ref={row} id="google-drive" tabIndex={-1} mark={<ProviderMark provider="google" />} label="Google Drive" {...line} />
      {/* Back from Google without a connection: what happened, under the line. */}
      {data && status === 'disconnected' && said && result !== undefined && result !== 'connected' && <SettingNote tone={result === 'failed' ? 'caution' : 'info'}>{returned(result, data)}</SettingNote>}
      {data && shown && (
        <>
          {said && result !== undefined && <SettingNote tone={result === 'failed' ? 'caution' : 'info'} icon={result === 'connected' ? 'check' : undefined}>{returned(result, data)}</SettingNote>}
          <Setting sub wide label="Folder" help="For new exports. You can pick another on a call."
            control={<DriveFolderButton folder={data.destination} disabled={!connected || busy} onClick={() => setDialog('pick')} />} />
          <Setting sub wide label="Files" help="Each goes once the call’s notes are final."
            control={<DriveExportFormats selected={data.formats} disabled={!connected || busy} onChange={(formats) => change({ formats }, 'Files')} />} />
          <Setting sub label="Export after each call" off={!ready}
            help={!data.destination ? 'Choose a folder first.' : !data.formats.length ? 'Choose at least one file type first.' : 'For calls that end after you turn it on. Files upload in the background, even after you leave.'}
            onLabel={ready && !busy ? () => change({ enabled: !data.enabled }, 'Export after each call') : undefined}
            control={<Switch label="Export after each call" checked={data.enabled} disabled={!ready || busy} onChange={(enabled) => change({ enabled }, 'Export after each call')} />} />
          {jobs.isError
            ? <SettingRow sub label="Recent exports" problem help={errorMessage(jobs.error)} control={<Button variant="secondary" size="sm" icon="retry" loading={jobs.isFetching} onClick={() => void jobs.refetch()}>Try again</Button>} />
            : jobs.data === undefined ? <SettingRow sub label="Recent exports" control={<SettingFact>Looking…</SettingFact>} />
              // Nothing has gone yet, and nothing can until there's a folder: nothing to show.
              : (jobs.data.length > 0 || data.destination) && (
                <DriveExportHistory jobs={jobs.data.slice(0, 8)} when={wentAt} onRetry={retryJob} retrying={retry.isPending ? retry.variables : undefined} onReconnect={askToConnect}
                  source={(id) => <Link to="/notes/$noteId" params={{ noteId: id }}>{notes.data?.find((note) => note.id === id)?.title ?? 'A call'}</Link>} />
              )}
          <SettingFoot sub actions={<Button variant="quiet" size="sm" loading={disconnect.isPending} disabled={busy} onClick={() => void off()}>{disconnect.isPending ? 'Disconnecting' : 'Disconnect Google Drive'}</Button>}>
            <DriveExportDisclosure />
          </SettingFoot>
        </>
      )}
      {dialog === 'connect' && (
        <Modal open onOpenChange={(o) => { if (!o && !connect.isPending) setDialog(null); }} label="Allow Google Drive exports" className="set-drive-picker" focusSelf>
          <header className="set-drive-picker-head">
            <span className="set-drive-picker-icon"><Icon name="cloudUpload" size={24} /></span>
            <h2>Allow Google Drive exports</h2>
          </header>
          <div className="set-drive-folders space-y-3 pb-4 text-sm leading-relaxed text-ink-2">
            <p>Google shares your Drive account details and lets Alcove create export files and manage files you make available to it. In Google, choose the account and folder where exports should go.</p>
            <p>Alcove sends only the call files you choose to export. If you reconnect the same account, exports you previously enabled can resume.</p>
            <DriveExportDisclosure />
          </div>
          <footer className="set-drive-picker-foot">
            <Button disabled={connect.isPending} onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" icon="external" loading={connect.isPending} disabled={busy} onClick={() => void go()}>Continue to Google</Button>
          </footer>
        </Modal>
      )}
      {dialog === 'pick' && data && <DriveFolderPicker current={data.destination} onClose={() => setDialog(null)} onPick={(folder) => save({ destinationId: folder.id }, 'Folder')} />}
    </>
  );
}

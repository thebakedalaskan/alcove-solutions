import { errorMessage, type DriveFolder } from '@alcove/api';
import { Button, DriveFolderLocation, EmptyState, Icon, IconButton, Modal, Spinner } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { sharingQueries, usePickDriveFolder } from '~/features/notes/sharing/queries';

/** Only folders Google made available to this connection; the server checks current write access on selection. */
export function DriveFolderPicker({ current, onPick, onClose, allowGoogle = true }: {
  current: DriveFolder | null; onPick: (folder: DriveFolder) => Promise<void>; onClose: () => void; allowGoogle?: boolean | undefined;
}) {
  const folders = useQuery(sharingQueries.driveFolders());
  const pick = usePickDriveFolder();
  const [saving, setSaving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = saving !== null || pick.isPending;
  const choose = async (folder: DriveFolder) => {
    if (busy) return;
    setSaving(folder.id); setProblem(null);
    try { await onPick(folder); onClose(); }
    catch (e) { setProblem(errorMessage(e)); }
    finally { setSaving(null); }
  };
  const google = async () => {
    setProblem(null);
    try { const { url } = await pick.mutateAsync(); location.assign(url); }
    catch (e) { setProblem(errorMessage(e)); }
  };
  return <Modal open onOpenChange={(open) => { if (!open && !busy) onClose(); }} label="Choose a Google Drive folder" className="set-drive-picker">
    <header className="set-drive-picker-head"><span className="set-drive-picker-icon"><Icon name="folderOpen" size={24} /></span><div><h2>Choose a folder</h2><p>Only folders you allow Alcove to use appear here.</p></div><IconButton icon="x" label="Close folder picker" disabled={busy} onClick={onClose} /></header>
    <div className="set-drive-folders" aria-busy={folders.isPending}>
      {folders.isPending ? <div className="set-drive-wait"><Spinner /><span>Looking for folders…</span></div>
        : folders.isError ? <EmptyState art={null} title="Folders couldn’t be loaded" action={<Button size="sm" icon="retry" loading={folders.isFetching} onClick={() => void folders.refetch()}>Try again</Button>}>{errorMessage(folders.error)}</EmptyState>
          : folders.data.length === 0 ? <EmptyState art={null} title="Choose your first folder">{allowGoogle ? 'Open Google to choose where your exported calls go.' : 'Choose a folder in Settings first. Only folders already allowed for this connection are available here.'}</EmptyState>
            : <ul aria-label="Available folders">{folders.data.map((folder) => <li key={folder.id}><button type="button" className="set-drive-folder" disabled={busy} aria-label={`Use ${folder.name}${folder.driveId ? ' in shared drive' : ''}`} onClick={() => void choose(folder)}>
              <DriveFolderLocation folder={folder} />{saving === folder.id ? <Spinner /> : folder.id === current?.id ? <Icon name="check" size={17} /> : <Icon name="right" size={16} />}
            </button></li>)}</ul>}
    </div>
    {problem && <p className="set-drive-problem" role="alert"><Icon name="alert" size={16} />{problem}</p>}
    <footer className="set-drive-picker-foot">
      <p>{allowGoogle
        ? 'In Google, choose the account and folder for exports. Google shares the account details and lets Alcove create and manage export files there. The folder’s sharing rules apply to every copy.'
        : 'The folder’s existing sharing rules apply to every copy. A folder that can’t be written to is refused.'}</p>
      {allowGoogle && <Button variant="primary" icon="external" loading={pick.isPending} disabled={busy} onClick={() => void google()}>Choose in Google</Button>}
    </footer>
  </Modal>;
}

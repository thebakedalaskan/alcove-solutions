import type { ReactNode } from 'react';
import type { DriveExportFormat, DriveExportJob, DriveFolder } from '@alcove/api';
import { cn } from '../cn';
import { Button, Spinner } from './primitives';
import { Icon, type IconName } from './icon';
import { EmptyState } from './empty';

const FORMATS: readonly { value: DriveExportFormat; title: string; detail: string; icon: IconName }[] = [
  { value: 'notes-markdown', title: 'Finalized notes', detail: 'Markdown · .md', icon: 'notes' },
  { value: 'transcript-text', title: 'Transcript', detail: 'Plain text · .txt', icon: 'transcript' },
  { value: 'recording-zip', title: 'Retained recording', detail: 'Original audio pieces · .zip', icon: 'waveform' }
];
export const driveFormatLabel = (format: DriveExportFormat): string => FORMATS.find((f) => f.value === format)?.title ?? format;

/** The supported formats, chosen explicitly. What is absent or unfinished is never exported. */
export function DriveExportFormats({ selected, onChange, disabled = false, unavailable }: {
  selected: readonly DriveExportFormat[]; onChange: (formats: DriveExportFormat[]) => void; disabled?: boolean | undefined; unavailable?: Partial<Record<DriveExportFormat, string>> | undefined;
}) {
  const availableSelected = selected.filter((format) => !unavailable?.[format]);
  return <div className="ac-drive-formats" role="group" aria-label="Files to export">{FORMATS.map((format) => {
    const reason = unavailable?.[format.value];
    const on = availableSelected.includes(format.value);
    return <button key={format.value} type="button" aria-pressed={on} disabled={disabled || reason !== undefined} className={cn('ac-drive-format', on && 'is-on', reason !== undefined && 'is-unavailable')}
      onClick={() => onChange(on ? availableSelected.filter((f) => f !== format.value) : [...availableSelected, format.value])}>
      <Icon name={format.icon} size={20} /><span><b>{format.title}</b><small>{format.detail}</small>{reason && <small className="ac-drive-format-reason">{reason}</small>}</span><span className="ac-drive-tick"><Icon name="check" size={13} /></span>
    </button>;
  })}</div>;
}

export function DriveExportDisclosure() {
  return <div className="ac-drive-disclosure"><Icon name="info" size={17} /><p>These copies are readable in Google Drive under the folder’s existing sharing rules. Alcove never changes sharing or includes private participant notes. Disconnecting, deleting the source or losing access stops future exports. Copies already in Drive stay until you delete them there.</p></div>;
}

/** A stable folder selection: the name is display-only and the ID stays with the caller. */
export function DriveFolderLocation({ folder, fallback = 'Choose a destination folder' }: { folder: DriveFolder | null; fallback?: string | undefined }) {
  return <span className="ac-drive-location"><Icon name={folder?.driveId ? 'building' : 'folder'} size={18} /><span><b className="ac-clamp-1">{folder?.name ?? fallback}</b>{folder && <small>{folder.driveId ? 'Shared drive' : 'Google Drive'}</small>}</span></span>;
}

const STATUS: Record<DriveExportJob['status'], { label: string; icon: IconName }> = {
  pending: { label: 'Pending', icon: 'clock' }, uploading: { label: 'Uploading', icon: 'cloudUpload' }, uploaded: { label: 'Uploaded', icon: 'check' },
  failed: { label: 'Needs attention', icon: 'alert' }, reconnect: { label: 'Reconnect Google Drive', icon: 'key' }
};

/** Recent exports, with the action next to the file it changes. No permission-changing actions. */
export function DriveExportHistory({ jobs, onRetry, retrying, onReconnect, source, empty = 'No exports yet' }: {
  jobs: readonly DriveExportJob[]; onRetry: (id: string) => void; retrying?: string | undefined; onReconnect?: (() => void) | undefined; empty?: string | undefined; source?: ((noteId: string) => ReactNode) | undefined;
}) {
  if (!jobs.length) return <EmptyState art={null} className="ac-drive-empty" title={empty}>Selected files appear here after they finish. Failed or deleted material is never uploaded.</EmptyState>;
  return <ul className="ac-drive-jobs" aria-label="Google Drive exports">{jobs.map((job) => {
    const status = STATUS[job.status];
    const problem = job.status === 'failed' || job.status === 'reconnect';
    return <li key={job.id} tabIndex={-1} className={cn('ac-drive-job', problem && 'is-problem')}>
      <span className="ac-drive-job-mark">{job.status === 'uploading' ? <Spinner /> : <Icon name={status.icon} size={17} />}</span>
      <div className="ac-drive-job-copy"><b>{driveFormatLabel(job.format)}</b>{source && <div className="ac-drive-source">{source(job.noteId)}</div>}<span role={problem ? undefined : 'status'}>{status.label}<span className="ac-drive-job-date"> · {new Date(job.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></span>{problem && job.reason && <p>{job.reason}</p>}</div>
      {job.status === 'uploaded' && job.fileUrl && <a href={job.fileUrl} target="_blank" rel="noreferrer" className="ac-drive-open">Open<Icon name="external" size={14} /><span className="sr-only"> {driveFormatLabel(job.format)} in Google Drive</span></a>}
      {job.status === 'failed' && <Button size="sm" variant="quiet" icon="retry" loading={retrying === job.id} disabled={retrying !== undefined} onClick={(e) => { e.currentTarget.closest('li')?.focus(); onRetry(job.id); }}>Retry</Button>}
      {job.status === 'reconnect' && onReconnect && <Button size="sm" variant="quiet" onClick={onReconnect}>Reconnect</Button>}
    </li>;
  })}</ul>;
}

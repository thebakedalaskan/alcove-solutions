/*
 * Google Drive exports: what goes (three files you can tick), where (a folder), what went lately, and what happens to the
 * copies, in one line. Used in Settings' Connections and on a call's own note. Stateless. Styles in drive-exports.css (ac-drive-).
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { DriveExportFormat, DriveExportJob, DriveFolder } from '@alcove/api';
import { cn } from '../foundation/cn';
import { Button, Spinner } from '../foundation/primitives';
import { Icon, type IconName } from '../foundation/icon';
import { EmptyState } from '../foundation/empty';

const FORMATS: readonly { value: DriveExportFormat; title: string; ext: string; icon: IconName }[] = [
  { value: 'notes-markdown', title: 'Notes', ext: '.md', icon: 'notes' },
  { value: 'transcript-text', title: 'Transcript', ext: '.txt', icon: 'transcript' },
  { value: 'recording-zip', title: 'Recording', ext: '.zip', icon: 'waveform' }
];
const formatOf = (format: DriveExportFormat) => FORMATS.find((f) => f.value === format);
export const driveFormatLabel = (format: DriveExportFormat): string => formatOf(format)?.title ?? format;

/**
 * The files to export, three chips in a row (one under another on a phone): each its name and extension, with a tick when
 * it's on. A file this call can't send says why (`unavailable`) and can't be ticked. What is absent or unfinished is
 * never exported.
 */
export function DriveExportFormats({ selected, onChange, disabled = false, unavailable }: {
  selected: readonly DriveExportFormat[]; onChange: (formats: DriveExportFormat[]) => void; disabled?: boolean | undefined; unavailable?: Partial<Record<DriveExportFormat, string>> | undefined;
}) {
  const availableSelected = selected.filter((format) => !unavailable?.[format]);
  return <div className="ac-drive-formats" role="group" aria-label="Files to export">{FORMATS.map((format) => {
    const reason = unavailable?.[format.value];
    const on = availableSelected.includes(format.value);
    return <button key={format.value} type="button" aria-pressed={on} disabled={disabled || reason !== undefined} className={cn('ac-drive-format', reason !== undefined && 'is-unavailable')}
      onClick={() => onChange(on ? availableSelected.filter((f) => f !== format.value) : [...availableSelected, format.value])}>
      <Icon name={format.icon} size={15} />
      <span className="ac-drive-format-t"><b>{format.title}</b><small>{format.ext}</small>{reason && <small className="ac-drive-format-reason">{reason}</small>}</span>
      <Icon name="check" size={13} className="ac-drive-tick" />
    </button>;
  })}</div>;
}

/** What happens to the copies, in one line: for the foot of Google Drive in Settings, and a call's own exports. */
export function DriveExportDisclosure() {
  return <span className="ac-drive-disclosure">Copies follow the folder’s sharing in Drive, and stay there if you disconnect. Alcove never changes who can see them, and never sends private notes.</span>;
}

/** A folder, to read: its name and which drive it's in. The ID stays with the caller. */
export function DriveFolderLocation({ folder, fallback = 'Choose a destination folder' }: { folder: DriveFolder | null; fallback?: string | undefined }) {
  return <span className="ac-drive-location"><Icon name={folder?.driveId ? 'building' : 'folder'} size={18} /><span><b className="ac-clamp-1">{folder?.name ?? fallback}</b>{folder && <small>{folder.driveId ? 'Shared drive' : 'Google Drive'}</small>}</span></span>;
}

/**
 * The Folder control: where exports go, as a box to press for another, with Change at its end. With no folder yet it
 * asks for one. Name it for screen readers with `aria-label` when its words aren't enough.
 */
export const DriveFolderButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { folder: DriveFolder | null }>(
  function DriveFolderButton({ folder, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={cn('ac-drive-dest', !folder && 'is-empty', className)} {...rest}>
        <Icon name={folder?.driveId ? 'building' : 'folder'} size={17} />
        <span className="ac-drive-dest-t"><b className="ac-clamp-1">{folder?.name ?? 'Choose a folder'}</b>{folder && <small className="ac-clamp-1">{folder.driveId ? 'Shared drive' : 'Google Drive'}</small>}</span>
        {folder && <em>Change</em>}
      </button>
    );
  });

/** Whether a waiting job went wrong in a way that may pass, and waits to be tried again later. */
const waitsToRetry = (job: DriveExportJob) => job.status === 'pending' && job.reason !== null && job.nextAt !== null && Date.parse(job.nextAt) > Date.now();

/**
 * A job's state at the end of its line: when it went (Open, in Drive), on its way (waiting to upload, or when it's tried
 * next), or the way on from a problem.
 */
function JobEnd({ job, when, onRetry, retrying, onReconnect }: { job: DriveExportJob; when: (iso: string) => string; onRetry: (id: string) => void; retrying: string | undefined; onReconnect: (() => void) | undefined }) {
  const label = driveFormatLabel(job.format);
  switch (job.status) {
    case 'uploaded':
      return job.fileUrl
        ? <a href={job.fileUrl} target="_blank" rel="noreferrer" className="ac-drive-s is-open"><Icon name="check" size={14} />{when(job.updatedAt)}<span className="sr-only">. Open {label} in Google Drive</span></a>
        : <span className="ac-drive-s"><Icon name="check" size={14} />{when(job.updatedAt)}</span>;
    case 'uploading':
      return <span className="ac-drive-s is-busy" role="status"><Spinner />Uploading</span>;
    case 'pending':
      return <span className="ac-drive-s is-wait" role="status"><Icon name="clock" size={14} />{waitsToRetry(job) && job.nextAt ? `Next try ${when(job.nextAt)}` : 'Waiting to upload'}</span>;
    case 'failed':
      return <Button size="xs" icon="retry" loading={retrying === job.id} disabled={retrying !== undefined} onClick={(e) => { e.currentTarget.closest('li')?.focus(); onRetry(job.id); }}>Try again</Button>;
    case 'reconnect':
      return onReconnect ? <Button size="xs" icon="key" onClick={onReconnect}>Reconnect</Button> : <span className="ac-drive-s is-no"><Icon name="key" size={14} />Reconnect</span>;
  }
}

/**
 * Recent exports, under a small heading: each file a line, which call it's from (`source`, when they're from more than
 * one) and what it is, and at its end when it went (`when` says a time as the app says times), that it's waiting to upload,
 * or the way on from a problem. One that went wrong in a way that may pass says why, quietly, and when it's tried next.
 * No permission-changing actions.
 */
export function DriveExportHistory({ jobs, when, onRetry, retrying, onReconnect, source, empty = 'No exports yet' }: {
  jobs: readonly DriveExportJob[]; when: (iso: string) => string; onRetry: (id: string) => void; retrying?: string | undefined; onReconnect?: (() => void) | undefined; empty?: string | undefined; source?: ((noteId: string) => ReactNode) | undefined;
}) {
  const h = useId();
  return (
    <div className="ac-drive-history">
      <p id={h} className="ac-drive-history-h">Recent exports</p>
      {!jobs.length
        ? <EmptyState art={null} className="ac-drive-empty" title={empty}>Files show here once they’ve gone. Nothing failed or deleted is ever sent.</EmptyState>
        : <ul className="ac-drive-jobs" aria-labelledby={h}>{jobs.map((job) => {
          const problem = job.status === 'failed' || job.status === 'reconnect';
          const label = driveFormatLabel(job.format);
          return (
            <li key={job.id} tabIndex={-1} className={cn('ac-drive-job', problem && 'is-problem')}>
              <span className="ac-drive-job-mark"><Icon name={formatOf(job.format)?.icon ?? 'fileText'} size={15} /></span>
              <div className="ac-drive-job-copy">
                <span className="ac-drive-job-t">{source ? <><b className="ac-drive-source">{source(job.noteId)}</b><span>· {label}</span></> : <b>{label}</b>}</span>
                {problem && <span className="ac-drive-why">{job.reason ?? (job.status === 'reconnect' ? 'Google access has ended.' : 'This file didn’t go.')}</span>}
                {waitsToRetry(job) && <span className="ac-drive-why is-quiet">{job.reason}</span>}
              </div>
              <JobEnd job={job} when={when} onRetry={onRetry} retrying={retrying} onReconnect={onReconnect} />
            </li>
          );
        })}</ul>}
    </div>
  );
}

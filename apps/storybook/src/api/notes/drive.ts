/*
 * Google Drive exports, as the stand-in answers for them (packages/api-http/src/notes/drive.ts is the real client's): the
 * connection, its folders, the default files and a call's own choice, and the exports themselves. The stand-in holds no
 * provider credentials: connecting and picking a folder stop at Google's hand-off.
 */
import { DriveExportInputSchema, type AlcoveApi, type DriveAutomatic, type DriveCallExports, type DriveExportFormat, type DriveExportInput, type DriveExportJob, type Note } from '@alcove/api';
import { disconnectedDrive } from '../../world/drive-exports';
import type { World } from '../../world/world';
import { answer, refused } from '../answer';
import { current, nextId } from '../state';
import { noteIn } from './api';

function driveChoice(w: World, input: DriveExportInput) {
  const parsed = DriveExportInputSchema.parse(input);
  const destination = parsed.destinationId === null ? null : w.drive.folders.find((folder) => folder.id === parsed.destinationId);
  if (destination === undefined) throw refused('invalid', 'Choose a folder you can write to.');
  if (parsed.enabled && (!destination || !parsed.formats.length)) throw refused('invalid', 'Choose a folder and a file type first.');
  return { enabled: parsed.enabled, destination, formats: parsed.formats };
}
/** Whether automatic exports cover a call, as the server's rule has it: on, and the call ended after they were turned on. */
function automaticFor(w: World, n: Note): DriveAutomatic {
  const s = w.drive.settings;
  if (!s.enabled || !s.destination || !s.formats.length) return 'off';
  const ended = new Date(Date.parse(n.startedAt) + n.duration * 1000).toISOString();
  return n.status !== 'recording' && ended < w.drive.enabledAt ? 'before' : 'on';
}
function driveForNote(w: World, id: string): DriveCallExports {
  const n = noteIn(w, id);
  const override = w.drive.overrides[id] ?? null;
  const effective = override ?? { enabled: w.drive.settings.enabled, destination: w.drive.settings.destination, formats: w.drive.settings.formats };
  return { noteId: id, override, effective, automatic: automaticFor(w, n), jobs: w.drive.jobs.filter((job) => job.noteId === id) };
}
/** Uploads starting at once, as the server starts them: each file Uploading, then, a moment later, with its link in Drive. */
function uploadNow(w: World, noteId: string, formats: readonly DriveExportFormat[]): DriveExportJob[] {
  const at = new Date().toISOString();
  const going = formats.map((format): DriveExportJob => ({
    id: w.drive.jobs.find((j) => j.noteId === noteId && j.format === format)?.id ?? nextId('drive'), noteId, format, status: 'uploading', reason: null, fileUrl: null, updatedAt: at, nextAt: null
  }));
  w.drive.jobs = [...going, ...w.drive.jobs.filter((j) => !going.some((x) => x.id === j.id))];
  setTimeout(() => {
    if (current() !== w) return;
    w.drive.jobs = w.drive.jobs.map((j) => (going.some((x) => x.id === j.id) && j.status === 'uploading'
      ? { ...j, status: 'uploaded', fileUrl: `https://drive.google.com/file/d/preview_${j.id}/view`, updatedAt: new Date().toISOString() } : j));
  }, 1600);
  return going;
}

export const driveApi: Pick<AlcoveApi, 'drive'> = {
  drive: {
    get: () => answer((w) => w.drive.settings),
    connect: () => answer(() => ({ url: new URL('#google-drive-consent', location.href).href })),
    pickFolder: () => answer(() => ({ url: new URL('#google-drive-folder-selection', location.href).href })),
    disconnect: () => answer((w) => { w.drive = disconnectedDrive(); return w.drive.settings; }),
    folders: () => answer((w) => w.drive.folders),
    update: (input) => answer((w) => {
      const next = driveChoice(w, input);
      if (next.enabled && !w.drive.settings.enabled) w.drive.enabledAt = new Date().toISOString();
      w.drive.settings = { ...w.drive.settings, ...next };
      return w.drive.settings;
    }),
    jobs: () => answer((w) => w.drive.jobs),
    forNote: (id) => answer((w) => driveForNote(w, id)),
    setForNote: (id, input) => answer((w) => {
      noteIn(w, id);
      if (input === null) delete w.drive.overrides[id];
      else {
        const choice = driveChoice(w, input);
        w.drive.overrides[id] = choice;
        if (choice.enabled) uploadNow(w, id, choice.formats);
      }
      return driveForNote(w, id);
    }),
    retry: (id) => answer((w) => {
      const job = w.drive.jobs.find((j) => j.id === id);
      if (!job) throw refused('not-found', 'That export is no longer there.');
      if (w.drive.settings.connection.status !== 'connected') throw refused('conflict', 'Reconnect Google Drive first.');
      const [next] = uploadNow(w, job.noteId, [job.format]);
      return next ?? job;
    })
  }
};

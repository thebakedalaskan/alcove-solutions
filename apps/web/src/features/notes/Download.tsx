/*
 * Download, at the top of a call's page: everything the call kept that the reader can open, saved on this device, opened by
 * their browser, which has it decrypted. The transcript as text, with times and who said what, chapter by chapter and room by
 * room; the notes as Markdown, as the page has them; the recording as its audio, a file for each stretch notes were on; and
 * each shared screen's video. Alcove never sees what's saved: nothing is made on the server, and a log says only what kind of
 * thing went and how big it was. A copy saved here is the reader's to keep or share, outside Alcove.
 */
import { errorMessage, type Note } from '@alcove/api';
import { Icon, IconButton, Popover, Spinner, useToast } from '@alcove/ui';
import { useState } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { minutesLabel } from '@alcove/api';
import { position } from '~/lib/time';
import { lengthOf } from './Line';
import { noteAsMarkdown } from './meta';

const dlog = log.child({ component: 'call-download' });

/** A file's name from the call's title and what it is: nothing a file system can't take. */
const fileName = (title: string, what: string, ext: string) => `${`${title.trim() || 'Call'} – ${what}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 120)}.${ext}`;
/** The extension a recording's own type says it has. */
const extOf = (type: string) => (/mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /wav/.test(type) ? 'wav' : /mp4/.test(type) ? 'mp4' : 'webm');
const videoExt = (type: string) => (/mp4/.test(type) ? 'mp4' : 'webm');

/** Hands a file to the browser to save, from memory: it never goes anywhere else. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Long enough for the browser to have taken it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The transcript as text: the call, then each chapter with who said what, and each breakout room's own. */
export function transcriptText(note: Note): string {
  const lines = note.transcript ?? [];
  const said = (l: Note['rooms'][number]['transcript'][number]) => `[${position(l.at)}] ${l.speaker ? `${l.speaker.name}: ` : ''}${l.text}`;
  const chapters = note.chapters.length ? note.chapters : [{ at: 0, title: '', summary: '' }];
  const parts = chapters.flatMap((c, i) => {
    const next = chapters[i + 1]?.at ?? Infinity;
    const these = lines.filter((l) => l.at >= c.at && l.at < next).map(said);
    return these.length ? ['', ...(c.title ? [c.title] : []), ...these] : [];
  });
  const rooms = note.rooms.filter((r) => r.transcript.length).flatMap((r) => ['', `In ${r.name}`, ...r.transcript.map(said)]);
  return [note.title, `${new Date(note.startedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${minutesLabel(note.duration)}`, ...parts, ...rooms, ''].join('\n');
}

/** Whether there's a transcript to save: the call's or a breakout room's. */
export const hasTranscript = (note: Note) => (note.transcript?.length ?? 0) > 0 || note.rooms.some((r) => r.transcript.length > 0);

/** Saves the transcript, saying so. */
export function useSaveTranscript(note: Note): () => void {
  const toast = useToast();
  return () => {
    const text = transcriptText(note);
    save(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName(note.title, 'transcript', 'txt'));
    dlog.info('call saved on this device', { noteId: note.id, what: 'transcript', bytes: text.length });
    toast(`Downloading the transcript of ${note.title}.`, { icon: 'download' });
  };
}

interface Item { key: string; label: string; kind: string; icon: Parameters<typeof Icon>[0]['name']; go: () => Promise<void> | void }

/** Download: an icon, and the menu of what the call kept, each saved on this device. */
export function DownloadMenu({ note }: { note: Note }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const saveTranscript = useSaveTranscript(note);
  const written = note.status === 'ready' && note.summary.trim() !== '';
  const audio = note.kept.recording ? note.audio : [];
  /** Something read from Alcove first, while the menu says it's on its way. */
  const fetched = async (key: string, what: string, read: () => Promise<{ blob: Blob; name: string }[]>) => {
    setBusy(key);
    try {
      const files = await read();
      for (const f of files) save(f.blob, f.name);
      dlog.info('call saved on this device', { noteId: note.id, what, files: files.length, bytes: files.reduce((n, f) => n + f.blob.size, 0) });
      setOpen(false);
      toast(files.length > 1 ? `Downloading ${files.length} files.` : `Downloading ${what === 'recording' ? 'the recording' : 'the shared screen'}.`, { icon: 'download' });
    } catch (e) {
      dlog.warn('call not saved on this device', { noteId: note.id, what, err: e });
      toast(errorMessage(e), { icon: 'x' });
    } finally {
      setBusy(null);
    }
  };
  const items: Item[] = [
    ...(hasTranscript(note) ? [{ key: 'transcript', label: 'The transcript', kind: 'Text, with times', icon: 'transcript', go: () => { setOpen(false); saveTranscript(); } } satisfies Item] : []),
    ...(written ? [{
      key: 'notes', label: 'The notes', kind: 'Markdown', icon: 'notes', go: () => {
        const text = noteAsMarkdown(note);
        save(new Blob([text], { type: 'text/markdown;charset=utf-8' }), fileName(note.title, 'notes', 'md'));
        dlog.info('call saved on this device', { noteId: note.id, what: 'notes', bytes: text.length });
        setOpen(false);
        toast(`Downloading the notes of ${note.title}.`, { icon: 'download' });
      }
    } satisfies Item] : []),
    ...(audio.length ? [{
      key: 'recording', label: 'The recording', kind: `Audio, ${minutesLabel(note.duration)}`, icon: 'waveform',
      go: () => fetched('recording', 'recording', () => Promise.all(audio.map(async (s, i) => {
        const blob = await api.notes.audio(note.id, s.index, s.pieces);
        return { blob, name: fileName(note.title, audio.length > 1 ? `recording, part ${i + 1}` : 'recording', extOf(blob.type || s.mimeType)) };
      })))
    } satisfies Item] : []),
    ...note.shares.map((s): Item => ({
      key: `share-${s.id}`, label: s.label, kind: `Video, ${lengthOf(s.until - s.at)}`, icon: 'monitor',
      go: () => fetched(`share-${s.id}`, 'shared screen', () => Promise.all(s.segments.map(async (g, i) => {
        const blob = await api.notes.screenVideo(note.id, s.id, g.segment);
        return { blob, name: fileName(note.title, s.segments.length > 1 ? `${s.label}, part ${i + 1}` : s.label, videoExt(blob.type)) };
      })))
    }))
  ];
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" label="Download from this call" tip="Download" className="cd-dl"
      anchor={<IconButton icon="download" label="Download" title={undefined} />}>
      <div className="ac-pop-h">Download from this call</div>
      {items.length ? items.map((it) => (
        <button key={it.key} type="button" className="ac-pop-item cd-dl-i" disabled={busy !== null} aria-busy={busy === it.key} onClick={() => void it.go()}>
          {busy === it.key ? <Spinner /> : <Icon name={it.icon} size={18} />}<span><b>{it.label}</b></span><small>{it.kind}</small>
        </button>
      )) : <p className="cd-pop-n">Nothing to download yet. The transcript and the notes can be saved once they’re written.</p>}
      <div className="ac-pop-sep" />
      <p className="cd-dl-n"><Icon name="sealed" size={14} />Opened on this device. Alcove can’t read it.</p>
    </Popover>
  );
}

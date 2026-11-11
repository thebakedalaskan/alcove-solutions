/*
 * Hear it, on a quote: that moment of the recording. During the call it's quoted from, it's for anyone in the call who may
 * read the line, which is a line in their own live transcript: the call sends that line's own pieces of the recording
 * (`CallSession.hear`), and only ones they were there for, so a guest never hears what was said while they were away. It
 * shows once the recording has some of the call, and says instead that it can't be heard when the call keeps no recording
 * or the line was said in a breakout room, which is never recorded. Otherwise it's the note's: for anyone with the notes
 * it's in, once the recording has the line, and not if the call keeps no recording. It reads the note the way the note's
 * own page does, and that audio only ever comes from `notes.audioUrl`.
 */
import { errorCode, errorRequestId, type AlcoveErrorCode, type AudioSegment, type CallSession } from '@alcove/api';
import { Icon, Spinner } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canChooseSpeaker, readPrefs } from '~/features/call/media/devices';
import { usePlayer, usePlayerAt } from '~/features/notes/Player';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';

const hlog = log.child({ component: 'hear-it' });

/** How long a moment plays when it's the last thing said. */
const LAST_LINE_SECONDS = 8;
/** While the call's still recording, the note is read again this often until it has audio to play. */
const RECORDING_READ_MS = 15_000;
const NO_AUDIO: AudioSegment[] = [];
const nothing = () => () => undefined;

/** Seconds into the recording of the line `at` places from `line` (0 the line, 1 the one after), from the call's transcript. */
function liveAt(call: CallSession | undefined, note: string, line: string, at: 0 | 1): number | undefined {
  const s = call?.getSnapshot();
  if (!s || s.notes.noteId !== note) return undefined;
  const i = s.transcript.findIndex((l) => l.id === line);
  return i < 0 ? undefined : s.transcript[i + at]?.at;
}
/**
 * What the call that's going on says of a quote: it isn't from this call (or nothing of it is recorded yet, so the note may
 * have it), the call keeps no recording, it was said in a breakout room, it isn't in your transcript, or the call plays it.
 */
type FromCall = 'elsewhere' | 'unkept' | 'room' | 'unread' | 'plays';
function fromCall(call: CallSession | undefined, note: string, line: string): FromCall {
  const s = call?.getSnapshot();
  if (!s || s.phase !== 'in-call' || s.notes.noteId !== note) return 'elsewhere';
  if (!s.notes.keepsRecording) return 'unkept';
  const said = s.transcript.find((l) => l.id === line);
  if (said?.room) return 'room';
  if (s.notes.recording.pieces === 0) return 'elsewhere';
  return said ? 'plays' : 'unread';
}

const Button = ({ playing, asking = false, onClick }: { playing: boolean; asking?: boolean | undefined; onClick: () => void }) => (
  <button type="button" className="pl" aria-busy={asking || undefined} onClick={onClick}>
    {asking ? <Spinner /> : <Icon name={playing ? 'pause' : 'play'} size={11} />}Hear it
  </button>
);
/** Why it can't be heard, where Hear it would be, or after it. */
const Why = ({ words }: { words: string }) => <span className="why" role="status">{words}</span>;

/** A failed Hear it, as it's said: in words, and whether pressing it again might do. */
interface Unheard { words: string; again: boolean }
function unheard(code: AlcoveErrorCode, organizer: boolean): Unheard {
  switch (code) {
    case 'conflict': return { words: 'Not in the recording yet. Try again in a few seconds.', again: true };
    // Everyone but the organizer hears only the pieces they were there for; the organizer hears all of it that plays.
    case 'not-found': return { words: organizer ? 'This part of the recording can’t be played.' : 'You can only hear what you were there for.', again: false };
    case 'network': return { words: 'Can’t reach Alcove. Try again.', again: true };
    case 'unavailable': return { words: 'Alcove is busy. Try again in a moment.', again: true };
    default: return { words: 'Couldn’t get it. Try again.', again: true };
  }
}
const UNPLAYABLE: Unheard = { words: 'This browser couldn’t play it.', again: false };

/** How long Hear it waits for the speaker chosen for the call before it plays on the system's. */
const SPEAKER_WAIT_MS = 200;
/** Plays on the speaker chosen for the call, where the browser lets a page choose one, as the call's own sounds do. */
async function onTheCallsSpeaker(el: HTMLAudioElement): Promise<void> {
  const chosen = readPrefs().speaker;
  if (!chosen || !canChooseSpeaker()) return;
  const routed = await Promise.race([
    el.setSinkId(chosen).then(() => true, () => false),
    new Promise<false>((resolve) => { setTimeout(() => resolve(false), SPEAKER_WAIT_MS); })
  ]);
  if (!routed) hlog.debug('a line plays on the system speaker');
}

/**
 * A line of the call that's going on, from the call: read when it's first pressed, and kept for as long as the quote's on
 * the page. It says it's working until the sound starts, and why when it can't play: pressed again, it tries again, unless
 * nothing would change (they weren't there for it, or this browser can't play it).
 */
function FromTheCall({ call, note, line }: { call: CallSession; note: string; line: string }) {
  const [state, setState] = useState<'idle' | 'asking' | 'playing' | Unheard>('idle');
  const audio = useRef<{ el: HTMLAudioElement; url: string; from: number; until: number } | null>(null);
  const drop = () => {
    const a = audio.current;
    if (a) { a.el.pause(); a.el.removeAttribute('src'); URL.revokeObjectURL(a.url); }
    audio.current = null;
  };
  useEffect(() => drop, []);
  const failed = (why: Unheard, context: Record<string, unknown>) => {
    hlog.warn('a line of the call wasn’t heard', context);
    if (!why.again) drop();
    setState(why);
  };
  const play = () => {
    const a = audio.current;
    if (!a) return;
    a.el.currentTime = a.from;
    void a.el.play().then(() => setState('playing'), (err: unknown) => {
      // Paused again before it started: nothing went wrong.
      if (err instanceof DOMException && err.name === 'AbortError') { setState('idle'); return; }
      failed(UNPLAYABLE, { code: err instanceof DOMException ? err.name : 'play' });
    });
  };
  const press = () => {
    const a = audio.current;
    if (state === 'playing' && a) { a.el.pause(); setState('idle'); return; }
    if (state === 'asking') return;
    if (a) { setState('asking'); play(); return; }
    setState('asking');
    call.hear(note, line).then(async (heard) => {
      const url = URL.createObjectURL(heard.audio);
      const el = new Audio(url);
      el.preload = 'auto';
      // The call sends a file of its own, its times from 0 at its first piece: the line is `from` seconds into it.
      el.addEventListener('timeupdate', () => { const held = audio.current; if (held?.el === el && el.currentTime >= held.until) { el.pause(); setState('idle'); } });
      el.addEventListener('ended', () => setState('idle'));
      el.addEventListener('error', () => { if (audio.current?.el === el) failed(UNPLAYABLE, { code: `media-${el.error?.code ?? 0}`, type: heard.audio.type }); });
      audio.current = { el, url, from: heard.from, until: heard.from + heard.seconds };
      await onTheCallsSpeaker(el);
      if (audio.current?.el !== el) return;
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) play();
      else el.addEventListener('loadedmetadata', play, { once: true });
    }, (err: unknown) => {
      const code = errorCode(err);
      failed(unheard(code, call.getSnapshot().isOrganizer), { code, requestId: errorRequestId(err) ?? null });
    });
  };
  if (typeof state === 'object' && !state.again) return <Why words={state.words} />;
  return (
    <>
      <Button playing={state === 'playing'} asking={state === 'asking'} onClick={press} />
      {typeof state === 'object' && <Why words={state.words} />}
    </>
  );
}

/** A line of a note, from its audio, for someone with the note. */
function FromTheNote({ note, line, call }: { note: string; line: string; call?: CallSession | undefined }) {
  const liveFrom = useSyncExternalStore(call?.subscribe ?? nothing, () => liveAt(call, note, line, 0));
  const liveNext = useSyncExternalStore(call?.subscribe ?? nothing, () => liveAt(call, note, line, 1));
  /* Nobody but whoever has the notes can read them, and that isn't worth asking twice. */
  const read = useQuery({
    ...q.note(note), retry: false, staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.status === 'recording' && query.state.data.audio.length === 0 ? RECORDING_READ_MS : false)
  }).data;
  const lines = read?.transcript ?? [];
  const at = lines.findIndex((l) => l.id === line);
  const from = lines[at]?.at ?? liveFrom;
  const until = (at < 0 ? liveNext : lines[at + 1]?.at) ?? (from === undefined ? undefined : from + LAST_LINE_SECONDS);
  const recording = read?.status === 'recording';
  const player = usePlayer(note, read?.audio ?? NO_AUDIO, recording);
  const { playing, seek, toggle } = player;
  const heard = usePlayerAt(player, (pos) => until !== undefined && pos >= until);
  useEffect(() => { if (playing && heard) toggle(); }, [playing, heard, toggle]);
  if (from === undefined || !read?.audio.length || (recording && !read.kept.recording)) return null;
  return <Button playing={playing} onClick={() => { if (playing) toggle(); else seek(from, true); }} />;
}

/** `notes`: whether this reader can have notes at all (they're signed in). Someone in the call hears its own lines without. */
export function HearIt({ note, line, call, notes }: { note: string; line: string; call?: CallSession | undefined; notes: boolean }) {
  const live = useSyncExternalStore(call?.subscribe ?? nothing, () => fromCall(call, note, line));
  if (live === 'unkept') return <Why words="This call doesn’t keep its recording." />;
  if (live === 'room') return <Why words="Breakout rooms aren’t recorded." />;
  if (live === 'unread') return null;
  if (call && live === 'plays') return <FromTheCall call={call} note={note} line={line} />;
  return notes ? <FromTheNote note={note} line={line} call={call} /> : null;
}

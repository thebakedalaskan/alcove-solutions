/*
 * Hear it, on a quote: that moment of the recording. During the call it's quoted from, it's for anyone in the call who may
 * read the line, which is a line in their own live transcript: the call sends that line's own pieces of the recording
 * (`CallSession.hear`), and only ones they were there for, so a guest never hears what was said while they were away. It
 * shows once the recording has some of the call. Otherwise it's the note's: for anyone with the notes it's in, once the
 * recording has the line, and not if the call keeps no recording. It reads the note the way the note's own page does, and
 * that audio only ever comes from `notes.audioUrl`.
 */
import { errorCode, type AudioSegment, type CallSession } from '@alcove/api';
import { Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
/** Whether this is a quote from the call that's going on, with some of it recorded: then the call plays it. */
const fromThisCall = (call: CallSession | undefined, note: string): boolean => {
  const s = call?.getSnapshot();
  return s !== undefined && s.phase === 'in-call' && s.notes.noteId === note && s.notes.recording.pieces > 0;
};

const Button = ({ playing, onClick }: { playing: boolean; onClick: () => void }) => (
  <button type="button" className="pl" onClick={onClick}><Icon name={playing ? 'pause' : 'play'} size={11} />Hear it</button>
);

/**
 * A line of the call that's going on, from the call: read when it's first pressed, and kept for as long as the quote's on
 * the page. A line the call won't play for this person (they weren't there for it) takes the button away.
 */
function FromTheCall({ call, note, line }: { call: CallSession; note: string; line: string }) {
  const [state, setState] = useState<'idle' | 'asking' | 'playing' | 'refused'>('idle');
  const audio = useRef<{ el: HTMLAudioElement; url: string; from: number; until: number } | null>(null);
  useEffect(() => () => {
    const a = audio.current;
    if (a) { a.el.pause(); URL.revokeObjectURL(a.url); }
    audio.current = null;
  }, []);
  const play = () => {
    const a = audio.current;
    if (!a) return;
    a.el.currentTime = a.from;
    void a.el.play().then(() => setState('playing'), (err: unknown) => { hlog.info('a line didn’t play', { err }); setState('idle'); });
  };
  const press = () => {
    const a = audio.current;
    if (state === 'playing' && a) { a.el.pause(); setState('idle'); return; }
    if (a) { play(); return; }
    if (state === 'asking') return;
    setState('asking');
    call.hear(note, line).then((heard) => {
      const url = URL.createObjectURL(heard.audio);
      const el = new Audio(url);
      el.preload = 'auto';
      // A recording that starts part way through keeps its own times: where it can start is where its lines are counted from.
      el.addEventListener('loadedmetadata', () => {
        const start = el.seekable.length ? el.seekable.start(0) : el.currentTime;
        const held = audio.current;
        if (held?.el === el) { held.from = start + heard.from; held.until = start + heard.from + heard.seconds; }
      }, { once: true });
      el.addEventListener('timeupdate', () => { const held = audio.current; if (held?.el === el && el.currentTime >= held.until) { el.pause(); setState('idle'); } });
      el.addEventListener('ended', () => setState('idle'));
      audio.current = { el, url, from: heard.from, until: heard.from + heard.seconds };
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) play();
      else el.addEventListener('loadedmetadata', play, { once: true });
    }, (err: unknown) => {
      const code = errorCode(err);
      hlog.info('a line of the call wasn’t heard', { code });
      setState(code === 'not-found' || code === 'conflict' ? 'refused' : 'idle');
    });
  };
  if (state === 'refused') return null;
  return <Button playing={state === 'playing'} onClick={press} />;
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
  const inThisCall = useSyncExternalStore(call?.subscribe ?? nothing, () => fromThisCall(call, note));
  const inTranscript = useSyncExternalStore(call?.subscribe ?? nothing, () => liveAt(call, note, line, 0) !== undefined);
  if (call && inThisCall) return inTranscript ? <FromTheCall call={call} note={note} line={line} /> : null;
  return notes ? <FromTheNote note={note} line={line} call={call} /> : null;
}

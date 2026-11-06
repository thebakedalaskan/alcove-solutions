/*
 * Hear it, on a quote: that moment of the recording, for anyone with the notes it's in. It shows once the recording has the
 * line, so not for someone who doesn't have the notes, and not if the call keeps no recording. During the call the note has no
 * transcript yet, so where the line is comes from the call's own (`call`), while the call is the note's. It reads the note the
 * way the note's own page does, and audio only ever comes from `notes.audioUrl`.
 */
import type { AudioSegment, CallSession } from '@alcove/api';
import { Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { usePlayer, usePlayerAt } from '~/features/notes/Player';
import { q } from '~/lib/queries';

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

export function HearIt({ note, line, call }: { note: string; line: string; call?: CallSession | undefined }) {
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
  return <button type="button" className="pl" onClick={() => { if (playing) toggle(); else seek(from, true); }}><Icon name={playing ? 'pause' : 'play'} size={11} />Hear it</button>;
}

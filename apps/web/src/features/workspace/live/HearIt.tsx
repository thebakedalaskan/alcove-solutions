/*
 * Hear it, on a quote: that moment of the recording, for anyone with the notes it's in. It shows once they exist and can say
 * where the line is, so not during the call, not for someone who doesn't have them, and not if the call kept no recording or no
 * transcript. It reads the note the way the note's own page does, and audio only ever comes from `notes.audioUrl`.
 */
import type { AudioSegment } from '@alcove/api';
import { Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { usePlayer, usePlayerAt } from '~/features/notes/Player';
import { q } from '~/lib/queries';

/** How long a moment plays when it's the last thing said. */
const LAST_LINE_SECONDS = 8;
const NO_AUDIO: AudioSegment[] = [];

export function HearIt({ note, line }: { note: string; line: string }) {
  /* Nobody but whoever has the notes can read them, and that isn't worth asking twice. */
  const read = useQuery({ ...q.note(note), retry: false, staleTime: 60_000 }).data;
  const lines = read?.transcript ?? [];
  const at = lines.findIndex((l) => l.id === line);
  const from = lines[at]?.at;
  const until = lines[at + 1]?.at ?? (from === undefined ? undefined : from + LAST_LINE_SECONDS);
  const player = usePlayer(note, read?.audio ?? NO_AUDIO, read?.status === 'recording');
  const { playing, seek, toggle } = player;
  const heard = usePlayerAt(player, (pos) => until !== undefined && pos >= until);
  useEffect(() => { if (playing && heard) toggle(); }, [playing, heard, toggle]);
  if (from === undefined || !read?.audio.length) return null;
  return <button type="button" className="pl" onClick={() => { if (playing) toggle(); else seek(from, true); }}><Icon name={playing ? 'pause' : 'play'} size={11} />Hear it</button>;
}

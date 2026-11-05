/*
 * What a document's videos need in a call: Play for everyone, and the picture everyone's watching in the block that holds it
 * (features/call/PlayTogether.tsx). Outside a call, or with nowhere to read a video from, a video offers nothing to play.
 */
import { useMemo } from 'react';
import type { Ws } from './context';
import type { MediaHandlers } from './editor/types';

/** `canPlay`: this view may start a video. The audience's view of a presentation can't; whoever's presenting can. */
export function useVideoHandlers(ws: Ws, documentId: string, canPlay: boolean): MediaHandlers | undefined {
  const playing = ws.call?.playing;
  return useMemo((): MediaHandlers | undefined => {
    if (!playing) return undefined;
    const start = playing.start;
    return {
      url: () => undefined,
      onPlay: canPlay && start ? (video) => start(documentId, video.media) : undefined,
      playing: playing.now?.documentId === documentId ? playing.now.video : null
    };
  }, [playing, documentId, canPlay]);
}

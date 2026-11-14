/*
 * What a document's videos need in a call: Play for everyone, and the picture everyone's watching in the block that holds it
 * (features/call/playback/PlayTogether.tsx). Outside a call a video plays only where it's pressed. The rest of what a video block
 * draws from, its first frame and where a player reads it, is DocumentMedia.tsx's.
 */
import { useMemo } from 'react';
import type { Ws } from '../context';
import type { VideoHandlers } from './DocumentMedia';

/** `canPlay`: this view may start a video. The audience's view of a presentation can't; whoever's presenting can. */
export function useVideoHandlers(ws: Ws, documentId: string, canPlay: boolean): VideoHandlers | undefined {
  const playing = ws.call?.playing;
  return useMemo((): VideoHandlers | undefined => {
    if (!playing) return undefined;
    const start = playing.start;
    return {
      onPlay: canPlay && start ? (video) => start(documentId, video.media) : undefined,
      playing: playing.now?.documentId === documentId ? playing.now.video : null
    };
  }, [playing, documentId, canPlay]);
}

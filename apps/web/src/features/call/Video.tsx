import { cn } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import type { CallRoom } from './livekit';
import type { LocalMedia } from './media';

/** A live camera or screen. Your own camera is mirrored by the stylesheet, a screen isn't. */
export function Video({ stream, className }: { stream: MediaStream; className?: string | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = ref.current; if (v && v.srcObject !== stream) v.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted />;
}

/** Someone else's camera or screen, from the call's room: shown as they see it, not mirrored. */
export function RoomVideo({ room, sid, className }: { room: CallRoom; sid: string; className?: string | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const el = ref.current; return el ? room.attach(sid, el) : undefined; }, [room, sid]);
  return <video ref={ref} className={cn('is-remote', className)} autoPlay playsInline muted />;
}

/** A camera or screen on the stage: your own (its stream), or someone else's (a track in the call's room). */
export type Feed = { stream: MediaStream } | { room: CallRoom; sid: string };
export function FeedVideo({ feed, className }: { feed: Feed; className?: string | undefined }) {
  return 'stream' in feed ? <Video stream={feed.stream} className={className} /> : <RoomVideo room={feed.room} sid={feed.sid} className={className} />;
}

/** Bar heights (percent) that follow the real microphone level, refreshed ten times a second. */
export function useLevels(media: LocalMedia, n: number, live: boolean, shape: (level: number, i: number) => number): number[] {
  const [bars, setBars] = useState<number[]>(() => Array.from({ length: n }, () => 14));
  useEffect(() => {
    if (!live) { setBars(Array.from({ length: n }, () => 14)); return; }
    const t = setInterval(() => { const l = media.level(); setBars(Array.from({ length: n }, (_, i) => shape(l, i))); }, 110);
    return () => clearInterval(t);
  }, [media, n, live, shape]);
  return bars;
}

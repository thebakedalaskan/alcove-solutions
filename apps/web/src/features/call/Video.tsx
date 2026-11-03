import { useEffect, useRef, useState } from 'react';
import type { LocalMedia } from './media';

/** A live camera or screen. Your own camera is mirrored by the stylesheet, a screen isn't. */
export function Video({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = ref.current; if (v && v.srcObject !== stream) v.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted />;
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

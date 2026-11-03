/*
 * The private audio behind a note. Each time notes were turned back on, a new segment started; the
 * player plays them one after another as a single recording. Audio is decrypted by the server for
 * a signed-in recipient only, and streamed straight into the page.
 */
import { minutesLabel, type AudioSegment, type Chapter } from '@alcove/api';
import { Icon, type Cover } from '@alcove/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { position } from '~/lib/time';

const plog = log.child({ component: 'player' });

export interface PlayerState {
  pos: number;
  total: number;
  playing: boolean;
  toggle: () => void;
  /** Jumps to a moment in the whole recording, and plays from there. */
  seek: (seconds: number, play?: boolean) => void;
}

export function usePlayer(noteId: string, segments: AudioSegment[]): PlayerState {
  const starts = useMemo(() => { let t = 0; return segments.map((s) => { const a = t; t += s.seconds; return a; }); }, [segments]);
  const total = segments.reduce((s, x) => s + x.seconds, 0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const at = useRef(0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  const load = useCallback((i: number, offset: number, play: boolean) => {
    const a = audio.current;
    const seg = segments[i];
    if (!a || !seg) return;
    at.current = i;
    const go = () => {
      if (offset > 0) a.currentTime = offset;
      if (play) a.play().catch((e: unknown) => { plog.warn('audio could not play', { err: e, segment: seg.index }); setPlaying(false); });
    };
    const src = api.notes.audioUrl(noteId, seg.index);
    if (a.src.endsWith(src)) { go(); return; }
    a.src = src;
    a.addEventListener('loadedmetadata', go, { once: true });
    a.load();
  }, [noteId, segments]);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'none';
    audio.current = a;
    const time = () => setPos((starts[at.current] ?? 0) + a.currentTime);
    const ended = () => {
      const next = at.current + 1;
      if (next < segments.length) load(next, 0, true);
      else { setPlaying(false); setPos(total); }
    };
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    a.addEventListener('timeupdate', time);
    a.addEventListener('ended', ended);
    a.addEventListener('play', play);
    a.addEventListener('pause', pause);
    return () => { a.pause(); a.removeAttribute('src'); a.load(); audio.current = null; };
  }, [starts, segments.length, total, load]);

  const seek = useCallback((seconds: number, play = true) => {
    const s = Math.max(0, Math.min(total, seconds));
    let i = starts.findLastIndex((x) => x <= s);
    if (i < 0) i = 0;
    setPos(s);
    load(i, s - (starts[i] ?? 0), play);
  }, [starts, total, load]);
  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    if (!a.src || pos >= total) seek(pos >= total ? 0 : pos);
    else a.play().catch((e: unknown) => plog.warn('audio could not play', { err: e }));
  }, [pos, total, seek]);
  return { pos, total, playing, toggle, seek };
}

/** Bar heights that look like speech, the same every time for the same note. */
function bars(seed: string, n = 64): number[] {
  let s = 7;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) % 233_280;
  return Array.from({ length: n }, (_, i) => { s = (s * 9301 + 49_297) % 233_280; return Math.round(18 + Math.abs(Math.sin(i * 0.37)) * 40 + (s / 233_280) * 36); });
}

export function Player({ noteId, cover, player, chapters, room }: { noteId: string; cover: Cover; player: PlayerState; chapters: Chapter[]; room: boolean }) {
  const heights = useMemo(() => bars(noteId), [noteId]);
  const { pos, total, playing, toggle, seek } = player;
  const k = total ? Math.round((pos / total) * heights.length) : 0;
  const chapter = chapters.findLast((c) => c.at <= pos);
  return (
    <section className={`player cover-${cover}`} aria-label="Audio">
      <div className="player-top"><span className="inline-flex items-center gap-[7px]"><Icon name="lock" size={14} />Private audio</span><span className="mono">{minutesLabel(total)}</span></div>
      <div className="wave" role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(pos)} aria-valuetext={position(pos)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total, playing); }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(pos + 10, playing); if (e.key === 'ArrowLeft') seek(pos - 10, playing); }}>
        {heights.map((h, i) => <i key={i} className={i < k ? 'p' : undefined} style={{ height: `${h}%` }} />)}
      </div>
      <div className="player-bot">
        <button type="button" className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
        <div className="tm"><span>{position(pos)}</span> / {position(total)}<small>{chapter?.title ?? (room ? 'Recorded in the room' : 'Recorded during the call')}</small></div>
      </div>
    </section>
  );
}

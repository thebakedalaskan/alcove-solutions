/** Screens already captured by the previous release in a call that is still live when video capture is deployed. */
import type { AudioSegment, CaptureGap, ScreenMoment, Speaker } from '@alcove/api';
import { z } from 'zod';
import { recorded, ScreenChange, type CaptureChange, type OfflineStretch } from '../calls/capture';
import type { Frame } from './screens';

/** Only a stored-data transition: the old capture boundaries are needed until its call ends. */
export const FrameCapture = z.object({
  history: z.array(ScreenChange),
  ended: z.array(z.object({ share: z.string().nullable(), presenter: z.string(), at: z.number(), segment: z.number().int() }))
});

/** Carry old sealed state into its new field; future saves no longer contain the removed screens key. */
export function carryFrameCapture(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || 'frameCapture' in v || !('screens' in v)) return v;
  return { ...v, frameCapture: v.screens };
}

interface Timeline {
  history: CaptureChange[];
  offline: OfflineStretch[];
  capture: z.infer<typeof FrameCapture>;
  gaps: CaptureGap[];
  segments: AudioSegment[];
  duration: number;
  presenterOf: (identity: string) => Speaker | undefined;
}

/** Place the previous release's frame rows on the note's recording timeline, retaining its original stop boundaries. */
export function storedMoments(frames: Frame[], t: Timeline): ScreenMoment[] {
  const before = (segment: number) => t.segments.filter((g) => g.index < segment).reduce((n, g) => n + g.seconds, 0);
  const length = (segment: number) => t.segments.find((g) => g.index === segment)?.seconds ?? 0;
  const place = (at: number, segment: number): number => {
    const seconds = length(segment);
    if (!seconds) return Math.round(recorded(t.history, t.offline, at, t.duration) * 10) / 10;
    const start = t.history.find((h) => h.status === 'on' && h.segment === segment)?.at ?? t.offline.find((g) => g.segment + 1 === segment)?.to;
    const into = start === undefined ? recorded(t.history, t.offline, at, t.duration) : before(segment) + Math.max(0, at - start);
    return Math.round(Math.min(Math.max(into, before(segment)), before(segment) + Math.max(0, seconds - 0.1)) * 10) / 10;
  };
  const placed = frames.filter((f) => f.pick === null).map((f) => ({ f, at: place(f.at, f.segment) }));
  const audio = t.segments.reduce((n, g) => n + g.seconds, 0);
  const called = recorded(t.history, t.offline, t.duration, t.duration);
  const recordedEnd = placed.some((p) => !length(p.f.segment)) ? Math.max(audio, called) : audio || called;
  const stops = [
    ...t.capture.history.filter((c) => !c.on).map((c) => place(c.at, c.segment)),
    ...t.history.filter((h) => h.status !== 'on').map((h) => place(h.at, h.segment)),
    ...t.gaps.map((g) => g.at)
  ];
  return placed.sort((a, b) => a.at - b.at || a.f.at - b.f.at).map(({ f, at }) => {
    const next = placed.find((p) => p.f.presenter === f.presenter && p.f.share === f.share && p.f.at > f.at)?.at;
    const end = t.capture.ended.find((e) => e.presenter === f.presenter && (e.share === null || e.share === f.share) && e.at >= f.at);
    const until = Math.min(recordedEnd, ...[next, end ? place(end.at, end.segment) : undefined, ...stops].filter((x): x is number => x !== undefined && x > at));
    const presenter = t.presenterOf(f.presenter);
    return {
      id: f.id, at, until: Math.max(at, Math.round(until * 10) / 10), ...(presenter ? { presenter } : {}), share: f.share, width: f.width, height: f.height,
      legible: f.reading?.legible ?? 'unread', title: f.reading?.title ?? '', text: f.reading?.text ?? '', description: '', regions: f.reading?.regions ?? [],
      shows: f.reading?.shows ?? '', changed: f.reading?.changed ?? '', relevance: 'supporting', cue: '', line: null
    };
  });
}

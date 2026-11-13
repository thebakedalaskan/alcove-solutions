/*
 * A call's transcript as the notes model reads it: each line by its time and speaker, a line of its own where nothing was
 * captured, shared screens among the lines where they appeared, numbered so a reply can point at lines, and cut to fit,
 * keeping a long call's beginning and end.
 */
import { type CaptureGap, type ScreenMoment, type TranscriptLine } from '@alcove/api';
import { changeOf } from '../../recordings/screens/screen-grid';
import { mmss, saidBy, clip, unfenced, oneLine, spoken } from '../../../inference/prompts';
import { SCREEN_TEXT_CHARS } from '../../recordings/screens/reading';

/** About 30,000 tokens of transcript; longer calls keep their beginning and end. */
export const MAX_TRANSCRIPT_CHARS = 120_000;

/**
 * Where nothing was captured, as the model reads it: a line of its own starting "--", which says how long and that
 * nothing said then was recorded, so the model never writes as if the meeting ran on through it.
 */
function gapLine(g: CaptureGap, now: number): string {
  const ms = (g.to ? Date.parse(g.to) : now) - Date.parse(g.from);
  const long = ms < 60_000 ? 'less than a minute' : `${Math.round(ms / 60_000)} min`;
  if (g.kind === 'offline') {
    return g.to ? `-- at ${mmss(g.at)} the host's browser was out of the call for ${long}: nothing said then was recorded --`
      : `-- at ${mmss(g.at)} the host's browser left the call, ${long} ago: nothing said since was recorded --`;
  }
  const kind = g.kind === 'paused' ? 'paused' : 'off';
  return g.to ? `-- at ${mmss(g.at)} notes were ${kind} for ${long}: nothing said then was recorded --`
    : `-- at ${mmss(g.at)} notes went ${kind}, ${long} ago: nothing said since was recorded --`;
}
/** How much of a screen's text the notes model reads while writing the notes: a long share can have hundreds of frames. */
const NOTES_SCREEN_CHARS = 300;
const LEGIBLE: Record<ScreenMoment['legible'], string> = { clear: 'clear', partly: 'partly legible', unreadable: 'unreadable', unread: 'not read' };
/**
 * A shared screen as the model reads it, numbered from 1: "[mm:ss] [screen N from Name, clear, key, hint] Title.
 * Reads: … Shows: … Changed: … Parts: (1) … (2) …", with only what was read on it, at most `chars` of its text. "key"
 * marks a screen what was said refers to or relies on; the hint, when there is one, says how it compares with its
 * share's screen before.
 */
function screenLine(m: ScreenMoment, n: number, chars: number, hint?: string | undefined): string {
  const from = m.presenter ? ` from ${saidBy(m.presenter)}` : '';
  const reads = m.text.trim() ? ` Reads: ${clip(unfenced(m.text).replace(/\s*\n\s*/g, ' / ').trim(), chars)}` : '';
  const shows = m.shows.trim() ? ` Shows: ${oneLine(m.shows)}` : '';
  const changed = m.changed.trim() ? ` Changed: ${oneLine(m.changed)}` : '';
  const parts = m.regions.length ? ` Parts: ${m.regions.map((r, i) => `(${i + 1}) ${oneLine(r.label)}`).join(' ')}` : '';
  return `[${mmss(m.at)}] [screen ${n}${from}, ${LEGIBLE[m.legible]}${m.relevance === 'key' ? ', key' : ''}${hint ? `, ${hint}` : ''}] ${oneLine(m.title) || 'Untitled'}.${reads}${shows}${changed}${parts}`;
}
/** A line about shared screens, at the second it goes among the transcript's lines. */
interface Placed { at: number; text: string }
/** Shared screens as a question about the note reads them: each numbered from 1, in full. */
export const placed = (shown: ScreenMoment[]): Placed[] => shown.map((m, i) => ({ at: m.at, text: screenLine(m, i + 1, SCREEN_TEXT_CHARS) }));
/** Numbers in order, as "4–6, 8": a run of consecutive ones as a range. */
function ranges(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === (ns[j] ?? 0) + 1) j++;
    out.push(j > i ? `${ns[i] ?? ''}–${ns[j] ?? ''}` : `${ns[i] ?? ''}`);
    i = j + 1;
  }
  return out.join(', ');
}
/**
 * Shared screens as the notes model reads them (`shown` in order), each numbered from 1, with how it compares with its
 * share's last screen given in full, by their grids: "first of this share", "changed a little since screen 3" or
 * "changed a lot since screen 3" (nothing when either has no grid). Screens that look the same as that one go on one
 * line, where the first of them was, without their readings: "[mm:ss–mm:ss] [screens 4–9 same as screen 3]". Only
 * screens given in full carry what was read on them, at most NOTES_SCREEN_CHARS of it.
 */
function compared(shown: ScreenMoment[], grids: ReadonlyMap<string, Uint8Array>): Placed[] {
  const out: Placed[] = [];
  const last = new Map<string, { n: number; grid: Uint8Array | undefined; run: { at: number; until: number; ns: number[]; slot: number } | null }>();
  shown.forEach((m, i) => {
    const n = i + 1;
    const grid = grids.get(m.id);
    const ref = last.get(m.share);
    const change = ref ? changeOf(ref.grid, grid) : null;
    if (ref && change === 'same') {
      const run = ref.run ?? { at: m.at, until: m.at, ns: [], slot: out.push({ at: m.at, text: '' }) - 1 };
      run.ns.push(n);
      run.until = m.at;
      ref.run = run;
      const when = mmss(run.until) === mmss(run.at) ? mmss(run.at) : `${mmss(run.at)}–${mmss(run.until)}`;
      out[run.slot] = { at: run.at, text: `[${when}] [screen${run.ns.length > 1 ? 's' : ''} ${ranges(run.ns)} same as screen ${ref.n}]` };
      return;
    }
    const hint = !ref ? 'first of this share' : change === null || change === 'unknown' ? undefined : `changed ${change} since screen ${ref.n}`;
    out.push({ at: m.at, text: screenLine(m, n, NOTES_SCREEN_CHARS, hint) });
    last.set(m.share, { n, grid, run: null });
  });
  return out;
}
/**
 * The transcript in order, each entry a line (by its index), a "--" line where nothing was captured, or a line about
 * shared screens (`screens`, in order) where one appeared.
 */
type Entry = { text: string; line: number | null };
export function entries(lines: TranscriptLine[], gaps: CaptureGap[], label: (l: TranscriptLine, i: number) => string, screens: Placed[] = []): Entry[] {
  const now = Date.now();
  const out: Entry[] = [];
  let g = 0;
  let sc = 0;
  lines.forEach((l, i) => {
    for (; g < gaps.length && (gaps[g]?.at ?? 0) <= l.at; g++) { const gap = gaps[g]; if (gap) out.push({ text: gapLine(gap, now), line: null }); }
    for (; sc < screens.length && (screens[sc]?.at ?? 0) <= l.at; sc++) { const m = screens[sc]; if (m) out.push({ text: m.text, line: null }); }
    out.push({ text: label(l, i), line: i });
  });
  for (const gap of gaps.slice(g)) out.push({ text: gapLine(gap, now), line: null });
  for (; sc < screens.length; sc++) { const m = screens[sc]; if (m) out.push({ text: m.text, line: null }); }
  return out;
}
/** Which lines didn't fit and were left out of what the model read: how many, and the first and last of them (by index). */
export interface Cut { count: number; first: number; last: number }
/**
 * What fits: all of it, or a long transcript's beginning and end with a marker between. `kept` are the lines (by index)
 * the model was sent, and `cut` the ones it wasn't.
 */
export function fit(all: Entry[], max = MAX_TRANSCRIPT_CHARS): { text: string; kept: Set<number>; cut: Cut | null } {
  const lineNos = (xs: Entry[]) => xs.flatMap((e) => (e.line === null ? [] : [e.line]));
  const text = all.map((e) => e.text).join('\n');
  if (text.length <= max) return { text, kept: new Set(lineNos(all)), cut: null };
  const head: Entry[] = [];
  const tail: Entry[] = [];
  let used = 0;
  for (let i = 0, j = all.length - 1; i <= j && used < max;) {
    const front = all[i];
    if (front) { head.push(front); used += front.text.length + 1; }
    i++;
    if (i <= j) {
      const back = all[j];
      if (back) { tail.unshift(back); used += back.text.length + 1; }
      j--;
    }
  }
  const kept = new Set(lineNos([...head, ...tail]));
  const out = lineNos(all).filter((n) => !kept.has(n));
  const first = out[0];
  const last = out.at(-1);
  // Every line went in after all (the last ones were long): nothing is left out, so nothing says it is.
  if (first === undefined || last === undefined) return { text, kept, cut: null };
  return {
    text: [...head.map((e) => e.text), `[… ${out.length} lines left out …]`, ...tail.map((e) => e.text)].join('\n'),
    kept, cut: { count: out.length, first, last }
  };
}
/**
 * Transcripts read together (a call's and its breakout rooms', for a question about the note), fitted into one budget:
 * each keeps a share of it in proportion to its length, so together they're no longer than one transcript may be. Each
 * line starts with its number in its own transcript, after `prefix(i)` for the i-th (0 is the call's), as in "L12" or
 * "R2-L5"; `kept` are the lines (by index) the model was sent, so it can only point at lines it read.
 */
export function fitTogether(parts: { lines: TranscriptLine[]; gaps: CaptureGap[]; screens: ScreenMoment[] }[], prefix: (part: number) => string): { text: string; kept: Set<number> }[] {
  const all = parts.map((p, part) => entries(p.lines, p.gaps, (l, i) => `${prefix(part)}${i + 1} ${spoken(l)}`, placed(p.screens)));
  const sizes = all.map((es) => es.reduce((n, e) => n + e.text.length + 1, 0));
  const total = sizes.reduce((n, x) => n + x, 0);
  return all.map((es, i) => fit(es, total <= MAX_TRANSCRIPT_CHARS ? MAX_TRANSCRIPT_CHARS : Math.floor((MAX_TRANSCRIPT_CHARS * (sizes[i] ?? 0)) / total)));
}
/**
 * The transcript as the model reads it to point at the lines things come from: "L12 [mm:ss] Name: words", with a "--"
 * line where nothing was captured and a "[screen N" line where a shared screen changed. `kept` are the lines the model
 * was shown, so it can only point at lines it read.
 */
export const numberedText = (lines: TranscriptLine[], gaps: CaptureGap[], screens: ScreenMoment[] = [], grids: ReadonlyMap<string, Uint8Array> = new Map()) =>
  fit(entries(lines, gaps, (l, i) => `L${i + 1} ${spoken(l)}`, compared(screens, grids)));

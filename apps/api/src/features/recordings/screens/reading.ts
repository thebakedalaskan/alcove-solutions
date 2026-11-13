/*
 * Shared screens as the notes model reads them (docs: notes-and-inference › Shared screens): which moments of a call what
 * was said points at a screen, which frames to take for them, and what's on each frame and how much it matters to what
 * was said then. Each request goes to NEAR AI Cloud through inference.ts and accepts only the JSON shapes below.
 */
import { MAX_SCREEN_FRAMES, SECONDS_PER_SCREEN_FRAME, type InferenceEvidence, type ScreenRelevance, type ScreenShare, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../../../platform/config';
import { UnavailableError } from '../../../platform/errors';
import { complete, jpegPart, type ChatModel, type ContentPart, type Meter } from '../../../inference/inference';
import type { Reading } from './screens';
import { DOUBT, SAID_ONLY, Ref, spoken, oneLine, mmss, fenced, lineFor, clip, issues } from '../../../inference/prompts';

/**
 * What reading a call's shared screens asks for back at most, in tokens: picking moments, and reading a frame. Writing a
 * call's notes holds this too while the call is live (features/notes/writing/drafting.ts › writingAtMost).
 */
export const READING_OUTPUT = { pickMoments: 6000, readScreen: 1200 } as const;
/**
 * How much of a screen's text is kept: what a question about the note reads among the lines, and what the note shows.
 * The note keeps every attached frame's reading, and every edit copies the note, so it stays short.
 */
export const SCREEN_TEXT_CHARS = 700;

/** Why what was said points at a screen: it refers to what's shown, the screen changed, a question about it, or a new topic while it's shared. */
export const MOMENT_WHY = ['reference', 'change', 'question', 'topic'] as const;
export type MomentWhy = (typeof MOMENT_WHY)[number];
/**
 * A moment the notes model picked from the transcript: the second of the line it named (a second of the recording), the
 * share it names (from 1), the words that point at it, why, and whether the words say something just changed, so the screen a few seconds before
 * is worth comparing with it.
 */
export interface Moment { at: number; share: number; cue: string; why: MomentWhy; before: boolean }

/** Lines this close to a share (seconds) are read for its moments: people often point at a screen just before or after it's up. */
const NEAR_SHARE_S = 15;
/** How much transcript goes in one request for moments; a longer one goes in several, each with the shares it overlaps. */
export const PICK_CHARS = 60_000;
/** How long before a change (seconds) the frame it's compared with is taken. */
export const BEFORE_S = 5;

const PICK_PROMPT = `You read the transcript of a meeting in which people shared their screens, and pick the moments when what was said points at what was on a screen. A frame of the screen is taken at each moment you pick and read later, so pick the moments where seeing the screen helps understand what was said. Reply with a single JSON object and nothing else, in this shape:
{"moments": [{"line": number, "share": number, "cue": string, "why": "reference" | "change" | "question" | "topic", "before": boolean}]}

The message lists the shares, each numbered, with whose screen it was and when it was up, from [mm:ss] to [mm:ss]. Each transcript line starts with its number and its [mm:ss], as in "L12 [03:41] Name: words".

What counts as a moment, by why:
- reference: the words refer to something shown ("as you can see", "here", "this slide", "this chart", "look at the numbers", "scroll down", "on the left"), or someone reads out words or numbers that are on the screen.
- change: someone says the screen changed or moves on ("next slide", "let me switch to the demo", "it changed now", "it completed", "there, it's done", "see how that updated", "now it's green").
- question: someone asks about what's shown ("what do you think of these changes?", "what's that number at the bottom?").
- topic: the talk turns to a new topic while a screen is shared, and what's shown likely goes with it.
Talk that would be the same whatever was on the screen is not a moment: greetings, small talk, plans for another day, anything about the call itself ("can you hear me?", "you're on mute").

For each moment:
- line: the number of the line where the words were said (the 12 of "L12"). Only numbers of lines you were sent.
- share: the number of the share that was up then.
- cue: the words that point at the screen, as they were said, at most 120 characters.
- why: reference, change, question or topic.
- before: true when the words say something on the screen just changed, finished, loaded or appeared, so the screen ${BEFORE_S} seconds earlier shows how it was before and the two can be compared. For example "it changed now", "it completed", "there, it's done", "see how that updated", "now it's green", "that's the new version", "the build finished". Otherwise false.

How many: about one moment for every fifteen seconds of sharing on average, fewer when little is said about the screens. More only while a screen is stepped through quickly and each step is talked over, as in a live demo, where nearly every line may be a moment. At most one moment for a line. Prefer the moments that point at the screen most plainly. Only lines inside a share's time, in order. An empty list if nothing said points at a screen. ${DOUBT} ${SAID_ONLY}`;

const MomentsReply = z.object({ moments: z.array(z.unknown()).catch([]) });
const MomentItem = z.object({ line: Ref.nullish().catch(null), share: z.coerce.number().catch(0), cue: z.string().catch(''), why: z.enum(MOMENT_WHY).catch('reference'), before: z.boolean().catch(false) });

/**
 * The moments of a call when what was said points at a shared screen, picked by the notes model from the transcript
 * and the shares (numbered from 1 in the order given). Only lines near a share are read, each numbered by its place in
 * `lines`, so a long call's requests number them alike; a long call goes in several requests. The model names the line,
 * never a time: a moment's second is its line's. A moment the model gave that makes no sense, or names a line its request
 * didn't send, is dropped, and a reply that isn't moments at all counts as
 * none (`unusable` says how many were), so a bad answer costs only the cues, never the notes.
 */
export async function pickMoments(cfg: Config, meter: Meter, lines: TranscriptLine[], shares: ScreenShare[], via?: ChatModel | undefined): Promise<{ moments: Moment[]; evidence: InferenceEvidence[]; requests: number; unusable: number }> {
  const said = lines.flatMap((l, i) => (shares.some((sh) => l.at >= sh.at - NEAR_SHARE_S && l.at <= sh.until + NEAR_SHARE_S) ? [{ i, at: l.at, text: `L${i + 1} ${spoken(l)}` }] : []));
  const chunks: { i: number; at: number; text: string }[][] = [];
  let size = 0;
  for (const x of said) {
    const last = chunks.at(-1);
    if (!last || size + x.text.length + 1 > PICK_CHARS) { chunks.push([x]); size = x.text.length + 1; } else { last.push(x); size += x.text.length + 1; }
  }
  const moments: Moment[] = [];
  const evidence: InferenceEvidence[] = [];
  let unusable = 0;
  for (const chunk of chunks) {
    const from = chunk[0]?.at ?? 0;
    const to = chunk.at(-1)?.at ?? 0;
    const listed = shares.flatMap((sh, i) => (sh.at <= to + NEAR_SHARE_S && sh.until >= from - NEAR_SHARE_S ? [`Share ${i + 1}: ${oneLine(sh.label)}, from [${mmss(sh.at)}] to [${mmss(sh.until)}]`] : []));
    const { json, evidence: e } = await complete(cfg, meter, [
      { role: 'system', content: PICK_PROMPT },
      { role: 'user', content: `Shares:\n${listed.join('\n')}\n\nTranscript:\n${fenced(chunk.map((x) => x.text).join('\n'))}` }
    ], { what: 'pick-moments', maxTokens: READING_OUTPUT.pickMoments, timeoutMs: 180_000, via });
    if (e) evidence.push(e);
    const reply = MomentsReply.safeParse(json);
    if (!reply.success) { unusable++; continue; }
    const sent = new Set(chunk.map((x) => x.i));
    for (const raw of reply.data.moments) {
      const m = MomentItem.safeParse(raw);
      const line = m.success ? lineFor(m.data.line, sent, lines) : undefined;
      if (!m.success || !line || !Number.isInteger(m.data.share)) continue;
      moments.push({ at: line.at, share: m.data.share, cue: clip(oneLine(m.data.cue), 120), why: m.data.why, before: m.data.before });
    }
  }
  return { moments, evidence, requests: chunks.length, unusable };
}

/** Why a frame was taken: a moment's reason, the share's first second, or as the screen was a few seconds before a change. */
export const PICK_WHY = [...MOMENT_WHY, 'start', 'before'] as const;
export type PickWhy = (typeof PICK_WHY)[number];
/**
 * A frame to take: of which share, in which segment of the recording, at which tenth of a second of the recording, and
 * why; for a change, `before` is the second of the frame it's compared with (taken as a pick of its own), else null.
 */
export interface FramePick { share: string; segment: number; at: number; cue: string; why: PickWhy; before: number | null }

/** What's pointed at plainly comes first when there are more moments than frames. */
const FIRST: Record<MomentWhy, number> = { reference: 0, question: 0, change: 1, topic: 1 };
/** Frames are taken on a grid of tenths of a second (ffmpeg.frames). */
const tenth = (x: number) => Math.round(x * 10) / 10;

/** `n` of `xs` (in order), spread evenly from the first to the last. */
function spread<T>(xs: T[], n: number): T[] {
  if (n >= xs.length) return xs;
  if (n <= 0) return [];
  if (n === 1) return xs.slice(Math.floor(xs.length / 2), Math.floor(xs.length / 2) + 1);
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]).flatMap((x) => (x === undefined ? [] : [x]));
}
/** How long before a share's video starts a line can begin and still be about it: its words reach the video. */
const LEAD_S = 5;

/**
 * The frames to take for each share's video in each segment (from its first whole second to half a second short of its
 * end, where the last frame may be missing), at most one for every SECONDS_PER_SCREEN_FRAME seconds of sharing and never
 * more than `max`:
 *
 *  - Each moment picked from what was said, inside a share's video. A moment naming no share up then goes to the share
 *    that was (the one that started last, as replay shows it). One said up to LEAD_S seconds before a share's video
 *    starts goes to its first second; one outside every share otherwise is dropped. At most one a second for each
 *    share: the one pointed at most plainly, or the first.
 *  - For a moment whose words say something just changed, the frame BEFORE_S seconds before it (`before`), to compare.
 *  - The segment's first second (`start`), when there's room, so every share is seen.
 *
 * Over budget: the moments first, one frame each (what's pointed at plainly first, spread evenly over the call), then
 * the frames before changes while there's room (plainly pointed at first, then the earliest), then starts, spread
 * evenly. The same moments always give the same frames, so a retried job takes the same ones.
 */
export function selectFrames(moments: Moment[], shares: ScreenShare[], max = MAX_SCREEN_FRAMES): FramePick[] {
  const spans = shares.flatMap((sh) => sh.segments.map((g) => ({ share: sh.id, started: sh.at, segment: g.segment, lo: Math.ceil(g.at), hi: tenth(g.until - 0.5) })))
    .filter((x) => x.hi >= x.lo)
    .sort((a, b) => b.started - a.started);
  const seconds = spans.reduce((n, x) => n + Math.max(1, x.hi - x.lo), 0);
  const budget = Math.min(max, Math.ceil(seconds / SECONDS_PER_SCREEN_FRAME));
  const inside = (share: string | undefined, s: number) => spans.find((x) => (share === undefined || x.share === share) && s >= x.lo && s <= x.hi);
  const starting = (share: string | undefined, s: number) => spans.find((x) => (share === undefined || x.share === share) && x.lo > s && x.lo - s <= LEAD_S);
  type Found = FramePick & { why: MomentWhy; lo: number; wants: boolean };
  const found = new Map<string, Found>();
  for (const m of moments) {
    const named = shares[m.share - 1]?.id;
    let place: { span: (typeof spans)[number]; s: number } | undefined;
    for (const s of [tenth(m.at), Math.floor(m.at), Math.ceil(m.at)]) {
      const span = (named ? inside(named, s) : undefined) ?? inside(undefined, s);
      if (span) { place = { span, s }; break; }
    }
    if (!place) {
      const span = (named ? starting(named, m.at) : undefined) ?? starting(undefined, m.at);
      if (span) place = { span, s: span.lo };
    }
    if (!place) continue;
    const key = `${place.span.share}:${Math.floor(place.s)}`;
    const was = found.get(key);
    if (was && FIRST[was.why] <= FIRST[m.why]) { was.wants ||= m.before; continue; }
    found.set(key, { share: place.span.share, segment: place.span.segment, at: place.s, cue: m.cue || was?.cue || '', why: m.why, before: null, lo: place.span.lo, wants: m.before || (was?.wants ?? false) });
  }
  // A moment's before frame, when there's a second before it in its share's video.
  const beforeOf = (p: Found) => (p.wants && p.at - BEFORE_S >= p.lo ? tenth(p.at - BEFORE_S) : null);
  const byTime = (a: FramePick, b: FramePick) => a.at - b.at || a.share.localeCompare(b.share);
  const all = [...found.values()].sort(byTime);
  const plain = all.filter((p) => p.why === 'reference' || p.why === 'question');
  const rest = all.filter((p) => !(p.why === 'reference' || p.why === 'question'));
  const first = spread(plain, budget);
  const chosen = [...first, ...spread(rest, budget - first.length)].sort(byTime);

  // The frame taken in each second of each share, so a before frame in a second already taken is that frame.
  const secondOf = (share: string, at: number) => `${share}:${Math.floor(at)}`;
  const taken = new Map(chosen.map((p) => [secondOf(p.share, p.at), p.at]));
  const befores = new Map<Found, number>();
  const added: FramePick[] = [];
  let room = budget - chosen.length;
  for (const p of [...chosen].sort((x, y) => FIRST[x.why] - FIRST[y.why] || byTime(x, y))) {
    const b = beforeOf(p);
    if (b === null) continue;
    const there = taken.get(secondOf(p.share, b));
    if (there !== undefined) { befores.set(p, there); continue; }
    if (room <= 0) continue;
    room--;
    taken.set(secondOf(p.share, b), b);
    befores.set(p, b);
    added.push({ share: p.share, segment: p.segment, at: b, cue: '', why: 'before', before: null });
  }
  const picks: FramePick[] = [...chosen.map((p): FramePick => ({ share: p.share, segment: p.segment, at: p.at, cue: p.cue, why: p.why, before: befores.get(p) ?? null })), ...added];
  const starts = [...spans].sort((x, y) => x.lo - y.lo || x.share.localeCompare(y.share))
    .filter((span) => !taken.has(secondOf(span.share, span.lo)))
    .map((span): FramePick => ({ share: span.share, segment: span.segment, at: span.lo, cue: '', why: 'start', before: null }));
  return [...picks, ...spread(starts, budget - picks.length)].sort(byTime);
}

const READ_SCREEN_PROMPT = `You read a frame of a screen someone shared in a meeting, describe what's on it, and judge whether it matters to what was being said then. Reply with a single JSON object and nothing else, in this shape:
{"title": string, "text": string, "legible": "clear" | "partly" | "unreadable", "shows": string, "changed": string, "regions": [{"label": string, "box": [number, number, number, number]}], "relevance": "key" | "supporting" | "unrelated"}

title: what it is, in a few words: a slide's heading, a document's or page's name, or the app and what's open in it.
text: the words and numbers you can read on it, exactly as written, top to bottom, one line each, at most 600 characters. Leave out what you can't read; never guess at it or fill it in.
legible: clear if you can read all of it, partly if some of it is too small, blurred or cut off, unreadable if you can't make it out at all.
shows: one or two plain sentences on what the frame shows beyond its words: the kind of thing it is (a slide, a chart, a dashboard, code, a design, a map, a photo, a video), and what's in it, such as people, vehicles, buildings, products or other objects, diagrams, the layout, the design style and the main colours. Never say who a person is; describe only what can be seen. At most 300 characters.
changed: only when you're sent two frames, the first taken a few seconds before the second: one plain sentence on what changed between them (what appeared, finished, moved or updated), or an empty string when nothing visible did. Otherwise an empty string. Everything else describes the last frame.
regions: up to four parts someone might point at while talking, such as a chart, a table, a code block or a paragraph, each with a short label and its box as [left, top, right, bottom], each a fraction of the frame's width or height from 0 to 1. An empty list if nothing stands out.
relevance: what's on a shared screen is often unrelated to what's being said: a desktop, an email, a different tab, a loading screen, or the meeting app itself. key only when what was said plainly refers to what's shown, or relies on facts that only this frame shows. supporting when it gives useful context for what was said but isn't needed to follow it. Otherwise unrelated. Judge it by what was said as well as by the frame: never call a frame relevant from the image alone when what was said contradicts it.
Describe only what is on the frame. Write in the language on the screen. ${SAID_ONLY}`;

const ScreenReply = z.object({
  title: z.string().catch(''), text: z.string().catch(''),
  // Saying nothing about how legible it was isn't saying it was clear.
  legible: z.enum(['clear', 'partly', 'unreadable']).catch('partly'),
  shows: z.string().catch(''), changed: z.string().catch(''),
  regions: z.array(z.object({ label: z.string(), box: z.array(z.coerce.number()).length(4) })).catch([]),
  relevance: z.enum(['key', 'supporting', 'unrelated']).nullish().catch(null)
});
const unit = (n: number) => Math.min(1, Math.max(0, n));

/** What was said around a frame, for judging it: when it was taken, the words that picked it and why, and the lines within 30 seconds. */
export interface ScreenContext { at: number; cue: string; why: PickWhy; lines: TranscriptLine[] }
/** How far from a frame the lines sent with it are, and at most how much of them. */
const AROUND_S = 30;
const AROUND_CHARS = 6000;
/** How much of what the model said a frame shows, and what changed on it, is kept. */
const SHOWS_CHARS = 300;
const CHANGED_CHARS = 200;
/**
 * How much a frame matters when the model read it but didn't say: one picked because what was said plainly pointed at
 * it, and that could be made out, gives context; anything else (a share's start, a change or a new topic, or a frame it
 * found unreadable) is left out. A frame read with nothing said to go by (notes written before frames were picked) keeps
 * what old notes show. A frame that couldn't be read at all isn't judged here: it's kept as unread (screens.readOne).
 */
const unsaid = (c: ScreenContext | undefined, legible: Reading['legible']): ScreenRelevance =>
  !c ? 'supporting' : legible !== 'unreadable' && (c.why === 'reference' || c.why === 'question') ? 'supporting' : 'unrelated';
const TAKEN: Record<PickWhy, string> = {
  reference: 'picked because what was said referred to it', change: 'picked because what was said says the screen changed', question: 'picked for a question about it',
  topic: 'picked because the talk moved on then', start: 'taken as the share began', before: 'taken to compare with a change'
};

/**
 * What's on one frame of a shared screen, and how much it matters to what was said around it, read by the vision model
 * (`via`, the notes model unless said): the image and what was said go sealed to its verified key, like every request.
 * With `before`, the screen a few seconds earlier goes first, and the model says what changed. Only what it could read
 * is kept, with how legible it was and what it shows; the parts it points at are boxes inside the frame, as fractions
 * of it, and at least a sliver big.
 */
export async function readScreen(cfg: Config, meter: Meter, jpeg: Uint8Array, o: { context?: ScreenContext | undefined; via?: ChatModel | undefined; before?: Uint8Array | undefined } = {}): Promise<{ reading: Reading; relevance: ScreenRelevance; evidence: InferenceEvidence | null }> {
  const c = o.context;
  const around = c ? clip(c.lines.filter((l) => Math.abs(l.at - c.at) <= AROUND_S).map(spoken).join('\n'), AROUND_CHARS) : '';
  const said = c ? `The frame was taken at [${mmss(c.at)}], ${TAKEN[c.why]}${c.cue ? ' (the cue below)' : ''}. What was said within ${AROUND_S} seconds of it:\n${fenced([...(c.cue ? [`Cue: ${oneLine(c.cue)}`] : []), around || '(nothing was said)'].join('\n'))}\n\n` : '';
  const frames: ContentPart[] = o.before
    ? [{ type: 'text', text: `${said}Two frames: the screen ${BEFORE_S} seconds before, then the frame itself.\nBefore:` }, jpegPart(o.before), { type: 'text', text: 'The frame:' }, jpegPart(jpeg)]
    : [{ type: 'text', text: `${said}The frame:` }, jpegPart(jpeg)];
  const { json, evidence } = await complete(cfg, meter, [
    { role: 'system', content: READ_SCREEN_PROMPT },
    { role: 'user', content: frames }
  ], { what: 'read-screen', maxTokens: READING_OUTPUT.readScreen, timeoutMs: 60_000, via: o.via });
  const reply = ScreenReply.safeParse(json);
  if (!reply.success) throw new UnavailableError('The screen came back read in the wrong shape.', { context: { what: 'read-screen', issues: issues(reply.error) } });
  const r = reply.data;
  const regions = r.regions.flatMap((g) => {
    const [l = 0, t = 0, rt = 0, b = 0] = g.box.map(unit);
    const label = clip(g.label.trim(), 60);
    return label && rt - l >= 0.02 && b - t >= 0.02 ? [{ label, x: l, y: t, w: Math.round((rt - l) * 1000) / 1000, h: Math.round((b - t) * 1000) / 1000 }] : [];
  }).slice(0, 4);
  return {
    reading: {
      legible: r.legible, title: clip(r.title.trim(), 120), text: clip(r.text.trim(), SCREEN_TEXT_CHARS), shows: clip(oneLine(r.shows), SHOWS_CHARS),
      changed: o.before ? clip(oneLine(r.changed), CHANGED_CHARS) : '', regions
    },
    relevance: r.relevance ?? unsaid(c, r.legible), evidence
  };
}

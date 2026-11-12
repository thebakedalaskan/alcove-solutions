/* The pieces of a note page, shared by real notes, the example and a series. */
import {
  mayDecide, mayDispute, proposerOf,
  type ActionItem, type AnswerPart, type CaptureGap, type Chapter, type Decision, type DecisionPatch, type NoteReader, type RoomRef,
  type Question, type Recipient, type ScreenMoment, type ScreenRef, type SeriesAnswerPart, type Speaker, type TranscriptLine
} from '@alcove/api';
import { Avatar, CaptureGapMark, Icon, IconButton, ReadMore, UnsureKey, cn } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { Fragment, createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { KeepAnswer } from '~/features/personal/parts';
import { gapLabel, gapsAfter, gapsBefore } from '~/lib/capture';
import { ariaShortcut, withMod } from '~/lib/keys';
import { sameEmail, spokenName } from '~/lib/people';
import { position, shortDay } from '~/lib/time';
import { AnswerView, useAnswer, type Answer, type Cite } from './answer';
import { byName, notTheirs } from './entries';
import { LineRow, type Correcting, type FromLine, type LineMarks } from './lines';
import { roleLine } from './meta';
import { usePlayerAt, type PlayerState } from './Player';
import { capital } from '~/lib/words';

/** A part of the note, with its heading: what kind of thing it holds gives it its colour, and `count` says what's waiting. */
/** A part of a note under its heading. `id`: where a link goes to it, as a call's folder goes to a note's follow-ups. */
export function Section({ title, count, kind, id, className, children }: { title: string; count?: ReactNode; kind?: 'decide' | 'follow' | undefined; id?: string | undefined; className?: string | undefined; children: ReactNode }) {
  return (
    <section id={id} className={cn('nd-s', kind && `is-${kind}`, className)}>
      <h2>{title}{count !== undefined && <span className="n">{count}</span>}</h2>
      {children}
    </section>
  );
}

/** A moment as a chip that goes there, from anywhere on the page. With nothing to go to, it isn't drawn. */
export function Moment({ at, onSeek, plays = false }: { at: number | undefined; onSeek: ((s: number) => void) | undefined; plays?: boolean | undefined }) {
  if (at === undefined || !onSeek) return null;
  return (
    <button type="button" className="nd-moment" aria-label={plays ? `Play the call from ${position(at)}` : `Go to the moment at ${position(at)}`} title={plays ? 'Play from this moment' : 'Go to this moment'} onClick={() => onSeek(at)}>
      <Icon name={plays ? 'play' : 'moment'} size={13} />{position(at)}
    </button>
  );
}

/* ---------- decisions, open questions and follow-ups: what the notes heard, until people say so ---------- */

/** Shows where something was on a shared screen ("On screen" with the moment), on the note page. */
export type ScreenRefShown = (screen: ScreenRef) => ReactNode;

/** Whoever last reworded a decision that's still proposed: these are their words now, whoever proposed it. */
const wordsBy = (d: Decision) => (d.state === 'proposed' ? d.changes.findLast((c) => c.what === 'reworded')?.by : undefined);

/** Whose words a proposed decision is in: whoever last reworded it, whoever proposed it, or the notes. */
export const proposedLine = (d: Decision, me: string | undefined): string => {
  const words = wordsBy(d);
  if (words) return `Reworded by ${byName(words, me)}`;
  const p = proposerOf(d);
  return `Proposed by ${p ? byName(p, me) : 'the notes'}`;
};

/** The latest change to where a decision stands. */
export const lastMove = (d: Decision) => d.changes.findLast((c) => c.what !== 'reworded' && c.what !== 'disputed' && c.what !== 'undisputed');

/** Where a decision stands, in a sentence: confirmed by whom, said not to be decided or to no longer hold, or nobody has confirmed it yet. */
export function decisionLine(d: Decision, me: string | undefined): string {
  const last = lastMove(d);
  if (d.state === 'confirmed' && last) return `Confirmed by ${byName(last.by, me)}`;
  if (d.state === 'rejected' && last) return `${capital(byName(last.by, me))} said this wasn’t decided`;
  if (d.state === 'superseded' && last) return `${capital(byName(last.by, me))} said this no longer holds`;
  if (last?.what === 'reopened') return `${capital(byName(last.by, me))} reopened this. Nobody has confirmed it since`;
  return `${proposedLine(d, me)}. Nobody has confirmed it yet`;
}

/** Saying a decision wasn't decided: rejecting it, for whoever may; otherwise saying so for the organizer to settle. */
export const notDecided = (d: Decision, reader: NoteReader): DecisionPatch | undefined =>
  (mayDecide(d, 'rejected', reader) ? { state: 'rejected' } : mayDispute(d, reader) ? { dispute: true } : undefined);

/** Where an open question stands, in a sentence: still open, reopened by someone, or answered. */
export function questionLine(x: Question, me: string | undefined): string {
  const last = x.changes.findLast((c) => c.what !== 'reworded');
  if (x.state === 'answered') return last ? `${capital(byName(last.by, me))} said this was answered` : 'Answered';
  return last?.what === 'reopened' ? `Reopened by ${byName(last.by, me)}` : 'Not answered yet';
}

/** Who a follow-up is for, in a sentence: suggested by the notes or by someone, turned down, taken on, or to take on again. */
export function actionLine(a: ActionItem, me: string | undefined): string {
  if (!a.owner) {
    const no = a.changes.findLast((c) => c.what === 'declined');
    return no ? `${notTheirs(no, me)}. Nobody is on this yet` : 'Nobody is on this yet';
  }
  const mine = !!me && !!a.owner.person && sameEmail(a.owner.person, { email: me });
  const them = mine ? 'you' : spokenName(a.owner, me);
  if (a.takenOn) return mine ? 'You took this on' : `${them} took this on`;
  // Nobody with an address can't answer, so nobody is waited for.
  if (!a.owner.person?.email) return `The notes suggest ${them}. They can’t take it on here, so give it to someone who has the notes`;
  const ask = mine ? 'Take it on if it’s yours' : `Waiting for ${them} to take it on`;
  const last = a.changes.findLast((c) => c.what === 'reopened' || c.what === 'reassigned');
  if (last?.what === 'reopened') return mine ? `${capital(byName(last.by, me))} changed this since you took it on. Take it on again if it’s still yours` : `${capital(byName(last.by, me))} changed this since ${them} took it on. Waiting for them to take it on again`;
  if (last) return `${capital(byName(last.by, me))} gave this to ${them}. ${ask}`;
  const proposer = proposerOf(a);
  const who = proposer ? byName(proposer, me) : 'the notes';
  return `${capital(who)} ${who === 'you' || !proposer ? 'suggest' : 'suggests'} ${them}. ${ask}`;
}

/** Lines a written note shows before its whole transcript is opened. */
const FIRST_LINES = 5;

/** Where the page went, for the transcript to go there too: a new one each time, so going to the same moment again still does. */
export interface Focus { at: number }

/** The line said at a moment. */
const lineAt = (lines: TranscriptLine[], at: number) => Math.max(0, lines.findLastIndex((l) => l.at <= at + 0.5));

/**
 * What was said in a call, under a heading: its first lines, and all of it on request, or once something goes to a moment
 * further on. `player` marks the line being said as the recording plays. Pauses and shared screens after the lines shown
 * wait too, and `onScreens` opens the first of them from here meanwhile. `live`: the call is still going. With `correct`, whoever may
 * corrects lines in place (lines.tsx); with `marks`, they bookmark lines for themselves. `kinds` says which lines
 * something in the notes came from. `top` is what goes above the lines. Pressing a line (its words or its time) goes to
 * its moment and plays from there (`onSeek` with `play`), and the line is marked where it is: it's in view already. On a
 * phone, where only one line shows its tools, the line pressed keeps them while the line being said moves on, until
 * another is pressed or it's scrolled out of sight.
 */
export function Transcript({ lines, gaps, seconds, me, onSeek, focus, player, live = false, screens, onScreens, correct, fromLine, marks, kinds, top }: {
  lines: TranscriptLine[]; gaps: CaptureGap[]; seconds: number; me: string | undefined; onSeek?: ((s: number, play?: boolean) => void) | undefined; focus?: Focus | undefined; player: PlayerState; live?: boolean | undefined;
  screens?: ScreensShown | undefined; onScreens?: ((m: ScreenMoment) => void) | undefined; correct?: Correcting | undefined; fromLine?: FromLine | undefined; marks?: LineMarks | undefined; kinds?: LineKinds | undefined; top?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [went, setWent] = useState<Focus | undefined>(undefined);
  /** The moment of the line just pressed, which the page then goes to. */
  const pressed = useRef<number | null>(null);
  // Going to a line further on opens the rest, in the same drawing, so the line is there to scroll to.
  if (focus !== went) { setWent(focus); if (focus && lineAt(lines, focus.at) >= FIRST_LINES) setOpen(true); }
  useEffect(() => {
    if (!focus) return;
    // A line that was pressed only scrolls if it's under the strip at the top or the bar at the bottom.
    const near = pressed.current === focus.at;
    pressed.current = null;
    document.getElementById(MOMENT)?.scrollIntoView({ block: near ? 'nearest' : 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [focus, reduce]);
  const plays = player.total > 0;
  /** The line pressed last, by its ID, until another is pressed or it's out of sight. */
  const [picked, setPicked] = useState<string | null>(null);
  const press = onSeek && ((at: number, line: string) => { pressed.current = at; setPicked(line); onSeek(at, plays); });
  // The line being said, once anyone has gone anywhere or pressed play.
  const said = usePlayerAt(player, (p) => (p > 0 ? lineAt(lines, p) : -1));
  const lit = said >= 0 ? said : focus ? lineAt(lines, focus.at) : -1;
  const all = open || lines.length <= FIRST_LINES;
  /* Watches the line pressed (this owns the observer, and stops it when another is pressed or the lines change), and lets
     it go once it has been in sight and isn't any more: a line pressed under the bar is scrolled up into sight first. */
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = picked ? section.current?.querySelector('.nd-l.is-picked') : null;
    if (!el) return;
    let seen = false;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) seen = true;
      else if (seen) setPicked(null);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [picked, all]);
  const shown = all ? lines : lines.slice(0, FIRST_LINES);
  const last = shown.at(-1)?.at ?? 0;
  const upTo = <T extends { at: number }>(xs: T[]) => (all ? xs : xs.filter((x) => x.at <= last));
  // A screen attached to a line waits with that line; one whose line isn't in the transcript waits by time.
  const ids = new Set(lines.map((l) => l.id));
  const showing = new Set(shown.map((l) => l.id));
  const waiting = (m: ScreenMoment) => (m.line !== null && ids.has(m.line) ? showing.has(m.line) : m.at <= last);
  const hidden = (screens?.moments ?? []).filter((m) => !all && !waiting(m));
  const [nextHidden] = hidden;
  return (
    <section ref={section} className="nd-s nd-tr">
      <div className="nd-sh"><h2>Transcript</h2><UnsureKey words={lines.some((l) => l.unsure?.words)} speaker={lines.some((l) => l.unsure?.speaker)} className="nd-key" /></div>
      {top}
      <TranscriptLines lines={shown} gaps={upTo(gaps)} me={me} onSeek={press} plays={plays} focus={focus?.at} lit={lit} picked={picked} screens={screens && { ...screens, moments: all ? screens.moments : screens.moments.filter(waiting) }} correct={correct} fromLine={fromLine} marks={marks} kinds={kinds} />
      {(lines.length > FIRST_LINES || nextHidden) && (
        <div className="nd-allrow">
          {lines.length > FIRST_LINES && (
            <button type="button" className="nd-all" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Show less' : live ? 'Show all so far' : `Show all ${Math.max(1, Math.round(seconds / 60))} minutes`}<Icon name="down" size={14} />
            </button>
          )}
          {nextHidden && onScreens && <button type="button" className="nd-act nd-scrlink" onClick={() => onScreens(nextHidden)}><Icon name="monitor" size={15} />{hidden.length} shared {hidden.length === 1 ? 'screen' : 'screens'}</button>}
        </div>
      )}
    </section>
  );
}

/** Which lines something in the notes came from, by kind, for a mark beside them. */
export type LineKinds = ReadonlyMap<string, 'decide' | 'follow'>;

/** One key per person: guests have no email, so the person's ID tells them apart. */
const voiceOf = (s: Speaker | undefined) => (s ? (s.person?.id ?? `name:${s.name}`) : '');

/** Where a link to a moment lands: the transcript line said then, which the router scrolls to the middle of the view. */
const MOMENT = 'moment';
const CENTER: ScrollIntoViewOptions = { block: 'center' };
/** The parts of a link to a note that open it at a moment, in a breakout room's section when it was said there. */
const atMoment = (at: number, room?: RoomRef | undefined) => ({ search: { at: Math.round(at), ...(room ? { room: room.id } : {}) }, hash: MOMENT, hashScrollIntoView: CENTER });
/** Where a link to a breakout room's section lands. */
export const roomAnchor = (id: string) => `room-${id}`;
/** The parts of a link to a note that open it at a breakout room's section, or at a moment, when it has one. */
export const inNote = (at: number | undefined, room: RoomRef | undefined) =>
  (at !== undefined ? atMoment(at, room) : room ? { search: { room: room.id }, hash: roomAnchor(room.id), hashScrollIntoView: CENTER } : {});
/** The parts of a link to a note that open it at a moment and play the call from there, as Play from in the palette does. */
export const playIn = (at: number, room: RoomRef | undefined) => {
  const moment = atMoment(at, room);
  return { ...moment, search: { ...moment.search, play: true as const } };
};

/**
 * Links to notes under this open in a new tab, each still opened with the reader's access checked: from a call or its
 * pre-join, leaving the page would leave the call, or turn the camera off.
 */
export const NotesApart = createContext(false);
/** A link's target, under `NotesApart`. */
export function useNotesApart() {
  return useContext(NotesApart) ? { target: '_blank', rel: 'noopener' } : {};
}

/** A note's shared screens among its transcript lines: the moments, and how each is drawn (it opens the frame). */
export interface ScreensShown { moments: ScreenMoment[]; row: (m: ScreenMoment) => ReactNode }

/**
 * What was said, line by line, with the stretches nothing was captured in marked where they fall, and what was on a
 * shared screen right after the line it's attached to (or, for one attached to no line shown, just before the lines
 * said while it was up). A speaker's lines in a row share one name; a room recording names nobody. With `focus`, the line
 * said at that moment is where a moment's link lands, and `lit` is the line to mark. With `onSeek`, pressing a line goes to
 * it, playing from there with `plays`, and `picked` is the line pressed last, by its ID. With `correct`, whoever may
 * corrects lines in place (lines.tsx). With `marks`, they bookmark lines for themselves.
 */
export function TranscriptLines({ lines, gaps = [], me, onSeek, plays = false, focus, lit, picked, screens, correct, fromLine, marks, kinds, className }: {
  lines: TranscriptLine[]; gaps?: CaptureGap[] | undefined; me: string | undefined; onSeek?: ((s: number, lineId: string) => void) | undefined; plays?: boolean | undefined; focus?: number | undefined; lit?: number | undefined;
  picked?: string | null | undefined; screens?: ScreensShown | undefined; correct?: Correcting | undefined; fromLine?: FromLine | undefined; marks?: LineMarks | undefined; kinds?: LineKinds | undefined; className?: string | undefined;
}) {
  const here = focus === undefined ? -1 : lineAt(lines, focus);
  const on = lit ?? here;
  const gap = (g: CaptureGap) => <CaptureGapMark key={`${g.kind}-${g.from}`} label={gapLabel(g)} className="nd-gapline" />;
  const moments = screens?.moments ?? [];
  const shown = (m: ScreenMoment) => <Fragment key={m.id}>{screens?.row(m)}</Fragment>;
  // A moment attached to a line shown comes right after it; any other is placed by when it appeared.
  const ids = new Set(lines.map((l) => l.id));
  const attached = new Map<string, ScreenMoment[]>();
  for (const m of moments) if (m.line !== null && ids.has(m.line)) attached.set(m.line, [...(attached.get(m.line) ?? []), m]);
  const byTime = moments.filter((m) => m.line === null || !ids.has(m.line));
  return (
    <div className={cn('nd-lines', !lines.some((l) => l.speaker) && 'is-nameless', className)}>
      {lines.map((l, i) => {
        const before = gapsBefore(gaps, lines, i);
        const up = gapsBefore(byTime, lines, i);
        const prev = lines[i - 1];
        const after = attached.get(l.id) ?? [];
        // After a gap, or a screen, the speaker is named again: it's a new part of the call.
        const more = !!l.speaker && voiceOf(lines[i - 1]?.speaker) === voiceOf(l.speaker) && !before.length && !up.length && !(prev && attached.has(prev.id));
        return <Fragment key={l.id}>{before.map(gap)}{up.map(shown)}<LineRow line={l} more={more} id={i === here ? MOMENT : undefined} on={i === on} picked={l.id === picked} kind={kinds?.get(l.id)} onSeek={onSeek} plays={plays} me={me} correct={correct} fromLine={fromLine} marks={marks} />{after.map(shown)}</Fragment>;
      })}
      {gapsAfter(gaps, lines).map(gap)}
      {gapsAfter(byTime, lines).map(shown)}
    </div>
  );
}

/**
 * A moment in a call's notes, as a link: they open with the transcript at that line, and the audio waiting there. In a
 * breakout room's section, that room's. `chip`: as the moment chips on a note look, for a page that's a note's neighbour.
 */
export function MomentLink({ noteId, at, room, chip = false }: { noteId: string; at: number; room?: RoomRef | undefined; chip?: boolean | undefined }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId }} {...atMoment(at, room)} {...useNotesApart()} className={chip ? 'nd-moment' : 'ac-time-chip'} title={`Open the notes at ${position(at)}${room ? `, in ${room.name}` : ''}`}>
      {chip && <Icon name="moment" size={13} />}{position(at)}
    </Link>
  );
}

/** The chapters of a call as a list, for a phone: the line has no room for them, or for what they say. */
export function ChapterList({ chapters, onGo }: { chapters: Chapter[]; onGo: ((c: Chapter) => void) | undefined }) {
  if (!chapters.length) return null;
  return (
    <section className="nd-b nd-chapters">
      <h2>Chapters</h2>
      {chapters.map((c) => (
        <button key={`${c.at}-${c.title}`} type="button" className="nd-chap" disabled={!onGo} onClick={() => onGo?.(c)}>
          <span className="nd-c-d">{position(c.at)}</span><span><b>{c.title}</b>{c.summary && <small>{c.summary}</small>}</span>
        </button>
      ))}
    </section>
  );
}

const COUNTED = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** Who can open a note: "Only these five can open them. Alcove can’t." */
const onlyThese = (n: number) => (n <= 1 ? 'Only your account can open them in Alcove.' : `Only these ${COUNTED[n] ?? n} accounts can open them in Alcove.`);
/* A long list shows its first people until it's opened; the people a share just reached show in it either way. */
const FIRST_PEOPLE = 8;

/** Who has a note, and how each of them got it: organizer, invited, or shared afterwards by whom (and with which group). */
export function Recipients({ recipients, me, fresh }: { recipients: Recipient[]; me: string | undefined; fresh?: ReadonlySet<string> | undefined }) {
  const [all, setAll] = useState(false);
  const long = recipients.length > FIRST_PEOPLE + 2;
  const shown = !long || all ? recipients : recipients.filter((r, i) => i < FIRST_PEOPLE || fresh?.has(r.person.email));
  return (
    <section className="nd-b">
      <h2>Who has these notes</h2>
      {shown.map((r) => (
        <div key={r.person.email} className={cn('nd-p', fresh?.has(r.person.email) && 'is-fresh')}>
          <Avatar person={r.person} size={26} />
          <span className="nd-p-n ac-clamp-1">{r.person.name}{me && sameEmail(r.person, { email: me }) ? ' (you)' : ''}</span>
          <span className="nd-p-r">{roleLine(r, me)}</span>
        </div>
      ))}
      {long && <button type="button" className="nd-act nd-showall" aria-expanded={all} onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${recipients.length}`}</button>}
      <p className="nd-open"><Icon name="sealed" size={14} />{onlyThese(recipients.length)}</p>
    </section>
  );
}

/**
 * The note's short summary, and under it, when the notes wrote one, the full summary behind a "Full summary" button:
 * paragraphs, closed until pressed. Older notes have no full summary, and show no button.
 */
export function Summary({ summary, details }: { summary: string; details: string }) {
  const paragraphs = details.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      <p className="nd-sum">{summary}</p>
      {paragraphs.length > 0 && (
        <ReadMore label="Full summary" className="nd-more-sum">
          <div className="nd-full">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
        </ReadMore>
      )}
    </>
  );
}

/** A cite's key among an answer's: a moment, a shared screen, or one of a series' calls (at a moment when it can tell). */
const citeKey = (c: Cite) => (c.type === 'cite' ? `${c.noteId}@${c.at}` : c.type === 'screen' ? `screen:${c.id}` : `${c.noteId}/${c.room?.id ?? ''}@${c.at ?? ''}`);

/** One of a series' calls an answer comes from: its day, its breakout room and the moment when the answer could tell. */
export function SourceLink({ c }: { c: Extract<Cite, { type: 'source' }> }) {
  const day = shortDay(new Date(c.startedAt));
  return (
    <Link to="/notes/$noteId" params={{ noteId: c.noteId }} {...inNote(c.at, c.room)} {...useNotesApart()} className="src-chip" title={`Open the notes from ${c.title}, ${day}${c.room ? `, in ${c.room.name}` : ''}`}>
      <Icon name="notes" size={13} />{day}{c.room && <span>{c.room.name}</span>}{c.at !== undefined && <span className="ac-mono">{position(c.at)}</span>}
    </Link>
  );
}

/**
 * Ask about a call, or about the calls in a series. Answers stream in, with where they come from:
 * moments in this call to play, the shared screens they were read on, or the calls (and moments) to open.
 * Only the person asking sees a question or its answer, and neither is kept unless they keep it (`onKeep`).
 */
export function AskBar({ suggestions, ask, onSeek, shown, label = 'Ask about this call', waiting = 'Reading the call', onKeep }: {
  suggestions: string[]; ask: (question: string) => AsyncIterable<AnswerPart | SeriesAnswerPart>; onSeek?: ((s: number) => void) | undefined;
  /** Shows a shared screen an answer comes from. */
  shown?: ScreenRefShown | undefined; label?: string | undefined;
  /** What it says until the first words arrive. */
  waiting?: string | undefined;
  /** Keeps an answer in your own notes. */
  onKeep?: ((a: Answer) => Promise<unknown>) | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const suggs = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [over, setOver] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [text, setText] = useState('');
  const [keptFor, setKeptFor] = useState<string | null>(null);
  const { answer, ask: start, reset } = useAnswer(ask);
  /*
   * The bar stays in view while the note is read; its suggestions show at the end of the note, while the pointer is over
   * the bar, or while asking, so nothing covers the note as it's read. They go a moment after the pointer leaves, so it
   * can cross to them; a finger or the keyboard gets them on focus. The end is marked just above the bar, so the
   * suggestions appearing (below the mark) can't push it out of view again.
   */
  const pointIn = (e: PointerEvent<HTMLElement>) => { if (e.pointerType === 'touch') return; clearTimeout(leaving.current); setOver(true); };
  const pointOut = (e: PointerEvent<HTMLElement>) => { if (e.pointerType === 'touch') return; clearTimeout(leaving.current); leaving.current = setTimeout(() => setOver(false), 240); };
  useEffect(() => () => clearTimeout(leaving.current), []);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => setAtEnd(!!e?.isIntersecting));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  /*
   * The suggestions sit above the bar, over the end of the note, and can wrap to several rows. Their height (and the gap
   * above the bar) is handed to the page as --nd-chips, which the end of the note pads by, so the last lines can always
   * scroll clear. They're laid out even when out of sight, so the room doesn't change as they appear. The answer isn't
   * counted: it's dismissed, and it's tall.
   */
  const room = suggestions.length > 0;
  useEffect(() => {
    const el = suggs.current;
    const page = el?.closest('.nd');
    if (!el || !(page instanceof HTMLElement)) return;
    const measure = (target: Element) => {
      if (target instanceof HTMLElement && target.offsetHeight > 0) page.style.setProperty('--nd-chips', `${target.offsetHeight + 8}px`);
    };
    measure(el);
    const watch = new ResizeObserver((entries) => { for (const entry of entries) measure(entry.target); });
    watch.observe(el);
    return () => { watch.disconnect(); page.style.removeProperty('--nd-chips'); };
  }, [room]);
  // The bar is in view wherever the page is, so going to it never moves the page.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (withMod(e) && e.key.toLowerCase() === 'j') { e.preventDefault(); input.current?.focus({ preventScroll: true }); } };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
  const run = (question: string) => {
    if (!question.trim()) return;
    setText('');
    input.current?.blur();
    void start(question);
  };
  return (
    <>
      <div ref={end} className="nd-end-mark" aria-hidden="true" />
      <div className="nd-askdock" onPointerEnter={pointIn} onPointerLeave={pointOut}>
        <div className="nd-up">
          {answer && (
            <AnswerView answer={answer} waiting={waiting} onClose={() => { reset(); input.current?.focus({ preventScroll: true }); }} className="nd-ans">
              {(answer.cites.length > 0 || (onKeep && answer.done && answer.text)) && (
                <div className="nd-ans-f">
                  {answer.cites.map((c) => (c.type === 'cite' ? <Moment key={citeKey(c)} at={c.at} onSeek={onSeek} />
                    : c.type === 'screen' ? <Fragment key={citeKey(c)}>{shown?.({ id: c.id, sure: true, ...(c.region === undefined ? {} : { region: c.region }) })}</Fragment>
                      : <SourceLink key={citeKey(c)} c={c} />))}
                  {onKeep && answer.done && answer.text && <KeepAnswer kept={keptFor === `${answer.q}\n${answer.text}`} onKeep={() => onKeep(answer).then(() => setKeptFor(`${answer.q}\n${answer.text}`))} />}
                </div>
              )}
            </AnswerView>
          )}
          {room && (
            <div ref={suggs} className={cn('nd-suggs', !answer && (atEnd || focus || over) && 'is-on')} hidden={!!answer}>
              {suggestions.slice(0, 3).map((s) => <button key={s} type="button" className="nd-sugg" onMouseDown={(e) => e.preventDefault()} onClick={() => run(s)}>{s}</button>)}
            </div>
          )}
        </div>
        <div className="nd-ask">
          <Icon name="ask" size={18} />
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(text); }} placeholder={label} autoComplete="off" aria-label={`${label}, for you alone`} aria-keyshortcuts={ariaShortcut('J')} />
          <span className="nd-only"><Icon name="lock" size={13} />Only you</span>
          <IconButton icon="arrowUp" label="Ask" className="nd-ask-go" onClick={() => run(text)} />
        </div>
      </div>
    </>
  );
}

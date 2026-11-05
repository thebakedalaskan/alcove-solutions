/* The pieces of a note page, shared by real notes and the example. */
import {
  isAssignee, isBy, mayAssign, mayChangeAction, mayDecide, mayDispute, mayRewordDecision, proposerOf,
  type ActionItem, type ActionPatch, type AnswerPart, type CaptureGap, type Chapter, type Decision, type DecisionPatch, type NoteAction, type NoteDecision, type NoteQuestion, type NoteReader, type Person, type RoomRef,
  type Question, type QuestionPatch, type Recipient, type ScreenMoment, type ScreenRef, type SeriesAnswerPart, type Speaker, type TranscriptLine
} from '@alcove/api';
import { Avatar, Button, CaptureGapMark, Card, Check, Faces, Icon, IconButton, Popover, Scope, SealedBadge, TimeChip, UnsureKey, buttonClass, cn } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { Fragment, createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { KeepAnswer } from '~/features/personal/parts';
import { gapLabel, gapsAfter, gapsBefore } from '~/lib/capture';
import { ariaShortcut, withMod } from '~/lib/keys';
import { sameEmail, spokenName } from '~/lib/people';
import { position, shortDay } from '~/lib/time';
import { AnswerView, useAnswer, type Answer, type Cite } from './answer';
import { Backing, ChangeList, EvidenceFlags, History, byName, notTheirs } from './entries';
import { LineRow, type Correcting, type FromLine, type LineMarks } from './lines';
import { peopleLine, roleLine } from './meta';
import { capital } from '~/lib/words';

/**
 * A note's head: chips for its state, its series and how you got it; the title; when and who, you first; and
 * (`proof`) where it was written, with what was checked about the models that wrote it.
 */
export function DocHead({ title, when, people, me, chips, proof }: { title: string; when: string; people: Person[]; me: string | undefined; chips?: ReactNode; proof?: ReactNode }) {
  return (
    <>
      {chips && <div className="lead-chips">{chips}</div>}
      <h1>{title}</h1>
      <div className="doc-meta"><span className="ac-mono">{when}</span><span className="who"><Faces people={people} size={26} /><span>{peopleLine(people, me)}</span></span></div>
      {proof && <div className="doc-proof">{proof}</div>}
    </>
  );
}

export function Section({ title, count, children, className, style }: { title: string; count?: ReactNode; children: ReactNode; className?: string | undefined; style?: CSSProperties | undefined }) {
  return (
    <section className={cn('sec', className)} style={style}>
      <div className="sec-h"><h3>{title}</h3>{count !== undefined && <small>{count}</small>}</div>
      {children}
    </section>
  );
}

/* ---------- decisions, open questions and follow-ups: what the notes heard, until people say so ---------- */

/** Shows where something was on a shared screen ("On screen" with the moment), on the note page. */
export type ScreenRefShown = (screen: ScreenRef) => ReactNode;

const STATE_WORD: Record<Decision['state'], string> = { proposed: 'Proposed', confirmed: 'Confirmed', rejected: 'Not decided', superseded: 'No longer holds' };

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
const lastMove = (d: Decision) => d.changes.findLast((c) => c.what !== 'reworded' && c.what !== 'disputed' && c.what !== 'undisputed');

/** Beside the word for where a decision stands: who put it there, so the row doesn't say the state twice. */
function decisionBy(d: Decision, me: string | undefined, reader: NoteReader | undefined): string {
  const last = lastMove(d);
  if (d.state === 'confirmed' && last) return `By ${byName(last.by, me)}`;
  if ((d.state === 'rejected' || d.state === 'superseded') && last) return `${capital(byName(last.by, me))} said so`;
  const words = wordsBy(d);
  // Whoever wrote these words isn't offered Confirm, so the row says why.
  if (reader && words && isBy(words, reader) && !mayDecide(d, 'confirmed', reader)) return 'Reworded by you. Someone else has to confirm it';
  if (last?.what === 'reopened') return `${capital(byName(last.by, me))} reopened this. Nobody has confirmed it since`;
  if (words) return `Reworded by ${byName(words, me)}. Nobody has confirmed it yet`;
  const proposer = proposerOf(d);
  return `By ${proposer ? byName(proposer, me) : 'the notes'}. Nobody has confirmed it yet`;
}

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

/** What someone can do with a decision, as `grants.ts` says: only what will work is offered. */
function DecisionActions({ d, reader, onChange, onReword, editing }: { d: Decision; reader: NoteReader; onChange: (d: Decision, patch: DecisionPatch) => void; onReword: () => void; editing: boolean }) {
  const may = (to: Decision['state']) => mayDecide(d, to, reader);
  // Agreeing says what was read, so what changed meanwhile isn't agreed to.
  const confirm = () => onChange(d, { state: 'confirmed', seen: { text: d.text } });
  const no = d.state === 'proposed' || d.state === 'confirmed' ? notDecided(d, reader) : undefined;
  const mine = d.disputes.some((x) => isBy(x.by, reader));
  return (
    <>
      {(d.state === 'proposed' || d.state === 'rejected') && may('confirmed') && <button type="button" className="lk" onClick={confirm}>Confirm</button>}
      {d.state === 'confirmed' && reader.role === 'organizer' && d.disputes.length > 0 && <button type="button" className="lk" onClick={confirm}>Keep it confirmed</button>}
      {mine ? <button type="button" className="lk quiet" onClick={() => onChange(d, { dispute: false })}>Take that back</button>
        : no && <button type="button" className={cn('lk', d.state === 'confirmed' && 'quiet')} onClick={() => onChange(d, no)}>It wasn’t decided</button>}
      {d.state === 'confirmed' && may('superseded') && <button type="button" className="lk" onClick={() => onChange(d, { state: 'superseded' })}>It no longer holds</button>}
      {d.state === 'superseded' && may('confirmed') && <button type="button" className="lk" onClick={confirm}>It still holds</button>}
      {(d.state === 'confirmed' || d.state === 'rejected') && may('proposed') && <button type="button" className="lk quiet" onClick={() => onChange(d, { state: 'proposed' })}>{d.state === 'confirmed' ? 'Undo' : 'Reopen'}</button>}
      {!editing && mayRewordDecision(d, reader) && <button type="button" className="lk quiet" onClick={onReword}>Reword</button>}
    </>
  );
}

/** The time of something in a note: plays from it when the note's audio can. */
const timeOf = (onSeek: ((s: number) => void) | undefined) => (at: number) => <TimeChip seconds={at} onSeek={onSeek} />;

function DecisionRow({ d, n, me, reader, onChange, onSeek, shown }: { d: NoteDecision; n: number; me: string | undefined; reader?: NoteReader | undefined; onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined; onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.text);
  useEffect(() => { if (!editing) setText(d.text); }, [d.text, editing]);
  const save = () => { const t = text.trim(); setEditing(false); if (t && t !== d.text) onChange?.(d, { text: t }); };
  return (
    <div className={cn('dec', d.state)}>
      <span className="n">{String(n).padStart(2, '0')}</span>
      <div className="dec-b">
        {editing
          ? <input className="inline-edit" autoFocus value={text} maxLength={300} aria-label="Reword this decision" onChange={(e) => setText(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(d.text); setEditing(false); } }} />
          : <span className="t">{d.text}</span>}
        {editing && reader?.role !== 'organizer' && <span className="dec-hint">Someone else has to confirm new words.</span>}
        {editing && reader?.role === 'organizer' && d.state === 'confirmed' && <span className="dec-hint">New words need confirming again.</span>}
        <div className="dec-s">
          <span className="dec-state">{d.state === 'confirmed' && <Icon name="check" size={13} />}{STATE_WORD[d.state]}</span>
          <span>{decisionBy(d, me, reader)}</span>
          {d.screen && shown?.(d.screen)}
          <Backing evidence={d.evidence} me={me} moment={timeOf(onSeek)} shown={shown} />
          <EvidenceFlags evidence={d.evidence} disputes={d.disputes} me={me} />
        </div>
        {(onChange || d.changes.length > 0) && (
          <div className="dec-a">
            {onChange && reader && <DecisionActions d={d} reader={reader} onChange={onChange} onReword={() => setEditing(true)} editing={editing} />}
            <History changes={d.changes} me={me} what="decision" />
          </div>
        )}
      </div>
      {d.at !== undefined ? <TimeChip seconds={d.at} onSeek={onSeek} /> : <span />}
    </div>
  );
}

/** What the call settled, and what people proposed. Each stays proposed until the organizer or someone invited confirms it. */
export function Decisions({ items, me, reader, onChange, onSeek, shown }: {
  items: NoteDecision[]; me: string | undefined; reader?: NoteReader | undefined; onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined; onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined;
}) {
  return <>{items.map((d, i) => <DecisionRow key={d.id} d={d} n={i + 1} me={me} reader={reader} onChange={onChange} onSeek={onSeek} shown={shown} />)}</>;
}

/** Where an open question stands, in a sentence: still open, reopened by someone, or answered. */
export function questionLine(x: Question, me: string | undefined): string {
  const last = x.changes.findLast((c) => c.what !== 'reworded');
  if (x.state === 'answered') return last ? `${capital(byName(last.by, me))} said this was answered` : 'Answered';
  return last?.what === 'reopened' ? `Reopened by ${byName(last.by, me)}` : 'Not answered yet';
}

function QuestionRow({ x, n, me, onChange, onSeek, shown }: { x: NoteQuestion; n: number; me: string | undefined; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined; onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(x.text);
  useEffect(() => { if (!editing) setText(x.text); }, [x.text, editing]);
  const save = () => { const t = text.trim(); setEditing(false); if (t && t !== x.text) onChange?.(x, { text: t }); };
  return (
    <div className={cn('dec', 'ques', x.state)}>
      <span className="n">{String(n).padStart(2, '0')}</span>
      <div className="dec-b">
        {editing
          ? <input className="inline-edit" autoFocus value={text} maxLength={300} aria-label="Reword this question" onChange={(e) => setText(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(x.text); setEditing(false); } }} />
          : <span className="t">{x.text}</span>}
        <div className="dec-s">
          {x.state === 'answered' && <Icon name="check" size={14} />}
          <span>{questionLine(x, me)}</span>
          {x.screen && shown?.(x.screen)}
          <Backing evidence={x.evidence} me={me} moment={timeOf(onSeek)} shown={shown} />
          <EvidenceFlags evidence={x.evidence} me={me} />
        </div>
        {(onChange || x.changes.length > 0) && (
          <div className="dec-a">
            {onChange && (
              <>
                <button type="button" className="lk" onClick={() => onChange(x, { state: x.state === 'open' ? 'answered' : 'open' })}>{x.state === 'open' ? 'It was answered' : 'Reopen'}</button>
                {!editing && <button type="button" className="lk quiet" onClick={() => setEditing(true)}>Reword</button>}
              </>
            )}
            <History changes={x.changes} me={me} what="question" />
          </div>
        )}
      </div>
      {x.at !== undefined ? <TimeChip seconds={x.at} onSeek={onSeek} /> : <span />}
    </div>
  );
}

/** What the call asked and didn't settle. Each stays open until someone who has the notes says it was answered. */
export function Questions({ items, me, onChange, onSeek, shown }: {
  items: NoteQuestion[]; me: string | undefined; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined; onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined;
}) {
  return <>{items.map((x, i) => <QuestionRow key={x.id} x={x} n={i + 1} me={me} onChange={onChange} onSeek={onSeek} shown={shown} />)}</>;
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

function ActionMenu({ a, me, reader, people, onChange }: { a: NoteAction; me: string | undefined; reader: NoteReader; people: Person[]; onChange: (a: ActionItem, patch: ActionPatch) => void }) {
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(a.due ?? '');
  const [text, setText] = useState(a.text);
  useEffect(() => { if (open) { setDue(a.due ?? ''); setText(a.text); } }, [open, a.due, a.text]);
  const apply = (patch: ActionPatch) => { setOpen(false); onChange(a, patch); };
  const owner = a.owner?.person?.email;
  // Giving it to yourself is taking it on, so it says what was read.
  const seen = { text: a.text, due: a.due ?? null };
  const assign = mayAssign(a, reader);
  const change = mayChangeAction(a, reader);
  // The organizer changing what someone took on asks them again, so it says so first.
  const asks = a.takenOn && !isAssignee(a, reader) && a.owner ? `${spokenName(a.owner, me)} will be asked to take it on again.` : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" label="Change this follow-up" className="act-pop"
      anchor={<IconButton icon="more" label="Change this follow-up" size={16} className="act-more" />}>
      {assign ? (
        <>
          <div className="ac-pop-h">Who it’s for</div>
          {people.map((p) => {
            const on = !!owner && sameEmail(p, { email: owner });
            return (
              <button key={p.email} type="button" className={cn('ac-pop-item', on && 'sel')} onClick={() => apply({ owner: p.email, seen })}>
                <Avatar person={p} size={22} />
                <span><b>{p.name}{me && sameEmail(p, { email: me }) ? ' (you)' : ''}</b>{on && <small>{a.takenOn ? 'Took it on' : 'Hasn’t taken it on yet'}</small>}</span>
              </button>
            );
          })}
          {a.owner && <button type="button" className="ac-pop-item" onClick={() => apply({ owner: null })}><Icon name="x" size={18} /><span><b>{isAssignee(a, reader) ? 'Not mine' : 'Nobody yet'}</b></span></button>}
        </>
      ) : <p className="act-note">{a.owner ? `Only the organizer or ${spokenName(a.owner, me)} can say who this is for.` : 'Only the organizer can say who this is for.'}</p>}
      {change && (
        <>
          <div className="ac-pop-sep" />
          <form className="act-field" onSubmit={(e) => { e.preventDefault(); apply({ due: due.trim() || null }); }}>
            <label htmlFor={`due-${a.id}`}>Due</label>
            <input id={`due-${a.id}`} className="ac-input" value={due} maxLength={40} placeholder="Wednesday, end of March…" autoComplete="off" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDue(e.target.value)} />
            <Button type="submit" variant="secondary" size="sm">Save</Button>
          </form>
          <form className="act-field" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) apply({ text: t }); }}>
            <label htmlFor={`txt-${a.id}`}>Wording</label>
            <input id={`txt-${a.id}`} className="ac-input" value={text} maxLength={300} autoComplete="off" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" variant="secondary" size="sm">Save</Button>
          </form>
          {asks && <p className="act-note">{asks}</p>}
        </>
      )}
      {a.changes.length > 0 && (
        <>
          <div className="ac-pop-sep" />
          <div className="ac-pop-h">History</div>
          <ChangeList changes={a.changes} me={me} />
        </>
      )}
    </Popover>
  );
}

/**
 * What people said they'd do. Who it's for and when it's due are only suggestions until that person says they'll do it,
 * which nobody can do for them; "Not mine" hands it back. Once they have, it's theirs and the organizer's to change.
 */
export function FollowUps({ actions, me, reader, people = [], onToggle, onChange, onSeek, shown }: {
  actions: NoteAction[]; me: string | undefined; reader?: NoteReader | undefined; people?: Person[] | undefined;
  onToggle?: ((a: ActionItem, done: boolean) => void) | undefined; onChange?: ((a: ActionItem, patch: ActionPatch) => void) | undefined;
  onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined;
}) {
  return (
    <>
      {actions.map((a) => {
        const mine = !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });
        return (
          <div key={a.id} className={cn('act', a.done && 'done')}>
            <Check checked={a.done} disabled={!!reader && !mayChangeAction(a, reader)} onChange={(on) => onToggle?.(a, on)} label={`Mark done: ${a.text}`} />
            <div className="act-b">
              <span className="t">{a.text}</span>
              <span className="act-s">
                <span>{actionLine(a, me)}</span>
                {a.screen && shown?.(a.screen)}
                <Backing evidence={a.evidence} me={me} moment={timeOf(onSeek)} shown={shown} />
                <EvidenceFlags evidence={a.evidence} me={me} />
              </span>
            </div>
            <span className="act-who">
              {a.owner && (
                <span className={cn('ac-owner', !a.takenOn && 'maybe')} title={a.takenOn ? 'Took it on' : 'Suggested. Hasn’t taken it on yet'}>
                  <Avatar person={a.owner.person ?? { name: a.owner.name }} size={22} />{spokenName(a.owner, me)}
                </span>
              )}
              {mine && !a.takenOn && onChange && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onChange(a, { takeOn: true, seen: { text: a.text, due: a.due ?? null } })}>I’ll do it</Button>
                  <button type="button" className="lk quiet" onClick={() => onChange(a, { owner: null })}>Not mine</button>
                </>
              )}
            </span>
            <span className={cn('due', !a.takenOn && 'maybe')} title={a.due && !a.takenOn ? 'Suggested. Nobody has agreed to this date yet' : undefined}>{a.due ?? ''}</span>
            {onChange && reader ? <ActionMenu a={a} me={me} reader={reader} people={people} onChange={onChange} /> : <span />}
          </div>
        );
      })}
    </>
  );
}

/** Lines a written note shows before its whole transcript is opened. */
const FIRST_LINES = 3;

/**
 * The transcript of a written note: its first lines under the summary, and all of it on request; all of it at
 * `focus` when a link brought someone to a moment in it. Pauses and shared screens after the lines shown wait too.
 * With `correct`, whoever may corrects lines in place (lines.tsx); with `marks`, they bookmark lines for themselves.
 */
export function Transcript({ lines, gaps, seconds, me, onSeek, focus, screens, correct, fromLine, marks }: {
  lines: TranscriptLine[]; gaps: CaptureGap[]; seconds: number; me: string | undefined; onSeek?: ((s: number) => void) | undefined; focus?: number | undefined;
  screens?: ScreensShown | undefined; correct?: Correcting | undefined; fromLine?: FromLine | undefined; marks?: LineMarks | undefined;
}) {
  const [open, setOpen] = useState(focus !== undefined);
  useEffect(() => { if (focus !== undefined) setOpen(true); }, [focus]);
  const all = open || lines.length <= FIRST_LINES;
  const shown = all ? lines : lines.slice(0, FIRST_LINES);
  const last = shown.at(-1)?.at ?? 0;
  const upTo = <T extends { at: number }>(xs: T[]) => (all ? xs : xs.filter((x) => x.at <= last));
  return (
    <>
      <TranscriptLines lines={shown} gaps={upTo(gaps)} me={me} onSeek={onSeek} focus={focus} screens={screens && { ...screens, moments: upTo(screens.moments) }} correct={correct} fromLine={fromLine} marks={marks} />
      {lines.length > FIRST_LINES && (
        <div className="tr-more">
          <button type="button" className={cn(buttonClass({ size: 'sm' }), 'tr-toggle')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : `Show all ${Math.max(1, Math.round(seconds / 60))} minutes`}<Icon name="down" size={16} />
          </button>
        </div>
      )}
    </>
  );
}

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
 * What was said, line by line, with the stretches nothing was captured in marked where they fall, what was on a
 * shared screen just before the lines said while it was up, and what the transcript isn't sure of dotted and explained
 * at the top. A speaker's lines in a row share one name; a room recording names nobody. With `focus`, the line said at
 * that moment is marked, and is where a moment's link lands. With `correct`, whoever may corrects lines in place
 * (lines.tsx). With `marks`, they bookmark lines for themselves.
 */
export function TranscriptLines({ lines, gaps = [], me, onSeek, focus, screens, correct, fromLine, marks, className }: {
  lines: TranscriptLine[]; gaps?: CaptureGap[] | undefined; me: string | undefined; onSeek?: ((s: number) => void) | undefined; focus?: number | undefined;
  screens?: ScreensShown | undefined; correct?: Correcting | undefined; fromLine?: FromLine | undefined; marks?: LineMarks | undefined; className?: string | undefined;
}) {
  const here = focus === undefined ? -1 : Math.max(0, lines.findLastIndex((l) => l.at <= focus + 0.5));
  const gap = (g: CaptureGap) => <CaptureGapMark key={`${g.kind}-${g.from}`} label={gapLabel(g)} />;
  const moments = screens?.moments ?? [];
  const shown = (m: ScreenMoment) => <Fragment key={m.id}>{screens?.row(m)}</Fragment>;
  return (
    <div className={cn('tr', className)}>
      <UnsureKey words={lines.some((l) => l.unsure?.words)} speaker={lines.some((l) => l.unsure?.speaker)} className="tr-key" />
      {lines.map((l, i) => {
        const time = <TimeChip seconds={l.at} onSeek={onSeek} />;
        const mark = i === here ? { id: MOMENT, className: 'here' } : {};
        const before = gapsBefore(gaps, lines, i);
        const up = gapsBefore(moments, lines, i);
        // After a gap, or a screen, the speaker is named again: it's a new part of the call.
        const more = !!l.speaker && voiceOf(lines[i - 1]?.speaker) === voiceOf(l.speaker) && i !== here && !before.length && !up.length;
        return <Fragment key={l.id}>{before.map(gap)}{up.map(shown)}<LineRow line={l} more={more} mark={mark} time={time} me={me} correct={correct} fromLine={fromLine} marks={marks} /></Fragment>;
      })}
      {gapsAfter(gaps, lines).map(gap)}
      {gapsAfter(moments, lines).map(shown)}
    </div>
  );
}

/** A moment in a call's notes, as a link: they open with the transcript at that line, and the audio waiting there. In a breakout room's section, that room's. */
export function MomentLink({ noteId, at, room }: { noteId: string; at: number; room?: RoomRef | undefined }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId }} {...atMoment(at, room)} {...useNotesApart()} className="ac-time-chip" title={`Open the notes at ${position(at)}${room ? `, in ${room.name}` : ''}`}>
      {position(at)}
    </Link>
  );
}

/** The chapters of a call, with the stretches nothing was captured in between them, where they fell. */
export function Chapters({ chapters, gaps = [], pos, onSeek }: { chapters: Chapter[]; gaps?: CaptureGap[] | undefined; pos: number; onSeek?: ((s: number) => void) | undefined }) {
  const current = chapters.findLastIndex((c) => c.at <= pos);
  const gap = (g: CaptureGap) => <CaptureGapMark key={`${g.kind}-${g.from}`} label={gapLabel(g)} className="chap-gap" />;
  return (
    <Card title="Chapters" aside={<span className="ac-mono">{chapters.length}</span>}>
      <div className="chaps">
        {chapters.map((c, i) => (
          <Fragment key={`${c.at}-${c.title}`}>
            {gapsBefore(gaps, chapters, i).map(gap)}
            <button type="button" className={cn('chap', i === Math.max(0, current) && 'on')} onClick={() => onSeek?.(c.at)} disabled={!onSeek}>
              <span className="ac-mono">{position(c.at)}</span><span><b>{c.title}</b><small>{c.summary}</small></span>
            </button>
          </Fragment>
        ))}
        {gapsAfter(gaps, chapters).map(gap)}
      </div>
    </Card>
  );
}

const COUNTED = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** Who can open a note: "Only these five can open them. Alcove can’t." */
const onlyThese = (n: number) => (n <= 1 ? 'Only you can open them. Alcove can’t.' : `Only these ${COUNTED[n] ?? n} can open them. Alcove can’t.`);
/* A long list shows its first people until it's opened; the people a share just reached show in it either way. */
const FIRST_PEOPLE = 8;

/** Who has a note, and how each of them got it: organizer, invited, or shared afterwards by whom (and with which group). */
export function Recipients({ recipients, me, fresh }: { recipients: Recipient[]; me: string | undefined; fresh?: ReadonlySet<string> | undefined }) {
  const [all, setAll] = useState(false);
  const long = recipients.length > FIRST_PEOPLE + 2;
  const shown = !long || all ? recipients : recipients.filter((r, i) => i < FIRST_PEOPLE || fresh?.has(r.person.email));
  return (
    <Card title="Who has these notes" aside={<span className="ac-mono">{recipients.length}</span>}>
      <div className="rcpt">
        {shown.map((r) => (
          <div key={r.person.email} className={cn('rc', fresh?.has(r.person.email) && 'fresh')}>
            <Avatar person={r.person} size={30} />
            <span className="min-w-0"><b>{r.person.name}{me && sameEmail(r.person, { email: me }) ? <i> (you)</i> : null}</b><small>{roleLine(r, me)}</small></span>
          </div>
        ))}
      </div>
      {long && <button type="button" className="lk quiet rcpt-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${recipients.length}`}</button>}
      <div className="seal"><SealedBadge inline title={onlyThese(recipients.length)} /></div>
    </Card>
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
export function AskBar({ suggestions, ask, onSeek, shown, label = 'Ask about this call', onKeep }: {
  suggestions: string[]; ask: (question: string) => AsyncIterable<AnswerPart | SeriesAnswerPart>; onSeek?: ((s: number) => void) | undefined;
  /** Shows a shared screen an answer comes from. */
  shown?: ScreenRefShown | undefined; label?: string | undefined;
  /** Keeps an answer in your own notes. */
  onKeep?: ((a: Answer) => Promise<unknown>) | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [text, setText] = useState('');
  const [keptFor, setKeptFor] = useState<string | null>(null);
  const { answer, ask: start } = useAnswer(ask);
  /*
   * The bar stays in view while the note is read; its suggestions show at the end of the note, or while asking. The
   * end is marked just above the bar, so the suggestions appearing (below the mark) can't push it out of view again.
   */
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(([e]) => setAtEnd(!!e?.isIntersecting));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (withMod(e) && e.key.toLowerCase() === 'j') { e.preventDefault(); input.current?.focus(); } };
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
      <div ref={end} aria-hidden="true" />
      <div className="ask">
        {answer && (
          <AnswerView answer={answer} className="ac-card">
            {answer.cites.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {answer.cites.map((c) => (c.type === 'cite' ? <TimeChip key={citeKey(c)} seconds={c.at} onSeek={onSeek} />
                  : c.type === 'screen' ? <Fragment key={citeKey(c)}>{shown?.({ id: c.id, sure: true, ...(c.region === undefined ? {} : { region: c.region }) })}</Fragment>
                    : <SourceLink key={citeKey(c)} c={c} />))}
              </div>
            )}
            {onKeep && answer.done && answer.text && <KeepAnswer kept={keptFor === `${answer.q}\n${answer.text}`} onKeep={() => onKeep(answer).then(() => setKeptFor(`${answer.q}\n${answer.text}`))} />}
          </AnswerView>
        )}
        {(atEnd || focus) && suggestions.length > 0 && (
          <div className="ask-sugg">{suggestions.slice(0, 3).map((s) => <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => run(s)}>{s}</button>)}</div>
        )}
        <div className="ask-bar">
          <Icon name="ask" size={20} />
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(text); }} placeholder={label} autoComplete="off" aria-label={`${label}, for you alone`} aria-keyshortcuts={ariaShortcut('J')} />
          <Scope>Only you</Scope>
          <Button variant="primary" size="sm" icon="send" onClick={() => run(text)}>Ask</Button>
        </div>
      </div>
    </>
  );
}

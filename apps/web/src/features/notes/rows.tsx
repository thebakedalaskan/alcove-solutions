/*
 * What the notes heard and people settled, as rows: decisions, open questions and follow-ups. Every row is built the same
 * way, so the eye reads down a list: its kind's mark (a rose diamond, hollow until someone confirms it; a blue dot for a
 * follow-up suggested to someone, a tick box once they've taken it on; a ring for a question), its words, then one line of who
 * and where it stands with the ▶ chip that plays its moment on the stage, and a menu with the rest. What the notes heard stays
 * a proposal until people say so: its line says who said what and what to be careful of, and its menu what backs it and every
 * change to it. Only what `grants.ts` lets the reader do is offered. `forYou` rows lead with what's asked of you, and the two
 * answers to it.
 */
import {
  isAcceptedFollowUp, isAssignee, isBy, mayAssign, mayChangeAction, mayDecide, mayRewordDecision, proposerOf,
  type ActionItem, type ActionPatch, type Change, type Decision, type DecisionPatch, type NoteAction, type NoteDecision, type NoteEvidence, type NoteQuestion, type NoteReader, type Person, type Question, type QuestionPatch
} from '@alcove/api';
import { Avatar, Button, Check, Icon, IconButton, Popover, cn, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sameEmail, spokenName } from '~/lib/people';
import { capital } from '~/lib/words';
import { ChangeList, EvidenceFlags, Moments, byName } from './entries';
import { Moment, actionLine, decisionLine, lastMove, notDecided, proposedLine, questionLine, type ScreenRefShown } from './parts';

/** What someone can do with a row, from its menu. */
interface Act { icon: IconName; label: string; go: () => void }

/** The menu beside a row: what can be done with it, then whatever `children` adds. */
function RowMenu({ label, acts, children }: { label: string; acts: Act[]; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" label={label} tip={label} className="cd-rowmenu"
      anchor={<IconButton icon="more" label={label} title={undefined} size={16} className="cd-more" />}>
      {acts.map((a) => <button key={a.label} type="button" className="ac-pop-item" onClick={() => { close(); a.go(); }}><Icon name={a.icon} size={18} /><span><b>{a.label}</b></span></button>)}
      {children(close)}
    </Popover>
  );
}

/** What backs a row and every change to it, in its menu, under `lead` when there's something above. */
function Backed({ evidence, changes, me, onSeek, shown, lead, close }: { evidence: NoteEvidence; changes: Change[]; me: string | undefined; onSeek: ((s: number) => void) | undefined; shown: ScreenRefShown | undefined; lead: boolean; close: () => void }) {
  const said = evidence.moments.length > 0;
  const go = onSeek && ((s: number) => { close(); onSeek(s); });
  return (
    <>
      {said && <>{lead && <div className="ac-pop-sep" />}<div className="ac-pop-h">What was said</div><Moments evidence={evidence} me={me} moment={(at) => <Moment at={at} onSeek={go} />} shown={shown} /></>}
      {changes.length > 0 && <>{(lead || said) && <div className="ac-pop-sep" />}<div className="ac-pop-h">Changes</div><ChangeList changes={changes} me={me} /></>}
    </>
  );
}

/** New words for something, in place of its words. Enter keeps them; Escape leaves it as it was. */
function Reword({ text, label, hint, onSave, onDone }: { text: string; label: string; hint?: string | undefined; onSave: (t: string) => void; onDone: () => void }) {
  const [words, setWords] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, []);
  const save = () => { const t = words.replace(/\s+/g, ' ').trim(); onDone(); if (t && t !== text) onSave(t); };
  return (
    <div className="tx">
      <textarea ref={box} className="cd-area" rows={2} value={words} maxLength={300} aria-label={label} onChange={(e) => setWords(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } }} />
      {hint && <small className="ln">{hint}</small>}
      <span className="acts"><Button variant="secondary" size="xs" onClick={save}>Save</Button><Button variant="quiet" size="xs" onClick={onDone}>Cancel</Button></span>
    </div>
  );
}

/** Who said what something rests on, as a row says it: "Priya said it", "Kofi asked". Nothing when nobody can be named. */
export function saidBy(evidence: NoteEvidence, me: string | undefined, verb = 'said it'): string | undefined {
  const line = evidence.moments.find((m) => m.kind === 'line');
  return line?.kind === 'line' && line.speaker ? `${spokenName(line.speaker, me)} ${verb}` : undefined;
}

/** Who stands behind a decision, in a few words. Whoever wrote its words isn't offered Confirm, so it says why. */
function decisionStatus(d: Decision, me: string | undefined, reader: NoteReader | undefined): string {
  if (d.state !== 'proposed') return decisionLine(d, me);
  const last = lastMove(d);
  if (last?.what === 'reopened') return `${capital(byName(last.by, me))} reopened this`;
  const words = d.changes.findLast((c) => c.what === 'reworded')?.by ?? proposerOf(d);
  return reader && words && isBy(words, reader) && !mayDecide(d, 'confirmed', reader) ? `${proposedLine(d, me)}. Someone else has to confirm it` : proposedLine(d, me);
}

interface RowProps {
  me: string | undefined;
  /** Plays the row's moment on the stage. */
  onSeek?: ((s: number) => void) | undefined;
  shown?: ScreenRefShown | undefined;
  /** A breakout room's: its talk isn't in the recording, so it has no moment to play. */
  room?: boolean | undefined;
}

/** The parts every row has: its mark, its words, one line of who and where it stands, and the menu. */
function Row({ kind, cls, mark, label, text, line, below, acts, menu }: {
  kind: 'decide' | 'follow' | 'ask'; cls?: string | undefined; mark: ReactNode; label?: ReactNode; text: string; line: ReactNode; below?: ReactNode; acts?: ReactNode; menu?: ReactNode;
}) {
  return (
    <article className={cn('cd-row', `is-${kind}`, cls)}>
      {mark}
      <div className="tx">
        {label}
        <p className="t">{text}</p>
        <small className="ln">{line}</small>
        {below}
        {acts && <span className="acts">{acts}</span>}
      </div>
      {menu}
    </article>
  );
}

/** "A · B · C", with the moment chip at the end, leaving out what's empty. */
function Line({ parts, chip }: { parts: ReactNode[]; chip?: ReactNode }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return <>{shown.map((p, i) => <span key={i} className="pt">{i > 0 && <span className="sep" aria-hidden="true">·</span>}{p}</span>)}{chip}</>;
}

export interface DecisionRowProps extends RowProps {
  d: NoteDecision;
  reader?: NoteReader | undefined;
  onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined;
  /** Waiting on you: what's asked and the two answers. `onConfirm` says it was confirmed, for the toast with Undo. */
  forYou?: { onConfirm: (d: Decision) => void; onNotDecided: (d: Decision, patch: DecisionPatch) => void } | undefined;
}

export function DecisionRow({ d, reader, onChange, me, onSeek, shown, room, forYou }: DecisionRowProps) {
  const [editing, setEditing] = useState(false);
  // Just confirmed here: taking it back is right there, not in the menu.
  const [just, setJust] = useState(false);
  const off = d.state === 'rejected' || d.state === 'superseded';
  const mark = <span className={cn('mk', 'is-dec', d.state !== 'confirmed' && 'is-hollow', off && 'is-off')} aria-hidden="true" />;
  if (editing) {
    const hint = reader?.role !== 'organizer' ? 'Someone else has to confirm new words.' : d.state === 'confirmed' ? 'New words need confirming again.' : undefined;
    return <article className="cd-row is-decide is-editing">{mark}<Reword text={d.text} label="Reword this decision" hint={hint} onSave={(text) => onChange?.(d, { text })} onDone={() => setEditing(false)} /></article>;
  }
  const may = (to: Decision['state']) => !!reader && mayDecide(d, to, reader);
  // Agreeing says what was read, so what changed meanwhile isn't agreed to.
  const confirm = () => onChange?.(d, { state: 'confirmed', seen: { text: d.text } });
  const undo = () => { setJust(false); onChange?.(d, { state: 'proposed' }); };
  const no = reader && (d.state === 'proposed' || d.state === 'confirmed') ? notDecided(d, reader) : undefined;
  const mine = !!reader && d.disputes.some((x) => isBy(x.by, reader));
  const undoHere = just && d.state === 'confirmed' && may('proposed');
  const lead = forYou ? (
    <>
      <Button variant="secondary" size="xs" onClick={() => forYou.onConfirm(d)}>{d.state === 'confirmed' ? 'Keep it confirmed' : 'Confirm'}</Button>
      {no && <Button variant="quiet" size="xs" onClick={() => forYou.onNotDecided(d, no)}>It wasn’t decided</Button>}
    </>
  ) : !onChange ? null
    : d.state === 'proposed' && may('confirmed') ? <Button variant="secondary" size="xs" onClick={() => { setJust(true); confirm(); }}>Confirm</Button>
      : d.state === 'confirmed' && reader?.role === 'organizer' && d.disputes.length > 0 ? <Button variant="secondary" size="xs" onClick={confirm}>Keep it confirmed</Button>
        : undoHere ? <Button variant="quiet" size="xs" onClick={undo}>Undo</Button>
          : d.state === 'rejected' && may('proposed') ? <Button variant="quiet" size="xs" onClick={() => onChange(d, { state: 'proposed' })}>Reopen</Button> : null;
  const acts: Act[] = !onChange || !reader ? [] : [
    ...(d.state === 'rejected' && may('confirmed') ? [{ icon: 'check', label: 'Confirm', go: confirm } satisfies Act] : []),
    ...(mine ? [{ icon: 'reset', label: 'Take that back', go: () => onChange(d, { dispute: false }) } satisfies Act] : no && !forYou ? [{ icon: 'x', label: 'It wasn’t decided', go: () => onChange(d, no) } satisfies Act] : []),
    ...(d.state === 'confirmed' && may('superseded') ? [{ icon: 'history', label: 'It no longer holds', go: () => onChange(d, { state: 'superseded' }) } satisfies Act] : []),
    ...(d.state === 'superseded' && may('confirmed') ? [{ icon: 'check', label: 'It still holds', go: confirm } satisfies Act] : []),
    ...(mayRewordDecision(d, reader) ? [{ icon: 'pen', label: 'Reword', go: () => setEditing(true) } satisfies Act] : []),
    ...(d.state === 'confirmed' && !undoHere && may('proposed') ? [{ icon: 'reset', label: 'Undo', go: undo } satisfies Act] : [])
  ];
  const settling = forYou && d.state === 'confirmed';
  return (
    <Row kind="decide" cls={cn(d.state === 'confirmed' && 'is-set', off && 'is-off')} mark={mark}
      label={forYou && <small className="kind is-rose">{settling ? 'Disputed: yours to settle' : 'Decision to confirm'}</small>}
      text={d.text}
      line={<Line parts={[forYou ? undefined : decisionStatus(d, me, reader), saidBy(d.evidence, me)]} chip={!room && <Moment at={d.at} onSeek={onSeek} />} />}
      below={(d.screen || d.evidence.flags.length > 0 || d.disputes.length > 0) && <span className="cd-flags">{d.screen && shown?.(d.screen)}<EvidenceFlags evidence={d.evidence} disputes={d.disputes} me={me} /></span>}
      acts={lead}
      menu={(acts.length > 0 || d.evidence.moments.length > 0 || d.changes.length > 0) && (
        <RowMenu label={acts.length ? 'Change this' : 'What was said'} acts={acts}>{(close) => <Backed evidence={d.evidence} changes={d.changes} me={me} onSeek={onSeek} shown={shown} lead={acts.length > 0} close={close} />}</RowMenu>
      )} />
  );
}

/** What the call settled, and what people proposed. Each stays proposed until the organizer or someone invited confirms it. */
export function Decisions({ items, reader, onChange, ...row }: { items: readonly NoteDecision[]; reader?: NoteReader | undefined; onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined } & RowProps) {
  return <>{items.map((d) => <DecisionRow key={d.id} d={d} reader={reader} onChange={onChange} {...row} />)}</>;
}

function QuestionRow({ x, onChange, me, onSeek, shown, room }: { x: NoteQuestion; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined } & RowProps) {
  const [editing, setEditing] = useState(false);
  const answered = x.state === 'answered';
  const mark = <span className={cn('mk', 'is-open', answered && 'is-answered')} aria-hidden="true" />;
  if (editing) return <article className="cd-row is-ask is-editing">{mark}<Reword text={x.text} label="Reword this question" onSave={(text) => onChange?.(x, { text })} onDone={() => setEditing(false)} /></article>;
  const acts: Act[] = onChange ? [
    answered ? { icon: 'reset', label: 'Reopen', go: () => onChange(x, { state: 'open' }) } : { icon: 'check', label: 'It was answered', go: () => onChange(x, { state: 'answered' }) },
    { icon: 'pen', label: 'Reword', go: () => setEditing(true) }
  ] : [];
  return (
    <Row kind="ask" cls={answered ? 'is-off' : undefined} mark={mark} text={x.text}
      line={<Line parts={[questionLine(x, me), saidBy(x.evidence, me, 'asked')]} chip={!room && <Moment at={x.at} onSeek={onSeek} />} />}
      below={(x.screen || x.evidence.flags.length > 0) && <span className="cd-flags">{x.screen && shown?.(x.screen)}<EvidenceFlags evidence={x.evidence} me={me} /></span>}
      menu={(acts.length > 0 || x.evidence.moments.length > 0 || x.changes.length > 0) && (
        <RowMenu label={acts.length ? 'Change this' : 'What was said'} acts={acts}>{(close) => <Backed evidence={x.evidence} changes={x.changes} me={me} onSeek={onSeek} shown={shown} lead={acts.length > 0} close={close} />}</RowMenu>
      )} />
  );
}

/** What the call asked and didn't settle. Each stays open until someone who has the notes says it was answered. */
export function Questions({ items, onChange, ...row }: { items: readonly NoteQuestion[]; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined } & RowProps) {
  return <>{items.map((x) => <QuestionRow key={x.id} x={x} onChange={onChange} {...row} />)}</>;
}

const DUES = ['Today', 'Tomorrow', 'Friday', 'Monday'];

/** When it's due: the days most things are said for, no date, or any other words. */
function DuePicker({ a, onDue }: { a: NoteAction; onDue: (due: string | null) => void }) {
  const named = !a.due || DUES.includes(a.due);
  const [other, setOther] = useState(named ? '' : a.due ?? '');
  return (
    <>
      <div className="ac-pop-h">Due</div>
      <div className="cd-dues">
        {DUES.map((t) => <button key={t} type="button" className={cn('cd-dc', a.due === t && 'is-on')} aria-pressed={a.due === t} onClick={() => onDue(t)}>{t}</button>)}
        <button type="button" className={cn('cd-dc', !a.due && 'is-on')} aria-pressed={!a.due} onClick={() => onDue(null)}>No date</button>
      </div>
      <form className="cd-due-f" onSubmit={(e) => { e.preventDefault(); const t = other.trim(); if (t) onDue(t); }}>
        <input className="ac-input" value={other} maxLength={40} placeholder="Another day" aria-label="When it’s due, in your words" autoComplete="off" onChange={(e) => setOther(e.target.value)} />
      </form>
    </>
  );
}

/** Who a follow-up is for, when it's due, and its words, as far as the grants go. */
function FollowUpMenu({ a, me, reader, people, onChange, onSeek, shown, onReword }: { a: NoteAction; me: string | undefined; reader: NoteReader; people: readonly Person[]; onChange: (a: ActionItem, patch: ActionPatch) => void; onSeek: ((s: number) => void) | undefined; shown: ScreenRefShown | undefined; onReword: () => void }) {
  const owner = a.owner?.person?.email;
  // Giving it to yourself is taking it on, so it says what was read.
  const seen = { text: a.text, due: a.due ?? null };
  const assign = mayAssign(a, reader);
  const change = mayChangeAction(a, reader);
  // The organizer changing what someone took on asks them again, so it says so first.
  const asks = a.takenOn && !isAssignee(a, reader) && a.owner ? `${spokenName(a.owner, me)} will be asked to take it on again.` : undefined;
  return (
    <RowMenu label="Change this" acts={[]}>
      {(close) => {
        const apply = (patch: ActionPatch) => { close(); onChange(a, patch); };
        return (
          <>
            {assign ? (
              <>
                <div className="ac-pop-h">Who it’s for</div>
                {people.map((p) => {
                  const on = !!owner && sameEmail(p, { email: owner });
                  return (
                    <button key={p.email} type="button" className={cn('ac-pop-item', 'cd-mp', on && 'sel')} onClick={() => apply({ owner: p.email, seen })}>
                      <Avatar person={p} size={22} />
                      <span><b>{p.name}{me && sameEmail(p, { email: me }) ? ' (you)' : ''}</b>{on && <small>{a.takenOn ? 'Took it on' : 'Hasn’t taken it on yet'}</small>}</span>
                      {on && <Icon name="check" size={16} className="cd-tick" />}
                    </button>
                  );
                })}
                {a.owner && <button type="button" className="ac-pop-item" onClick={() => apply({ owner: null })}><Icon name="x" size={18} /><span><b>{isAssignee(a, reader) ? 'Not mine' : 'Nobody yet'}</b></span></button>}
              </>
            ) : <p className="cd-pop-n">{a.owner ? `Only the organizer or ${spokenName(a.owner, me)} can say who this is for.` : 'Only the organizer can say who this is for.'}</p>}
            {change && (
              <>
                <div className="ac-pop-sep" />
                <DuePicker a={a} onDue={(due) => apply({ due })} />
                <div className="ac-pop-sep" />
                <button type="button" className="ac-pop-item" onClick={() => { close(); onReword(); }}><Icon name="pen" size={18} /><span><b>Reword</b></span></button>
                {asks && <p className="cd-pop-n">{asks}</p>}
              </>
            )}
            <Backed evidence={a.evidence} changes={a.changes} me={me} onSeek={onSeek} shown={shown} lead close={close} />
          </>
        );
      }}
    </RowMenu>
  );
}

/** Whether a follow-up has something to say beyond who it's with: what someone did to it, or that it can't be taken on here. */
const worthSaying = (a: ActionItem) => !a.done && (a.owner
  ? !a.takenOn && (!a.owner.person?.email || a.changes.some((c) => c.what === 'reassigned' || (c.what === 'reopened' && !(a.owner?.person && sameEmail(c.by, a.owner.person)))))
  : a.changes.some((c) => c.what === 'declined'));

/** Whether a follow-up is the reader's own. */
export const isMine = (a: ActionItem, me: string | undefined) => !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });

export interface FollowUpRowProps extends RowProps {
  a: NoteAction;
  reader?: NoteReader | undefined;
  people: readonly Person[];
  onToggle?: ((a: ActionItem, done: boolean) => void) | undefined;
  onChange?: ((a: ActionItem, patch: ActionPatch) => void) | undefined;
  /** Suggested for you: I'll do it and Not mine. `onTake` says you took it on, for the toast with Undo. */
  forYou?: { onTake: (a: ActionItem) => void; onNotMine: (a: ActionItem) => void } | undefined;
}

export function FollowUpRow({ a, reader, people, onToggle, onChange, me, onSeek, shown, room, forYou }: FollowUpRowProps) {
  const [editing, setEditing] = useState(false);
  const mine = isMine(a, me);
  // Suggested to someone who hasn't said yet: a dot. Taken on, or nobody's yet: a box to tick.
  const suggested = !!a.owner && !a.takenOn && !a.done;
  const mark = suggested ? <span className="mk is-sug" aria-hidden="true" />
    : <span className="mk is-box"><Check checked={a.done} disabled={!!reader && !mayChangeAction(a, reader)} onChange={(on) => onToggle?.(a, on)} label={`Mark done: ${a.text}`} /></span>;
  if (editing) return <article className="cd-row is-follow is-editing">{mark}<Reword text={a.text} label="Reword this follow-up" onSave={(text) => onChange?.(a, { text })} onDone={() => setEditing(false)} /></article>;
  const due = a.done ? undefined : a.due;
  const dueWords = due ? `due ${/^(today|tomorrow)$/i.test(due) ? due.toLowerCase() : due}` : undefined;
  const who = forYou ? undefined : mine ? <b className="is-yours">Yours</b>
    : a.owner ? <span className="who"><Avatar person={a.owner.person ?? { name: a.owner.name }} size={16} />{a.takenOn ? spokenName(a.owner, me) : `Suggested for ${spokenName(a.owner, me)}`}</span>
      : 'Nobody yet';
  const sayer = forYou ? saidBy(a.evidence, me, '')?.trim() : undefined;
  const said = forYou ? (sayer ? `Suggested from what ${sayer} said` : 'Suggested by the notes') : undefined;
  return (
    <Row kind="follow" cls={cn(a.done && 'is-done', mine && 'is-mine')} mark={mark}
      label={forYou && <small className="kind is-horizon">Follow-up for you{dueWords ? ` · ${dueWords}` : ''}</small>}
      text={a.text}
      line={<Line parts={[who, said, forYou ? undefined : dueWords]} chip={!room && <Moment at={a.at} onSeek={onSeek} />} />}
      below={<>
        {worthSaying(a) && !forYou && <small className="ln is-said">{actionLine(a, me)}</small>}
        {(a.screen || a.evidence.flags.length > 0) && <span className="cd-flags">{a.screen && shown?.(a.screen)}<EvidenceFlags evidence={a.evidence} me={me} /></span>}
      </>}
      acts={forYou ? (
        <>
          <Button variant="secondary" size="xs" onClick={() => forYou.onTake(a)}>I’ll do it</Button>
          <Button variant="quiet" size="xs" onClick={() => forYou.onNotMine(a)}>Not mine</Button>
        </>
      ) : mine && !a.takenOn && !a.done && onChange ? <Button variant="secondary" size="xs" onClick={() => onChange(a, { takeOn: true, seen: { text: a.text, due: a.due ?? null } })}>I’ll do it</Button> : undefined}
      menu={!forYou && onChange && reader && <FollowUpMenu a={a} me={me} reader={reader} people={people} onChange={onChange} onSeek={onSeek} shown={shown} onReword={() => setEditing(true)} />} />
  );
}

/**
 * What people said they'd do, yours first. Who it's for and when it's due are only suggestions until that person says they'll
 * do it, which nobody can do for them; "Not mine" hands it back. Once they have, it's theirs and the organizer's to change.
 */
export function FollowUps({ actions, reader, people = [], onToggle, onChange, me, ...row }: {
  actions: readonly NoteAction[]; reader?: NoteReader | undefined; people?: readonly Person[] | undefined;
  onToggle?: ((a: ActionItem, done: boolean) => void) | undefined; onChange?: ((a: ActionItem, patch: ActionPatch) => void) | undefined;
} & RowProps) {
  const accepted = actions.filter(isAcceptedFollowUp);
  const sorted = [...accepted.filter((a) => isMine(a, me)), ...accepted.filter((a) => !isMine(a, me))];
  return <>{sorted.map((a) => <FollowUpRow key={a.id} a={a} reader={reader} people={people} onToggle={onToggle} onChange={onChange} me={me} {...row} />)}</>;
}

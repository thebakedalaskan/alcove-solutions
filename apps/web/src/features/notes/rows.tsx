/*
 * What the notes heard and people settled, as rows: decisions, open questions and follow-ups. Every row keeps the same
 * columns, so things line up: what kind it is, the words, the moment it was said, what's waiting on you, and a menu with
 * the rest. What the notes heard stays a proposal until people say so: its row says who said what and what to be careful
 * of, and its menu what backs it and every change to it. Only what `grants.ts` lets the reader do is offered.
 */
import {
  isAcceptedFollowUp, isAssignee, isBy, mayAssign, mayChangeAction, mayDecide, mayRewordDecision, proposerOf,
  type ActionItem, type ActionPatch, type Change, type Decision, type DecisionPatch, type NoteAction, type NoteDecision, type NoteEvidence, type NoteQuestion, type NoteReader, type Person, type Question, type QuestionPatch
} from '@alcove/api';
import { Avatar, Check, Icon, IconButton, Popover, cn, type IconName } from '@alcove/ui';
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
    <Popover open={open} onOpenChange={setOpen} align="end" label={label} tip={label} className="nd-rowmenu"
      anchor={<IconButton icon="more" label={label} title={undefined} size={16} className="nd-more" />}>
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
    <>
      <div className="nd-rb">
        <textarea ref={box} className="nd-area" rows={2} value={words} maxLength={300} aria-label={label} onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); } }} />
        {hint && <p className="nd-rs">{hint}</p>}
      </div>
      <div className="nd-ra"><button type="button" className="nd-yes" onClick={save}>Save</button><button type="button" className="nd-act" onClick={onDone}>Cancel</button></div>
    </>
  );
}

/** Who stands behind a decision, in a few words. Whoever wrote its words isn't offered Confirm, so it says why. */
function decisionStatus(d: Decision, me: string | undefined, reader: NoteReader | undefined): string {
  if (d.state !== 'proposed') return decisionLine(d, me);
  const last = lastMove(d);
  if (last?.what === 'reopened') return `${capital(byName(last.by, me))} reopened this`;
  const words = d.changes.findLast((c) => c.what === 'reworded')?.by ?? proposerOf(d);
  return reader && words && isBy(words, reader) && !mayDecide(d, 'confirmed', reader) ? `${proposedLine(d, me)}. Someone else has to confirm it` : proposedLine(d, me);
}

interface RowProps { me: string | undefined; onSeek?: ((s: number) => void) | undefined; shown?: ScreenRefShown | undefined; room?: boolean | undefined }

function DecisionRow({ d, reader, onChange, me, onSeek, shown, room }: { d: NoteDecision; reader?: NoteReader | undefined; onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined } & RowProps) {
  const [editing, setEditing] = useState(false);
  // Just confirmed here: taking it back is right there, not in the menu.
  const [just, setJust] = useState(false);
  const tile = <span className="nd-kind"><Icon name="badgeCheck" size={16} /></span>;
  const cls = cn('nd-r', 'is-decide', room && 'is-room', d.state === 'confirmed' && 'is-set', (d.state === 'rejected' || d.state === 'superseded') && 'is-off', editing && 'is-editing');
  if (editing) {
    const hint = reader?.role !== 'organizer' ? 'Someone else has to confirm new words.' : d.state === 'confirmed' ? 'New words need confirming again.' : undefined;
    return <article className={cls}>{tile}<Reword text={d.text} label="Reword this decision" hint={hint} onSave={(text) => onChange?.(d, { text })} onDone={() => setEditing(false)} /></article>;
  }
  const may = (to: Decision['state']) => !!reader && mayDecide(d, to, reader);
  // Agreeing says what was read, so what changed meanwhile isn't agreed to.
  const confirm = () => onChange?.(d, { state: 'confirmed', seen: { text: d.text } });
  const undo = () => { setJust(false); onChange?.(d, { state: 'proposed' }); };
  const no = reader && (d.state === 'proposed' || d.state === 'confirmed') ? notDecided(d, reader) : undefined;
  const mine = !!reader && d.disputes.some((x) => isBy(x.by, reader));
  const undoHere = just && d.state === 'confirmed' && may('proposed');
  const lead = !onChange ? null
    : d.state === 'proposed' && may('confirmed') ? <button type="button" className="nd-yes" onClick={() => { setJust(true); confirm(); }}>Confirm</button>
      : d.state === 'confirmed' && reader?.role === 'organizer' && d.disputes.length > 0 ? <button type="button" className="nd-yes" onClick={confirm}>Keep it confirmed</button>
        : undoHere ? <button type="button" className="nd-act" onClick={undo}>Undo</button>
          : d.state === 'rejected' && may('proposed') ? <button type="button" className="nd-act" onClick={() => onChange(d, { state: 'proposed' })}>Reopen</button> : null;
  const acts: Act[] = !onChange || !reader ? [] : [
    ...(d.state === 'rejected' && may('confirmed') ? [{ icon: 'check', label: 'Confirm', go: confirm } satisfies Act] : []),
    ...(mine ? [{ icon: 'reset', label: 'Take that back', go: () => onChange(d, { dispute: false }) } satisfies Act] : no ? [{ icon: 'x', label: 'It wasn’t decided', go: () => onChange(d, no) } satisfies Act] : []),
    ...(d.state === 'confirmed' && may('superseded') ? [{ icon: 'history', label: 'It no longer holds', go: () => onChange(d, { state: 'superseded' }) } satisfies Act] : []),
    ...(d.state === 'superseded' && may('confirmed') ? [{ icon: 'check', label: 'It still holds', go: confirm } satisfies Act] : []),
    ...(mayRewordDecision(d, reader) ? [{ icon: 'pen', label: 'Reword', go: () => setEditing(true) } satisfies Act] : []),
    ...(d.state === 'confirmed' && !undoHere && may('proposed') ? [{ icon: 'reset', label: 'Undo', go: undo } satisfies Act] : [])
  ];
  return (
    <article className={cls}>
      {tile}
      <div className="nd-rb">
        <p className="nd-rt">{d.text}</p>
        <p className="nd-rs">{decisionStatus(d, me, reader)}</p>
        <div className="nd-rf">{d.screen && shown?.(d.screen)}<EvidenceFlags evidence={d.evidence} disputes={d.disputes} me={me} /></div>
      </div>
      {!room && <Moment at={d.at} onSeek={onSeek} />}
      <div className="nd-ra">{lead}</div>
      {(acts.length > 0 || d.evidence.moments.length > 0 || d.changes.length > 0) && (
        <RowMenu label={acts.length ? 'Change this' : 'What was said'} acts={acts}>{(close) => <Backed evidence={d.evidence} changes={d.changes} me={me} onSeek={onSeek} shown={shown} lead={acts.length > 0} close={close} />}</RowMenu>
      )}
    </article>
  );
}

/** What the call settled, and what people proposed. Each stays proposed until the organizer or someone invited confirms it. */
export function Decisions({ items, reader, onChange, ...row }: { items: NoteDecision[]; reader?: NoteReader | undefined; onChange?: ((d: Decision, patch: DecisionPatch) => void) | undefined } & RowProps) {
  return <>{items.map((d) => <DecisionRow key={d.id} d={d} reader={reader} onChange={onChange} {...row} />)}</>;
}

function QuestionRow({ x, onChange, me, onSeek, shown, room }: { x: NoteQuestion; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined } & RowProps) {
  const [editing, setEditing] = useState(false);
  const tile = <span className="nd-kind"><Icon name="ask" size={16} /></span>;
  const cls = cn('nd-r', 'is-ask', room && 'is-room', x.state === 'answered' && 'is-off', editing && 'is-editing');
  if (editing) return <article className={cls}>{tile}<Reword text={x.text} label="Reword this question" onSave={(text) => onChange?.(x, { text })} onDone={() => setEditing(false)} /></article>;
  const acts: Act[] = onChange ? [{ icon: 'pen', label: 'Reword', go: () => setEditing(true) }] : [];
  return (
    <article className={cls}>
      {tile}
      <div className="nd-rb">
        <p className="nd-rt">{x.text}</p>
        <p className="nd-rs">{questionLine(x, me)}</p>
        <div className="nd-rf">{x.screen && shown?.(x.screen)}<EvidenceFlags evidence={x.evidence} me={me} /></div>
      </div>
      {!room && <Moment at={x.at} onSeek={onSeek} />}
      <div className="nd-ra">
        {onChange && (x.state === 'open'
          ? <button type="button" className="nd-yes" onClick={() => onChange(x, { state: 'answered' })}>It was answered</button>
          : <button type="button" className="nd-act" onClick={() => onChange(x, { state: 'open' })}>Reopen</button>)}
      </div>
      {(acts.length > 0 || x.evidence.moments.length > 0 || x.changes.length > 0) && (
        <RowMenu label={acts.length ? 'Change this' : 'What was said'} acts={acts}>{(close) => <Backed evidence={x.evidence} changes={x.changes} me={me} onSeek={onSeek} shown={shown} lead={acts.length > 0} close={close} />}</RowMenu>
      )}
    </article>
  );
}

/** What the call asked and didn't settle. Each stays open until someone who has the notes says it was answered. */
export function Questions({ items, onChange, ...row }: { items: NoteQuestion[]; onChange?: ((x: Question, patch: QuestionPatch) => void) | undefined } & RowProps) {
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
      <div className="nd-dues">
        {DUES.map((t) => <button key={t} type="button" className={cn('nd-dc', a.due === t && 'is-on')} aria-pressed={a.due === t} onClick={() => onDue(t)}>{t}</button>)}
        <button type="button" className={cn('nd-dc', !a.due && 'is-on')} aria-pressed={!a.due} onClick={() => onDue(null)}>No date</button>
      </div>
      <form className="nd-due-f" onSubmit={(e) => { e.preventDefault(); const t = other.trim(); if (t) onDue(t); }}>
        <input className="nd-field" value={other} maxLength={40} placeholder="Another day" aria-label="When it’s due, in your words" autoComplete="off" onChange={(e) => setOther(e.target.value)} />
      </form>
    </>
  );
}

/** Who a follow-up is for, when it's due, and its words, as far as the grants go. */
function FollowUpMenu({ a, me, reader, people, onChange, onSeek, shown, onReword }: { a: NoteAction; me: string | undefined; reader: NoteReader; people: Person[]; onChange: (a: ActionItem, patch: ActionPatch) => void; onSeek: ((s: number) => void) | undefined; shown: ScreenRefShown | undefined; onReword: () => void }) {
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
                    <button key={p.email} type="button" className={cn('ac-pop-item', 'nd-mp', on && 'sel')} onClick={() => apply({ owner: p.email, seen })}>
                      <Avatar person={p} size={22} />
                      <span><b>{p.name}{me && sameEmail(p, { email: me }) ? ' (you)' : ''}</b>{on && <small>{a.takenOn ? 'Took it on' : 'Hasn’t taken it on yet'}</small>}</span>
                      {on && <Icon name="check" size={16} className="nd-tick" />}
                    </button>
                  );
                })}
                {a.owner && <button type="button" className="ac-pop-item" onClick={() => apply({ owner: null })}><Icon name="x" size={18} /><span><b>{isAssignee(a, reader) ? 'Not mine' : 'Nobody yet'}</b></span></button>}
              </>
            ) : <p className="nd-pop-n">{a.owner ? `Only the organizer or ${spokenName(a.owner, me)} can say who this is for.` : 'Only the organizer can say who this is for.'}</p>}
            {change && (
              <>
                <div className="ac-pop-sep" />
                <DuePicker a={a} onDue={(due) => apply({ due })} />
                <div className="ac-pop-sep" />
                <button type="button" className="ac-pop-item" onClick={() => { close(); onReword(); }}><Icon name="pen" size={18} /><span><b>Reword</b></span></button>
                {asks && <p className="nd-pop-n">{asks}</p>}
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
  ? !a.takenOn && (!a.owner.person?.email || a.changes.some((c) => c.what === 'reopened' || c.what === 'reassigned'))
  : a.changes.some((c) => c.what === 'declined'));

function FollowUpRow({ a, reader, people, onToggle, onChange, me, onSeek, shown, room }: {
  a: NoteAction; reader?: NoteReader | undefined; people: Person[];
  onToggle?: ((a: ActionItem, done: boolean) => void) | undefined; onChange?: ((a: ActionItem, patch: ActionPatch) => void) | undefined;
} & RowProps) {
  const [editing, setEditing] = useState(false);
  const mine = !!me && !!a.owner?.person && sameEmail(a.owner.person, { email: me });
  const check = <Check checked={a.done} disabled={!!reader && !mayChangeAction(a, reader)} onChange={(on) => onToggle?.(a, on)} label={`Mark done: ${a.text}`} />;
  const cls = cn('nd-r', 'is-follow', room && 'is-room', a.done && 'is-done', editing && 'is-editing');
  if (editing) return <article className={cls}>{check}<Reword text={a.text} label="Reword this follow-up" onSave={(text) => onChange?.(a, { text })} onDone={() => setEditing(false)} /></article>;
  const line = actionLine(a, me);
  const due = a.done ? undefined : a.due;
  return (
    <article className={cls}>
      {check}
      <div className="nd-rb">
        <p className="nd-rt">{a.text}</p>
        {worthSaying(a) && <p className="nd-rs">{line}</p>}
        <div className="nd-rf">{a.screen && shown?.(a.screen)}<EvidenceFlags evidence={a.evidence} me={me} /></div>
      </div>
      {!room && <Moment at={a.at} onSeek={onSeek} />}
      <div className="nd-ra">
        {mine && !a.takenOn && !a.done && onChange
          ? <button type="button" className="nd-take" title={line} onClick={() => onChange(a, { takeOn: true, seen: { text: a.text, due: a.due ?? null } })}>I’ll do it</button>
          : a.owner
            ? <span className={cn('nd-owner', !a.takenOn && 'is-maybe')} title={line}><Avatar person={a.owner.person ?? { name: a.owner.name }} size={22} /><span className="ac-clamp-1">{spokenName(a.owner, me)}</span></span>
            : <span className="nd-owner is-none" title={line}>Nobody yet</span>}
        {due && <span className={cn('nd-due', /^today$/i.test(due) && 'is-soon', !a.takenOn && 'is-maybe')} title={a.takenOn ? undefined : 'Suggested. Nobody has agreed to this date yet'}>{due}</span>}
      </div>
      {onChange && reader && <FollowUpMenu a={a} me={me} reader={reader} people={people} onChange={onChange} onSeek={onSeek} shown={shown} onReword={() => setEditing(true)} />}
    </article>
  );
}

/**
 * What people said they'd do. Who it's for and when it's due are only suggestions until that person says they'll do it,
 * which nobody can do for them; "Not mine" hands it back. Once they have, it's theirs and the organizer's to change.
 */
export function FollowUps({ actions, reader, people = [], onToggle, onChange, ...row }: {
  actions: NoteAction[]; reader?: NoteReader | undefined; people?: Person[] | undefined;
  onToggle?: ((a: ActionItem, done: boolean) => void) | undefined; onChange?: ((a: ActionItem, patch: ActionPatch) => void) | undefined;
} & RowProps) {
  return <>{actions.filter(isAcceptedFollowUp).map((a) => <FollowUpRow key={a.id} a={a} reader={reader} people={people} onToggle={onToggle} onChange={onChange} {...row} />)}</>;
}

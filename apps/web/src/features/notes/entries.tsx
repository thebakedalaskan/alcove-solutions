/*
 * What every entry in the notes (a decision, an open question, a follow-up) shares, wherever it shows: what backs it, what
 * to be careful of, its history, and adding one. What backs an entry comes from the server, worked out for this reader
 * each time they read the note. Anything that goes into the shared notes goes because someone typed it here and sent it.
 */
import { firstName, type Change, type Dispute, type NoteEvidence, type NoteEvidenceFlag, type NoteEvidenceMoment, type ScreenRef, type TranscriptLine } from '@alcove/api';
import { Button, Icon, IconButton, Popover, cn } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { listNames, sameEmail, spokenName } from '~/lib/people';
import { hm, position, shortDay } from '~/lib/time';
import { capital } from '~/lib/words';

/** Who did something, as the reader sees them: "you", or a first name. */
export const byName = (by: Change['by'], me: string | undefined) => (me && sameEmail(by, { email: me }) ? 'you' : firstName(by.name));
/** A name as kept in a change; someone known only by their address goes by the part before the @. */
const named = (s: string | undefined) => (s ? (s.includes('@') ? s.slice(0, s.indexOf('@')) : firstName(s)) : 'nobody');
const when = (iso: string) => { const d = new Date(iso); return `${shortDay(d)}, ${hm(d)}`; };

/** Someone saying a follow-up isn't theirs, as the reader reads it. */
export const notTheirs = (c: Change, me: string | undefined): string => (byName(c.by, me) === 'you' ? 'You said it isn’t yours' : `${capital(byName(c.by, me))} said it isn’t theirs`);

/** One change, as a sentence. */
export function changeLine(c: Change, me: string | undefined): string {
  const who = capital(byName(c.by, me));
  switch (c.what) {
    case 'proposed': return `${who} proposed it`;
    case 'confirmed': return `${who} confirmed it`;
    case 'rejected': return `${who} said it wasn’t decided`;
    case 'superseded': return `${who} said it no longer holds`;
    case 'answered': return `${who} said it was answered`;
    case 'reopened': return `${who} reopened it`;
    case 'reworded': return `${who} reworded it`;
    case 'disputed': return `${who} said it wasn’t decided`;
    case 'undisputed': return `${who} took that back`;
    case 'took-on': return c.before ? `${who} took it on from ${named(c.before)}` : `${who} took it on`;
    case 'declined': return notTheirs(c, me);
    case 'reassigned': return c.after ? `${who} gave it to ${named(c.after)}` : `${who} took the owner off`;
    case 'due': return c.after ? `${who} set it due ${c.after}` : `${who} removed the due date`;
    case 'done': return `${who} ticked it`;
    case 'undone': return `${who} unticked it`;
  }
}

/** Every change to something, newest first: who, when, what it was and what it became, and whether they got the notes afterwards. */
export function ChangeList({ changes, me }: { changes: Change[]; me: string | undefined }) {
  return (
    <ol className="ent-hist">
      {[...changes].reverse().map((c, i) => (
        <li key={`${c.at}-${i}`}>
          <span>{changeLine(c, me)}</span>
          <span className="ac-mono">{when(c.at)}</span>
          {(c.what === 'reworded' || c.what === 'due') && c.before && c.after && <p className="was"><s>{c.before}</s></p>}
          {c.by.as === 'shared' && <small>{capital(byName(c.by, me))} got these notes afterwards</small>}
        </li>
      ))}
    </ol>
  );
}

/** Who changed something and when, for anyone who wants the whole story. Nothing to show until someone has. */
export function History({ changes, me, what }: { changes: Change[]; me: string | undefined; what: string }) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" label={`History of this ${what}`} className="ent-pop"
      anchor={<IconButton icon="history" label={`History of this ${what}`} size={15} className="ent-icon" />}>
      <div className="ac-pop-h">History</div>
      <ChangeList changes={changes} me={me} />
    </Popover>
  );
}

const FLAGS: Record<NoteEvidenceFlag, string> = {
  missing: 'Nothing said backs this',
  conflict: 'Someone said otherwise',
  unsure: 'Hard to hear',
  corrected: 'A line behind this was corrected'
};

/** Who says a decision wasn't decided, when anyone does, so the flag says it in their name. */
const disputeLine = (disputes: Dispute[], me: string | undefined) => {
  const you = disputes.some((x) => me && sameEmail(x.by, { email: me }));
  const others = disputes.filter((x) => !(me && sameEmail(x.by, { email: me }))).map((x) => x.by);
  if (you && !others.length) return 'You said this wasn’t decided';
  return `${you ? `You and ${listNames(others)}` : listNames(others)} ${others.length > 1 || you ? 'say' : 'says'} this wasn’t decided`;
};

/** What to be careful of in an entry, in plain words. Nothing shows when there's nothing to say. */
export function EvidenceFlags({ evidence, disputes = [], me }: { evidence: NoteEvidence; disputes?: Dispute[] | undefined; me: string | undefined }) {
  // A conflict that's only a dispute says whose it is; one with a line against it says that too.
  const said = evidence.moments.some((m) => m.kind === 'line' && m.against);
  const flags = evidence.flags.filter((f) => f !== 'conflict' || said);
  if (!flags.length && !disputes.length) return null;
  return (
    <>
      {flags.map((f) => <span key={f} className="ent-flag"><Icon name="alert" size={13} />{FLAGS[f]}</span>)}
      {disputes.length > 0 && <span className="ent-flag"><Icon name="alert" size={13} />{disputeLine(disputes, me)}</span>}
    </>
  );
}

/** One moment an entry rests on: who said what, when, and whether it cuts against it. */
function Moment({ m, me, moment, shown }: { m: NoteEvidenceMoment; me: string | undefined; moment: (at: number) => ReactNode; shown?: ((s: ScreenRef) => ReactNode) | undefined }) {
  if (m.kind === 'screen') {
    return (
      <li className="ent-m">
        <div className="who"><Icon name="monitor" size={14} /><b className="ac-clamp-1">{m.sure ? 'On screen' : 'Maybe on screen'}</b>{moment(m.at)}</div>
        <p>{shown?.({ id: m.id, sure: m.sure, ...(m.region === undefined ? {} : { region: m.region }) }) ?? (m.part ? `${m.title}: ${m.part}` : m.title)}</p>
      </li>
    );
  }
  return (
    <li className={cn('ent-m', m.against && 'against')}>
      <div className="who"><b className="ac-clamp-1">{m.speaker ? spokenName(m.speaker, me) : 'Someone'}</b>{moment(m.at)}</div>
      <p>“{m.text}”</p>
      {(m.against || m.corrected || m.unsure) && (
        <small>{[m.against && 'Cuts against this', m.corrected && 'Corrected since', m.unsure?.words && 'Hard to hear', m.unsure?.speaker && 'May be someone else'].filter(Boolean).join(' · ')}</small>
      )}
    </li>
  );
}

/**
 * What was said or shown that an entry rests on, one press away, for checking before you agree. `moment` draws the time
 * of a moment: playing it where the note is open, or a link into the note from anywhere else.
 */
export function Backing({ evidence, me, moment, shown }: { evidence: NoteEvidence; me: string | undefined; moment: (at: number) => ReactNode; shown?: ((s: ScreenRef) => ReactNode) | undefined }) {
  const [open, setOpen] = useState(false);
  if (!evidence.moments.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="What was said" className="ent-pop"
      anchor={<button type="button" className="ent-said"><Icon name="transcript" size={13} />What was said</button>}>
      <ol className="ent-ms">{evidence.moments.map((m) => <Moment key={`${m.kind}-${m.id}`} m={m} me={me} moment={moment} shown={shown} />)}</ol>
    </Popover>
  );
}

/** A line of the transcript someone starts a proposal from, and the breakout room's section it goes in. */
export interface Seed { line: TranscriptLine; room?: string | undefined; kind: 'decision' | 'follow-up' }

/**
 * Adding to the shared notes, in place: what the notes didn't hear goes in in your words, for everyone with the notes,
 * as a proposal. Started from a line (`seed`), it opens with that line's words and points at it.
 */
export function Propose({ label, placeholder, hint, seed, busy, onAdd, onDone }: {
  label: string; placeholder: string; hint: string; seed?: Seed | undefined; busy?: boolean | undefined;
  /** Adds it, and says whether it went: what didn't stays in the field to try again. */
  onAdd: (text: string, lines: string[]) => Promise<boolean>; onDone?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!seed) return;
    setText(seed.line.text.slice(0, 300));
    setOpen(true);
  }, [seed]);
  // The field takes the keyboard when it opens, and it goes back to the button when it closes.
  useEffect(() => {
    if (open) { box.current?.focus(); box.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); box.current?.select(); }
    else if (back.current) { back.current = false; button.current?.focus(); }
  }, [open, reduce]);
  const close = () => { back.current = true; setOpen(false); setText(''); onDone?.(); };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await onAdd(t, seed ? [seed.line.id] : [])) close();
  };
  if (!open) return <button ref={button} type="button" className="ent-add" onClick={() => setOpen(true)}><Icon name="plus" size={14} />{label}</button>;
  return (
    <form className="ent-form" onSubmit={(e) => void send(e)}>
      <input ref={box} className="ac-input" value={text} maxLength={300} placeholder={placeholder} aria-label={label} autoComplete="off"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
      <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={!text.trim()}>Add</Button>
      <button type="button" className="lk quiet" onClick={close}>Cancel</button>
      <p>{seed ? `From what was said at ${position(seed.line.at)}. ` : ''}{hint}</p>
    </form>
  );
}

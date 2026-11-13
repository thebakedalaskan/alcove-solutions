/*
 * To answer, in For you: decisions nobody has confirmed, on your own notes ones someone disputes, follow-ups the notes
 * suggest are yours (or someone gave you, or changed since), and notes shared with you this past week, newest first. Each
 * is one row, answered in place. What you answer stays where it is, saying what you did, until you leave Home, so nothing
 * moves under your pointer.
 */
import {
  errorMessage, firstName, isAcceptedFollowUp, mayDecide, proposerOf, type ActionPatch, type Changer, type DecisionPatch, type Inbox, type NoteReader,
  type NoteSummary, type OpenAction, type PendingDecision, type Person
} from '@alcove/api';
import { Avatar, Faces, Icon, Popover, cn, useToast, type AvatarPerson } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Moments, cautionsOf, EvidenceFlags } from '~/features/notes/entries';
import { MomentLink, decisionLine, proposedLine } from '~/features/notes/parts';
import { sameEmail } from '~/lib/people';
import { q, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { dueFrom, dueLabel, dueOf, groupOf, sharedLately } from './day';

export type Item =
  | { kind: 'decision'; key: string; at: string; d: PendingDecision }
  | { kind: 'suggestion'; key: string; at: string; a: OpenAction }
  | { kind: 'shared'; key: string; at: string; n: NoteSummary };
/** What you did with an item here. `reopened` is a decision put back after confirming it, until the inbox has it again. */
export type Outcome = 'confirmed' | 'rejected' | 'disputed' | 'taken' | 'notMine' | 'reopened';
/** What a button asks for: an outcome, or `mine`, which gives back a follow-up you said wasn't yours (it's then taken on). */
type Answer = Outcome | 'mine';

const ORDER: Record<Item['kind'], number> = { decision: 0, suggestion: 1, shared: 2 };
const newestFirst = (x: Item, y: Item) => y.at.localeCompare(x.at) || ORDER[x.kind] - ORDER[y.kind];

/** Everything waiting on you, newest first: by when the call was, or when the notes were shared with you. */
export function waitingOf(inbox: Inbox, notes: readonly NoteSummary[], now: number): Item[] {
  return [
    ...inbox.decisions.map((d): Item => ({ kind: 'decision', key: `d:${d.noteId}:${d.id}`, at: d.noteStartedAt, d })),
    ...inbox.followUps.filter((a) => isAcceptedFollowUp(a) && !a.takenOn).map((a): Item => ({ kind: 'suggestion', key: `a:${a.noteId}:${a.id}`, at: a.noteStartedAt, a })),
    ...sharedLately(notes, now).map((n): Item => ({ kind: 'shared', key: `s:${n.id}`, at: n.received?.at ?? n.startedAt, n }))
  ].sort(newestFirst);
}

/**
 * What's to answer as it stands this visit: `items` from the inbox, with what you answered kept where it was after the inbox
 * lets go of it, and the answering. `outcomeOf` says what you did with one; `busy` holds those whose answer is on its way.
 */
export function useWaiting(items: Item[]) {
  const toast = useToast();
  const decide = useUpdateDecision();
  const act = useUpdateAction();
  const me = useQuery(q.session()).data?.user.email;
  /* What you answered this visit, with the item as it was, so it stays where it is after the inbox lets go of it. */
  const [answered, setAnswered] = useState<ReadonlyMap<string, { item: Item; outcome: Outcome }>>(new Map());
  /* Items whose answer is on its way; several can be, when you answer one after another. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const shown = [...items];
  for (const [key, { item }] of answered) if (!items.some((i) => i.key === key)) shown.push(item);
  shown.sort(newestFirst);
  const outcomeOf = (key: string) => { const o = answered.get(key)?.outcome; return o === 'reopened' ? undefined : o; };

  const settle = (item: Item, outcome: Outcome) => setAnswered((m) => new Map(m).set(item.key, { item, outcome }));
  const mark = (key: string, on: boolean) => setBusy((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
  /* Each answer waits for its own reply, so answering several in a row never loses what one of them did. */
  const run = async (item: Item, answer: Answer) => {
    if (answer === 'mine' && !me) return;
    mark(item.key, true);
    try {
      if (item.kind === 'decision') {
        // Taking back a dispute is the undo of a dispute, and everything else moves the decision. Agreeing says what was read.
        const was = answered.get(item.key)?.outcome;
        const patch: DecisionPatch = answer === 'disputed' ? { dispute: true } : answer === 'reopened' && was === 'disputed' ? { dispute: false }
          : answer === 'confirmed' ? { state: 'confirmed', seen: { text: item.d.text } } : { state: answer === 'rejected' ? 'rejected' : 'proposed' };
        await decide.mutateAsync({ noteId: item.d.noteId, decisionId: item.d.id, patch });
      } else if (item.kind === 'suggestion') {
        // Giving it back to yourself takes it on: the notes only suggest, and only you can say it's yours.
        const seen = { text: item.a.text, due: item.a.due ?? null };
        const patch: ActionPatch = answer === 'taken' ? { takeOn: true, seen } : answer === 'mine' && me ? { owner: me, seen } : { owner: null };
        await act.mutateAsync({ noteId: item.a.noteId, actionId: item.a.id, patch });
      }
      settle(item, answer === 'mine' ? 'taken' : answer);
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    } finally {
      mark(item.key, false);
    }
  };
  return { shown, outcomeOf, busy, me, run };
}

/** A decision disputed since someone confirmed it, on your own notes: yours to settle, as the organizer. */
export const settling = (item: Item) => item.kind === 'decision' && item.d.state === 'confirmed';

/** Who gave you a follow-up, or changed it since you agreed to it, when someone did: "From Maya", "Changed by Maya". */
function giverOf(a: OpenAction): { label: string; by: Changer } | undefined {
  const last = a.changes.findLast((c) => c.what === 'reassigned' || c.what === 'reopened');
  if (last?.what === 'reopened') return { label: `Changed by ${firstName(last.by.name)}`, by: last.by };
  const by = last?.by ?? proposerOf(a);
  return by ? { label: `From ${firstName(by.name)}`, by } : undefined;
}

/** Who was on the call: everyone with the notes but those who got them afterwards, and you. */
const onTheCall = (n: NoteSummary, me: string | undefined): Person[] =>
  n.people.filter((p) => !n.sharedWith.some((e) => sameEmail({ email: e }, p)) && !(me && sameEmail(p, { email: me })));

/** The faces column: who was on the call (a microphone's arch for a recording in the room), or one person alone. */
function Who({ people, room }: { people: AvatarPerson[]; room: boolean }) {
  return (
    <span className="hm-ask-f" aria-hidden="true">
      {room ? <span className="hm-room"><Icon name="mic" size={11} /></span>
        : people.length === 1 && people[0] ? <Avatar person={people[0]} size={20} />
          : people.length > 1 && <Faces people={people.slice(0, 3)} size={20} max={3} />}
    </span>
  );
}

/** What you did, in a word or two, where the answer was. */
const DID: Record<Exclude<Outcome, 'reopened'>, string> = {
  confirmed: 'Confirmed', rejected: 'Not decided', disputed: 'Disputed', taken: 'In your follow-ups', notMine: 'Not yours'
};

/**
 * One thing to answer: its kind in a circle, its words (opening the note at the moment they were said), who was on the call,
 * and the answer in a fixed column at the right. The call it came from is its tooltip. Answered, it stays, saying what you did.
 */
export function AskRow({ item, outcome, busy, me, reader, note, now, run }: {
  item: Item; outcome: Outcome | undefined; busy: boolean; me: string | undefined; reader: NoteReader | undefined;
  /** The note it came from, for who was on the call. */
  note: NoteSummary | undefined;
  now: number; run: (a: Answer) => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  const lead = useRef<HTMLButtonElement>(null);
  const was = useRef(outcome);
  /* Answering takes away the button you pressed: focus moves to what took its place (Undo, Confirm) or the row, not the page. */
  useEffect(() => {
    if (was.current === outcome) return;
    was.current = outcome;
    const at = document.activeElement;
    if (at === document.body || (at && row.current?.contains(at))) (lead.current ?? row.current)?.focus({ preventScroll: true });
  }, [outcome]);

  if (item.kind === 'shared') {
    const n = item.n;
    const by = n.received ? firstName(n.received.by.name) : 'Someone';
    const said = `${by} shared the notes from ${n.title}${n.received?.group ? ` with ${n.received.group}` : ''}`;
    return (
      <li data-row className="hm-ask is-shared" title={`From ${n.title}`}>
        <span className="hm-kind" aria-hidden="true"><Icon name="share" size={14} /></span>
        <div className="hm-words"><p className="ac-clamp-2">{said}</p></div>
        <Who people={onTheCall(n, me)} room={n.kind === 'room'} />
        <span className="hm-act">
          <Link to="/calls/$noteId" params={{ noteId: n.id }} className="hm-pill" aria-label={`Read the notes from ${n.title}`}>Read</Link>
          <span className="hm-x" aria-hidden="true" />
        </span>
      </li>
    );
  }

  const decision = item.kind === 'decision';
  const settle = settling(item);
  const text = decision ? item.d.text : item.a.text;
  const noteId = decision ? item.d.noteId : item.a.noteId;
  const noteTitle = decision ? item.d.noteTitle : item.a.noteTitle;
  const at = decision ? item.d.at : item.a.at;
  // Who gave you a follow-up, or changed it, stands alone in the faces column, and is said in the tooltip and to a screen reader.
  const giver = decision ? undefined : giverOf(item.a);
  const people = giver ? [note?.people.find((p) => sameEmail(p, giver.by)) ?? { name: giver.by.name, email: giver.by.email }] : note ? onTheCall(note, me) : [];
  // Saying yes to a follow-up agrees to when it's suggested for too, so the day is on the row.
  const today = new Date(now);
  const dueWords = decision ? undefined : item.a.due;
  const due = decision ? undefined : dueOf(item.a.due, dueFrom(item.a));
  const day = due ? dueLabel(due, today) : undefined;
  const undo = (outcome === 'confirmed' || outcome === 'rejected' || outcome === 'disputed') && !settle
    ? <button ref={lead} type="button" className="hm-undo" disabled={busy} onClick={() => run('reopened')}>Undo</button>
    : outcome === 'notMine' ? <button ref={lead} type="button" className="hm-undo" disabled={busy} onClick={() => run('mine')}>It’s mine</button> : null;
  return (
    <li data-row ref={row} tabIndex={-1} className={cn('hm-ask', decision ? 'is-decide' : 'is-own', outcome && 'is-answered')} aria-busy={busy || undefined}
      title={giver ? `${giver.label} · ${noteTitle}` : `From ${noteTitle}`}>
      <span className="hm-kind" aria-hidden="true"><Icon name={decision ? 'diamond' : 'square'} size={14} /></span>
      <div className="hm-words">
        <Link to="/calls/$noteId" params={{ noteId }} search={{ at }} className="ac-clamp-2">
          {text}{giver && <span className="sr-only">. {giver.label}</span>}
        </Link>
        {!outcome && <SaidMark item={item} me={me} />}
        {day && due && <span className={cn('hm-due', day === 'Today' && 'is-now', groupOf(due, today) === 'overdue' && 'is-late')} title={`Suggested for ${dueWords ?? day}`}>{day}</span>}
      </div>
      <Who people={people} room={!giver && note?.kind === 'room'} />
      <span className="hm-act" role="status">
        {outcome && outcome !== 'reopened' ? (
          <><span className="hm-did"><Icon name={outcome === 'confirmed' || outcome === 'taken' ? 'check' : outcome === 'disputed' ? 'alert' : 'x'} size={14} />{DID[outcome]}</span>{undo}</>
        ) : (
          <>
            <button ref={lead} type="button" className="hm-pill" disabled={busy} onClick={() => run(decision ? 'confirmed' : 'taken')}>{settle ? 'Keep it confirmed' : decision ? 'Confirm' : 'I’ll do it'}</button>
            <button type="button" className="hm-x" disabled={busy} aria-label={decision ? 'It wasn’t decided' : 'Not mine'} title={decision ? 'It wasn’t decided' : 'Not mine'}
              onClick={() => run(!decision ? 'notMine' : reader && mayDecide(item.d, 'rejected', reader) ? 'rejected' : 'disputed')}><Icon name="x" size={16} /></button>
          </>
        )}
      </span>
    </li>
  );
}

/** Where a decision stands, in words: confirmed by someone already, when it's disputed since; or whose words it's in. */
const decisionFrom = (d: PendingDecision, me: string | undefined) => (d.state === 'confirmed' ? decisionLine(d, me) : proposedLine(d, me));

/**
 * What backs a decision or follow-up, and what to be careful of, one press away: a small mark after the words (in the colour
 * of a problem when there's something to be careful of, which its tooltip says), opening what was said, each moment a way
 * into the note.
 */
function SaidMark({ item, me }: { item: Extract<Item, { kind: 'decision' | 'suggestion' }>; me: string | undefined }) {
  const [open, setOpen] = useState(false);
  const decision = item.kind === 'decision';
  const evidence = decision ? item.d.evidence : item.a.evidence;
  const disputes = decision ? item.d.disputes : [];
  const noteId = decision ? item.d.noteId : item.a.noteId;
  const careful = cautionsOf(evidence, disputes, me);
  if (!evidence.moments.length && !careful.length) return null;
  const said = careful.length ? careful.join('. ') : 'What was said';
  const giver = decision ? undefined : giverOf(item.a);
  const whose = decision ? decisionFrom(item.d, me) : `${giver?.label ?? 'Suggested by the notes'}${item.a.due ? `, for ${item.a.due}` : ''}`;
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="What was said" tip={said} className="ent-pop"
      anchor={<button type="button" className={cn('hm-mark', careful.length > 0 && 'is-careful')} aria-label={said}><Icon name={careful.length ? 'alert' : 'quote'} size={13} /></button>}>
      <p className="hm-mark-by">{whose}</p>
      {careful.length > 0 && <div className="hm-mark-flags"><EvidenceFlags evidence={evidence} disputes={disputes} me={me} /></div>}
      {evidence.moments.length > 0 && <Moments evidence={evidence} me={me} moment={(m) => <MomentLink noteId={noteId} at={m} />} />}
    </Popover>
  );
}

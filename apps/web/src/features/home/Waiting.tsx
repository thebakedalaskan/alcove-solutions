/*
 * What's waiting on you, as tiles: decisions nobody has confirmed, on your own notes ones someone disputes, follow-ups the
 * notes suggest are yours, and notes shared with you this past week, newest first. What you answer stays in place, saying
 * what you did, until you leave Home, so nothing moves under your pointer.
 */
import { errorMessage, firstName, mayDecide, proposerOf, type ActionPatch, type DecisionPatch, type Inbox, type NoteReader, type NoteSummary, type OpenAction, type PendingDecision } from '@alcove/api';
import { Icon, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Backing, EvidenceFlags, useNoteReader } from '~/features/notes/entries';
import { MomentLink, decisionLine, proposedLine } from '~/features/notes/parts';
import { q, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { sharedLately } from './day';
import { Moment, More } from './parts';

type Item =
  | { kind: 'decision'; key: string; at: string; d: PendingDecision }
  | { kind: 'suggestion'; key: string; at: string; a: OpenAction }
  | { kind: 'shared'; key: string; at: string; n: NoteSummary };
/** What you did with an item here. `reopened` is a decision put back after confirming it, until the inbox has it again. */
type Outcome = 'confirmed' | 'rejected' | 'disputed' | 'taken' | 'notMine' | 'reopened';
/** What a button asks for: an outcome, or `mine`, which gives back a follow-up you said wasn't yours (it's then taken on). */
type Answer = Outcome | 'mine';

const FIRST = 6;
const ORDER: Record<Item['kind'], number> = { decision: 0, suggestion: 1, shared: 2 };

/** Everything waiting on you, newest first: by when the call was, or when the notes were shared with you. */
export function waitingOf(inbox: Inbox, notes: readonly NoteSummary[], now: number): Item[] {
  return [
    ...inbox.decisions.map((d): Item => ({ kind: 'decision', key: `d:${d.noteId}:${d.id}`, at: d.noteStartedAt, d })),
    ...inbox.followUps.filter((a) => !a.takenOn).map((a): Item => ({ kind: 'suggestion', key: `a:${a.noteId}:${a.id}`, at: a.noteStartedAt, a })),
    ...sharedLately(notes, now).map((n): Item => ({ kind: 'shared', key: `s:${n.id}`, at: n.received?.at ?? n.startedAt, n }))
  ].sort((x, y) => y.at.localeCompare(x.at) || ORDER[x.kind] - ORDER[y.kind]);
}

export function Waiting({ items, onAnswer }: { items: Item[]; onAnswer: () => void }) {
  const toast = useToast();
  const decide = useUpdateDecision();
  const act = useUpdateAction();
  const me = useQuery(q.session()).data?.user.email;
  const readerAs = useNoteReader();
  /* What you answered this visit, with the item as it was, so it stays where it is after the inbox lets go of it. */
  const [answered, setAnswered] = useState<ReadonlyMap<string, { item: Item; outcome: Outcome }>>(new Map());
  /* Items whose answer is on its way; several can be, when you answer one after another. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);

  const shown = [...items];
  for (const [key, { item }] of answered) if (!items.some((i) => i.key === key)) shown.push(item);
  shown.sort((x, y) => y.at.localeCompare(x.at) || ORDER[x.kind] - ORDER[y.kind]);
  const outcomeOf = (key: string) => { const o = answered.get(key)?.outcome; return o === 'reopened' ? undefined : o; };
  // One more than fits is shown rather than hidden behind "Show 1 more".
  const visible = all || shown.length <= FIRST + 1 ? shown : shown.slice(0, FIRST);

  const settle = (item: Item, outcome: Outcome) => { onAnswer(); setAnswered((m) => new Map(m).set(item.key, { item, outcome })); };
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

  if (!shown.length) return null;
  return (
    <>
      <ul className="hm-tiles">
        {visible.map((item) => <Tile key={item.key} item={item} outcome={outcomeOf(item.key)} busy={busy.has(item.key)} me={me} reader={item.kind === 'decision' ? readerAs(item.d.role) : undefined} run={(o) => void run(item, o)} />)}
      </ul>
      {shown.length > FIRST + 1 && <More all={all} more={shown.length - FIRST} onToggle={() => setAll((a) => !a)} />}
    </>
  );
}

/** What a follow-up tile is headed: who changed what you'd agreed to, gave it to you or suggested it, or else that it's a follow-up. */
function followUpLabel(a: OpenAction): string {
  const last = a.changes.findLast((c) => c.what === 'reassigned' || c.what === 'reopened');
  if (last?.what === 'reopened') return `Changed by ${firstName(last.by.name)}`;
  const by = last?.by ?? proposerOf(a);
  return by ? `From ${firstName(by.name)}` : 'Follow-up';
}

/** Where a decision came from: confirmed by someone already, when it's disputed since; or whose words it's in. */
const decisionFrom = (d: PendingDecision, me: string | undefined) => (d.state === 'confirmed' ? decisionLine(d, me) : proposedLine(d, me));

function Tile({ item, outcome, busy, me, reader, run }: { item: Item; outcome: Outcome | undefined; busy: boolean; me: string | undefined; reader: NoteReader | undefined; run: (a: Answer) => void }) {
  const tile = useRef<HTMLLIElement>(null);
  const lead = useRef<HTMLButtonElement>(null);
  const was = useRef(outcome);
  /* Answering takes away the button you pressed: focus moves to what took its place (Undo, Confirm) or the tile, not the page. */
  useEffect(() => {
    if (was.current === outcome) return;
    was.current = outcome;
    const at = document.activeElement;
    if (at === document.body || (at && tile.current?.contains(at))) (lead.current ?? tile.current)?.focus({ preventScroll: true });
  }, [outcome]);

  if (item.kind === 'shared') {
    const n = item.n;
    const by = n.received ? firstName(n.received.by.name) : 'Someone';
    const said = `${by} shared the notes from ${n.title}${n.received?.group ? ` with ${n.received.group}` : ''}`;
    return (
      <li className="hm-tile is-shared">
        <div className="hm-tile-h"><span className="hm-tile-i"><Icon name="share" size={16} /></span><span className="hm-tile-k ac-clamp-1">Shared with you</span></div>
        <p className="hm-tile-t" title={said}>{said}</p>
        <div className="hm-tile-a"><Link to="/notes/$noteId" params={{ noteId: n.id }} className="hm-yes">Read the notes</Link></div>
      </li>
    );
  }

  const decision = item.kind === 'decision';
  // Confirmed already and disputed since: yours to settle, as the organizer.
  const settling = decision && item.d.state === 'confirmed';
  const text = decision ? item.d.text : item.a.text;
  const noteId = decision ? item.d.noteId : item.a.noteId;
  const noteTitle = decision ? item.d.noteTitle : item.a.noteTitle;
  const at = decision ? item.d.at : item.a.at;
  const said = outcome === 'confirmed' ? 'Confirmed for everyone.' : outcome === 'rejected' ? 'Crossed out for everyone.' : outcome === 'disputed' ? 'Everyone sees that. The organizer settles it.' : outcome === 'taken' ? 'It’s in your follow-ups.' : 'Nobody has it now.';
  const put = (outcome === 'confirmed' || outcome === 'rejected' || outcome === 'disputed') && !settling ? <button ref={lead} type="button" className="hm-undo" disabled={busy} onClick={() => run('reopened')}>Undo</button>
    : outcome === 'notMine' ? <button ref={lead} type="button" className="hm-undo" disabled={busy} onClick={() => run('mine')}>It’s mine</button> : null;
  return (
    <li ref={tile} tabIndex={-1} className={cn('hm-tile', decision && 'is-decide', outcome && 'is-answered')} aria-busy={busy || undefined}>
      <div className="hm-tile-h">
        <span className="hm-tile-i"><Icon name={decision ? 'badgeCheck' : 'userCheck'} size={16} /></span>
        <span className="hm-tile-k ac-clamp-1">{settling ? 'Disputed' : decision ? 'Decision' : followUpLabel(item.a)}</span>
        <Moment noteId={noteId} noteTitle={noteTitle} at={at} />
      </div>
      <p className="hm-tile-t" title={text}>{text}</p>
      {/* Saying yes is to these words and this date, so both are on the tile. */}
      {(decision || item.a.due) && <p className="hm-tile-by ac-clamp-1">{decision ? decisionFrom(item.d, me) : `Suggested for ${item.a.due}`}</p>}
      {!outcome && (
        <div className="hm-tile-ev">
          <Backing evidence={decision ? item.d.evidence : item.a.evidence} me={me} moment={(m) => <MomentLink noteId={noteId} at={m} />} />
          <EvidenceFlags evidence={decision ? item.d.evidence : item.a.evidence} disputes={decision ? item.d.disputes : undefined} me={me} />
        </div>
      )}
      <div className={cn('hm-tile-a', outcome && 'hm-done')} role="status">
        {outcome ? <><Icon name={outcome === 'confirmed' || outcome === 'taken' ? 'check' : outcome === 'disputed' ? 'alert' : 'x'} size={15} /><span>{said}</span>{put}</> : (
          <>
            <button ref={lead} type="button" className="hm-yes" disabled={busy} onClick={() => run(decision ? 'confirmed' : 'taken')}>{settling ? 'Keep it confirmed' : decision ? 'Confirm' : 'I’ll do it'}</button>
            <button type="button" className="hm-no" disabled={busy} aria-label={decision ? 'It wasn’t decided' : 'Not mine'} title={decision ? 'It wasn’t decided' : 'Not mine'}
              onClick={() => run(!decision ? 'notMine' : reader && mayDecide(item.d, 'rejected', reader) ? 'rejected' : 'disputed')}><Icon name="x" size={16} /></button>
          </>
        )}
      </div>
    </li>
  );
}

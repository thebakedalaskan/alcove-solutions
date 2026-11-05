/*
 * Waiting on you: decisions the notes proposed that nobody has confirmed, follow-ups the notes suggest are
 * yours, and notes shared with you this past week, newest first. What you answer stays in place, saying
 * what you did, until you leave Home, so nothing moves under your pointer.
 */
import { errorMessage, firstName, mayDecide, proposerOf, type ActionPatch, type DecisionPatch, type Inbox, type NoteReader, type NoteSummary, type OpenAction, type PendingDecision } from '@alcove/api';
import { Card, EmptyState, Icon, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Backing, EvidenceFlags, useNoteReader } from '~/features/notes/entries';
import { MomentLink, decisionLine, proposedLine } from '~/features/notes/parts';
import { q, useUpdateAction, useUpdateDecision } from '~/lib/queries';
import { agoLabel } from '~/lib/time';
import { More } from './parts';

type Item =
  | { kind: 'decision'; key: string; at: string; d: PendingDecision }
  | { kind: 'suggestion'; key: string; at: string; a: OpenAction }
  | { kind: 'shared'; key: string; at: string; n: NoteSummary };
/**
 * What you did with an item here. `disputed` is saying a decision wasn't decided when it's the organizer's to reject.
 * `reopened` is a decision put back after confirming it, until the inbox has it again.
 */
type Outcome = 'confirmed' | 'rejected' | 'disputed' | 'taken' | 'notMine' | 'reopened';
/** What a button asks for: an outcome, or `mine`, which gives back a follow-up you said wasn't yours (it's then taken on). */
type Answer = Outcome | 'mine';

const WEEK = 7 * 86_400_000;
const FIRST = 4;
const ORDER: Record<Item['kind'], number> = { decision: 0, suggestion: 1, shared: 2 };

/** Everything waiting on you, newest first: by when the call was, or when the notes were shared with you. */
export function waitingOf(inbox: Inbox, notes: readonly NoteSummary[], now: number): Item[] {
  return [
    ...inbox.decisions.map((d): Item => ({ kind: 'decision', key: `d:${d.noteId}:${d.id}`, at: d.noteStartedAt, d })),
    ...inbox.followUps.filter((a) => !a.takenOn).map((a): Item => ({ kind: 'suggestion', key: `a:${a.noteId}:${a.id}`, at: a.noteStartedAt, a })),
    ...notes.flatMap((n): Item[] => (n.received?.role === 'shared' && now - new Date(n.received.at).getTime() < WEEK ? [{ kind: 'shared', key: `s:${n.id}`, at: n.received.at, n }] : []))
  ].sort((x, y) => y.at.localeCompare(x.at) || ORDER[x.kind] - ORDER[y.kind]);
}

export function Waiting({ items, now }: { items: Item[]; now: number }) {
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
  const open = shown.filter((i) => !outcomeOf(i.key)).length;
  // One more than fits is shown rather than hidden behind "Show 1 more".
  const visible = all || shown.length <= FIRST + 1 ? shown : shown.slice(0, FIRST);

  const settle = (item: Item, outcome: Outcome) => setAnswered((m) => new Map(m).set(item.key, { item, outcome }));
  const mark = (key: string, on: boolean) => setBusy((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
  /* Each answer waits for its own reply, so answering several in a row never loses what one of them did. */
  const run = async (item: Item, answer: Answer) => {
    if (answer === 'mine' && !me) return;
    mark(item.key, true);
    try {
      if (item.kind === 'decision') {
        // Taking back a dispute is the undo of a dispute, and everything else moves the decision.
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

  return (
    <Card title="Waiting on you" className="hm-wait" aside={shown.length > 0 ? <span className="ac-mono">{open}<span className="sr-only"> waiting</span></span> : undefined}>
      {shown.length ? (
        <>
          <ul className="hm-wait-list">
            {visible.map((item) => <Row key={item.key} item={item} outcome={outcomeOf(item.key)} busy={busy.has(item.key)} now={now} me={me} reader={item.kind === 'decision' ? readerAs(item.d.role) : undefined} run={(o) => void run(item, o)} />)}
          </ul>
          {shown.length > FIRST + 1 && <More all={all} more={shown.length - FIRST} onToggle={() => setAll((a) => !a)} />}
        </>
      ) : (
        <EmptyState title="Nothing needs you" className="hm-empty" art={<span className="hm-tile is-lg"><Icon name="circleCheck" size={24} /></span>}>
          Decisions to confirm, and follow-ups the notes think are yours, show up here.
        </EmptyState>
      )}
    </Card>
  );
}

/** Who says a follow-up is yours: whoever changed what you'd agreed to, gave it to you last, or proposed it, or else the notes. */
function suggestedBy(a: OpenAction): string {
  const last = a.changes.findLast((c) => c.what === 'reassigned' || c.what === 'reopened');
  if (last?.what === 'reopened') return `${firstName(last.by.name)} changed it since you took it on`;
  if (last) return `${firstName(last.by.name)} gave it to you`;
  const proposer = proposerOf(a);
  return proposer ? `${firstName(proposer.name)} suggests you` : 'the notes suggest you';
}
/** Where a decision came from: confirmed by someone already, when it's disputed since; or whose words it's in. */
function decisionFrom(d: PendingDecision, me: string | undefined): string {
  const line = d.state === 'confirmed' ? decisionLine(d, me) : proposedLine(d, me);
  return `${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

/** The note something came from, opening at the moment it was said when the notes know it. */
function From({ noteId, title, at }: { noteId: string; title: string; at?: number | undefined }) {
  return <Link to="/notes/$noteId" params={{ noteId }} search={{ at }} className="hm-src">{title}</Link>;
}

function Row({ item, outcome, busy, now, me, reader, run }: { item: Item; outcome: Outcome | undefined; busy: boolean; now: number; me: string | undefined; reader: NoteReader | undefined; run: (a: Answer) => void }) {
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
      <li className="hm-wait-item">
        <span className="hm-tile"><Icon name="share" size={18} /></span>
        <div className="min-w-0">
          <div className="hm-wait-k">Shared with you · {agoLabel(item.at, now)}</div>
          <p className="hm-wait-t ac-clamp-2" title={said}>{said}</p>
          <div className="hm-wait-acts"><Link to="/notes/$noteId" params={{ noteId: n.id }} className="lk">Read the notes<Icon name="right" size={14} /></Link></div>
        </div>
      </li>
    );
  }

  const decision = item.kind === 'decision';
  // Confirmed already and disputed since: yours to settle, as the organizer.
  const settling = decision && item.d.state === 'confirmed';
  const text = decision ? item.d.text : item.a.text;
  const from = decision ? <From noteId={item.d.noteId} title={item.d.noteTitle} at={item.d.at} /> : <From noteId={item.a.noteId} title={item.a.noteTitle} at={item.a.at} />;
  const k = outcome === 'confirmed' ? 'Confirmed' : outcome === 'rejected' ? 'Not decided' : outcome === 'disputed' ? 'You said it wasn’t decided' : outcome === 'taken' ? 'Taken on' : outcome === 'notMine' ? 'Not yours' : settling ? 'Settle a decision' : decision ? 'Confirm a decision' : 'Is this yours?';
  const icon = outcome === 'confirmed' || outcome === 'taken' ? 'check' : outcome === 'disputed' ? 'alert' : outcome ? 'x' : decision ? 'badgeCheck' : 'userCheck';
  return (
    <li ref={row} tabIndex={-1} className={cn('hm-wait-item', outcome && (outcome === 'notMine' ? 'is-not-mine' : `is-${outcome}`))} aria-busy={busy || undefined}>
      <span className={cn('hm-tile', (outcome === 'confirmed' || outcome === 'taken') && 'is-sun')}><Icon name={icon} size={18} /></span>
      <div className="min-w-0">
        <div className="hm-wait-k">{k}</div>
        <p className="hm-wait-t">{text}</p>
        <p className="hm-wait-from">{from} · {decision ? decisionFrom(item.d, me) : suggestedBy(item.a)}{!decision && item.a.due ? ` · suggested for ${item.a.due}` : ''}</p>
        {!outcome && (
          <div className="hm-wait-ev">
            <Backing evidence={decision ? item.d.evidence : item.a.evidence} me={me} moment={(at) => <MomentLink noteId={decision ? item.d.noteId : item.a.noteId} at={at} />} />
            <EvidenceFlags evidence={decision ? item.d.evidence : item.a.evidence} disputes={decision ? item.d.disputes : undefined} me={me} />
          </div>
        )}
        <div className="hm-wait-acts" role="status">
          {outcome === 'confirmed' || outcome === 'rejected' || outcome === 'disputed' ? (
            <><span>{outcome === 'confirmed' ? 'Confirmed for everyone.' : outcome === 'rejected' ? 'Crossed out for everyone.' : 'Everyone with the notes sees that. The organizer settles it.'}</span>
              {!settling && <button ref={lead} type="button" className="lk quiet" disabled={busy} onClick={() => run('reopened')}>Undo</button>}</>
          ) : outcome === 'taken' ? <span>It’s in your follow-ups.</span>
            : outcome === 'notMine' ? (
              <><span>Nobody has it now.</span>
                <button ref={lead} type="button" className="lk quiet" disabled={busy} onClick={() => run('mine')}>It’s mine</button></>
            )
              : decision ? (
                <><button ref={lead} type="button" className="lk" disabled={busy} onClick={() => run('confirmed')}><Icon name="check" size={15} />{settling ? 'Keep it confirmed' : 'Confirm'}</button>
                  <button type="button" className="lk quiet" disabled={busy} onClick={() => run(reader && mayDecide(item.d, 'rejected', reader) ? 'rejected' : 'disputed')}>It wasn’t decided</button></>
              ) : (
                <><button ref={lead} type="button" className="lk" disabled={busy} onClick={() => run('taken')}>I’ll do it</button>
                  <button type="button" className="lk quiet" disabled={busy} onClick={() => run('notMine')}>Not mine</button></>
              )}
        </div>
      </div>
    </li>
  );
}

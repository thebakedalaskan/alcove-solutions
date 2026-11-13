/*
 * The call's follow-ups: one shared checklist, ticked for everyone, and what the call suggests, kept apart from it until
 * someone adds it. Two views of them start from the same preparation (useCallFollowUps): the section in the call's Notes
 * panel (NotesFollowUps), and the workspace's Follow-ups page (CallFollowUps).
 */
import { firstName, isAcceptedFollowUp, type CallSession, type FollowUpReview as Review, type LiveFollowUp, type Person, type TranscriptMoment } from '@alcove/api';
import { Avatar, Button, Check, DURATION, EASE, Icon, IconButton, TimeChip, WsFollowUps, WsPutArrow, cn, useToast, type FollowUpValues, type WsFollowUp } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FollowUpForm } from '~/features/notes/follow-ups/FollowUpForm';
import { FollowUpReview } from '~/features/notes/follow-ups/FollowUpReview';
import type { FollowUpProposal } from '~/features/notes/follow-ups/useFollowUpReview';
import { NO_DATE, dueWords } from '~/features/workspace/live/dates';
import { NO_IDS } from '~/features/workspace/sharing/ids';
import type { LiveHost } from '~/features/workspace/live/host';
import { clockAt, notesOnHere, personNamed } from '~/features/workspace/live/lines';
import type { LivePut } from '~/features/workspace/live/types';
import { useFollowUps, type FollowUpRow } from '~/features/workspace/live/useFollowUps';
import { useLive } from '~/lib/live';
import { callQueries } from '~/features/calls/list/queries';
import { SuggestedFollowUps, type SuggestedFollowUp } from './SuggestedFollowUps';

/** What the checklist needs from round it: the workspace, round its page; the call alone, round the Notes panel. */
type Around = Pick<LiveHost, 'here' | 'workspaceId' | 'go' | 'say' | 'ids'>;

/** Round the Notes panel there's no workspace: nobody is in one, and nothing opens in it. */
const NOBODY: LiveHost['here'] = [];
const noGo: LiveHost['go'] = () => undefined;

/** A suggestion as both views decide on it (`proposal`, its times not drawn yet), and what it came from. */
interface CallSuggestion { proposal: FollowUpProposal; from: LiveFollowUp }

/**
 * What both views share: the checklist (useFollowUps) and what each of its rows can do (edit it in place, or for a line in a
 * document, open it there; and send it to a document with `put`); the form to add one, with focus back on `addButton` once
 * it closes; and each suggestion as a proposal to decide on. `invited`: who a follow-up can be for, besides who's here.
 */
function useCallFollowUps({ session, around, put, invited }: {
  session: CallSession; around: Around; put: LivePut | null | undefined; invited: readonly Person[];
}) {
  const state = useLive(session);
  const meeting = useQuery({ ...callQueries.byCode(state.code), enabled: state.isOrganizer }).data;
  const written = useLive(session.followUps);
  const { rows, tick, canAdd } = useFollowUps({ ...around, session });
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  useEffect(() => { if (!adding && returning.current) { returning.current = false; addButton.current?.focus(); } }, [adding]);
  const [editing, setEditing] = useState<{ id: string; revision: string; initial: FollowUpValues } | null>(null);
  useEffect(() => session.watchFollowUps(), [session]);
  const watching = notesOnHere(state);
  useEffect(() => (watching ? session.watchNotes() : undefined), [watching, session]);
  const actual = [...(state.liveNotes.notes?.next ?? []), ...state.liveNotes.added].filter(isAcceptedFollowUp);
  const actualById = new Map(actual.map((item) => [item.id, item]));
  const people = [...new Map([...invited, ...(meeting?.guests ?? []), ...state.participants.map((p) => p.person), ...actual.flatMap((f) => f.ownerPerson ? [f.ownerPerson] : [])].filter((p) => p.email).map((p) => [p.email, p])).values()];
  const namedOwner = (email: string | null) => people.find((p) => p.email === email)?.name ?? email;
  const lines = rows.map((row) => {
    const item = actualById.get(row.id);
    if (!item) return { row, item, onEdit: row.locked ? undefined : row.onSource, editor: undefined, actions: undefined };
    const initial = { text: item.text, owner: item.ownerPerson?.email || null, due: item.due ?? null };
    return {
      row, item,
      onEdit: row.locked ? undefined : () => setEditing({ id: row.id, revision: item.revision, initial }),
      editor: editing?.id === row.id ? <FollowUpForm key={row.id} initial={editing.initial} people={people} onDone={() => setEditing(null)} onSave={(value) => {
        const before = editing.initial;
        const patch = { ...(value.text === before.text ? {} : { text: value.text }), ...(value.owner === before.owner ? {} : { owner: value.owner }), ...(value.due === before.due ? {} : { due: value.due }) };
        return Object.keys(patch).length ? session.updateFollowUp(item.id, { seen: { revision: editing.revision, ...before }, ...patch }) : Promise.resolve();
      }} /> : undefined,
      actions: put ? <WsPutArrow verb="Add to" target={put.target} onPut={() => put.followUp(item)} /> : undefined
    };
  });
  const addForm = <FollowUpForm initial={{ text: '', owner: null, due: null }} people={people} saveLabel="Add" onSave={(value) => session.addFollowUp(value)} onDone={() => { returning.current = true; setAdding(false); }} />;
  const suggestions = [...new Map([...(written?.suggestions ?? []), ...state.liveNotes.suggestions].map((p) => [p.id, p])).values()].map((from): CallSuggestion => ({
    from,
    proposal: {
      id: from.id, revision: from.revision, text: from.text, owner: from.owner ?? null, due: from.due ?? null,
      target: from.target ? { ...from.target, owner: namedOwner(from.target.owner) } : null, allowed: canAdd
    }
  }));
  const onReview = (review: Review) => session.reviewFollowUp(review);
  return { state, rows, tick, canAdd, lines, adding, setAdding, addButton, addForm, suggestions, onReview };
}

/**
 * The follow-ups in the call's Notes panel, a section with its own heading: the checklist, + to add one in place, and what the
 * call suggests listed under it (SuggestedFollowUps.tsx). A time said opens the panel's transcript there (`onSeek`); `put`
 * sends a follow-up to the document you were last in; `people` are everyone invited, whom a follow-up can be for. With no
 * workspace round the panel, a tick that fails says so in a toast.
 */
export function NotesFollowUps({ session, put, onSeek, people }: {
  session: CallSession; put: LivePut | null | undefined; onSeek: (moment: TranscriptMoment) => void; people: readonly Person[];
}) {
  const toast = useToast();
  const say = useCallback<LiveHost['say']>((data) => { toast(data.text, { icon: data.icon, action: data.action, ms: data.ms }); }, [toast]);
  const { state, rows, tick, canAdd, lines, adding, setAdding, addButton, addForm, suggestions, onReview } = useCallFollowUps({
    session, around: { here: NOBODY, workspaceId: null, go: noGo, say, ids: NO_IDS }, put, invited: people
  });
  const section = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const now = new Date();
  const time = (moment: TranscriptMoment) => <TimeChip key={moment.lineId} seconds={moment.said} label={clockAt(state, moment.said)} title="Open the transcript here" onSeek={() => onSeek(moment)} />;
  const suggested = suggestions.map(({ proposal, from }): SuggestedFollowUp => {
    const was = proposal.target;
    return {
      ...proposal,
      evidence: from.evidence.length ? from.evidence.map(time) : undefined,
      person: from.ownerPerson ?? (proposal.owner ? personNamed(state, proposal.owner) ?? { name: proposal.owner } : null),
      name: proposal.owner ? firstName(proposal.owner) : '',
      when: proposal.due ? dueWords(proposal.due, now) : null,
      was: was && [was.text, was.owner && firstName(was.owner), was.due && dueWords(was.due, now)].filter(Boolean).join(' · ')
    };
  });
  const move = { duration: reduce ? 0 : DURATION[2], ease: EASE.out };
  return (
    <section ref={section} tabIndex={-1} className="nn-sec is-fol" aria-label="Follow-ups">
      <div className="nn-sh">
        <h3>Follow-ups</h3>
        {rows.length > 0 && <span className="n">{rows.length}</span>}
        <span className="sp" />
        {canAdd && <IconButton ref={addButton} icon="plus" label="Add a follow-up" size={16} on={adding} aria-expanded={adding} onClick={() => setAdding((open) => !open)} />}
      </div>
      <AnimatePresence initial={false}>
        {lines.map(({ row, item, onEdit, editor, actions }) => {
          const moment = item?.evidence[0];
          return <FollowUpLine key={row.id} row={row} time={moment && time(moment)} onTick={tick} onEdit={onEdit} editor={editor} actions={actions} move={move} />;
        })}
      </AnimatePresence>
      {canAdd && adding && <div className="nn-row is-editing">{addForm}</div>}
      <SuggestedFollowUps proposals={suggested} onReview={onReview} after={section}
        empty={rows.length === 0 && !adding && <p className="nn-quiet">Nothing to do yet.</p>} />
    </section>
  );
}

/**
 * The workspace's Follow-ups page: everyone's or yours, Add a follow-up under them, and the suggestions behind a count that
 * opens a fixed batch to review (FollowUpReview.tsx). A time said opens the call's Transcript page there. `notice` says what's
 * holding the notes back.
 */
export function CallFollowUps({ session, host, notice }: { session: CallSession; host: LiveHost; notice: ReactNode }) {
  const { state, rows, tick, canAdd, lines, adding, setAdding, addButton, addForm, suggestions, onReview } = useCallFollowUps({ session, around: host, put: host.put, invited: [] });
  const [mine, setMine] = useState(false);
  const seek = (moment: TranscriptMoment) => host.go({ kind: 'live', page: 'transcript', line: moment.lineId });
  const proposals = suggestions.map(({ proposal, from }): FollowUpProposal => ({
    ...proposal,
    evidence: from.evidence.length ? <div className="ac-follow-evidence">{from.evidence.map((moment) => (
      <Button key={moment.lineId} variant="quiet" size="xs" title="Open the transcript here" onClick={() => seek(moment)}>{clockAt(state, moment.said)}</Button>
    ))}</div> : undefined
  }));
  const rendered = lines.map(({ row, item, onEdit, editor, actions }): WsFollowUp => {
    const moment = item?.evidence[0];
    return { ...row, onSource: row.onSource ?? (moment ? () => seek(moment) : undefined), onEdit, editor, actions };
  });
  const mineIds = new Set(rows.filter((row) => row.mine).map((row) => row.id));
  const yours = rendered.filter((row) => mineIds.has(row.id));
  return <WsFollowUps mine={mine} onMine={setMine} everyoneCount={rows.length} mineCount={yours.length} rows={mine ? yours : rendered} onTick={tick} notice={notice}>
    {canAdd && (adding ? addForm : <Button ref={addButton} variant="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>Add a follow-up</Button>)}
    <FollowUpReview proposals={proposals} onReview={onReview} />
  </WsFollowUps>;
}

/**
 * A follow-up in the call's Notes panel: the kit's box, which anyone permitted ticks, the words with whose it is and when (and
 * the document it's in), and at its right the time it was said, which opens the transcript there, with edit and the arrow.
 * Editing puts the form in its place, and focus comes back to edit when it's done.
 */
function FollowUpLine({ row, time, onTick, onEdit, editor, actions, move }: {
  row: FollowUpRow; time: ReactNode; onTick: (id: string) => void; onEdit: (() => void) | undefined; editor: ReactNode; actions: ReactNode;
  move: { duration: number; ease: typeof EASE.out };
}) {
  const edit = useRef<HTMLButtonElement>(null);
  const editing = Boolean(editor);
  const wasEditing = useRef(false);
  /* Back from editing, focus goes to the pen that opened it. */
  useEffect(() => {
    if (wasEditing.current && !editing) edit.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  if (editing) return <div className="nn-row is-editing">{editor}</div>;
  const dated = row.due !== NO_DATE;
  return (
    <motion.div className={cn('nn-row is-fol', row.done && 'is-done')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={move}>
      <Check checked={row.done} disabled={row.locked} onChange={() => onTick(row.id)} label={`Mark done: ${row.text}`} />
      <div className="nn-tx">
        <p>{row.text}</p>
        {(row.person || dated || row.document) && (
          <div className="mt">
            {row.person && <><Avatar person={row.person} size={16} /><span>{row.name}</span></>}
            {dated && <span className="due">{row.due}</span>}
            {row.document && (row.onSource
              ? <button type="button" className="src" title="Open it there" onClick={row.onSource}><Icon name="fileText" size={12} /><span className="ac-clamp-1">{row.document}</span></button>
              : <span className="src"><Icon name="fileText" size={12} /><span className="ac-clamp-1">{row.document}</span></span>)}
          </div>
        )}
      </div>
      <div className="end">
        {time}
        {onEdit && <IconButton ref={edit} icon="pen" label="Edit follow-up" size={14} onClick={onEdit} />}
        {actions}
      </div>
    </motion.div>
  );
}

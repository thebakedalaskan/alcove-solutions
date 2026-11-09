import { isAcceptedFollowUp, type CallSession, type Person, type TranscriptMoment } from '@alcove/api';
import { Button, WsFollowUps, WsPutArrow, useToast, type FollowUpValues, type WsFollowUp } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FollowUpForm } from '~/features/notes/FollowUpForm';
import { FollowUpReview, type FollowUpProposal } from '~/features/notes/FollowUpReview';
import { NO_IDS } from '~/features/workspace/ids';
import type { LiveHost } from '~/features/workspace/live/host';
import { clockAt, notesOnHere } from '~/features/workspace/live/lines';
import type { LivePut } from '~/features/workspace/live/types';
import { useFollowUps } from '~/features/workspace/live/useFollowUps';
import { useLive } from '~/lib/live';
import { q } from '~/lib/queries';

const noGo: LiveHost['go'] = () => undefined;

/** The same actual checklist and optional review in the workspace and beside the call. */
export function CallFollowUps({ session, host, compact = false, notice, put, onSeek, people: invited = [] }: {
  session: CallSession; host?: LiveHost | undefined; compact?: boolean | undefined; notice?: ReactNode;
  put?: LivePut | null | undefined; onSeek?: ((moment: TranscriptMoment) => void) | undefined; people?: readonly Person[] | undefined;
}) {
  const state = useLive(session);
  const meeting = useQuery({ ...q.byCode(state.code), enabled: state.isOrganizer }).data;
  const written = useLive(session.followUps);
  const toast = useToast();
  const say = useCallback<LiveHost['say']>((data) => { toast(data.text, { icon: data.icon, action: data.action, ms: data.ms }); }, [toast]);
  const { rows, tick, canAdd } = useFollowUps({ session, here: host?.here ?? [], workspaceId: host?.workspaceId ?? null, go: host?.go ?? noGo, say: host?.say ?? say, ids: host?.ids ?? NO_IDS });
  const [mine, setMine] = useState(false);
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
  const seek = onSeek ?? (host ? (moment: TranscriptMoment) => host.go({ kind: 'live', page: 'transcript', line: moment.lineId }) : undefined);
  const suggestions = [...new Map([...(written?.suggestions ?? []), ...state.liveNotes.suggestions].map((p) => [p.id, p])).values()];
  const namedOwner = (email: string | null) => people.find((p) => p.email === email)?.name ?? email;
  const proposals = suggestions.map((p): FollowUpProposal => ({
    id: p.id, revision: p.revision, text: p.text, owner: p.owner ?? null, due: p.due ?? null,
    target: p.target ? { ...p.target, owner: namedOwner(p.target.owner) } : null,
    allowed: canAdd,
    evidence: p.evidence.length ? <div className="ac-follow-evidence">{p.evidence.map((moment) => seek
      ? <Button key={moment.lineId} variant="quiet" size="xs" title="Open the transcript here" onClick={() => seek(moment)}>{clockAt(state, moment.said)}</Button>
      : <span key={moment.lineId}>{clockAt(state, moment.said)}</span>)}</div> : undefined
  }));
  const rendered = rows.map((row): WsFollowUp => {
    const item = actualById.get(row.id);
    if (!item) return { ...row, onEdit: row.locked ? undefined : row.onSource };
    const target = put ?? host?.put;
    const initial = { text: item.text, owner: item.ownerPerson?.email || null, due: item.due ?? null };
    return {
      ...row,
      onSource: row.onSource ?? (item.evidence[0] && seek ? () => { const moment = item.evidence[0]; if (moment) seek(moment); } : undefined),
      onEdit: row.locked ? undefined : () => setEditing({ id: row.id, revision: item.revision, initial }),
      editor: editing?.id === row.id ? <FollowUpForm key={row.id} initial={editing.initial} people={people} onDone={() => setEditing(null)} onSave={(value) => {
        const before = editing.initial;
        const patch = { ...(value.text === before.text ? {} : { text: value.text }), ...(value.owner === before.owner ? {} : { owner: value.owner }), ...(value.due === before.due ? {} : { due: value.due }) };
        return Object.keys(patch).length ? session.updateFollowUp(item.id, { seen: { revision: editing.revision, ...before }, ...patch }) : Promise.resolve();
      }} /> : undefined,
      actions: target ? <WsPutArrow verb="Add to" target={target.target} onPut={() => target.followUp(item)} /> : undefined
    };
  });
  const mineIds = new Set(rows.filter((row) => row.mine).map((row) => row.id));
  const yours = rendered.filter((row) => mineIds.has(row.id));
  return <WsFollowUps compact={compact} mine={mine} onMine={setMine} everyoneCount={rows.length} mineCount={yours.length} rows={mine ? yours : rendered} onTick={tick} notice={notice}>
    {canAdd && (adding ? <FollowUpForm initial={{ text: '', owner: null, due: null }} people={people} saveLabel="Add" onSave={(value) => session.addFollowUp(value)} onDone={() => { returning.current = true; setAdding(false); }} />
      : <Button ref={addButton} variant="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>Add a follow-up</Button>)}
    <FollowUpReview proposals={proposals} onReview={(review) => session.reviewFollowUp(review)} />
  </WsFollowUps>;
}

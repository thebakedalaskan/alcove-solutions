import { errorMessage, type CallFeedback, type CallFeedbackKind, type CallQuestion, type CallSession, type CallState } from '@alcove/api';
import { AttentionHand, AttentionQuestion, AttentionSection, Button, CallSignal, CallSignalChoices, EmptyState, Tabs, useToast, type IconName } from '@alcove/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { log } from '~/lib/log';
import { useDraft, type Draft } from './side';

const alog = log.child({ component: 'call-attention' });
export const SIGNAL_CHOICES: readonly { value: CallFeedbackKind; label: string; icon: IconName }[] = [
  { value: 'cant-hear', label: 'Can’t hear you', icon: 'hear' },
  { value: 'slow-down', label: 'Slow down', icon: 'pace' },
  { value: 'yes', label: 'Yes', icon: 'check' },
  { value: 'no', label: 'No', icon: 'x' },
  { value: 'need-break', label: 'Need a break', icon: 'away' }
];
export const signalChoice = (kind: CallFeedbackKind) => SIGNAL_CHOICES.find((c) => c.value === kind);
export type AttentionTab = 'hands' | 'questions' | 'signals' | 'waiting';
/** Kept with its room above the panel, including an ambiguous request's retry identity. */
export interface QuestionDraft extends Draft { submission: { id: string; text: string } | null }

/** Shared call questions, hands and feedback. Ask in Notes remains a private AI conversation. */
export function AttentionView({ session, state, ready, signals, presenter, draft, waiting, tab, onTab }: {
  session: CallSession; state: CallState; ready: boolean; signals: CallFeedback[]; presenter: boolean; draft: QuestionDraft; waiting: ReactNode;
  tab: AttentionTab; onTab: (tab: AttentionTab) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [text, setText] = useDraft(draft);
  const composeId = useId();
  const [sort, setSort] = useState<'votes' | 'recent'>('votes');
  const [order, setOrder] = useState<{ place: string; ids: string[] }>({ place: state.attention.place, ids: [] });
  const [closed, setClosed] = useState(false);
  const me = state.participants.find((p) => p.isMe);
  const attention = state.attention;
  const questions = attention.questions;
  const opens = questions.filter((q) => q.status === 'open');
  const host = state.isHost;
  const confirmSubmission = (id: string) => {
    const submitted = draft.submission;
    if (submitted?.id !== id) return;
    draft.submission = null;
    if (draft.text.trim() !== submitted.text) return;
    draft.text = '';
    setText('');
  };
  // A snapshot is confirmation even when the command's response was lost, including after reopening the panel.
  const confirmed = draft.submission && questions.some((q) => q.id === draft.submission?.id) ? draft.submission.id : null;
  useEffect(() => { if (confirmed) confirmSubmission(confirmed); }, [confirmed, draft]);
  const ownHand = attention.hands.find((h) => h.participantId === me?.id);
  const mine = signals.find((s) => s.participantId === me?.id)?.kind ?? null;
  const run = (key: string, action: () => Promise<void>, success?: string, then?: () => void) => {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(key);
    const requestedPlace = attention.place;
    action().then(() => { if (session.getSnapshot().attention.place !== requestedPlace) return; if (success) toast(success, { icon: 'check' }); then?.(); }, (err: unknown) => {
      alog.warn('call attention action failed', { err });
      toast(errorMessage(err), { icon: 'x' });
    }).finally(() => { pending.current = false; setBusy(null); });
  };
  const sorted = (qs: CallQuestion[], by: typeof sort) => [...qs].sort((a, b) => by === 'votes' ? b.votes - a.votes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  // Preserve the order already being read as votes arrive. Refresh explicitly applies the current ranking.
  const existing = new Set(questions.map((q) => q.id));
  const kept = order.place === attention.place ? order.ids.filter((id) => existing.has(id)) : [];
  const known = new Set(kept);
  const ids = [...kept, ...sorted(questions.filter((q) => !known.has(q.id)), sort).map((q) => q.id)];
  if (order.place !== attention.place || order.ids.length !== ids.length || ids.some((id, i) => order.ids[i] !== id)) setOrder({ place: attention.place, ids });
  const reorder = (by: typeof sort) => setOrder({ place: attention.place, ids: sorted(questions, by).map((q) => q.id) });
  const shown = ids.flatMap((id) => { const q = questions.find((q) => q.id === id); return q && (closed || q.status === 'open') ? [q] : []; });
  const options = [
    { value: 'hands' as const, label: `Hands ${attention.hands.length}` },
    { value: 'questions' as const, label: `Q&A ${opens.length}` },
    { value: 'signals' as const, label: 'Signals' },
    ...(host ? [{ value: 'waiting' as const, label: `Waiting ${state.waiting.length}` }] : [])
  ];
  const activeTab = tab === 'waiting' && !host ? 'hands' : tab;
  const disabled = busy !== null || !ready;
  return <div className="ic-attention-body">
    <Tabs className="ic-attention-tabs" label="Call attention" value={activeTab} onChange={onTab} options={options} />
    {!ready ? <EmptyState art={null} title="Finding this room" >Requests appear once your connection is ready.</EmptyState> : activeTab === 'waiting' ? state.waiting.length ? waiting : <EmptyState art={null} title="No one waiting">New requests to join appear here.</EmptyState> : <>
      <div className="ic-attention-scroll">
        {activeTab === 'hands' && <AttentionSection title="In order raised" action={host && attention.hands.length > 0 ? <Button size="xs" variant="quiet" disabled={disabled} onClick={() => run('hands', () => session.clearHands(), 'All hands lowered')}>Lower all</Button> : undefined}>
          <Button className="ic-attention-mine" variant="secondary" size="sm" icon="hand" disabled={disabled} onClick={() => run('hand', () => session.setHand(!ownHand), ownHand ? 'Your hand is lowered' : 'Your hand is raised. Everyone in this room can see it.')}>{ownHand ? 'Lower your hand' : 'Raise your hand'}</Button>
          {!attention.hands.length ? <EmptyState art={null} title="No hands raised" >Raise a hand when you’d like a turn.</EmptyState> : <ol className="ic-attention-hands">{attention.hands.map((h, i) => {
            const p = state.participants.find((p) => p.id === h.participantId || p.seat === h.seat);
            return <AttentionHand key={h.id} number={i + 1} person={p?.person ?? { name: 'Someone' }} detail={p?.isMe ? 'Your hand is raised' : 'Waiting for a turn'} busy={disabled} lower={host || p?.isMe ? { label: p?.isMe ? 'Lower yours' : 'Lower', onClick: () => run(h.id, () => p?.isMe ? session.setHand(false) : session.lowerHand(h.id), p?.isMe ? 'Your hand is lowered' : 'Hand lowered') } : null} />;
          })}</ol>}
        </AttentionSection>}
        {activeTab === 'questions' && <AttentionSection title="Questions for this room">
          <div className="ic-attention-sort" role="group" aria-label="Question order"><button type="button" aria-pressed={sort === 'votes'} onClick={() => { setSort('votes'); reorder('votes'); }}>Most votes</button><button type="button" aria-pressed={sort === 'recent'} onClick={() => { setSort('recent'); reorder('recent'); }}>Newest</button><button type="button" onClick={() => reorder(sort)}>Refresh order</button></div>
          {!shown.length && <EmptyState art={null} title="No open questions" >Post a question for the people in this room.</EmptyState>}
          {shown.map((q) => <AttentionQuestion key={q.id} author={q.author} text={q.text} votes={q.votes} voted={q.voted} status={q.status} pinned={q.pinned} busy={disabled}
            onVote={() => run(q.id, () => session.voteQuestion(q.id, !q.voted))}
            actions={host ? { pin: () => run(q.id, () => session.pinQuestion(q.pinned ? null : q.id), q.pinned ? 'Question unpinned' : 'Question pinned'), answer: () => run(q.id, () => session.resolveQuestion(q.id, 'answered'), 'Question marked answered'), dismiss: () => run(q.id, () => session.resolveQuestion(q.id, 'dismissed'), 'Question dismissed') } : undefined} />)}
          {questions.some((q) => q.status !== 'open') && <Button size="sm" variant="quiet" onClick={() => setClosed(!closed)}>{closed ? 'Hide resolved questions' : 'Show resolved questions'}</Button>}
        </AttentionSection>}
        {activeTab === 'signals' && <AttentionSection title="Send a quiet signal">
          <CallSignalChoices choices={SIGNAL_CHOICES} selected={mine} busy={disabled} onChange={(value) => { const kind = SIGNAL_CHOICES.find((c) => c.value === value)?.value ?? null; run('signal', () => session.setFeedback(kind), kind ? 'Signal sent to this room' : 'Your signal is cleared'); }} />
          <p className="ac-caption" style={{ marginTop: 'var(--space-3)', color: 'var(--ink-2)' }}>Shown beside your tile for a moment. Press it again to clear it.</p>
          {(host || presenter) && <div className="ic-attention-summary" aria-label="Signals in this room">{SIGNAL_CHOICES.flatMap((c) => { const count = signals.filter((s) => s.kind === c.value).length; return count ? [<CallSignal key={c.value} label={c.label} icon={c.icon} count={count} />] : []; })}</div>}
        </AttentionSection>}
      </div>
      {activeTab === 'questions' && <form className="ic-attention-compose" onSubmit={(e) => { e.preventDefault(); const clean = text.trim(); if (!clean || disabled) return; const submitted = draft.submission?.text === clean ? draft.submission : { id: crypto.randomUUID(), text: clean }; draft.submission = submitted; run('question', () => session.postQuestion(submitted.id, submitted.text), 'Question posted to this room', () => confirmSubmission(submitted.id)); }}>
        <label htmlFor={composeId}>Post a question to everyone in this room</label><textarea id={composeId} value={text} maxLength={1000} onChange={(e) => { const next = e.target.value; if (draft.submission && draft.submission.text !== next.trim()) draft.submission = null; draft.text = next; setText(next); }} placeholder="What would you like to ask?" disabled={disabled} />
        <div className="foot"><span>Q&A is shared with this room</span><Button variant="primary" size="sm" type="submit" disabled={disabled || !text.trim()}>{busy === 'question' ? 'Posting…' : 'Post question'}</Button></div>
      </form>}
    </>}
  </div>;
}

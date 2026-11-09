/*
 * The room's questions, in Chat: asked by name or anonymously, voted up, and pinned, answered or dismissed by whoever hosts.
 * Whoever asked can take theirs back. They're the server's, for the people in the room when each was asked; the draft and
 * the order you're reading in are this screen's.
 */
import { errorMessage, type CallQuestion as Question, type CallSession, type CallState } from '@alcove/api';
import { CallQuestion, EmptyState, Icon, Switch, useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { hm } from '~/lib/time';
import { useActionFocus, type ActionJump } from './actionFocus';
import { useDraft, type Draft } from './side';

const qlog = log.child({ component: 'call-questions' });

/** What's typed, kept with its room above the panel, with an unconfirmed ask's ID so a retry can't post it twice. */
export interface QuestionDraft extends Draft { anonymous: boolean; submission: { id: string; text: string; anonymous: boolean } | null }
export const newQuestionDraft = (): QuestionDraft => ({ text: '', anonymous: false, submission: null });

type Order = 'votes' | 'recent';
const ranked = (qs: readonly Question[], by: Order) => [...qs].sort((a, b) => by === 'votes'
  ? b.votes - a.votes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  : b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

export function ChatQuestions({ session, state, ready, draft, jump }: {
  session: CallSession; state: CallState; ready: boolean; draft: QuestionDraft; jump?: ActionJump | undefined;
}) {
  const focus = useActionFocus(jump);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [text, setText] = useDraft(draft);
  const [anonymous, setAnonymous] = useState(draft.anonymous);
  const [sort, setSort] = useState<Order>('votes');
  const [order, setOrder] = useState<{ place: string; ids: string[] }>({ place: state.attention.place, ids: [] });
  const [closed, setClosed] = useState(false);
  const attention = state.attention;
  const questions = attention.questions;
  const host = state.isHost;
  const confirm = (id: string) => {
    const submitted = draft.submission;
    if (submitted?.id !== id) return;
    draft.submission = null;
    if (draft.text.trim() !== submitted.text) return;
    draft.text = '';
    setText('');
  };
  // A snapshot is confirmation even when the request's answer was lost, including after reopening the panel.
  const confirmed = draft.submission && questions.some((q) => q.id === draft.submission?.id) ? draft.submission.id : null;
  useEffect(() => { if (confirmed) confirm(confirmed); }, [confirmed, draft]);
  const run = (key: string, action: () => Promise<void>, success?: string, then?: () => void) => {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(key);
    const asked = attention.place;
    action().then(() => { if (session.getSnapshot().attention.place !== asked) return; if (success) toast(success, { icon: 'check' }); then?.(); }, (err: unknown) => {
      qlog.warn('question action failed', { err });
      toast(errorMessage(err), { icon: 'x' });
    }).finally(() => { pending.current = false; setBusy(null); });
  };
  // The order being read stays put as votes come in; a new question joins at its place, and choosing an order applies it.
  const existing = new Set(questions.map((q) => q.id));
  const kept = order.place === attention.place ? order.ids.filter((id) => existing.has(id)) : [];
  const known = new Set(kept);
  const ids = [...kept, ...ranked(questions.filter((q) => !known.has(q.id)), sort).map((q) => q.id)];
  if (order.place !== attention.place || order.ids.length !== ids.length || ids.some((id, i) => order.ids[i] !== id)) setOrder({ place: attention.place, ids });
  const reorder = (by: Order) => { setSort(by); setOrder({ place: attention.place, ids: ranked(questions, by).map((q) => q.id) }); };
  const byId = new Map(questions.map((q) => [q.id, q]));
  const listed = ids.flatMap((id) => { const q = byId.get(id); return q && (closed || q.status === 'open') ? [q] : []; });
  // The pinned question leads, whatever the order.
  const shown = [...listed.filter((q) => q.pinned), ...listed.filter((q) => !q.pinned)];
  const stale = ranked(questions, sort).map((q) => q.id).join() !== ids.join();
  const resolved = questions.filter((q) => q.status !== 'open').length;
  const disabled = busy !== null || !ready;
  const ask = () => {
    const clean = text.trim();
    if (!clean || disabled) return;
    const submitted = draft.submission?.text === clean && draft.submission.anonymous === anonymous ? draft.submission : { id: crypto.randomUUID(), text: clean, anonymous };
    draft.submission = submitted;
    run('ask', () => session.postQuestion(submitted.id, submitted.text, submitted.anonymous), submitted.anonymous ? 'Asked anonymously. Nobody is told it’s yours.' : 'Question asked', () => confirm(submitted.id));
  };
  if (!ready) return <EmptyState art={null} title="Finding this room" className="ch-empty">Questions appear once your connection is ready.</EmptyState>;
  return (
    <>
      <div className="ch-qbar" role="group" aria-label="Question order">
        <button type="button" aria-pressed={sort === 'votes'} onClick={() => reorder('votes')}>Most votes</button>
        <button type="button" aria-pressed={sort === 'recent'} onClick={() => reorder('recent')}>Newest</button>
        {stale && <><span className="sep" aria-hidden="true" /><button type="button" onClick={() => reorder(sort)}>Reorder</button></>}
        {resolved > 0 && <button type="button" className="end" aria-pressed={closed} onClick={() => setClosed(!closed)}>{closed ? 'Hide answered' : `Show answered · ${resolved}`}</button>}
      </div>
      <div ref={focus} className="ch-scroll">
        {shown.length ? (
          <div className="ch-qs">
            {shown.map((q) => <CallQuestion key={q.id} id={q.id} text={q.text} author={q.author} own={q.own} time={hm(q.createdAt)} votes={q.votes} voted={q.voted}
              status={q.status} pinned={q.pinned} busy={disabled}
              onVote={() => run(q.id, () => session.voteQuestion(q.id, !q.voted))}
              host={host ? {
                onPin: () => run(q.id, () => session.pinQuestion(q.pinned ? null : q.id), q.pinned ? 'Question unpinned' : 'Question pinned'),
                onAnswer: () => run(q.id, () => session.resolveQuestion(q.id, 'answered'), 'Marked answered'),
                onDismiss: () => run(q.id, () => session.resolveQuestion(q.id, 'dismissed'), 'Question dismissed')
              } : undefined}
              onWithdraw={q.own ? () => run(q.id, () => session.withdrawQuestion(q.id), 'Your question is taken back') : undefined} />)}
          </div>
        ) : (
          <EmptyState art={null} title={questions.length ? 'No open questions' : 'No questions yet'} className="ch-empty">
            Ask everyone in this room. The questions with the most votes come first.
          </EmptyState>
        )}
      </div>
      <form className="ch-compose" autoComplete="off" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input className="ch-input" value={text} maxLength={1000} disabled={!ready} placeholder="Ask a question" aria-label="Ask everyone in this room a question"
          onChange={(e) => { const next = e.target.value; if (draft.submission && draft.submission.text !== next.trim()) draft.submission = null; setText(next); }} />
        <div className="ch-tools">
          <label className="ch-also"><Switch checked={anonymous} onChange={(on) => { draft.anonymous = on; setAnonymous(on); }} label="Ask anonymously" />Ask anonymously</label>
          <button type="submit" className="ac-btn is-primary ch-send" aria-label={anonymous ? 'Ask anonymously' : 'Ask'} title={anonymous ? 'Ask anonymously' : 'Ask'} disabled={disabled || !text.trim()}><Icon name="sendLine" size={16} /></button>
        </div>
      </form>
    </>
  );
}

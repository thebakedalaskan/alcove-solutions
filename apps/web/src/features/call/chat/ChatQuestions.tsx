/*
 * The room's questions, in Chat: asked by name or anonymously, voted up, and pinned, answered, dismissed or reopened by whoever
 * hosts. Whoever asked can take theirs back. They're the server's, for the people in the room when each was asked; the draft and
 * the order you're reading in are this screen's. The order chosen holds whenever the pointer is away from the list, no finger
 * has been on it or scrolled it for a moment, and nothing in it has keyboard focus; meanwhile nothing moves, so a row never
 * slides away as it's pressed, and the bar offers to sort.
 */
import { errorMessage, type CallQuestion as Question, type CallSession, type CallState } from '@alcove/api';
import { CallQuestion, EmptyState, Icon, Switch, useToast } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { log } from '~/lib/log';
import { hm } from '~/lib/time';
import { useActionFocus, type ActionJump } from '../layout/actionFocus';
import { useDraft, type Draft } from '../layout/side';
import { useTouchHold } from '../layout/touchHold';

const qlog = log.child({ component: 'call-questions' });

/** What's typed, kept with its room above the panel, with an unconfirmed ask's ID so a retry can't post it twice. */
export interface QuestionDraft extends Draft { anonymous: boolean; submission: { id: string; text: string; anonymous: boolean } | null }
export const newQuestionDraft = (): QuestionDraft => ({ text: '', anonymous: false, submission: null });

type Order = 'votes' | 'recent';
const ranked = (qs: readonly Question[], by: Order) => [...qs].sort((a, b) => by === 'votes'
  ? b.votes - a.votes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  : b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
/** The pinned question leads, whatever the order. */
const pinnedFirst = (qs: readonly Question[]) => [...qs.filter((q) => q.pinned), ...qs.filter((q) => !q.pinned)];
/** Rows gliding to their new places: --duration-2 on --ease-in-out. */
const GLIDE = { duration: 0.24, ease: [0.65, 0, 0.35, 1] } as const;

export function ChatQuestions({ session, state, ready, draft, jump }: {
  session: CallSession; state: CallState; ready: boolean; draft: QuestionDraft; jump?: ActionJump | undefined;
}) {
  const focus = useActionFocus(jump);
  const toast = useToast();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [text, setText] = useDraft(draft);
  const [anonymous, setAnonymous] = useState(draft.anonymous);
  const [sort, setSort] = useState<Order>('votes');
  const [order, setOrder] = useState<{ place: string; ids: string[] }>({ place: state.attention.place, ids: [] });
  /*
   * The order holds while a mouse or pen points at the questions or their bar, while a finger is on them and a moment after,
   * while one of them has keyboard focus, and while a question's menu is open.
   */
  const [pointing, setPointing] = useState(false);
  const touch = useTouchHold();
  const [keyed, setKeyed] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const hold = useRef<HTMLDivElement>(null);
  const attention = state.attention;
  const questions = attention.questions;
  const [closed, setClosed] = useState(false);
  // A menu holds the order only while its question is listed: one that went (taken back, or answered elsewhere) holds nothing.
  const menuListed = menu !== null && questions.some((q) => q.id === menu && (closed || q.status === 'open'));
  const held = pointing || touch.held || keyed || menuListed;
  // Nor does focus inside that went with what had it, nor that menu.
  useEffect(() => {
    if (keyed && !(document.activeElement && hold.current?.contains(document.activeElement))) setKeyed(false);
    if (menu !== null && !menuListed) setMenu(null);
  });
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
  const run = (key: string, action: () => Promise<void>, success?: string, then?: () => void, undo?: () => void) => {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(key);
    const asked = attention.place;
    action().then(() => {
      if (session.getSnapshot().attention.place !== asked) return;
      if (success) toast(success, { icon: 'check', ...(undo ? { action: { label: 'Undo', onClick: undo } } : {}) });
      then?.();
    }, (err: unknown) => {
      qlog.warn('question action failed', { err });
      toast(errorMessage(err), { icon: 'x' });
    }).finally(() => { pending.current = false; setBusy(null); });
  };
  /** Whoever hosts puts a question answered or dismissed by mistake back, from its toast or its menu under Show answered. */
  const reopen = (id: string) => run(id, () => session.resolveQuestion(id, 'open'), 'Question reopened');
  // What's listed stays where it is while the order holds, and a question asked meanwhile waits at its end; otherwise it's the order chosen.
  const existing = new Set(questions.map((q) => q.id));
  const kept = order.place === attention.place ? order.ids.filter((id) => existing.has(id)) : [];
  const known = new Set(kept);
  const ids = held && kept.length ? [...kept, ...ranked(questions.filter((q) => !known.has(q.id)), sort).map((q) => q.id)] : ranked(questions, sort).map((q) => q.id);
  if (order.place !== attention.place || order.ids.length !== ids.length || ids.some((id, i) => order.ids[i] !== id)) setOrder({ place: attention.place, ids });
  const reorder = (by: Order) => { setSort(by); setOrder({ place: attention.place, ids: ranked(questions, by).map((q) => q.id) }); };
  const byId = new Map(questions.map((q) => [q.id, q]));
  const listed = ids.flatMap((id) => { const q = byId.get(id); return q && (closed || q.status === 'open') ? [q] : []; });
  const shown = pinnedFirst(listed);
  // Out of the order chosen, of what's shown: only ever while it holds.
  const stale = pinnedFirst(ranked(listed, sort)).map((q) => q.id).join() !== shown.map((q) => q.id).join();
  const resolved = questions.filter((q) => q.status !== 'open').length;
  const disabled = busy !== null || !ready;
  const ask = () => {
    const clean = text.trim();
    if (!clean || disabled) return;
    const submitted = draft.submission?.text === clean && draft.submission.anonymous === anonymous ? draft.submission : { id: crypto.randomUUID(), text: clean, anonymous };
    draft.submission = submitted;
    run('ask', () => session.postQuestion(submitted.id, submitted.text, submitted.anonymous), submitted.anonymous ? 'Asked anonymously. Nobody is told it’s yours.' : 'Question asked', () => confirm(submitted.id));
  };
  // Keyboard focus in the questions holds them; focus a press leaves behind doesn't, so they sort once the pointer leaves.
  const focusIn = (e: FocusEvent<HTMLDivElement>) => setKeyed(e.target instanceof Element && e.target.matches(':focus-visible'));
  const focusOut = (e: FocusEvent<HTMLDivElement>) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setKeyed(false); };
  if (!ready) return <EmptyState art={null} title="Finding this room" className="ch-empty">Questions appear once your connection is ready.</EmptyState>;
  return (
    <>
      <div ref={hold} className="ch-qhold" onPointerEnter={(e) => { if (e.pointerType !== 'touch') setPointing(true); }} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setPointing(false); }}
        {...touch.on} onFocus={focusIn} onBlur={focusOut}>
        <div className="ch-qbar" role="group" aria-label="Question order">
          <button type="button" aria-pressed={sort === 'votes' && !stale} onClick={() => reorder('votes')}>Most votes</button>
          <button type="button" aria-pressed={sort === 'recent' && !stale} onClick={() => reorder('recent')}>Newest</button>
          {stale && <><span className="sep" aria-hidden="true" /><button type="button" className="is-due" onClick={() => reorder(sort)}>{sort === 'votes' ? 'Sort by votes' : 'Sort by newest'}</button></>}
          {resolved > 0 && <button type="button" className="end" aria-pressed={closed} onClick={() => setClosed(!closed)}>{closed ? 'Hide answered' : `Show answered · ${resolved}`}</button>}
        </div>
        <div ref={focus} className="ch-scroll" onScroll={touch.onScroll}>
          {shown.length ? (
            <div className="ch-qs">
              {shown.map((q) => (
                <motion.div key={q.id} layout={reduce ? false : 'position'} transition={GLIDE}>
                  <CallQuestion id={q.id} text={q.text} author={q.author} own={q.own} time={hm(q.createdAt)} votes={q.votes} voted={q.voted}
                    status={q.status} pinned={q.pinned} busy={disabled} onMenu={(o) => setMenu(o ? q.id : null)}
                    onVote={() => run(q.id, () => session.voteQuestion(q.id, !q.voted))}
                    host={host ? {
                      onPin: () => run(q.id, () => session.pinQuestion(q.pinned ? null : q.id), q.pinned ? 'Question unpinned' : 'Question pinned'),
                      onAnswer: () => run(q.id, () => session.resolveQuestion(q.id, 'answered'), 'Marked answered', undefined, () => reopen(q.id)),
                      onDismiss: () => run(q.id, () => session.resolveQuestion(q.id, 'dismissed'), 'Question dismissed', undefined, () => reopen(q.id)),
                      onReopen: () => reopen(q.id)
                    } : undefined}
                    onWithdraw={q.own ? () => run(q.id, () => session.withdrawQuestion(q.id), 'Your question is taken back') : undefined} />
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState art={null} title={questions.length ? 'No open questions' : 'No questions yet'} className="ch-empty">
              Ask everyone in this room. The questions with the most votes come first.
            </EmptyState>
          )}
        </div>
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

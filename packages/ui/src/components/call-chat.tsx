/*
 * Chat in a call, as its parts: the conversations as tabs along the top, a message sitting on the panel without a box (a
 * run from the same person under one name), the small bar that comes over a message's corner, the line under a message
 * that opens its thread, a thread's own head, and a private conversation's lock line. Every part takes plain data and
 * handlers; the conversations themselves belong to the app. Styles are in `styles/call-chat.css` (`ch-`).
 */
import { CALL_REACTIONS, type CallReaction } from '@alcove/api';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Emoji, EMOJI_WORDS } from './emoji';
import { Icon, type IconName } from './icon';
import { EASE } from './motion';
import { Popover } from './overlay';
import { Avatar, Faces, type AvatarPerson } from './people';
import { Button, IconButton } from './primitives';
import { ReactionAdd, Reactions, type ReactionShown } from './reactions';

/** The three reactions a message's bar offers at once; the rest are a press away. */
export const QUICK_REACTIONS: readonly CallReaction[] = ['thumbs-up', 'heart', 'laugh'];

/* ---------- the conversations, as tabs ---------- */

/** One conversation's tab: Everyone, Questions, or a private one (`lock`), with how many (`count`) or a dot for what's new. */
export interface ChatTabItem {
  key: string; label: string; icon?: IconName | undefined; lock?: boolean | undefined;
  count?: number | undefined; dot?: boolean | undefined;
  /** A private conversation whose other person isn't here now: quieter, and still there to read. */
  muted?: boolean | undefined;
  /** What a screen reader says for it, when that's more than its label ("Priya Desai, private, 2 new"). */
  name?: string | undefined;
}

/**
 * The conversations along the top of Chat. Arrow keys, Home and End move between them, as tabs do; `end` (the + that
 * starts a private one) stays at the end, outside the tabs, however many there are. `panel` is the id of what they show.
 */
export function ChatTabs({ tabs, value, onChange, label, panel, end }: {
  tabs: readonly ChatTabItem[]; value: string; onChange: (key: string) => void; label: string; panel: string; end?: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  // The chosen tab stays in view when it's one of many.
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [value]);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.key === value);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.key);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="ch-tabs">
      <div ref={list} className="ch-tablist" role="tablist" aria-label={label} onKeyDown={move}>
        {tabs.map((t) => {
          const on = t.key === value;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} aria-controls={on ? panel : undefined} tabIndex={on ? 0 : -1}
              aria-label={t.name} title={t.name ?? t.label} className={cn('ch-tab', t.muted && 'is-muted')} onClick={() => onChange(t.key)}>
              {t.lock && <Icon name="lock" size={13} className="lk" />}
              {t.icon && <Icon name={t.icon} size={14} />}
              <span className="t">{t.label}</span>
              {t.count !== undefined && t.count > 0 && <span className="n">{t.count}</span>}
              {t.dot && <i className="dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {end}
    </div>
  );
}

/* ---------- a message ---------- */

/** A message's thread, under it: how many replies, when the last came, and the faces of who replied. */
export interface ChatThreadSummary { count: number; last: string; people: AvatarPerson[]; fresh: number; onOpen: () => void }

/** What can be done to a message, as its bar (and on a phone its ⋯) offers it. Each is left out where it can't be done. */
export interface ChatMessageActions {
  /** Your reaction on or off; the bar offers three at once and the rest from its smiley. */
  onReact?: ((name: CallReaction, on: boolean) => void) | undefined;
  onReply?: (() => void) | undefined;
  /** A private conversation with whoever sent it: someone else's message only. */
  onPrivate?: (() => void) | undefined;
}

/**
 * One message, Slack-like: no box, the arch and name and time over the first of a run (`first`), the words under it, its
 * reactions as pills, and its thread's line. Hovering (or reaching it with the keyboard) brings a small bar over its top
 * right corner; on a phone a ⋯ does, and so does pressing and holding the message. Retry stays with a failed message.
 */
export function ChatMessage({ id, person, name, time, text, first, context, unreadMention = false, sending = false, failed, delivery, reactions, actions, thread }: {
  id: string; person: AvatarPerson; name: string; time: string; text: ReactNode; first: boolean;
  /** A line over the words, such as that it was a reply sent to everyone too. */
  context?: ReactNode;
  unreadMention?: boolean | undefined; sending?: boolean | undefined;
  failed?: { onRetry: () => void; canRetry: boolean; label: string } | undefined;
  /** Sent or Delivered, under one of yours in a private conversation. */
  delivery?: string | undefined;
  reactions: ReactionShown[]; actions: ChatMessageActions; thread?: ChatThreadSummary | null | undefined;
}) {
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const { onReact, onReply, onPrivate } = actions;
  const mine = reactions.filter((r) => r.mine).map((r) => r.name);
  const acts = Boolean(onReact || onReply || onPrivate);
  const stopHold = () => { if (hold.current) window.clearTimeout(hold.current.timer); hold.current = null; };
  useEffect(() => stopHold, []);
  // Pressing and holding a message with a finger opens what its ⋯ opens.
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' || !acts || (e.target instanceof Element && e.target.closest('button, a, [role="button"]'))) return;
    stopHold();
    hold.current = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { hold.current = null; held.current = true; setMenu(true); }, 450) };
  };
  const moved = (e: PointerEvent<HTMLDivElement>) => { const h = hold.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) stopHold(); };
  return (
    <motion.div id={`chat-message-${id}`} data-chat-message={id} tabIndex={-1}
      className={cn('ch-msg', first && 'is-first', unreadMention && 'has-mention', failed && 'is-failed', menu && 'is-menu')}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18, ease: EASE.out }}
      onPointerDown={down} onPointerMove={moved} onPointerUp={stopHold} onPointerCancel={stopHold}
      onClickCapture={(e) => { if (held.current) { held.current = false; e.preventDefault(); e.stopPropagation(); } }}>
      <div className="ch-gutter">{first ? <Avatar person={person} size={28} /> : <span className="ch-at" aria-hidden="true">{time}</span>}</div>
      <div className="ch-body">
        {first && <div className="ch-head"><b className="ac-clamp-1">{name}</b><span className="ch-time">{time}</span></div>}
        {context}
        <p className="ch-text">{!first && <span className="sr-only">{name}, {time}: </span>}{text}</p>
        <span data-chat-read-end className="ch-read-end" aria-hidden="true" />
        {sending && <small className="ch-state" role="status">Sending…</small>}
        {failed && <div className="ch-failed" role="status"><span>Not confirmed. Your message is kept here.</span><Button size="sm" variant="quiet" disabled={!failed.canRetry} onClick={failed.onRetry}>{failed.label}</Button></div>}
        {delivery && !failed && !sending && <small className="ch-state">{delivery}</small>}
        {reactions.length > 0 && <Reactions reactions={reactions} onToggle={(r, on) => onReact?.(r, on)} canReact={Boolean(onReact)} />}
        {thread && thread.count > 0 && <ChatThreadLine id={id} {...thread} />}
      </div>
      {acts && (
        <div className="ch-bar" role="toolbar" aria-label={`Message from ${name}`}>
          {onReact && QUICK_REACTIONS.map((r) => {
            const on = mine.includes(r);
            return <button key={r} type="button" className="ch-quick" aria-pressed={on} aria-label={on ? `Take back your ${EMOJI_WORDS[r]}` : `React with ${EMOJI_WORDS[r]}`} title={EMOJI_WORDS[r]}
              onClick={() => onReact(r, !on)}><Emoji name={r} size={18} /></button>;
          })}
          {onReact && <ReactionAdd mine={mine} onPick={onReact} className="ch-bar-add" />}
          {onReact && (onReply || onPrivate) && <span className="sep" aria-hidden="true" />}
          {onReply && <IconButton icon="thread" size={16} label="Reply in thread" onClick={onReply} />}
          {onPrivate && <IconButton icon="lock" size={16} label={`Message ${name} privately`} onClick={onPrivate} />}
        </div>
      )}
      {acts && (
        <Popover open={menu} onOpenChange={setMenu} label={`Message from ${name}`} align="end" className="ic-menu ch-menu is-sheet"
          anchor={<IconButton icon="more" size={17} label={`More for ${name}’s message`} className="ch-more" />}>
          {onReact && (
            <div className="ch-menu-react" role="group" aria-label="Reactions">
              {CALL_REACTIONS.map((r) => {
                const on = mine.includes(r);
                return <button key={r} type="button" className={cn('ch-menu-emoji', on && 'is-mine')} aria-pressed={on} aria-label={EMOJI_WORDS[r]} title={EMOJI_WORDS[r]}
                  onClick={() => { onReact(r, !on); setMenu(false); }}><Emoji name={r} size={24} /></button>;
              })}
            </div>
          )}
          {onReply && <button type="button" className="mi" onClick={() => { setMenu(false); onReply(); }}><Icon name="thread" size={17} /><span className="t">Reply in thread</span></button>}
          {onPrivate && <button type="button" className="mi" onClick={() => { setMenu(false); onPrivate(); }}><Icon name="lock" size={17} /><span className="t">Message {name} privately</span></button>}
        </Popover>
      )}
    </motion.div>
  );
}

/** Under a message with replies: the faces of who replied, how many, and when the last came, or how many are new. */
export function ChatThreadLine({ id, count, last, people, fresh, onOpen }: ChatThreadSummary & { id: string }) {
  const replies = `${count} ${count === 1 ? 'reply' : 'replies'}`;
  return (
    <button type="button" id={`thread-open-${id}`} className="ch-thread" onClick={onOpen}
      aria-label={`${replies}, ${fresh > 0 ? `${fresh} new` : `last reply ${last}`}. Open the thread`}>
      <span aria-hidden="true" className="fc"><Faces people={people} size={18} max={3} /></span>
      <b>{replies}</b>
      {fresh > 0 ? <span className="new">{fresh} new</span> : <small>Last reply {last}</small>}
    </button>
  );
}

/** A thread, open in place of its conversation: back, and where it is ("In Everyone · 3 people"). */
export function ChatThreadHead({ sub, onBack }: { sub: string; onBack: () => void }) {
  return (
    <div className="ch-thead">
      <IconButton icon="left" label="Back to chat" onClick={onBack} />
      <div><b>Thread</b><small className="ac-clamp-1">{sub}</small></div>
    </div>
  );
}

/** A quiet line across the conversation with a few words on it: how many replies, or that it moved to another room. */
export function ChatDivider({ children }: { children: ReactNode }) {
  return <div className="ch-div"><span>{children}</span></div>;
}

/** At the top of a private conversation: who alone can read it. */
export function ChatLock({ children }: { children: ReactNode }) {
  return <div className="ch-lock"><Icon name="lock" size={14} /><span>{children}</span></div>;
}

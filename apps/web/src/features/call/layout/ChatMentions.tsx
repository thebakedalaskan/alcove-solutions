/* Chat's composer keeps selected people as stable identities and text spans, never as names to match later. */
import { CALL_CHAT_MAX, errorMessage, type CallChatMention, type Person } from '@alcove/api';
import { Avatar, Icon, IconButton, cn, useToast } from '@alcove/ui';
import { Fragment, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { fold } from '~/lib/people';
import { useDraft, type Draft } from './side';

export interface MentionPerson { identity: string; person: Person }
export interface ChatDraft extends Draft { mentions?: CallChatMention[] }

/** An edit preserves a tag only when its complete span is outside the changed text. */
function afterEdit(before: string, after: string, mentions: readonly CallChatMention[]): CallChatMention[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const shift = newEnd - oldEnd;
  return mentions.flatMap((m) => {
    if (m.end <= start) return [m];
    if (m.start >= oldEnd) return [{ ...m, start: m.start + shift, end: m.end + shift }];
    return [];
  });
}

export function ChatComposer({ draft, people, ready, moving, to, onSend }: {
  draft: ChatDraft; people: readonly MentionPerson[]; ready: boolean; moving: boolean; to: string;
  onSend: (text: string, mentions?: readonly CallChatMention[]) => Promise<void>;
}) {
  const [text, setText] = useDraft(draft);
  const [mentions, setMentions] = useState(draft.mentions ?? []);
  const [caret, setCaret] = useState(text.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const id = useId();
  const toast = useToast();
  useEffect(() => { draft.mentions = mentions; }, [draft, mentions]);

  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(prefix);
  const term = match?.[1];
  const start = term === undefined ? -1 : caret - term.length - 1;
  const selectedSpan = mentions.some((m) => m.start <= start && m.end > start);
  const choosing = ready && term !== undefined && !selectedSpan && !dismissed;
  const rows = choosing ? people.filter((p) => fold(`${p.person.name} ${p.person.email}`).includes(fold(term ?? ''))).slice(0, 12) : [];
  const at = Math.max(0, Math.min(active, rows.length - 1));
  const chosen = mentions.filter((m) => people.some((p) => p.identity === m.identity));
  useEffect(() => { list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }); }, [at]);

  const edit = (next: string, position: number) => {
    revision.current++;
    setMentions(afterEdit(text, next, mentions));
    setText(next); setCaret(position); setActive(0); setDismissed(false);
  };
  const pick = (p: MentionPerson) => {
    if (start < 0) return;
    const name = `@${(p.person.name.trim() || p.person.email || 'Guest').replace(/\s+/gu, ' ')}`;
    const next = `${text.slice(0, start)}${name} ${text.slice(caret)}`;
    if (next.length > CALL_CHAT_MAX) { toast('This message is too long to add a mention.', { icon: 'x' }); return; }
    revision.current++;
    const end = start + name.length;
    setMentions([...afterEdit(text, next, mentions), { identity: p.identity, start, end }].sort((a, b) => a.start - b.start));
    setText(next); setCaret(end + 1); setDismissed(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(end + 1, end + 1); });
  };
  const send = () => {
    if (!text.trim() || !ready) return;
    const sending = text;
    const tags = chosen;
    const sentAt = ++revision.current;
    draft.text = ''; draft.mentions = [];
    setText(''); setMentions([]); setCaret(0); setDismissed(true);
    void onSend(sending, tags).catch((e: unknown) => {
      toast(errorMessage(e), { icon: 'x' });
      // A failed send restores its people with its words only if no new draft has started meanwhile.
      if (revision.current === sentAt) { draft.text = sending; draft.mentions = tags; setText(sending); setMentions(tags); setCaret(sending.length); }
    });
  };
  return (
    <form className="ic-foot ic-chat-compose" autoComplete="off" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {choosing && <div className="ic-mention-picker">
        <div className="ic-mention-head">Mention someone in this room</div>
        <div ref={list} id={id} role="listbox" aria-label="People to mention" className="ic-mention-list">
          {rows.map((p, i) => <button key={p.identity} id={`${id}-${i}`} type="button" role="option" aria-selected={i === at} tabIndex={-1}
            className={cn('ic-mention-option', i === at && 'is-active')} data-active={i === at || undefined}
            onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => pick(p)}>
            <Avatar person={p.person} size={28} /><span><b>{p.person.name || 'Guest'}</b><small>{p.person.email || `Guest · ${p.identity.slice(0, 8)}`}</small></span>
          </button>)}
          {!rows.length && <p className="ic-mention-none">No one in this room matches.</p>}
        </div>
      </div>}
      {!!chosen.length && <div className="ic-mention-chosen" aria-label="Selected mentions">
        {chosen.map((m) => <span className="ic-mention-token" key={`${m.identity}-${m.start}`}>
          {text.slice(m.start, m.end)}<IconButton icon="x" label={`Remove mention ${text.slice(m.start + 1, m.end)}`} onClick={() => { revision.current++; setMentions(mentions.filter((other) => other !== m)); }} />
        </span>)}
      </div>}
      <div className="inrow">
        <input ref={input} className="ac-input" value={text} maxLength={CALL_CHAT_MAX} disabled={!ready}
          role="combobox" aria-autocomplete="list" aria-expanded={choosing} aria-controls={choosing ? id : undefined} aria-activedescendant={choosing && rows.length ? `${id}-${at}` : undefined}
          onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => { setCaret(e.currentTarget.selectionStart ?? text.length); }}
          onBlur={() => setDismissed(true)}
          onKeyDown={(e) => {
            if (!choosing || e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(rows.length - 1, at + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, at - 1)); }
            else if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); }
            else if (e.key === 'Enter' || (e.key === 'Tab' && rows.length)) { e.preventDefault(); const row = rows[at]; if (row) pick(row); }
          }}
          placeholder={ready ? `Message ${to} · @ to mention` : moving ? 'Moving to another room…' : 'Getting the call’s keys…'} aria-label={`Message ${to}`} />
        <button type="submit" className="ac-btn is-primary" aria-label={`Send to ${to}`} disabled={!ready || !text.trim()}><Icon name="sendLine" size={18} /></button>
      </div>
    </form>
  );
}

/** The encrypted text supplies the words; identity controls highlighting even if someone's display name changed. */
export function MentionText({ text, mentions, me }: { text: string; mentions: readonly CallChatMention[]; me: string }) {
  let end = 0;
  const parts = [...mentions].sort((a, b) => a.start - b.start).flatMap((m) => {
    if (m.start < end || m.start < 0 || m.end > text.length || m.end <= m.start || text[m.start] !== '@') return [];
    const before = text.slice(end, m.start);
    end = m.end;
    return [<Fragment key={`${m.start}-${m.end}`}>{before}<mark className={cn('ic-mention', m.identity === me && 'is-me')} title={m.identity === me ? 'Mentions you' : undefined}>{text.slice(m.start, m.end)}</mark></Fragment>];
  });
  return <>{parts}{text.slice(end)}</>;
}

/** Owns the intersection and visibility listeners while Chat is shown; the addressed words themselves must be visible. */
export function useReadMentions(scroll: RefObject<HTMLDivElement | null>, unread: readonly string[], onRead: ((ids: readonly string[]) => void) | undefined) {
  const latest = useRef(onRead);
  latest.current = onRead;
  const ids = unread.join(' ');
  useEffect(() => {
    const root = scroll.current;
    if (!root || !ids || !latest.current || typeof IntersectionObserver === 'undefined') return;
    // Track spans separately: hiding one tag must not erase another visible tag in the same long message.
    const visible = new Set<Element>();
    const read = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const messages = new Set<string>();
      for (const span of visible) {
        const message = span.closest('[data-chat-message]')?.getAttribute('data-chat-message');
        if (message) messages.add(message);
      }
      if (messages.size) latest.current?.([...messages]);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(entry.target); else visible.delete(entry.target);
      }
      read();
    }, { root, threshold: [0, 0.5] });
    for (const message of ids.split(' ')) {
      const el = document.getElementById(`chat-message-${message}`);
      if (el && root.contains(el)) for (const span of el.querySelectorAll('.ic-mention.is-me')) observer.observe(span);
    }
    document.addEventListener('visibilitychange', read);
    window.addEventListener('focus', read);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', read); window.removeEventListener('focus', read); };
  }, [scroll, ids]);
}

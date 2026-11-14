/*
 * Your own notes on a call, as they're drawn in the call's panel and beside a note: what you wrote, the moments you
 * bookmarked and the answers you kept. Only you read them, and everything you type here says so first. What each one
 * points at comes from the server each time, as you may read it now; it's never kept here.
 */
import { MAX_BOOKMARK_LABEL, MAX_PERSONAL_TEXT, errorMessage, type PersonalEntry, type SourceMoment } from '@alcove/api';
import { Button, Icon, IconButton, Scope, cn, useToast, type IconName } from '@alcove/ui';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { spokenName } from '~/lib/people';
import { hm } from '~/lib/time';

/** Each kind's marker. What you wrote is lines of text: a pencil there would read as the button that changes it. */
const ICON: Record<PersonalEntry['kind'], IconName> = { note: 'textLines', bookmark: 'bookmark', answer: 'ask' };

/** What a moment says: who said what. */
export function Quote({ m, me }: { m: SourceMoment; me: string | undefined }) {
  if (!m.line) return null;
  return <blockquote className="own-quote">{m.line.speaker && <b>{spokenName(m.line.speaker, me)}</b>}{m.line.text}</blockquote>;
}

/**
 * Writing something for yourself. Who it's for is in the box before you type. Enter keeps it; Shift and Enter starts a
 * new line. The draft is the caller's: it stays where you left it however you move around, and never reaches another box.
 * `icon` leads the box, and `hint` stands where the button that keeps it is until something's typed. The box is as tall as
 * the lines its words take (`field-sizing` in personal.css), so it's one row here.
 */
export function OwnComposer({ value, onChange, onSend, busy = false, focus = false, said = false, placeholder = 'Write something for yourself', icon, hint }: {
  value: string; onChange: (v: string) => void; onSend: (text: string) => void; busy?: boolean; focus?: boolean;
  /** What's around it already says it's only for you. */
  said?: boolean;
  placeholder?: string | undefined; icon?: IconName | undefined; hint?: ReactNode;
}) {
  const send = () => { const t = value.trim(); if (t && !busy) onSend(t); };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  return (
    <form className="own-compose" autoComplete="off" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {!said && <span className="to"><Scope>Your notes</Scope>Other participants can’t open this</span>}
      {icon && <Icon name={icon} size={16} />}
      <textarea autoFocus={focus} value={value} rows={1} maxLength={MAX_PERSONAL_TEXT} placeholder={placeholder} aria-label="Write in your own notes" onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />
      {hint && !value.trim() ? hint : <button type="submit" className="ac-btn is-secondary" aria-label="Keep it in your notes" title="Keep it in your notes" disabled={!value.trim() || busy}><Icon name={said ? 'arrowUp' : 'sendLine'} size={said ? 15 : 17} /></button>}
    </form>
  );
}

/** Keeps an answer you asked for in your own notes: nothing keeps one but this. `kept`: it's there already. */
export function KeepAnswer({ kept, onKeep }: { kept: boolean; onKeep: () => Promise<unknown> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (kept) return <span className="own-keep"><span className="kept"><Icon name="bookmarked" size={14} />Kept in your notes</span></span>;
  const keep = () => {
    setBusy(true);
    onKeep().catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setBusy(false));
  };
  return <span className="own-keep"><button type="button" className="lk" disabled={busy} onClick={keep}>Keep in your notes</button><Scope>Only you</Scope></span>;
}

/** The one step before something goes for good, in place. The keyboard lands on keeping it, and Escape keeps it too. */
export function Sure({ ask, act, onYes, onNo }: { ask: string; act: string; onYes: () => void; onNo: () => void }) {
  return (
    <span className="own-sure" role="group" aria-label={ask} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onNo(); } }}>
      {ask}
      <button type="button" className="lk" onClick={onYes}>{act}</button>
      <button type="button" className="lk quiet" autoFocus onClick={onNo}>Keep</button>
    </span>
  );
}

/** Changing what you wrote, or what a bookmark is called, in place. */
function EditBox({ text, label, max, multiline, onSave, onDone }: { text: string; label: string; max: number; multiline: boolean; onSave: (t: string) => void; onDone: () => void }) {
  const [value, setValue] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (!el) return; el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, []);
  const save = () => { const t = value.trim(); if (t === text.trim()) onDone(); else onSave(t); };
  return (
    <form className="own-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <textarea ref={box} value={value} rows={1} maxLength={max} aria-label={label} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
          if (e.key === 'Enter' && (!multiline || !e.shiftKey) && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
        }} />
      <div className="btns"><Button type="submit" variant="secondary" size="sm" disabled={multiline && !value.trim()}>Save</Button><button type="button" className="lk quiet" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

/** How your own notes are changed, in a call or by the note. Each rejects with why it couldn't. */
export interface OwnActions {
  edit(entryId: string, text: string): Promise<unknown>;
  remove(entryId: string): Promise<unknown>;
}

/** One thing you kept. `moment` draws where it points, as this place opens it; `share` is what it can do with the shared notes. */
function OwnRow({ e, me, actions, moment, away, share, picked }: {
  e: PersonalEntry; me: string | undefined; actions: OwnActions; moment: (m: SourceMoment) => ReactNode;
  /** What a bookmark says when it doesn't open from here. */
  away: (reach: 'later' | 'none') => string;
  share?: ((e: PersonalEntry) => ReactNode) | undefined; picked: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const failed = (err: unknown) => toast(errorMessage(err), { icon: 'x' });
  const name = e.kind === 'note' ? 'note' : e.kind === 'bookmark' ? 'bookmark' : 'answer';
  const body = e.kind === 'note' ? <p className="own-t">{e.text}</p>
    : e.kind === 'bookmark' ? (
      <>
        {e.label && <p className="own-t">{e.label}</p>}
        {e.moment && <Quote m={e.moment} me={me} />}
        {e.reach !== 'open' && <p className="own-away"><Icon name="lock" size={13} />{away(e.reach)}</p>}
      </>
    ) : <><p className="own-q">{e.question}</p><p className="own-t">{e.answer}</p></>;
  const moments = e.kind === 'bookmark' ? (e.moment ? [e.moment] : []) : e.kind === 'answer' ? e.moments : [];
  return (
    <li className={cn('own-row', `is-${e.kind}`, picked && 'is-picked')}>
      <span className="own-mk"><Icon name={ICON[e.kind]} size={13} /></span>
      <div className="own-b">
        {editing && e.kind !== 'answer'
          ? <EditBox text={e.kind === 'note' ? e.text : e.label} label={e.kind === 'note' ? 'What you wrote' : 'What to call this bookmark'} max={e.kind === 'note' ? MAX_PERSONAL_TEXT : MAX_BOOKMARK_LABEL} multiline={e.kind === 'note'}
              onDone={() => setEditing(false)} onSave={(t) => { setEditing(false); actions.edit(e.id, t).catch(failed); }} />
          : body}
        <div className="own-m">
          {e.kind !== 'bookmark' || !e.moment ? <span className="ac-time">{hm(new Date(e.at))}</span> : null}
          {moments.map((m) => <Fragment key={`${m.at}-${m.line?.id ?? m.screen?.id ?? ''}`}>{moment(m)}</Fragment>)}
          {e.shared && <span className="own-shared"><Icon name="share" size={12} />In the shared notes</span>}
          {sure ? (
            <Sure ask={`Delete this ${name}?`} act="Delete" onYes={() => { setSure(false); actions.remove(e.id).catch(failed); }} onNo={() => setSure(false)} />
          ) : !editing && (
            <span className="own-acts">
              {share?.(e)}
              {e.kind !== 'answer' && <IconButton icon="pen" label={e.kind === 'note' ? 'Change what you wrote' : 'Name this bookmark'} size={15} onClick={() => setEditing(true)} />}
              <IconButton icon="trash" label={`Delete this ${name}`} size={15} onClick={() => setSure(true)} />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Everything you kept, oldest first. `picked` is the entry being added to the shared notes, marked while the preview's open. */
export function OwnEntries({ entries, me, actions, moment, away, share, picked }: {
  entries: PersonalEntry[]; me: string | undefined; actions: OwnActions; moment: (m: SourceMoment) => ReactNode; away: (reach: 'later' | 'none') => string;
  share?: ((e: PersonalEntry) => ReactNode) | undefined; picked?: string | null | undefined;
}) {
  return (
    <ul className="own-list" aria-label="Your notes">
      {entries.map((e) => <OwnRow key={e.id} e={e} me={me} actions={actions} moment={moment} away={away} share={share} picked={picked === e.id} />)}
    </ul>
  );
}

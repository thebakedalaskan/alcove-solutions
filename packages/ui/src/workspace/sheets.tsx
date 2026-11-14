/* What opens in a popover: people, comments, sharing, switching, presenting, and find, which opens over everything. */
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RDialog } from 'radix-ui';
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { andList, Avatar, Faces, type AvatarPerson } from '../foundation/people';
import { Dots } from '../foundation/motion';
import { stayForExtensions } from '../foundation/overlay';
import { Button, Kbd, Segmented, type Choice } from '../foundation/primitives';
import { WsMenu, WsPopover, type WsMenuRow } from './popover';
import { canTakeFocus, firstName, focusedNow, useMove } from './shared';

/**
 * Someone's card, from their tile, their face or their name in a line. `where` is the document they're in, in words:
 * pass "A document you can’t open" or "Not in the workspace" when that's so. `onGo` is left out when you can't go there,
 * and `onTag` when you can't write in what's open. `onOptions`, from their arch on a phone: the rest of what their tile's
 * menu has, such as pinning them or how loud they are, for you.
 */
export function WsPersonCard({ person, where, followed = false, onFollow, onStop, onGo, onTag, onOptions }: {
  person: AvatarPerson; where: string; followed?: boolean | undefined;
  onFollow: () => void; onStop: () => void; onGo?: (() => void) | undefined; onTag?: (() => void) | undefined; onOptions?: (() => void) | undefined;
}) {
  const first = firstName(person);
  return (
    <div className="wv-person">
      <div className="hd"><Avatar person={person} size={38} /><span><b>{person.name}</b><small>{where}</small></span></div>
      {followed
        ? <Button size="sm" onClick={onStop}>Stop following</Button>
        : <Button variant="primary" size="sm" onClick={onFollow}><Icon name="navigate" size={15} />Follow {first}</Button>}
      {onGo && <button type="button" className="wm-r" onClick={onGo}><Icon name="locate" size={16} /><span className="t"><span className="l">Go to where {first} is</span></span></button>}
      {onTag && <button type="button" className="wm-r" onClick={onTag}><Icon name="at" size={16} /><span className="t"><span className="l">Tag {first} in this document</span></span></button>}
      {onOptions && <button type="button" className="wm-r" onClick={onOptions}><Icon name="more" size={16} /><span className="t"><span className="l">Pin, volume and more</span></span></button>}
    </div>
  );
}

/** Asked once, by the name, when you tag someone who can't open the document. Tagging never shares anything by itself. */
export function WsMentionPrompt({ person, document, onEdit, onRead, onNotNow }: { person: AvatarPerson; document: string; onEdit: () => void; onRead: () => void; onNotNow: () => void }) {
  const first = firstName(person);
  return (
    <div className="wv-ask">
      <div className="hd"><Avatar person={person} size={30} /><p><b>{first} can’t open {document}.</b> Share it so they can see what you tagged them in?</p></div>
      <div className="ac">
        <Button variant="primary" size="sm" onClick={onEdit}>Let {first} edit</Button>
        <Button size="sm" onClick={onRead}>Read only</Button>
        <Button variant="quiet" size="sm" onClick={onNotNow}>Not now</Button>
      </div>
    </div>
  );
}

/** One thing `@` offers in a comment. `words` is what goes in the text. */
export interface WsTagChoice { key: string; label: string; person?: AvatarPerson | undefined; icon?: IconName | undefined; sub?: string | undefined; words: string }
/** A headed part of that list. */
export interface WsTagSection { title: string; choices: WsTagChoice[] }
/** What `@` in a comment needs: what it offers for what's been typed after it, and what to do once something's picked. */
export interface WsTagging { sections: (query: string) => WsTagSection[]; onPick: (choice: WsTagChoice) => void }

/** The `@word` the caret is at the end of, as the editor finds it. */
function tagAt(value: string, caret: number): { from: number; query: string } | null {
  const hit = /(?:^|\s)@([^\s@]{0,18})$/.exec(value.slice(0, caret));
  const query = hit?.[1];
  return query === undefined ? null : { from: caret - query.length - 1, query };
}

/**
 * What `@` does in a one-line field: the `@word` the caret is at, the list it opens, and what picking from it writes. Arrows
 * move through the list, and so does the pointer, over a row; Enter or Tab picks the one highlighted, and Esc closes the list
 * and leaves the field. `keys` says whether it took a key.
 */
function useTagList(field: RefObject<HTMLInputElement | null>, value: string, onChange: (v: string) => void, tagging: WsTagging | undefined) {
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState<number | null>(null);
  const tag = tagging ? tagAt(value, caret) : null;
  const shown = tag && tag.from !== closed ? tag : null;
  const sections = shown && tagging ? tagging.sections(shown.query).filter((s) => s.choices.length > 0) : [];
  const choices = sections.flatMap((s) => s.choices);
  const open = shown !== null;
  const take = (c: WsTagChoice | undefined) => {
    if (!c || !shown) return;
    /* Only a person keeps the @: a date is just words. */
    const words = `${c.person ? '@' : ''}${c.words} `;
    const at = shown.from + words.length;
    onChange(`${value.slice(0, shown.from)}${words}${value.slice(caret)}`);
    setCaret(at);
    tagging?.onPick(c);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(at, at); });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (open && choices.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
      return true;
    }
    if (open && choices.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      take(choices[index]);
      return true;
    }
    return false;
  };
  const moved = (e: { currentTarget: HTMLInputElement }) => setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
  /* Esc closes the list and leaves the box: the popover hears it first otherwise. */
  const from = shown?.from ?? null;
  useEffect(() => {
    if (from === null) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setClosed(from); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [from]);
  const list = open ? (
    <>
      {choices.length === 0 && <p className="wm-x">Nobody called “{shown.query}”.</p>}
      {sections.map((s) => [
        <div key={s.title} className="wm-h">{s.title}</div>,
        ...s.choices.map((c) => (
          <button key={c.key} type="button" role="option" aria-selected={choices[index] === c} tabIndex={-1} className={cn('wm-r', choices[index] === c && 'is-sel', c.person && 'is-person')} onMouseDown={(e) => e.preventDefault()} onClick={() => take(c)}
            onPointerMove={() => { const at = choices.indexOf(c); if (at !== index) setIndex(at); }}>
            {c.person && <Avatar person={c.person} size={24} />}
            {c.icon && <Icon name={c.icon} size={16} />}
            <span className="t"><span className="l">{c.label}</span>{c.sub && <small>{c.sub}</small>}</span>
          </button>
        ))
      ])}
    </>
  ) : null;
  return { open, list, keys, moved, reset: () => setIndex(0), close: () => setClosed(from) };
}

/** A field and its send button, as a comment has them. Enter sends, and `@` opens a list above the line, in the same box. */
function CommentField({ label, placeholder, value, onChange, onSend, tagging, autoFocus = false }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; onSend: () => void; tagging?: WsTagging | undefined; autoFocus?: boolean | undefined }) {
  const field = useRef<HTMLInputElement>(null);
  const tags = useTagList(field, value, onChange, tagging);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (tags.keys(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  };
  return <>
    <input ref={field} className="wm-in" type="text" placeholder={placeholder} aria-label={label} aria-expanded={tags.open} value={value} autoFocus={autoFocus}
      onChange={(e) => { onChange(e.target.value); tags.reset(); tags.moved(e); }} onSelect={tags.moved} onKeyDown={keys} />
    <button type="button" className="ws-send" aria-label="Send" onClick={onSend}><Icon name="sendLine" size={15} /></button>
    {tags.list && <div className="wv-tags wm-list" role="listbox" aria-label="People and dates">{tags.list}</div>}
  </>;
}

/** Words with the people they tag marked, as `@First` in them: what a comment and a caption show once they're written. */
export function wsTagged(text: string, names: readonly string[]): ReactNode {
  const marks = [...new Set(names.map((name) => `@${firstName({ name })}`))].filter((m) => text.includes(m)).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (marks.length === 0) return text;
  return text.split(new RegExp(`(${marks.join('|')})`)).map((part, i) => (i % 2 === 1 ? <WsTagWords key={i}>{part}</WsTagWords> : <Fragment key={i}>{part}</Fragment>));
}

/**
 * A photo's caption: one line, typed in place under it, where `@` tags someone as it does in a comment, with a list that
 * drops below the line. Once it's written, the people it tags (`tagged`, by name) are marked in it. `onChange` is every key,
 * `onDone` when it's left or Enter is pressed. Read only, it's the words, or nothing when there are none.
 */
export function WsCaptionField({ value, tagged = [], readOnly = false, onChange, onDone, tagging }: {
  value: string; tagged?: readonly string[] | undefined; readOnly?: boolean | undefined; onChange: (v: string) => void; onDone: () => void; tagging?: WsTagging | undefined;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const tags = useTagList(field, value, onChange, readOnly ? undefined : tagging);
  const marked = !focused && tagged.some((name) => value.includes(`@${firstName({ name })}`));
  return (
    <span className={cn('wb-capw', marked && 'is-marked')}>
      <input ref={field} className="wb-cap" type="text" aria-label="Caption" placeholder={tagging && !readOnly ? 'Add a caption, or @ someone' : 'Add a caption'} readOnly={readOnly} value={value}
        aria-expanded={tags.open}
        onChange={(e) => { onChange(e.target.value); tags.reset(); tags.moved(e); }} onSelect={tags.moved}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); tags.close(); onDone(); }}
        onKeyDown={(e) => { if (tags.keys(e)) return; if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {marked && <span className="wb-cap wb-capm" aria-hidden="true">{wsTagged(value, tagged)}</span>}
      {tags.list && <span className="wb-captags wm-list" role="listbox" aria-label="People and dates">{tags.list}</span>}
    </span>
  );
}

/** A tag in a comment: the words as they were written, marked like a tag in a line. */
export function WsTagWords({ children }: { children: ReactNode }) {
  return <span className="wn-w">{children}</span>;
}

/** A new comment on selected words, or on something on a board. `person` is who's writing it. An empty `quote` shows nothing above the field. */
export function WsCommentCompose({ quote, person, value, onChange, onSend, tagging }: { quote: string; person: AvatarPerson; value: string; onChange: (v: string) => void; onSend: () => void; tagging?: WsTagging | undefined }) {
  return (
    <div className="wv-cmt">
      {quote && <div className="q"><span className="ac-clamp-2">{quote}</span></div>}
      <div className="in"><Avatar person={person} size={24} /><CommentField label="Comment" placeholder="Comment, or @ someone" value={value} onChange={onChange} onSend={onSend} tagging={tagging} autoFocus /></div>
    </div>
  );
}

/** One message in a thread. `name` is their first name. */
export interface WsComment { id: string; person: AvatarPerson; name: string; text: ReactNode }

/**
 * A thread on some words, or on something on a board: what they are, Resolve, what's been said and the reply field. A reply
 * rises 8 px, 240 ms. Someone who can only read gets the thread and nothing to press: leave out `onSend` and `onResolve`.
 */
export function WsCommentThread({ quote, messages, value = '', onChange, onSend, onResolve, tagging }: {
  quote: string; messages: WsComment[]; value?: string | undefined; onChange?: ((v: string) => void) | undefined; onSend?: (() => void) | undefined; onResolve?: (() => void) | undefined; tagging?: WsTagging | undefined;
}) {
  const move = useMove();
  const said = useRef<HTMLDivElement>(null);
  /* A long thread scrolls, and what was just said is what's showing. */
  useEffect(() => { const box = said.current; if (box) box.scrollTop = box.scrollHeight; }, [messages.length]);
  return (
    <div className="wv-cmt">
      {(quote || onResolve) && <div className="wv-th"><span className="q1">{quote}</span>{onResolve && <Button variant="quiet" size="xs" onClick={onResolve}><Icon name="check" size={14} />Resolve</Button>}</div>}
      <div ref={said} className="wv-ms">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div key={m.id} className="wv-m" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}>
              <Avatar person={m.person} size={24} /><div><b>{m.name}</b><p>{m.text}</p></div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {onSend && onChange && <div className="in"><CommentField label="Reply" placeholder="Reply" value={value} onChange={onChange} onSend={onSend} tagging={tagging} autoFocus /></div>}
    </div>
  );
}

/** What someone can do with a document, and what they can change it to. Without `options` it's only said. */
export interface WsShareRole { label: string; options?: { label: string; sub?: string | undefined; caution?: boolean | undefined; ticked?: boolean | undefined; onSelect: () => void }[] | undefined }
/**
 * Someone or a group with this document. `tag`: a word after the name, such as Guest. Without a `role`, nothing's said at the
 * row's end: what everyone in it can do is said once, above them.
 */
export interface WsShareRow { id: string; people: AvatarPerson[]; name: string; sub: string; role?: WsShareRole | undefined; tag?: string | undefined }
/** Someone the field found, not added yet. */
export interface WsShareMatch { id: string; person: AvatarPerson; sub: string; onAdd: () => void }

function RolePicker({ role, who }: { role: WsShareRole; who: string }) {
  const [open, setOpen] = useState(false);
  if (!role.options) return <span className="role">{role.label}</span>;
  const rows = role.options.map((o): WsMenuRow => ({ id: o.label, label: o.label, sub: o.sub, ticked: o.ticked, tone: o.caution ? 'caution' : undefined, onSelect: () => { o.onSelect(); setOpen(false); } }));
  return (
    <WsPopover open={open} onOpenChange={setOpen} label={`What ${who} can do`} align="end" anchor={<button type="button" className="role" aria-label={`${who}: ${role.label}`}>{role.label}<Icon name="down" size={13} /></button>}>
      <WsMenu label={`What ${who} can do`} rows={rows} className="is-role" />
    </WsPopover>
  );
}

/** One person or group in the sheet, with what they can do at its end. */
function ShareRow({ row }: { row: WsShareRow }) {
  return (
    <div className="wv-pr">
      <Faces people={row.people} size={26} max={3} />
      <span className="m"><b><span className="n">{row.name}</span>{row.tag && <span className="wv-tag">{row.tag}</span>}</b>{row.sub && <small>{row.sub}</small>}</span>
      {row.role && <RolePicker role={row.role} who={row.name} />}
    </div>
  );
}

/** Who's in a team's workspace: everyone licensed on the team, or only the people added. */
export type WsTeamAccess = 'team' | 'added';
const TEAM_ACCESS: Choice<WsTeamAccess>[] = [{ value: 'team', label: 'Whole team', icon: 'people' }, { value: 'added', label: 'Only people I add', icon: 'lock' }];
const TEAM_ACCESS_SAYS: Record<WsTeamAccess, string> = {
  team: 'Everyone licensed on the team can open and edit it.',
  added: 'Only the people here can open it.'
};

/**
 * Share, at the top of a document, and the same sheet for who's in a workspace. `title` is its heading, and `about` a line
 * under it. `rows`: who has it. `inCall`: people in the call who aren't among them, who can edit it while they're in the
 * call, under the rows. `matches`: who the field found, as you type. Someone who can't add people has no field: leave
 * `onQuery` out.
 */
export function WsShareSheet({ title, about, query = '', onQuery, onAdd, matches = [], rows, inCall = [], team }: {
  title: string; about?: string | undefined; query?: string | undefined; onQuery?: ((q: string) => void) | undefined;
  /** On a team's workspace: who's in it, which its admins change (`onChange`) and everyone else reads. */
  team?: { access: WsTeamAccess; onChange?: ((access: WsTeamAccess) => void) | undefined } | null | undefined;
  /** Enter in the field, with an email address or a name. */
  onAdd?: (() => void) | undefined;
  matches?: WsShareMatch[] | undefined; rows: WsShareRow[];
  inCall?: WsShareRow[] | undefined;
}) {
  return (
    <div className="wv-share">
      <div className="wv-h"><b>{title}</b>{about && <p>{about}</p>}</div>
      {team && (
        <div className="wv-team">
          {team.onChange
            ? <Segmented label="Who’s in it" value={team.access} onChange={team.onChange} options={TEAM_ACCESS} />
            : <b><Icon name={team.access === 'team' ? 'people' : 'lock'} size={15} />{team.access === 'team' ? 'Whole team' : 'Only people added'}</b>}
          <small>{TEAM_ACCESS_SAYS[team.access]}</small>
        </div>
      )}
      {onQuery && (
        <label className="wv-f">
          <Icon name="search" size={15} />
          <input type="text" autoFocus placeholder="Add people by name or email" aria-label="Add people by name or email" autoComplete="off" spellCheck={false} data-1p-ignore value={query} onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && onAdd) { e.preventDefault(); onAdd(); } }} />
        </label>
      )}
      {matches.map((m) => (
        <button key={m.id} type="button" className="wm-r" onClick={m.onAdd}><Avatar person={m.person} size={24} /><span className="t"><span className="l">{m.person.name}</span><small>{m.sub}</small></span></button>
      ))}
      <div className="wv-rows">{rows.map((r) => <ShareRow key={r.id} row={r} />)}</div>
      {inCall.length > 0 && <>
        <div className="wv-sep" />
        <span className="ac-eyebrow">Also in the call</span>
        <div className="wv-rows is-call">{inCall.map((r) => <ShareRow key={r.id} row={r} />)}</div>
      </>}
      <div className="wv-foot"><Icon name="sealed" size={14} /><span>Encrypted in storage.</span></div>
    </div>
  );
}

/**
 * One question, in place of the menu, before everyone in a call views another workspace. `name`: that workspace. `home`: the
 * call's home, where its notes go, when that isn't `name`. `cantOpen`: the first names of people in the call who aren't in it,
 * so can't open it but through the call: once everyone views it, they can open and edit everything in it while they're in the
 * call. Unless `everyone` is false: a call opens a workspace to everyone in it only while its files count against the
 * organizer's storage, so one they don't pay for opens only for its own people, and the question says so.
 */
export function WsSwitchSheet({ name, home, cantOpen = [], everyone = true, onSwitch, onKeep }: {
  name: string; home?: string | undefined; cantOpen?: readonly string[] | undefined; everyone?: boolean | undefined; onSwitch: () => void; onKeep: () => void;
}) {
  /* It takes the menu's place, and focus with it: on the question, so a stray key or Enter switches nobody. Tab reaches the answers. */
  const box = useRef<HTMLDivElement>(null);
  const question = useId();
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  return (
    <div ref={box} className="wv-switch" tabIndex={-1} role="group" aria-labelledby={question}>
      <b id={question}>Switch everyone to {name}?</b>
      {everyone
        ? cantOpen.length > 0 && <p>{andList(cantOpen)} {cantOpen.length === 1 ? 'isn’t' : 'aren’t'} in it. While they’re in the call, they can open and edit everything in it.</p>
        : <p>{cantOpen.length > 0 ? `${andList(cantOpen)} ${cantOpen.length === 1 ? 'isn’t' : 'aren’t'} in it, so they can’t open it. ` : ''}Its files don’t count against your storage, so it opens only for its own people.</p>}
      <p className="m">Anything closed to some people stays closed.{home ? ` The notes still go to ${home}.` : ''}</p>
      <div className="ac">
        <Button variant="primary" size="sm" onClick={onSwitch}>Switch</Button>
        <Button variant="quiet" size="sm" onClick={onKeep}>Keep this one</Button>
      </div>
    </div>
  );
}


/**
 * Renaming a workspace, in place of a menu: its name in a field, selected as it opens. Enter keeps what's typed; Esc, or a
 * press anywhere else, leaves the name as it was.
 */
export function WsNameSheet({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  return (
    <div className="wv-name">
      <div className="wv-h"><b>Rename this workspace</b></div>
      <label className="wv-f">
        <Icon name="pen" size={15} />
        <input type="text" aria-label="Name this workspace" placeholder="Name this workspace" defaultValue={name} maxLength={120} autoFocus spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCommit(e.currentTarget.value); } }} />
      </label>
    </div>
  );
}


/** A document or a line that find turned up. `sub`: where it is. */
export interface WsFindHit { id: string; name: string; sub: string; icon: IconName }

/**
 * Find, ⌘K: the page dims as the box pops in, 140 ms. With nothing typed `hits` are what you opened last. Up and Down
 * move `selected` (an index), Enter opens it, Esc closes. `searching`: more may be on its way, so nothing found isn't an
 * answer yet. `note` says why this may not be everything; `foot` sits under the list.
 */
export function WsFind<H extends WsFindHit>({ open, onOpenChange, query, onQuery, hits, selected, onSelected, onOpen, searching = false, note, foot }: {
  open: boolean; onOpenChange: (open: boolean) => void; query: string; onQuery: (q: string) => void;
  hits: H[]; selected: number; onSelected: (i: number) => void; onOpen: (hit: H) => void;
  searching?: boolean | undefined; note?: string | undefined; foot?: ReactNode;
}) {
  const ids = useId();
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => { list.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const n = hits.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n > 0) onSelected((selected + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selected];
      if (hit) onOpen(hit);
    }
  };
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ws-scrim" />
        <RDialog.Content aria-describedby={undefined} className="ws-pop wv-find" onInteractOutside={stayForExtensions} onOpenAutoFocus={() => { back.current = focusedNow(); }}
          onCloseAutoFocus={(e) => {
            // Landing on a line puts the caret there, and it's not to be taken away again.
            if (focusedNow()) e.preventDefault();
            else if (canTakeFocus(back.current)) { e.preventDefault(); back.current.focus({ preventScroll: true }); }
          }}>
          <RDialog.Title className="sr-only">Find in this workspace</RDialog.Title>
          <div className="f">
            <Icon name="search" size={17} />
            <input className="wv-fi" type="text" role="combobox" aria-expanded={hits.length > 0} aria-controls={`${ids}l`} aria-activedescendant={hits[selected] ? `${ids}${selected}` : undefined}
              placeholder="Find a document or a line" aria-label="Find in this workspace" value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={keys} />
            <Kbd>Esc</Kbd>
          </div>
          <div ref={list} id={`${ids}l`} className="wm-list" role="listbox" aria-label="What was found">
            {!query && hits.length > 0 && <div className="wm-h">Recent</div>}
            {!query && hits.length === 0 && <p className="wm-x">Nothing to find yet. Documents show up here as people write them.</p>}
            {hits.map((h, i) => (
              <button key={h.id} id={`${ids}${i}`} type="button" role="option" aria-selected={i === selected} tabIndex={-1} className={cn('wm-r', i === selected && 'is-sel')} onClick={() => onOpen(h)} onPointerMove={() => { if (i !== selected) onSelected(i); }}>
                <Icon name={h.icon} size={16} /><span className="t"><span className="l">{h.name}</span><small>{h.sub}</small></span>
              </button>
            ))}
            {query && searching && <p className="wm-x wv-more"><Dots /></p>}
            {query && !searching && hits.length === 0 && <p className="wm-x">Nothing called “{query}”.</p>}
            {note && <p className="wm-x">{note}</p>}
          </div>
          {foot}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** The way to the keyboard list, at the foot of Find. A phone has no keys to list. */
export function WsKeysRow({ onOpen }: { onOpen: () => void }) {
  return <div className="wv-keyrow"><button type="button" className="wm-r" onClick={onOpen}><Icon name="keyboard" size={16} /><span className="t"><span className="l">Keyboard</span></span><Kbd>?</Kbd></button></div>;
}

/** One column of the keyboard list. */
export interface WsKeyGroup { name: string; keys: { label: string; key: string }[] }

/** Every key there is, in columns, over the page like Find. `note`: what's worth knowing about them all. */
export function WsKeyboard({ open, onOpenChange, groups, note }: { open: boolean; onOpenChange: (open: boolean) => void; groups: WsKeyGroup[]; note?: string | undefined }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ws-scrim" />
        <RDialog.Content aria-describedby={undefined} className="ws-pop wv-keys" onInteractOutside={stayForExtensions}>
          <RDialog.Title className="sr-only">Keyboard</RDialog.Title>
          <Kbd className="wv-keys-esc">Esc</Kbd>
          <div className="ky">
            {groups.map((g) => (
              <div key={g.name} className="ky-g">
                <h3>{g.name}</h3>
                {g.keys.map((k) => <div key={k.label} className="ky-r"><span>{k.label}</span><kbd>{k.key}</kbd></div>)}
              </div>
            ))}
            {note && <p className="ky-note">{note}</p>}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** A photo already in the workspace. `src` is left out while it's on its way. */
export interface WsPhoto { id: string; src?: string | undefined; label: string }

/** A video or a file already in the workspace: its name, and how big it is. */
export interface WsStoredFile { id: string; name: string; sub: string; icon: IconName }

const howMany = (n: number) => (n === 2 ? 'two' : n === 3 ? 'three' : String(n));

/**
 * Photos, Video or File, from the `/` menu: choose from the computer, or reuse what's in the workspace. `heading` names where
 * `photos` or `files` are from, such as a folder. `onAll` adds all the photos.
 */
export function WsUploadPicker({ heading, photos = [], files = [], onChoose, onPhoto, onFile, onAll }: {
  heading?: ReactNode; photos?: WsPhoto[] | undefined; files?: WsStoredFile[] | undefined;
  onChoose: () => void; onPhoto?: ((id: string) => void) | undefined; onFile?: ((id: string) => void) | undefined; onAll?: (() => void) | undefined;
}) {
  return (
    <div className="wm is-upload">
      <div className="wu">
        <Button size="sm" onClick={onChoose}><Icon name="cloudUpload" size={16} />Choose from this computer</Button>
        {photos.length > 0 && <>
          <span className="ac-eyebrow ac-clamp-1">{heading}</span>
          <div className="wu-g">{photos.map((p) => <button key={p.id} type="button" className="wu-p" aria-label={p.label} onClick={() => onPhoto?.(p.id)}>{p.src ? <img src={p.src} alt="" /> : <span className="wu-w" />}</button>)}</div>
          {onAll && photos.length > 1 && <Button variant="quiet" size="xs" onClick={onAll}>Add all {howMany(photos.length)}</Button>}
        </>}
        {files.length > 0 && <>
          <span className="ac-eyebrow ac-clamp-1">{heading}</span>
          <div className="wu-f">
            {files.map((f) => (
              <button key={f.id} type="button" className="wm-r" onClick={() => onFile?.(f.id)}>
                <Icon name={f.icon} size={16} /><span className="t"><span className="l">{f.name}</span><small>{f.sub}</small></span>
              </button>
            ))}
          </div>
        </>}
      </div>
    </div>
  );
}

/**
 * What Delete for good asks, from a photo, video or file block's menu. Delete takes a block out of a document and leaves
 * its file in the workspace; this deletes the file, from every document that has it, so it asks.
 */
export function WsDeleteFileAsk({ name, onDelete, onKeep }: { name: string; onDelete: () => void; onKeep: () => void }) {
  return (
    <div className="wv-switch">
      <b>Delete {name} for good?</b>
      <p>It goes from every document that has it, for everyone, and older versions show it as deleted. Nobody can bring it back.</p>
      <div className="ac">
        <Button variant="primary" size="sm" onClick={onDelete}>Delete forever</Button>
        <Button variant="quiet" size="sm" onClick={onKeep}>Keep it</Button>
      </div>
    </div>
  );
}

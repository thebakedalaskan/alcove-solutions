/* What opens in a popover: people, comments, sharing, switching, presenting, and find, which opens over everything. */
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RDialog } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../cn';
import { Icon, type IconName } from '../icon';
import { Avatar, Faces, type AvatarPerson } from '../people';
import { Dots } from '../motion';
import { Button, Kbd } from '../primitives';
import { WsMenu, WsPopover, type WsMenuRow } from './popover';
import { canTakeFocus, firstName, focusedNow, useMove } from './shared';

/**
 * Someone's card, from their tile, their face or their name in a line. `where` is the document they're in, in words:
 * pass "A document you can’t open" or "Not in the workspace" when that's so. `onGo` is left out when you can't go there.
 */
export function WsPersonCard({ person, where, followed = false, onFollow, onStop, onGo, onTag }: {
  person: AvatarPerson; where: string; followed?: boolean | undefined;
  onFollow: () => void; onStop: () => void; onGo?: (() => void) | undefined; onTag: () => void;
}) {
  const first = firstName(person);
  return (
    <div className="wv-person">
      <div className="hd"><Avatar person={person} size={38} /><span><b>{person.name}</b><small>{where}</small></span></div>
      {followed
        ? <Button size="sm" onClick={onStop}>Stop following</Button>
        : <Button variant="primary" size="sm" onClick={onFollow}><Icon name="navigate" size={15} />Follow {first}</Button>}
      {onGo && <button type="button" className="wm-r" onClick={onGo}><Icon name="locate" size={16} /><span className="t"><span className="l">Go to where {first} is</span></span></button>}
      <button type="button" className="wm-r" onClick={onTag}><Icon name="at" size={16} /><span className="t"><span className="l">Tag {first} in this document</span></span></button>
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

/** A field and its send button, as a comment has them. Enter sends. */
function CommentField({ label, placeholder, value, onChange, onSend, autoFocus = false }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; onSend: () => void; autoFocus?: boolean | undefined }) {
  return <>
    <input className="wm-in" type="text" placeholder={placeholder} aria-label={label} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSend(); } }} />
    <button type="button" className="ws-send" aria-label="Send" onClick={onSend}><Icon name="sendLine" size={15} /></button>
  </>;
}

/** A new comment on selected words. `person` is who's writing it. */
export function WsCommentCompose({ quote, person, value, onChange, onSend }: { quote: string; person: AvatarPerson; value: string; onChange: (v: string) => void; onSend: () => void }) {
  return (
    <div className="wv-cmt">
      <div className="q"><span className="ac-clamp-2">{quote}</span></div>
      <div className="in"><Avatar person={person} size={24} /><CommentField label="Comment" placeholder="Comment, or @ someone" value={value} onChange={onChange} onSend={onSend} autoFocus /></div>
    </div>
  );
}

/** One message in a thread. `name` is their first name. */
export interface WsComment { id: string; person: AvatarPerson; name: string; text: string }

/** A thread on some words: what they are, Resolve, what's been said and the reply field. A reply rises 8 px, 240 ms. */
export function WsCommentThread({ quote, messages, value, onChange, onSend, onResolve }: {
  quote: string; messages: WsComment[]; value: string; onChange: (v: string) => void; onSend: () => void; onResolve: () => void;
}) {
  const move = useMove();
  return (
    <div className="wv-cmt">
      <div className="wv-th"><span className="q1">{quote}</span><Button variant="quiet" size="xs" onClick={onResolve}><Icon name="check" size={14} />Resolve</Button></div>
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div key={m.id} className="wv-m" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={move(2)}>
            <Avatar person={m.person} size={24} /><div><b>{m.name}</b><p>{m.text}</p></div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="in"><CommentField label="Reply" placeholder="Reply" value={value} onChange={onChange} onSend={onSend} /></div>
    </div>
  );
}

/** What someone can do with a document, and what they can change it to. Without `options` it's only said. */
export interface WsShareRole { label: string; options?: { label: string; sub?: string | undefined; caution?: boolean | undefined; ticked?: boolean | undefined; onSelect: () => void }[] | undefined }
/** Someone or a group with this document. */
export interface WsShareRow { id: string; people: AvatarPerson[]; name: string; sub: string; role: WsShareRole }
/** Someone the field found, not added yet. */
export interface WsShareMatch { id: string; person: AvatarPerson; sub: string; onAdd: () => void }

function RolePicker({ role, who }: { role: WsShareRole; who: string }) {
  const [open, setOpen] = useState(false);
  if (!role.options) return <span className="role">{role.label}</span>;
  const rows = role.options.map((o): WsMenuRow => ({ label: o.label, sub: o.sub, ticked: o.ticked, tone: o.caution ? 'caution' : undefined, onSelect: () => { o.onSelect(); setOpen(false); } }));
  return (
    <WsPopover open={open} onOpenChange={setOpen} label={`What ${who} can do`} align="end" anchor={<button type="button" className="role" aria-label={`${who}: ${role.label}`}>{role.label}<Icon name="down" size={13} /></button>}>
      <WsMenu label={`What ${who} can do`} rows={rows} className="is-role" />
    </WsPopover>
  );
}

/**
 * Share, at the top of a document, and the same sheet for who's in a workspace. `title` is its heading. `rows`: who has
 * it. `guest`: someone in this call who can't open it, with Let them read. `matches`: who the field found, as you type.
 * Someone who can't add people has no field: leave `onQuery` out.
 */
export function WsShareSheet({ title, query = '', onQuery, onAdd, matches = [], rows, guest }: {
  title: string; query?: string | undefined; onQuery?: ((q: string) => void) | undefined;
  /** Enter in the field, with an email address or a name. */
  onAdd?: (() => void) | undefined;
  matches?: WsShareMatch[] | undefined; rows: WsShareRow[];
  guest?: { person: AvatarPerson; onRead: () => void } | null | undefined;
}) {
  return (
    <div className="wv-share">
      <div className="wv-h"><b>{title}</b></div>
      {onQuery && (
        <label className="wv-f">
          <Icon name="search" size={15} />
          <input type="text" autoFocus placeholder="Add people by name or email" aria-label="Add people by name or email" autoComplete="off" spellCheck={false} value={query} onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && onAdd) { e.preventDefault(); onAdd(); } }} />
        </label>
      )}
      {matches.map((m) => (
        <button key={m.id} type="button" className="wm-r" onClick={m.onAdd}><Avatar person={m.person} size={24} /><span className="t"><span className="l">{m.person.name}</span><small>{m.sub}</small></span></button>
      ))}
      <div className="wv-rows">
        {rows.map((r) => (
          <div key={r.id} className="wv-pr"><Faces people={r.people} size={26} max={3} /><span className="m"><b>{r.name}</b><small>{r.sub}</small></span><RolePicker role={r.role} who={r.name} /></div>
        ))}
      </div>
      {guest && <>
        <div className="wv-sep" />
        <span className="ac-eyebrow">In this call</span>
        <div className="wv-pr"><Avatar person={guest.person} size={26} /><span className="m"><b>{guest.person.name}</b><small>Guest, can’t open this</small></span><Button size="xs" onClick={guest.onRead}>Let them read</Button></div>
      </>}
      <div className="wv-foot"><Icon name="sealed" size={14} /><span>Sealed before it leaves your browser. Alcove can’t read it.</span></div>
    </div>
  );
}

/**
 * One question, in place of the menu, before a call moves to another workspace. `name`: that workspace. `current`: this
 * one. `cantOpen`: the first names of people in the call who can't open it.
 */
export function WsSwitchSheet({ name, current, cantOpen = [], onSwitch, onKeep }: { name: string; current: string; cantOpen?: string[] | undefined; onSwitch: () => void; onKeep: () => void }) {
  const who = cantOpen.length === 1 ? cantOpen[0] : `${cantOpen.length} people`;
  return (
    <div className="wv-switch">
      <b>Switch this call to {name}?</b>
      <p>Everyone sees the change. Nobody is disconnected, and nothing moves or is copied.</p>
      {cantOpen.length > 0 && <p className="warn"><Icon name="info" size={15} /><span>{who} can’t open {name}. They stay in the call and see that it’s private, not what’s in it.</span></p>}
      <div className="ac">
        <Button variant="primary" size="sm" onClick={onSwitch}><span className="ac-clamp-1">Switch to {name}</span></Button>
        <Button variant="quiet" size="sm" onClick={onKeep}><span className="ac-clamp-1">Keep {current}</span></Button>
      </div>
    </div>
  );
}

/** What people will see, and one button to start. `sections`: how many the document splits into. */
export function WsPresentPreview({ name, sections, onStart }: { name: string; sections: number; onStart: () => void }) {
  return (
    <div className="wv-pres">
      <div className="wv-pv"><b className="ac-clamp-2">{name}</b><span className="l a" /><span className="l b" /><span className="l c" /></div>
      <b className="t">Present to everyone in this call</b>
      <p>They see this document without menus or anyone’s cursor, one section at a time. Your notes stay with you, and anyone can keep working.</p>
      <Button variant="primary" size="sm" onClick={onStart}><Icon name="presentation" size={16} />Present {sections} {sections === 1 ? 'section' : 'sections'}</Button>
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
        <RDialog.Content aria-describedby={undefined} className="ws-pop wv-find" onOpenAutoFocus={() => { back.current = focusedNow(); }}
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
            {!query && <div className="wm-h">Recent</div>}
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
        <RDialog.Content aria-describedby={undefined} className="ws-pop wv-keys">
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

/**
 * Someone in the call asked to see the workspace, on the organizer's screen. Pass the person to show it: it drops in 8 px,
 * 420 ms, waits, and lifts away, 240 ms, when you pass null. `document`: what they can be let into.
 */
export function WsKnock({ person, document, onLet, onNotNow }: { person: AvatarPerson | null; document: string; onLet: () => void; onNotNow: () => void }) {
  const move = useMove();
  return (
    <AnimatePresence initial={false}>
      {person && (
        <motion.div className="wv-knock" role="status" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0, transition: move(3) }} exit={{ opacity: 0, y: -8, transition: move(2) }}>
          <Avatar person={person} size={34} />
          <div><b>{firstName(person)} asked to see the workspace</b><p>Share just this document, or nothing.</p></div>
          <div className="ac">
            <Button variant="primary" size="sm" onClick={onLet}><span className="ac-clamp-1">Let {firstName(person)} read {document}</span></Button>
            <Button variant="quiet" size="sm" onClick={onNotNow}>Not now</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A photo already in the workspace. */
export interface WsPhoto { id: string; src: string; label: string }

/**
 * Photos, from the `/` menu: choose from the computer, or reuse what's in the workspace. `heading` names where `photos`
 * are from, such as a folder. `onAll` adds them all.
 */
export function WsUploadPicker({ heading, photos = [], onChoose, onPhoto, onAll }: { heading?: ReactNode; photos?: WsPhoto[] | undefined; onChoose: () => void; onPhoto?: ((id: string) => void) | undefined; onAll?: (() => void) | undefined }) {
  return (
    <div className="wm is-upload">
      <div className="wu">
        <Button size="sm" onClick={onChoose}><Icon name="cloudUpload" size={16} />Choose from this computer</Button>
        {photos.length > 0 && <>
          <span className="ac-eyebrow">{heading}</span>
          <div className="wu-g">{photos.map((p) => <button key={p.id} type="button" className="wu-p" aria-label={p.label} onClick={() => onPhoto?.(p.id)}><img src={p.src} alt="" /></button>)}</div>
          {onAll && photos.length > 1 && <Button variant="quiet" size="xs" onClick={onAll}>Add all {photos.length === 2 ? 'two' : photos.length === 3 ? 'three' : photos.length}</Button>}
        </>}
      </div>
    </div>
  );
}

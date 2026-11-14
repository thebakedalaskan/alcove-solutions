/*
 * The palette (⌘K, or Search or ask): one window over the page, to search everything said in your notes and to ask them.
 * Every part is stateless: the app owns what's typed, what was found and which row is lit, and draws these with it.
 *
 * The window is a `Sheet` with className="pal" and overlayClassName="pal-scrim". Inside it, in order: `PaletteLine` (what
 * you type, as `<input className="pal-in">`), `PaletteBody` (the list, and beside it from 1100px the preview of what's
 * lit), and `PaletteFoot`. The window is 1000 × 640 while its body has a preview or an answer, and 680 wide with the list
 * alone (the first day, offline, Pin a note).
 *
 * A row is the app's own element, a `Link` or a `div role="option"`, with className={paletteRow(kind, active)} and one
 * row part inside it (`PaletteAskLine`, `PalettePersonLine`, `PaletteMomentLine`, `PaletteNoteLine`, `PaletteMoreLine`,
 * `PaletteAllLine`), so a row stays a real link. Groups, the preview and the foot draw their own containers. With nothing
 * to list, the app draws the kit's `EmptyState` with the palette's art, a dashed arch around an icon
 * (`<span className="pal-none-arch">`), and className="pal-none". Styles in palette/palette.css (`pal-`).
 */
import { useId, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Dots } from '../foundation/motion';
import { Avatar, Faces, GhostArch, type AvatarPerson } from '../foundation/people';
import { ArchThumb, IconButton, Kbd, type Cover } from '../foundation/primitives';

/** What a row in the list is. */
export type PaletteRowKind = 'ask' | 'person' | 'moment' | 'note' | 'more' | 'all';
/** What a line of what was said became in the notes: a decision, or a follow-up. */
export type PaletteMadeKind = 'decision' | 'follow-up';

/** The class for a row's own element (a `Link`, or a `div role="option"`): what it is, and whether it's the lit one. */
export function paletteRow(kind: PaletteRowKind, active: boolean): string {
  return cn('pal-row', `pal-${kind}`, active && 'is-active');
}

const MADE: Record<PaletteMadeKind, { word: string; icon: IconName }> = {
  decision: { word: 'Decision', icon: 'badgeCheck' },
  'follow-up': { word: 'Follow-up', icon: 'userCheck' }
};

/**
 * The line, on the window itself: the magnifier (the Ask mark, in sun-text, while Ask is lit), a person's token when the
 * search is narrowed to them, the input (`<input className="pal-in">`), and esc. On a phone esc becomes Cancel.
 * `icon` is the line's own mark when it isn't search, such as `pin` for Pin a note.
 */
export function PaletteLine({ ask = false, icon = 'search', token, onCancel, children }: {
  ask?: boolean | undefined; icon?: IconName | undefined; token?: ReactNode; onCancel: () => void; children: ReactNode;
}) {
  return (
    <div className={cn('pal-line', ask && 'is-ask')}>
      <Icon name={ask ? 'ask' : icon} size={20} className="pal-line-i" />
      {token}
      {children}
      <Kbd className="pal-esc">esc</Kbd>
      <button type="button" className="pal-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * Someone the search is narrowed to, in the line: their arch and first name, and the cross that shows everyone again. The
 * cross is for the pointer: from the keyboard, Backspace on an empty line takes the token off, and Tab asks.
 */
export function PaletteToken({ person, name, onClear, clearLabel }: { person: AvatarPerson; name: string; onClear: () => void; clearLabel: string }) {
  return (
    <span className="pal-tok">
      <Avatar person={person} size={22} />
      <span className="ac-clamp-1">{name}</span>
      <IconButton icon="x" label={clearLabel} size={14} tabIndex={-1} className="pal-tok-x" onClick={onClear} />
    </span>
  );
}

/**
 * Under the line: the list (`children`: the app's listbox, an answer or an empty state), and the preview of the lit row
 * beside it when there's one. Two panes from 1100px; narrower, the list alone.
 */
export function PaletteBody({ preview, children }: { preview?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('pal-body', Boolean(preview) && 'has-preview')}>
      <div className="pal-list">{children}</div>
      {preview}
    </div>
  );
}

/** A labelled run of rows, with how many on the right ("9 moments in 4 calls"). Its label names the group. */
export function PaletteGroup({ label, count, children }: { label: ReactNode; count?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="pal-group">
      <div id={id} className="pal-grp"><span>{label}</span>{count !== undefined && count !== null && <small>{count}</small>}</div>
      {children}
    </div>
  );
}

/** Ask "…": first while something's typed. `keyLabel` is the key that asks: ↵ when it's lit, Tab when it isn't. */
export function PaletteAskLine({ text, keyLabel }: { text: string; keyLabel: string }) {
  return (
    <>
      <span className="pal-mark"><Icon name="ask" size={15} /></span>
      <span className="t"><b className="ac-clamp-2">Ask <q>{text}</q></b></span>
      <span className="end"><Kbd>{keyLabel}</Kbd></span>
    </>
  );
}

/** Someone whose name has the words: their arch, the name with the match marked, and their title and calls together. */
export function PalettePersonLine({ person, name, meta }: { person: AvatarPerson; name: ReactNode; meta: ReactNode }) {
  return (
    <>
      <Avatar person={person} size={26} />
      <span className="t"><b className="ac-clamp-1">{name}</b><small className="ac-clamp-1">{meta}</small></span>
      <span className="end"><Icon name="right" size={15} className="go" /></span>
    </>
  );
}

/** A call in What was said: its own sky, its title and its day, over its moments. Not a row: nothing to press. */
export function PaletteCallHead({ cover, room = false, title, meta }: { cover: Cover; room?: boolean | undefined; title: ReactNode; meta: ReactNode }) {
  return (
    <div className="pal-head">
      <ArchThumb cover={cover} room={room} width={22} />
      <b className="ac-clamp-1">{title}</b>
      <span className="d">{meta}</span>
    </div>
  );
}

/** Decision or Follow-up, beside the name of who said the line it rests on. */
function MadeTag({ kind }: { kind: PaletteMadeKind }) {
  return <span className={cn('pal-tag', `is-${kind}`)}><Icon name={MADE[kind].icon} size={13} />{MADE[kind].word}</span>;
}

/**
 * A moment: who said it (their arch, and their name, marked when it matched), what it became (`made`), the words with the
 * match marked (`children`), and when, as a moment chip. Without `person`, an empty arch.
 */
export function PaletteMomentLine({ person, name, made, time, children }: {
  person?: AvatarPerson | undefined; name: ReactNode; made?: PaletteMadeKind | undefined; time: string; children: ReactNode;
}) {
  return (
    <>
      <span className="pal-face">{person ? <Avatar person={person} size={22} /> : <GhostArch size={22} />}</span>
      <span className="t">
        <span className="who"><span className="ac-clamp-1">{name}</span>{made && <MadeTag kind={made} />}</span>
        <span className="q ac-clamp-2">{children}</span>
      </span>
      <span className="end"><span className="pal-at"><Icon name="moment" size={13} />{time}</span></span>
    </>
  );
}

/** A note: its sky, its title and what it is. `end` takes the arrow's place, as Pin a note's `PalettePin` does. */
export function PaletteNoteLine({ cover, room = false, title, meta, end }: { cover: Cover; room?: boolean | undefined; title: ReactNode; meta: ReactNode; end?: ReactNode }) {
  return (
    <>
      <ArchThumb cover={cover} room={room} width={22} />
      <span className="t"><b className="ac-clamp-1">{title}</b><small className="ac-clamp-1">{meta}</small></span>
      <span className="end">{end ?? <Icon name="right" size={15} className="go" />}</span>
    </>
  );
}

/** Pin a note's end of a row: the pin in sun-text when it's pinned, and what Enter does on the lit row (Pin, Unpin). */
export function PalettePin({ pinned, label }: { pinned: boolean; label: string }) {
  return <span className={cn('pal-pin', pinned && 'is-on')}><span className="pal-act">{label}</span>{pinned && <Icon name="pin" size={16} />}</span>;
}

/** "3 more in Team standup": the rest of a call's moments, opened in place. */
export function PaletteMoreLine({ children }: { children: ReactNode }) {
  return <><Icon name="down" size={15} /><span className="ac-clamp-1">{children}</span></>;
}

/** "See all 9 moments in Calls": at the end of the list. */
export function PaletteAllLine({ children }: { children: ReactNode }) {
  return <><span className="ac-clamp-1">{children}</span><Icon name="right" size={16} /></>;
}

/** Someone to pick, before anything's typed: picking one narrows the search to what they said. */
export interface PalettePick { person: AvatarPerson; first: string; onPick: () => void }

/** The people you have most calls with, as arches with their first names. */
export function PalettePeople({ label, people }: { label: string; people: PalettePick[] }) {
  return (
    <PaletteGroup label={label}>
      <div className="pal-people">
        {people.map((p, i) => (
          <button key={`${p.person.email ?? p.person.name}-${i}`} type="button" className="pal-pick" aria-label={`What ${p.first} said`} onClick={p.onPick}>
            <Avatar person={p.person} size={40} />
            <span className="ac-clamp-1">{p.first}</span>
          </button>
        ))}
      </div>
    </PaletteGroup>
  );
}

/** The preview of the lit row, beside the list: it scrolls, with what to do pinned at its foot (`actions`). */
export function PalettePreview({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="pal-pv">
      <div className="pal-pv-in">{children}</div>
      {Boolean(actions) && <div className="pal-pv-a">{actions}</div>}
    </div>
  );
}

/** The top of a call's or a note's preview: its title, when and how long, and its people. */
export function PalettePreviewHead({ title, meta, people }: { title: ReactNode; meta: ReactNode; people?: AvatarPerson[] | undefined }) {
  return (
    <div className="pal-pv-h">
      <span><b>{title}</b><small>{meta}</small></span>
      {people && people.length > 0 && <Faces people={people} size={24} max={4} />}
    </div>
  );
}

/** The decision or follow-up made at a moment: what it says, where it stands, and what to do (`children`: Confirm, It wasn't decided). */
export function PaletteMade({ kind, text, state, children }: { kind: PaletteMadeKind; text: ReactNode; state: ReactNode; children?: ReactNode }) {
  return (
    <div className={cn('pal-made', `is-${kind}`)}>
      <span className="kind"><Icon name={MADE[kind].icon} size={14} />{MADE[kind].word}</span>
      <p>{text}</p>
      <span className="s">{state}</span>
      {Boolean(children) && <span className="acts">{children}</span>}
    </div>
  );
}

/** The transcript around a moment: a line before it, the moment lit, three after. */
export function PaletteExcerpt({ children }: { children: ReactNode }) {
  return <div className="pal-tr">{children}</div>;
}

/** A line of the transcript: when, who (their arch and name), and the words, marked. `lit`: the moment itself, warm. */
export function PaletteExcerptLine({ time, person, name, lit = false, children }: {
  time: string; person?: AvatarPerson | undefined; name: ReactNode; lit?: boolean | undefined; children: ReactNode;
}) {
  return (
    <div className={cn('pal-tl', lit && 'is-lit')} aria-current={lit ? 'true' : undefined}>
      <span className="a">{time}</span>
      <span className="f">{person ? <Avatar person={person} size={20} /> : <GhostArch size={20} />}</span>
      <span className="x"><span className="n">{name}</span>{children}</span>
    </div>
  );
}

/** A note's summary in its preview, with what's waiting in it: decisions to confirm and follow-ups. */
export function PaletteSummary({ confirm = 0, followUps = 0, children }: { confirm?: number | undefined; followUps?: number | undefined; children: ReactNode }) {
  return (
    <>
      <p className="pal-pv-p">{children}</p>
      {(confirm > 0 || followUps > 0) && (
        <div className="pal-chips">
          {confirm > 0 && <span className="pal-chip is-decision">{confirm} to confirm</span>}
          {followUps > 0 && <span className="pal-chip is-follow-up">{followUps} {followUps === 1 ? 'follow-up' : 'follow-ups'}</span>}
        </div>
      )}
    </>
  );
}

/** Ask's preview: the question, and one line about where the answer comes from (`children`). */
export function PaletteAskPreview({ question, children }: { question: ReactNode; children: ReactNode }) {
  return (
    <div className="pal-askpv">
      <span className="pal-mark is-big"><Icon name="ask" size={21} /></span>
      <span className="k">Ask your notes</span>
      <blockquote>{question}</blockquote>
      <p>{children}</p>
    </div>
  );
}

/** See all's preview: the words, and what Calls will show for them (`children`). */
export function PaletteAllPreview({ words, children }: { words: ReactNode; children: ReactNode }) {
  return (
    <div className="pal-askpv">
      <span className="pal-mark is-big"><Icon name="calls" size={21} /></span>
      <span className="k">In Calls</span>
      <blockquote>{words}</blockquote>
      <p>{children}</p>
    </div>
  );
}

/** One of someone's latest lines, in their preview: the call and when in it, and what they said. */
export interface PaletteSaid { key: string; call: ReactNode; time: string; text: ReactNode }

/** Someone's preview: their arch, name and title, your calls together (`meta`), and the latest they said. */
export function PalettePersonPreview({ person, title, meta, saidLabel, said }: {
  person: AvatarPerson; title: ReactNode; meta: ReactNode; saidLabel: string; said: PaletteSaid[];
}) {
  return (
    <>
      <div className="pal-who"><Avatar person={person} size={52} /><span><b>{person.name}</b><small>{title}</small></span></div>
      <p className="pal-pv-p">{meta}</p>
      {said.length > 0 && (
        <div className="pal-saids">
          <div className="pal-sec">{saidLabel}</div>
          {said.map((s) => (
            <div key={s.key} className="pal-said"><small><span className="ac-clamp-1">{s.call}</span><span>{s.time}</span></small><p>{s.text}</p></div>
          ))}
        </div>
      )}
    </>
  );
}

/** The answer, beside the Ask mark. While it's `reading`, dots before `children` ("Reading your notes"). */
export function PaletteAnswer({ reading = false, children }: { reading?: boolean | undefined; children: ReactNode }) {
  return (
    <div className={cn('pal-ans', reading && 'is-reading')} aria-live="polite" aria-busy={reading}>
      <span className="pal-mark"><Icon name="ask" size={15} /></span>
      <p>{reading && <Dots />}{children}</p>
    </div>
  );
}

/** ← Results: from an answer back to what was found. */
export function PaletteBack({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className="pal-back" onClick={onClick}><Icon name="left" size={15} />{children}</button>;
}

/** Searching, with no list yet to keep dimmed: dots, and `label` ("Searching") for screen readers. */
export function PaletteWaiting({ label }: { label: string }) {
  return <div className="pal-wait" role="status" aria-label={label}><Dots /></div>;
}

/** A key and what it does, in the foot: `{ keys: ['↑', '↓'], label: 'Move' }`. */
export interface PaletteKeys { keys: string[]; label: string }

/**
 * The foot: what's private on the left (`children`), with a lock; `sealed` while Ask is lit or an answer shows, with the
 * sealed shield in sun-text; `outside` when the chosen model is outside a secure enclave, in caution. `icon` is the mark
 * when the line isn't about privacy (`pin`, for Pin a note). The keys on the right, on a wide screen, then `action`.
 */
export function PaletteFoot({ sealed = false, outside = false, icon, children, keys, action }: {
  sealed?: boolean | undefined; outside?: boolean | undefined; icon?: IconName | undefined; children: ReactNode; keys?: PaletteKeys[] | undefined; action?: ReactNode;
}) {
  return (
    <div className="pal-foot">
      <span className={cn('pal-priv', sealed && !outside && 'is-sealed', outside && 'is-outside')}>
        <Icon name={icon ?? (outside ? 'shieldOff' : sealed ? 'sealed' : 'lock')} size={15} />
        <span>{children}</span>
      </span>
      {keys && keys.length > 0 && (
        <span className="pal-keys">
          {keys.map((k) => <span key={k.label}>{k.keys.map((c) => <Kbd key={c}>{c}</Kbd>)}{k.label}</span>)}
        </span>
      )}
      {action}
    </div>
  );
}

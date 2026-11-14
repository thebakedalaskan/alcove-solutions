/*
 * Calls, the page of every call ahead and every call that's happened, and the places beside it: the parts it's built from,
 * each taking plain data and handlers, with no idea of the router or the API. A part that goes somewhere takes `link`, which
 * the app renders as its own router link with the props it's given. The places (`PlaceTree`, `PlaceRow`) suit any page with a
 * rail of places, and `SkyBar` any page whose job is a search on a short sky. Styles in calls/calls.css (cs-).
 */
import { Fragment, useId, useRef, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { Popover } from '../foundation/overlay';
import { Faces, type AvatarPerson } from '../foundation/people';
import { Button, IconButton, Kbd } from '../foundation/primitives';

/** What a part that goes somewhere gives the app's router link to render: its class and what it shows. */
export interface LinkProps { className: string; children: ReactNode; 'aria-current'?: 'page' | undefined; 'aria-label'?: string | undefined; title?: string | undefined }
/** Renders a part's link: the app's own router link with these props, or an anchor. */
export type LinkRender = (props: LinkProps) => ReactNode;

/* ---------- the sky ---------- */

/**
 * The slim band of sky a page starts with when its job is to find something: its title at the top left, its one search in the
 * middle, and its one filled button at the right (`action`). Search and you stay at the top right, outside the page; a page
 * with this bar hides the top search, as its own takes ⌘K. On a phone the title steps back for the phone's top bar, the
 * search takes the width, and the page puts its action in the top bar.
 */
export function SkyBar({ title, search, action, className }: { title: string; search: ReactNode; action?: ReactNode; className?: string | undefined }) {
  return (
    <header className={cn('cs-sky', className)}>
      <h1 className="dusk-title cs-sky-t">{title}</h1>
      <div className="cs-sky-q">{search}</div>
      <div className="cs-sky-a">{action}</div>
    </header>
  );
}

/**
 * The search on the sky: what's typed, set in Newsreader because it's the page's hero, and, once something is, a way to clear
 * it and Ask. Ask is tinted, so the page keeps its one filled button. `keyHint` is the key that comes here (⌘K).
 */
export function SkySearch({ inputRef, value, placeholder, maxLength, keyHint, keyShortcuts, asked, asking, token, onChange, onKeyDown, onClear, onAsk }: {
  inputRef: RefObject<HTMLInputElement | null>; value: string; placeholder: string; maxLength: number;
  keyHint: string; keyShortcuts: string;
  /** What's in the line is the question that's been answered, or is being. */
  asked: boolean; asking: boolean;
  /** Someone the search is narrowed to, as a token before the words, with its own way out. */
  token?: ReactNode;
  onChange: (text: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void; onClear: () => void; onAsk: () => void;
}) {
  return (
    <div className={cn('cs-q', (value || token) && 'is-on')}>
      <Icon name="search" size={18} />
      {token}
      <input ref={inputRef} type="text" value={value} placeholder={placeholder} aria-label={placeholder} aria-keyshortcuts={keyShortcuts} autoComplete="off" spellCheck={false}
        enterKeyHint="search" maxLength={maxLength} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      {value ? (
        <>
          <IconButton icon="x" size={16} label="Clear search" className="cs-q-x" onClick={onClear} />
          <Button size="sm" icon="ask" className="cs-q-ask" disabled={asked} loading={asking} onClick={onAsk}>Ask</Button>
        </>
      ) : <Kbd className="cs-q-k">{keyHint}</Kbd>}
    </div>
  );
}

/* ---------- the places ---------- */

/** A rail of places, beside the sheet they open: rows, a heading for some of them, and a foot. On a phone it's `PlaceChips` instead. */
export function PlaceTree({ label, children, foot, className }: { label: string; children: ReactNode; foot?: ReactNode; className?: string | undefined }) {
  return (
    <nav className={cn('cs-tree', className)} aria-label={label}>
      <div className="cs-tree-in">{children}</div>
      {foot}
    </nav>
  );
}

/** A heading over some of the places, such as Series. */
export const PlaceHead = ({ children }: { children: ReactNode }) => <p className="cs-th">{children}</p>;

/**
 * One place: its icon (or `mark`, a workspace's own), its name, and at its end a count or a few words (`trail`, such as a
 * series' next call). `depth` 1 sits under the place before it. The one you're on is `current`. `twist` opens and closes the
 * places under it. It goes somewhere through `link`, or does something with `onSelect`.
 */
export function PlaceRow({ icon, mark, label, count, countTone, trail, depth = 0, current = false, twist, link, onSelect }: {
  icon?: IconName | undefined; mark?: ReactNode; label: string;
  count?: number | undefined;
  /** `sun`: something's happening now in it. */
  countTone?: 'sun' | undefined;
  trail?: string | undefined;
  depth?: 0 | 1 | 2 | undefined; current?: boolean | undefined;
  twist?: { open: boolean; label: string; onToggle: () => void } | undefined;
  link?: LinkRender | undefined; onSelect?: (() => void) | undefined;
}) {
  const end = trail ?? (count ? String(count) : undefined);
  const inside = (
    <>
      <span className="cs-t-ic">{mark ?? (icon && <Icon name={icon} size={17} />)}</span>
      <span className="cs-t-l">{label}</span>
      {end && <small className={cn(countTone === 'sun' && 'is-sun', trail !== undefined && 'is-trail')}>{end}</small>}
    </>
  );
  const className = cn('cs-t', depth === 1 && 'is-sub', depth === 2 && 'is-sub2', current && 'is-on');
  return (
    <div className="cs-tr">
      {twist && <button type="button" className={cn('cs-tw', twist.open && 'is-open')} aria-label={twist.label} aria-expanded={twist.open} onClick={twist.onToggle}><Icon name="chevron" size={13} /></button>}
      {link ? link({ className, children: inside, 'aria-current': current ? 'page' : undefined })
        : <button type="button" className={className} aria-current={current ? 'page' : undefined} onClick={onSelect}>{inside}</button>}
    </div>
  );
}

/** The rail's foot: something connected, and the words that say so ("Google Calendar", "Connected"), opening where it's managed. */
export function PlaceFoot({ icon, title, detail, link }: { icon: IconName; title: string; detail: string; link: LinkRender }) {
  return (
    <div className="cs-foot">
      {link({ className: 'cs-foot-l', children: <><Icon name={icon} size={17} /><span><b>{title}</b><small>{detail}</small></span><Icon name="chevron" size={13} className="cs-foot-go" /></> })}
    </div>
  );
}

/** The places on a phone, where the rail has no room: a row of chips. */
export function PlaceChips({ label, chips }: { label: string; chips: { key: string; label: string; current: boolean; link: LinkRender }[] }) {
  return (
    <nav className="cs-chips-nav" aria-label={label}>
      {chips.map((c) => <span key={c.key}>{c.link({ className: cn('cs-chip', c.current && 'is-on'), children: c.label, 'aria-current': c.current ? 'page' : undefined })}</span>)}
    </nav>
  );
}

/* ---------- the sheet ---------- */

/** What a place opens, on its sheet: the rail's partner. It scrolls by itself, under the sky. */
export function CallsSheet({ ref, label, children, className }: { ref?: Ref<HTMLElement> | undefined; label: string; children: ReactNode; className?: string | undefined }) {
  return <section ref={ref} className={cn('cs-sheet', className)} aria-label={label}>{children}</section>;
}

/** The sheet's head: what's on it (Newsreader), a line under that when there's something to say, and what you can do with all of it. */
export function SheetHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="cs-mh">
      <div className="cs-mh-t"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      {actions && <div className="cs-mh-a">{actions}</div>}
    </div>
  );
}

/** A day's calls, or another group of them, under its name on a hairline: in `sun` when they're still to come. */
export function CallsGroup({ label, soon = false, more, children }: { label: string; soon?: boolean | undefined; more?: ReactNode; children: ReactNode }) {
  const h = useId();
  return (
    <section className="cs-g" aria-labelledby={h}>
      <h3 id={h} className={cn('cs-gh', soon && 'is-soon')}>{label}</h3>
      <div className="cs-g-rows">{children}</div>
      {more}
    </section>
  );
}

/** Under a group's last row: what else there is, as a way to it ("Show 3 more coming up"). */
export function CallsMore({ children, link, onSelect }: { children: ReactNode; link?: LinkRender | undefined; onSelect?: (() => void) | undefined }) {
  const inside = <>{children}<Icon name="right" size={14} /></>;
  return link ? <>{link({ className: 'cs-more', children: inside })}</> : <button type="button" className="cs-more" onClick={onSelect}>{inside}</button>;
}

/* ---------- a call ---------- */

/** Who a call is with: their faces, or an arch with what it is (a calendar meeting, a call waiting for a time, a recording in the room). */
export type CallWho = { faces: AvatarPerson[] } | { arch: IconName; solid?: boolean | undefined };

/**
 * A call in the list, ahead or past. Every column is fixed, so things line up down the sheet: who, then what it is and what it
 * needs from you, then when, then its menu. Its name is its link (`open`), which covers the row; what you can press in it sits
 * above that.
 */
export function CallRow({ who, title, open, tag, line, quiet, note, notesOff = false, gist, quote, reply, chips, when, pinned = false, menu, fresh = false, soon = false, muted = false }: {
  who: CallWho;
  /** The call's name, which may mark the words searched for. */
  title: ReactNode;
  /** The row's link: given the title, it opens the call. */
  open: LinkRender;
  /** Beside the name: its series, where it came from, how you got it. */
  tag?: { icon: IconName; text: string } | undefined;
  /** Under the name, for a call ahead: who's on it. */
  line?: ReactNode;
  /** After it, quietly: how others have answered, the times a guest picks from. */
  quiet?: ReactNode;
  /** After that, what needs saying: `rose` waits on you (an invitation, a request to move); `sun` just happened (Just scheduled). */
  note?: { text: string; tone: 'rose' | 'sun' } | undefined;
  /** The call won't write notes: said only when it won't. */
  notesOff?: boolean | undefined;
  /** For a call that happened: what it was about, in a line. */
  gist?: ReactNode;
  /** Or the line a search found, with who said it. */
  quote?: ReactNode;
  /** What you can answer in place: `CallReply`, or `CallAnswered`. */
  reply?: ReactNode;
  /** What waits on you from it, and the moments a search found: `CallChip`, `MomentChip`. */
  chips?: ReactNode;
  /** When: the time (or the day, further back), and how long. */
  when: { at: string; length?: string | undefined };
  pinned?: boolean | undefined;
  /** Its `RowMenu`. */
  menu?: ReactNode;
  /** Scheduled or moved a moment ago: it's lit, once. */
  fresh?: boolean | undefined;
  /** Still to come: its time is in sun. */
  soon?: boolean | undefined;
  /** A calendar meeting: its name steps back. */
  muted?: boolean | undefined;
}) {
  return (
    <div className={cn('cs-row', soon && 'is-soon', fresh && 'is-fresh', muted && 'is-muted')}>
      <span className="cs-who" aria-hidden="true">
        {'faces' in who ? <Faces people={who.faces} size={24} max={3} /> : <span className={cn('cs-arch', who.solid && 'is-solid')}><Icon name={who.arch} size={16} /></span>}
      </span>
      <span className="cs-main">
        <span className="cs-t1">
          {open({ className: 'cs-link ac-clamp-1', children: title })}
          {tag && <small className="cs-from"><Icon name={tag.icon} size={13} /><span>{tag.text}</span></small>}
        </span>
        {(line || quiet || note || notesOff) && (
          <span className="cs-line">
            {line && <span>{line}</span>}
            {quiet && <span className="cs-quiet">{quiet}</span>}
            {note && <span className={cn('cs-note', note.tone === 'rose' ? 'is-rose' : 'is-sun')}>{note.text}</span>}
            {notesOff && <span className="cs-nt" title="This call won’t write notes">No notes</span>}
          </span>
        )}
        {gist && <span className="cs-gist ac-clamp-1">{gist}</span>}
        {quote && <span className="cs-quote ac-clamp-2">{quote}</span>}
        {reply}
        {chips && <span className="cs-chips">{chips}</span>}
      </span>
      <span className="cs-when">
        <b>{pinned && <><Icon name="pin" size={13} className="cs-pin" /><span className="sr-only">Pinned. </span></>}{when.at}</b>
        {when.length && <small>{when.length}</small>}
      </span>
      <span className="cs-menu">{menu}</span>
    </div>
  );
}

/** What you can answer in place, as equal buttons: Yes, Maybe and No; Move it and Keep 10:00. `label` names the choice. */
export function CallReply({ label, children }: { label: string; children: ReactNode }) {
  return <span className="cs-reply" role="group" aria-label={label}>{children}</span>;
}

/** An answer you've given, with the way to change it: "You're going · Change". */
export function CallAnswered({ children, change, changeLabel }: { children: ReactNode; change: () => void; changeLabel: string }) {
  return (
    <span className="cs-reply is-said">
      <Icon name="check" size={15} /><span>{children}</span>
      <Button variant="quiet" size="xs" aria-label={changeLabel} onClick={change}>Change</Button>
    </span>
  );
}

/**
 * What waits on you from a call, as its kind's colour: a decision to confirm (`decide`, rose), a follow-up (`follow`, horizon),
 * notes being written (`writing`) or still recording (`rec`).
 */
export function CallChip({ kind, children }: { kind: 'decide' | 'follow' | 'writing' | 'rec'; children: ReactNode }) {
  const icon: Partial<Record<typeof kind, IconName>> = { decide: 'badgeCheck', follow: 'userCheck' };
  const glyph = icon[kind];
  return <span className={cn('cs-k', `is-${kind}`)}>{kind === 'rec' && <i className="ac-rec-dot" aria-hidden="true" />}{glyph && <Icon name={glyph} size={13} />}{children}</span>;
}

/**
 * A moment in a call: ▶ and the time. `label` says what pressing it does, in full ("Open Team standup at 8:40", "Play from
 * 8:40"). It goes there through `link`, or plays in place with `onPlay`.
 */
export function MomentChip({ time, label, link, onPlay, className }: { time: string; label: string; link?: LinkRender | undefined; onPlay?: (() => void) | undefined; className?: string | undefined }) {
  const inside = <><Icon name="playLine" size={11} /><span>{time}</span></>;
  const cls = cn('cs-at', className);
  return link ? <>{link({ className: cls, children: inside, 'aria-label': label, title: label })}</> : <button type="button" className={cls} aria-label={label} title={label} onClick={onPlay}>{inside}</button>;
}

/* ---------- a call's menu ---------- */

/** One thing a call's menu does: it does it (`onSelect`), or opens elsewhere (`href`, in a new tab). */
export interface RowMenuItem {
  /** Unique in its menu. */
  id: string;
  label: string;
  icon: IconName;
  onSelect?: (() => void) | undefined;
  href?: string | undefined;
  /** A few words at its end, such as what it needs. */
  note?: string | undefined;
  /** It takes something away, said in caution. */
  tone?: 'caution' | undefined;
  /** A hairline before it: the ones that take something away come last, apart. */
  separatorBefore?: boolean | undefined;
}

/** Up, Down, Home and End move through a menu's items. */
function moveIn(e: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.cs-mi'));
  const at = items.findIndex((el) => el === document.activeElement);
  const last = items.length - 1;
  const to = e.key === 'ArrowDown' ? (at >= last ? 0 : at + 1) : e.key === 'ArrowUp' ? (at <= 0 ? last : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
  if (to === null) return;
  e.preventDefault();
  items[to]?.focus();
}

/**
 * ⋯ on a call, in a fixed column: what you can do with it. A question it asks first (cancelling, which calls a change is for,
 * who to share with) is a `step` in the same popover, in place of the items, so no window opens over another.
 */
export function RowMenu({ label, open, onOpenChange, items, step, wide = false }: {
  /** Names the call: "More for Hiring sync". */
  label: string;
  open: boolean; onOpenChange: (open: boolean) => void;
  items: RowMenuItem[];
  step?: ReactNode;
  /** The step needs more room, as a picker of people does. */
  wide?: boolean | undefined;
}) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange} label={label} align="end" tip="More" className={cn('cs-rmenu', wide && 'is-wide')}
      anchor={<IconButton ref={button} icon="more" size={17} label={label} title={undefined} className="cs-menu-b" aria-expanded={open} />}>
      {step ?? (
        <div role="menu" aria-label={label} className="cs-mlist" onKeyDown={moveIn}>
          {items.map((m) => {
            const inside = <><Icon name={m.icon} size={17} /><span className="l">{m.label}</span>{m.note && <small>{m.note}</small>}</>;
            const cls = cn('cs-mi', m.tone === 'caution' && 'is-caution');
            return (
              <Fragment key={m.id}>
                {m.separatorBefore && <span className="cs-sep" role="separator" />}
                {m.href
                  ? <a role="menuitem" className={cls} href={m.href} target="_blank" rel="noopener noreferrer" onClick={() => onOpenChange(false)}>{inside}</a>
                  : <button type="button" role="menuitem" className={cls} onClick={m.onSelect}>{inside}</button>}
              </Fragment>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/** A question a call's menu asks before it does something: what will happen, then the answers. The answer that loses nothing is first. */
export function RowAsk({ title, children, actions }: { title: string; children?: ReactNode; actions: ReactNode }) {
  const h = useId();
  return (
    <div className="cs-ask" role="group" aria-labelledby={h}>
      <b id={h}>{title}</b>
      {children && <div className="cs-ask-b">{children}</div>}
      <div className="cs-ask-a">{actions}</div>
    </div>
  );
}

/* ---------- asking every call ---------- */

/**
 * An answer from every call, at the top of the sheet: where it was read and from how many calls (`sealed`), the answer, then
 * the moments it comes from (`cites`). × puts it away.
 */
export function CallsAnswer({ sealed, reading = false, cites, onClose, children }: { sealed: ReactNode; reading?: boolean | undefined; cites?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <section className="cs-answer" aria-label="The answer" aria-live="polite" aria-busy={reading}>
      <header><span className="cs-seal"><Icon name="sealed" size={15} />{sealed}</span><IconButton icon="x" size={16} label="Put the answer away" onClick={onClose} /></header>
      <div className={cn('cs-answer-t', reading && 'is-reading')}>{children}</div>
      {cites && <div className="cs-answer-c">{cites}</div>}
    </section>
  );
}

/* ---------- what carries over in a series ---------- */

/**
 * Something a series carries from call to call: its kind's mark (a question, a follow-up's dot, a decision's diamond, or the
 * tick box that settles it), what it says, who and when under it with its moment, and what you can do in a fixed column.
 */
export function CarryRow({ kind, mark, done = false, children, sub, later, actions }: {
  kind: 'ask' | 'follow' | 'decide';
  /** In place of the kind's mark: the tick box that settles it. */
  mark?: ReactNode;
  /** Settled since the last call: answered, or done. */
  done?: boolean | undefined;
  children: ReactNode;
  sub: ReactNode;
  /** Where a later call seems to have settled it. */
  later?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={cn('cs-carry', `is-${kind}`, done && 'is-done')}>
      <span className="cs-mk">{mark ?? (kind === 'ask' ? <Icon name="ask" size={16} /> : <i />)}</span>
      <span className="cs-carry-b">
        <b>{children}</b>
        <small>{sub}</small>
        {later}
      </span>
      <span className="cs-carry-a">{actions}</span>
    </div>
  );
}

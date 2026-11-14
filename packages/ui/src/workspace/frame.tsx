/*
 * A workspace, full screen: its own side panel, dark in both themes like the app's, beside its page, with one bar over the
 * page. Home puts the workspace's name on the evening, running up behind the bar. Every part is stateless, taking plain data
 * and handlers; the app composes them (apps/web/src/features/workspace/full-screen/Frame.tsx). The rows in the side panel are the list's
 * own (`WsRow`, `WsSection`, `WsTrashRow`), on the panel's dark. Classes `wf-` in workspace.css.
 */
import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cn } from '../foundation/cn';
import { Horizon } from '../evening/horizon';
import { Icon } from '../foundation/icon';
import { Avatar, Faces, type AvatarPerson } from '../foundation/people';
import { Button, IconButton, Kbd } from '../foundation/primitives';
import { WsSaveState, type WsFace, type WsSave } from './document';
import { WsSpaceField, WsTree, type WsNaming, type WsTreeProps } from './list';
import { WsPopover, type WsPop } from './popover';

/** Which of the two a phone shows: the workspace's pages, in its side panel, or the page that's open. */
export type WsPhone = 'list' | 'page';

/**
 * The frame: the side panel, the bar and the page. `bar` is where the bar goes (each page puts its own there, with what it
 * says about itself). `home`: the page is the workspace's Home, whose evening runs up behind the bar, which is clear until
 * the page scrolls under it (`scrolled`). `following` draws the line that says you're going where someone goes. Without a
 * `side` it's the frame waiting for its workspace: the side panel dark and empty.
 */
export function WsFrame({ side, bar, children, phone = 'page', home = false, scrolled = false, following = false, ref }: {
  side?: ReactNode; bar?: Ref<HTMLDivElement> | undefined; children?: ReactNode; phone?: WsPhone | undefined; home?: boolean | undefined; scrolled?: boolean | undefined;
  following?: boolean | undefined; ref?: Ref<HTMLElement> | undefined;
}) {
  return (
    <section ref={ref} aria-label="Workspace" className={cn('wf', home && 'is-home', scrolled && 'is-scrolled')} data-phone={phone}>
      {side ?? <div className="wf-side dark" />}
      <div ref={bar} className="wf-top" />
      <div className={cn('wf-main', following && 'is-follow')}>{children}</div>
    </section>
  );
}

/** A workspace's mark: the first letter of its name, or for a call's own workspace, the call's camera. */
export function WsMark({ name, call = false, className }: { name: string; call?: boolean | undefined; className?: string | undefined }) {
  const letter = name.trim().charAt(0).toUpperCase() || '·';
  return <span className={cn('wf-mark', call && 'is-call', className)} aria-hidden="true">{call ? <Icon name="video" size={15} /> : letter}</span>;
}

export interface WsSideProps extends WsTreeProps {
  /** The Alcove logo, which goes Home: the app's own link. */
  brand: ReactNode;
  /** Which workspace this is, as the switcher at the top says it: its name and mark, and the menu it opens. */
  space: {
    name: string;
    mark: ReactNode;
    picker: WsPop;
    /** Naming it, in place of the switcher. */
    naming?: WsNaming | null | undefined;
    /** A new name on its way: Saving…, Saved, or Couldn't confirm. */
    saveState?: 'quiet' | 'saving' | 'saved' | 'failed' | undefined;
  };
  /** Search: Find, in this workspace. `searchKeys` is its shortcut, as this computer writes it. */
  onSearch: () => void;
  searchKeys?: string | undefined;
  /** The list's own connection dropped, so it may not be up to date: Reconnecting, with Try now while the browser's online. */
  reconnecting?: { onTry?: (() => void) | undefined } | null | undefined;
  /** At the foot, under the rows however long they run: Trash. */
  foot?: ReactNode;
  /** Who can open the workspace, beside the seal: "Priya, Kofi, Ines and you can open it". */
  sealed: string;
  /**
   * Share: who can open it is pressed to see who's in it, which opens over the foot (the people sheet: adding people, what each
   * can do, leaving). Left out for someone who isn't in it, for whom it's only said.
   */
  share?: WsPop | undefined;
}

/**
 * The side panel: the logo, the workspace switcher, Search, then the rows (Home or the call first, then each section), and at
 * the foot Trash and who can open it, which opens who's in it. Dark in both themes. On a phone it's the workspace's pages, the
 * width of the screen.
 */
export function WsSide({ brand, space, onSearch, searchKeys, reconnecting, foot, sealed, share, label = 'This workspace', ...tree }: WsSideProps) {
  return (
    <nav className="wf-side dark" aria-label={label}>
      <div className="wf-brand">{brand}</div>
      {space.naming ? <WsSpaceField {...space.naming} mark={space.mark} /> : (
        <WsPopover open={space.picker.open} onOpenChange={space.picker.onOpenChange} label="Workspaces" anchor={
          <button type="button" className="wf-switch">{space.mark}<b className="ac-clamp-1" title={space.name}>{space.name}</b><Icon name="chevronsUpDown" size={15} /></button>
        }>{space.picker.content}</WsPopover>
      )}
      {space.saveState !== undefined && space.saveState !== 'quiet' && (
        <span role="status" className={cn('wf-name-save', space.saveState === 'failed' && 'is-failed')}>{space.saveState === 'saving' ? 'Saving…' : space.saveState === 'saved' ? 'Saved' : 'Couldn’t confirm'}</span>
      )}
      {reconnecting && (
        <div className="wt-off" role="status">
          <Icon name="wifiOff" size={13} /><span className="ac-clamp-1">Reconnecting</span>
          {reconnecting.onTry && <button type="button" onClick={reconnecting.onTry}>Try now</button>}
        </div>
      )}
      <button type="button" className="wf-search" onClick={onSearch} aria-haspopup="dialog"><Icon name="search" size={15} /><span>Search</span>{searchKeys && <Kbd>{searchKeys}</Kbd>}</button>
      <WsTree label={label} {...tree} />
      <div className="wf-foot">
        {foot}
        {share ? (
          <WsPopover open={share.open} onOpenChange={share.onOpenChange} label={`People in ${space.name}`} side="top" anchor={
            <button type="button" className="wf-seal" aria-label={`Share ${space.name}. ${sealed}`}>
              <Icon name="sealed" size={13} /><span className="ac-clamp-2">{sealed}</span><span className="wf-seal-go" aria-hidden="true">Share</span>
            </button>
          }>{share.content}</WsPopover>
        ) : <p className="wf-seal"><Icon name="sealed" size={13} /><span className="ac-clamp-2">{sealed}</span></p>}
      </div>
    </nav>
  );
}

/** A step on the bar's path: the workspace, a folder, the page. One you can press goes there. */
export interface WsCrumb { label: string; onClick?: (() => void) | undefined }

/** Who else is here, on the bar: their faces, each opening their card, and the words for it ("Priya is here"). */
export interface WsHere { faces: WsFace[]; line: string }

export interface WsBarProps {
  /** Where the workspace was opened from, which pressing it goes back to: ← Drive or ← Calls. */
  back: { label: string; onClick: () => void };
  /** The path after it: the workspace, its folders, and the page you're on, last. */
  crumbs?: readonly WsCrumb[] | undefined;
  /** A phone's way back to the workspace's pages from a page: ← and the workspace's name. Left out on the pages themselves. */
  up?: { label: string; onClick: () => void } | undefined;
  save?: WsSave | undefined;
  here?: WsHere | undefined;
  share?: WsPop | undefined;
  /** ⋯, with what else can be done with the page, named `moreLabel`. */
  more?: WsPop | undefined;
  moreLabel?: string | undefined;
  /** Leave full screen: back to where it was opened from. There's none on a phone, where back does it. */
  onExit?: (() => void) | undefined;
  /** You, at the far right: your face, which opens the app's own menu (Settings, the theme, Sign out). */
  me?: ReactNode;
}

/**
 * The bar over the page: the way back and the path, then how it's saving, who else is here, Share, ⋯, leaving full screen and
 * you. On a phone it's the way back (to the workspace's pages from a page, `up`), ⋯ and you.
 */
export function WsBar({ back, crumbs = [], up, save, here, share, more, moreLabel = 'More', onExit, me }: WsBarProps) {
  return (
    <header className={cn('wf-bar', up && 'has-up')}>
      <nav className="wf-path" aria-label="Where you are">
        <button type="button" className="wf-back" onClick={back.onClick} title={`Back to ${back.label}`}><Icon name="left" size={16} /><span>{back.label}</span></button>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={i}>
              <Icon name="chevron" size={13} className="wf-sep" />
              {c.onClick && !last
                ? <button type="button" className="wf-crumb" onClick={c.onClick}><span className="ac-clamp-1">{c.label}</span></button>
                : <span className={cn('wf-crumb', last && 'is-last')} aria-current={last ? 'page' : undefined}><span className="ac-clamp-1">{c.label}</span></span>}
            </Fragment>
          );
        })}
      </nav>
      {up && <button type="button" className="wf-up" onClick={up.onClick}><Icon name="left" size={17} /><span className="ac-clamp-1">{up.label}</span></button>}
      <div className="wf-end">
        {save && save !== 'quiet' && <WsSaveState state={save} />}
        {here && here.faces.length > 0 && (
          <span className="wf-here">
            <span className="wf-faces">
              {here.faces.slice(0, 3).map((f, i) => (
                <WsPopover key={i} open={f.card.open} onOpenChange={f.card.onOpenChange} label={f.person.name} align="end"
                  anchor={<button type="button" className="wf-face" aria-label={f.person.name}><Avatar person={f.person} size={24} /></button>}>{f.card.content}</WsPopover>
              ))}
            </span>
            <span className="wf-here-t">{here.line}</span>
          </span>
        )}
        {share && <WsPopover open={share.open} onOpenChange={share.onOpenChange} label="Share" align="end" anchor={<Button size="sm" icon="share" className="wf-share">Share</Button>}>{share.content}</WsPopover>}
        {more && <WsPopover open={more.open} onOpenChange={more.onOpenChange} label={moreLabel} align="end" anchor={<IconButton icon="more" size={18} className="wf-ib" label={moreLabel} />}>{more.content}</WsPopover>}
        {onExit && <IconButton icon="shrink" size={17} className="wf-ib wf-exit" label="Leave full screen" title="Leave full screen" onClick={onExit} />}
        {me && <span className="wf-me">{me}</span>}
      </div>
    </header>
  );
}

/** Who's here, in words: "Priya is here", "Priya and Kofi are here", "Priya, Kofi and 2 others are here". */
export function hereLine(names: readonly string[]): string {
  const [a, b] = names;
  if (a === undefined) return '';
  if (b === undefined) return `${a} is here`;
  if (names.length === 2) return `${a} and ${b} are here`;
  if (names.length === 3) return `${a}, ${b} and ${names[2] ?? ''} are here`;
  return `${a}, ${b} and ${names.length - 2} others are here`;
}

/** Home's top: the workspace's name on the evening after sunset, which runs up behind the bar and fades into the page. */
export function WsHomeBand({ name }: { name: string }) {
  return (
    <div className="wf-band">
      <Horizon moment="note" />
      <h1 className="wf-name">{name}</h1>
    </div>
  );
}

/**
 * The one line on what a workspace is for, under its name. Someone who can change it (`onEdit`) presses it to write in its
 * place (`editing`), or presses the quiet line asking for one while it says nothing; anyone else just reads it.
 */
export function WsAbout({ text, editing, onEdit }: { text: string; editing?: WsNaming | null | undefined; onEdit?: (() => void) | undefined }) {
  if (editing) return <AboutField {...editing} />;
  if (!onEdit) return text ? <p className="wf-about">{text}</p> : null;
  return text
    ? <button type="button" className="wf-about is-editable" onClick={onEdit} title="Change what it’s for">{text}<Icon name="pen" size={14} /></button>
    : <button type="button" className="wf-about is-empty" onClick={onEdit}><Icon name="pen" size={14} />Say what this workspace is for</button>;
}

/** The line, being written: Enter or leaving it keeps it, Esc goes back. It opens with what it said selected. */
function AboutField({ name, placeholder, onCommit, onCancel }: WsNaming) {
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  return (
    <input ref={field} className="wf-about is-field" type="text" aria-label="What this workspace is for" placeholder={placeholder} defaultValue={name} maxLength={200}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { cancelled.current = true; onCancel(); }
      }}
      onBlur={(e) => { if (!cancelled.current) onCommit(e.currentTarget.value); }} />
  );
}

/** Who's in a workspace, under its line: their faces and their names ("Priya, Kofi, Ines and you"). Pressing it shows them all. */
export function WsPeopleLine({ people, line, onOpen }: { people: AvatarPerson[]; line: string; onOpen?: (() => void) | undefined }) {
  const inner = <><Faces people={people} size={22} max={5} /><span>{line}</span></>;
  return onOpen ? <button type="button" className="wf-who" onClick={onOpen}>{inner}</button> : <p className="wf-who">{inner}</p>;
}

/** A part of Home: its heading, and what's under it. */
export function WsHomeSection({ title, children, className }: { title: string; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn('wf-sec', className)} aria-label={title}>
      <h2 className="wf-sh">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Under a document's title: the call it came from, as a chip that opens the call (`from`), and who made it with when it was
 * last edited.
 */
export function WsDocMeta({ from, person, name, edited }: { from?: { label: string; onClick?: (() => void) | undefined } | undefined; person: AvatarPerson | null; name: string | null; edited: string }) {
  return (
    <p className="wf-dmeta">
      {from && (from.onClick
        ? <button type="button" className="wf-from" onClick={from.onClick}><Icon name="video" size={14} /><span className="ac-clamp-1">{from.label}</span></button>
        : <span className="wf-from"><Icon name="video" size={14} /><span className="ac-clamp-1">{from.label}</span></span>)}
      <span className="wf-by">{person && <Avatar person={person} size={20} />}{name && <span className="n">{name}</span>}<span className="d">{edited}</span></span>
    </p>
  );
}

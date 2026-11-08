/*
 * The call stage, always night: tiles, the dock and More, what's yours at the top right, captions, pointers on a share, and
 * how loud someone is for you. What's open on your stage wears a frame, what someone presents waits as a tile with the
 * people, and Share, in the dock, presents your screen, a board or the workspace in a step or two.
 */
import { forwardRef, useLayoutEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Dots } from './motion';
import { Popover, Tooltip } from './overlay';
import { Avatar, PortraitArt, type AvatarPerson } from './people';
import { Button, IconButton, Notice, RecDot, Scope, Slider, Spinner, Switch } from './primitives';

/** "#RRGGBB" at an alpha, for the person's colour as room light. */
function withAlpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return 'transparent';
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A tile's ground: the person's colour as warm room light on the night stage (illustration). */
export function tileGround(person: AvatarPerson): string | undefined {
  const bg = person.portrait?.bg;
  if (!bg) return undefined;
  return `radial-gradient(70% 55% at 22% 0%, rgba(255,226,196,.16), transparent 70%), radial-gradient(90% 75% at 50% 32%, ${withAlpha(bg, 0.32)}, transparent 72%), linear-gradient(180deg, #24204A, #16132F)`;
}

/**
 * One person on the stage. Their video when it's on (`children`); otherwise their illustrated figure
 * on their own colour, or their arch. The speaker gets the speak ring and a level meter; a muted
 * person shows the mic-off mark; a raised hand gets a gold ring.
 */
export function CallTile({ person, name, speaking = false, muted = false, hand = false, connecting = false, className, children, chrome, label, signal }: {
  person: AvatarPerson; name: ReactNode; speaking?: boolean; muted?: boolean; hand?: boolean;
  /** In the call, but this browser can't play their media yet (their keys are on the way): not the same as a camera that's off. */
  connecting?: boolean | undefined;
  className?: string | undefined; children?: ReactNode;
  /** Controls and state drawn over the tile: what's pinned or spotlighted, its options. */
  chrome?: ReactNode; label?: string | undefined;
  signal?: ReactNode;
}) {
  const ground = children ? undefined : tileGround(person);
  return (
    <div className={cn('ac-tile', speaking && 'is-speaking', hand && 'is-hand', connecting && 'is-connecting', className)} style={ground ? { background: ground } : undefined} aria-label={label}>
      {children ?? (person.portrait
        ? <svg className="ac-figure" viewBox="0 20 200 220" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><PortraitArt p={person.portrait} /></svg>
        : <span className="ac-tile-face"><Avatar person={person} size={88} /></span>)}
      <span className="ac-tile-name">
        {speaking && <span className="ac-level" aria-hidden="true"><i /><i /><i /></span>}
        {hand && <Icon name="hand" size={14} />}
        {name}
      </span>
      {connecting ? <span className="ac-tile-wait" role="status"><Dots />Connecting</span>
        : muted && !hand && <span className="ac-tile-mic" aria-label="Microphone off"><Icon name="micOff" size={14} /></span>}
      {hand && <span className="ac-tile-hand" aria-label="Hand raised"><Icon name="hand" size={15} /></span>}
      {signal}
      {chrome}
    </div>
  );
}

/** The call's controls in one floating bar, bottom-centre on the stage. `tucked`: only what's marked `keep` shows. */
export function CallDock({ children, label = 'Call controls', tucked = false, className }: { children: ReactNode; label?: string; tucked?: boolean | undefined; className?: string | undefined }) {
  return <div className={cn('ac-dock', tucked && 'is-tucked', className)} role="toolbar" aria-label={label}>{children}</div>;
}

/**
 * One dock control. `off`: a switched-off device turns solid. `on`: something of yours running, such as a share, or what it
 * opens, open. `alert`: a device that can't work right now (blocked or unplugged) gets a caution mark; say why in the label.
 * `word` is said beside the icon, for the one control the dock names (Share); on a phone it's the icon alone.
 * `tip` shows above it on hover and focus, in place of the browser's own title.
 */
export const DockButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; label: string; off?: boolean; on?: boolean; alert?: boolean; badge?: number; tip?: ReactNode; word?: string | undefined;
}>(function DockButton({ icon, label, off = false, on = false, alert = false, badge = 0, tip, word, className, type = 'button', ...rest }, ref) {
  const button = (
    <button ref={ref} type={type} aria-label={label} title={tip ? undefined : label} aria-pressed={off ? false : on || undefined}
      className={cn('ac-dock-btn', off && 'is-off', on && 'is-on', word && 'has-word', className)} {...rest}>
      <Icon name={icon} size={word ? 19 : 20} />
      {word && <span className="w" aria-hidden="true">{word}</span>}
      {badge > 0 && <span className="badge">{badge}</span>}
      {alert && <span className="alert" aria-hidden="true" />}
    </button>
  );
  return tip ? <Tooltip label={tip}>{button}</Tooltip> : button;
});

/** A dock control with a menu: the button, and a narrow chevron beside it that opens the menu. */
export const DockSplit = ({ children, className }: { children: ReactNode; className?: string | undefined }) => <span className={cn('ac-dock-split', className)}>{children}</span>;
export const DockChevron = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; on?: boolean }>(
  function DockChevron({ label, on = false, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} aria-haspopup="menu" className={cn('ac-dock-chev', on && 'is-on', className)} {...rest}>
        <Icon name="up" size={14} />
      </button>
    );
  });

export const DockSeparator = () => <span className="ac-dock-sep" aria-hidden="true" />;

/** A dock control in words, for the one thing a tucked dock has to say. */
export const DockWords = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; children: ReactNode }>(
  function DockWords({ icon, children, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={cn('ac-dock-words', className)} {...rest}><Icon name={icon} size={15} /><span>{children}</span></button>;
  });

/** Leave: the last item in the dock and its only text button. Where a dock has no room for its word, the word is hidden only from sight, so it's still Leave's name. */
export const DockLeave = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function DockLeave({ className, children = 'Leave', type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={cn('ac-dock-leave', className)} {...rest}><Icon name="signOut" size={18} /><span className="lt">{children}</span></button>;
});

/**
 * What's yours at the top right of the call: one group of buttons, each lit while what it opens is open, and pressed again
 * to put it away, with a hairline between kinds (`CallTopRule`). Only your screen changes.
 */
export const CallTopGroup = ({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) => (
  <div className={cn('ic-yours', className)} role="group" aria-label={label}>{children}</div>
);
export const CallTopRule = () => <span className="ic-ysep" aria-hidden="true" />;

/**
 * One of them: an icon and its word, which goes where there's no room for it (the label still says it), and a count of
 * what's new while it's closed. `on`: what it opens is open.
 */
export const CallTopButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; label: string; word?: string | undefined; on?: boolean | undefined; badge?: number | undefined;
}>(function CallTopButton({ icon, label, word, on = false, badge = 0, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} aria-pressed={on} className={cn('ic-yb', word && 'has-word', on && 'is-on', className)} {...rest}>
      <Icon name={icon} size={18} />
      {word && <span className="yl" aria-hidden="true">{word}</span>}
      {badge > 0 && !on && <span className="badge" aria-hidden="true">{badge}</span>}
    </button>
  );
});

/** More's grid, on a phone: what sits at the top right on a wider screen, as tiles a thumb can reach. */
export const CallMoreGrid = ({ children }: { children: ReactNode }) => <div className="ic-mgrid">{children}</div>;
export const CallMoreTile = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; word: string; label?: string | undefined; badge?: number | undefined;
}>(function CallMoreTile({ icon, word, label, badge = 0, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label ?? word} className={cn('ic-mg', className)} {...rest}>
      <Icon name={icon} size={22} />
      <span aria-hidden="true">{word}</span>
      {badge > 0 && <span className="badge" aria-hidden="true">{badge}</span>}
    </button>
  );
});

/** A live caption. Translated lines carry a language tag and keep the original underneath. */
export function Caption({ who, lang, children, original, className }: { who: ReactNode; lang?: string | undefined; children: ReactNode; original?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('ac-caption', className)}>
      <div className="who">{who}{lang && <span className="lang">{lang}</span>}</div>
      <p>{children}</p>
      {original && <p className="orig">{original}</p>}
    </div>
  );
}

/** Whose a pointer or a mark on a shared screen is: their face in the arch and their name, never told apart by colour alone. */
export function PointerTag({ person, name, className, style }: { person: AvatarPerson; name: ReactNode; className?: string | undefined; style?: CSSProperties | undefined }) {
  return <span className={cn('ac-ptag', className)} style={style}><Avatar person={person} size={16} /><span className="n">{name}</span></span>;
}

/**
 * Someone's pointer on a shared screen: an arrow whose tip is the spot they point at, with whose it is beside it. The tip
 * is at the top left of its box: place it on the spot with left and top.
 */
export function SharePointer({ person, name, style, className }: { person: AvatarPerson; name: ReactNode; style?: CSSProperties | undefined; className?: string | undefined }) {
  return (
    <span className={cn('ac-pointer', className)} style={style}>
      <svg className="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z" /></svg>
      <PointerTag person={person} name={name} />
    </span>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * How loud one person is for you, from their tile's menu and from People: a slider and a quick mute, for you alone. Only
 * your own playback changes. Unmuting goes back to the level they had (the caller keeps it). `level` runs from 0 (muted
 * for you) to 1.
 */
export function VolumeControl({ name, level, onChange, onToggle }: { name: string; level: number; onChange: (level: number) => void; onToggle: () => void }) {
  const muted = level === 0;
  return (
    <div className="ic-vol">
      <div className="ic-vol-h"><span>Volume for you</span><Scope>Only you</Scope></div>
      <div className="ic-vol-row">
        <IconButton icon={muted ? 'speakerOff' : level < 0.5 ? 'speakerLow' : 'speaker'} size={17} on={muted}
          label={muted ? `Unmute ${name} for you` : `Mute ${name} for you`} onClick={onToggle} />
        <Slider value={level} step={0.05} label={`How loud ${name} is for you`} valueText={muted ? 'Muted for you' : pct(level)} onChange={onChange} />
        <span className="n">{muted ? 'Off' : pct(level)}</span>
      </div>
    </div>
  );
}

/** How someone's level reads beside their name: nothing at full volume. */
export function volumeTag(level: number): string | null {
  if (level >= 1) return null;
  return level === 0 ? 'Muted for you' : `${pct(level)} for you`;
}

/* ---------- What's open on your stage ---------- */

/** Whoever presents it, as the frame's bar says while someone else presents a board or the workspace. */
export interface CallFrameFollowing {
  person: AvatarPerson;
  /** Their first name. */
  name: string;
  /** Following them: "Following {name}" with Unfollow. Not: a button, "Follow {name}" over where they are. */
  on: boolean;
  /** Where they are, as it reads under Follow: "Priya is in Launch plan". */
  where: string;
  onToggle: () => void;
}

/** Close, on the frame's bar. */
export interface CallFrameClose {
  /** What it does, on hover: "Close it", "Close it for you, or for everyone", "Close it for you. While Priya presents, its tile takes you back". */
  tip: string;
  onClose: () => void;
  /** While it asks for whom (`CloseAsk`): Close has a ▾ and opens the question under itself instead of closing. */
  ask?: CloseAskProps | undefined;
}

/** Present, on the bar of a board or the workspace open just for you. */
export interface CallFramePresent {
  onPress: () => void;
  busy?: boolean | undefined;
  /** Some people here can't open the board: Present opens `PresentAsk` under itself instead of presenting. */
  ask?: PresentAskProps | undefined;
}

/**
 * The frame anything open on your stage wears: a board, the workspace or a screen. Its bar says whose it is (their arch, or
 * the kind's icon while nobody presents it), what it is and how it stands, then what's yours to press: following its
 * presenter, Present, focus, Stop sharing and Close. The body fills the rest; `foot` floats at its foot, centred. It fills
 * the box it's given: the app places that box. The frame itself takes the keys from code (not from Tab), as it opens from its
 * tile: what it is is said, and Tab goes on to its bar.
 */
export function CallFrame({ who, icon, name, meta, menu, following, present, focus, onStop, close, lit = false, focused = false, phone = false, foot, label, className, style, children }: {
  /** Whoever presents it, in the arch; null while nobody does: the kind's icon in a small square instead. */
  who: AvatarPerson | null;
  /** The kind: `presentation` for a board, `folderOpen` for the workspace, `screen` for a screen. */
  icon: IconName;
  /** "Launch retro", "Launch review · 4 Nov", "Your screen", "Priya’s screen". */
  name: string;
  /** "Open just for you", "You’re presenting · 3 following", "You’re presenting · a tab with sound", "Priya is presenting". */
  meta: string;
  /** The name is a menu ▾ with the app's rows (`.mi`), in a popover under it. Null: the name is plain text. */
  menu: { open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode } | null;
  following: CallFrameFollowing | null;
  present?: CallFramePresent | undefined;
  /** Fill your window with it, or leave focus (⌘⇧F). Null on a phone. */
  focus: { on: boolean; onToggle: () => void } | null;
  /** Stop sharing: your own screen, for everyone. */
  onStop?: (() => void) | undefined;
  close: CallFrameClose | null;
  /** You follow its presenter: its edge is lit. */
  lit?: boolean | undefined;
  /** It fills the window: a squarer edge. */
  focused?: boolean | undefined;
  /** A phone: how it stands goes under its name. */
  phone?: boolean | undefined;
  /** Floating at the foot of the body, centred: the board presenter's pager (`FramePager`). */
  foot?: ReactNode;
  /** The section's name: "Launch retro, only you see it", "Launch retro, everyone sees it". */
  label: string;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** The body, which fills the frame under its bar. */
  children: ReactNode;
}) {
  const title = <span className="nm ac-clamp-1">{name}</span>;
  /* Unfollow and Follow are two buttons: pressing one hands the keys to the other as it takes its place. */
  const followButton = useRef<HTMLButtonElement>(null);
  const followPressed = useRef(false);
  const followOn = following?.on;
  useLayoutEffect(() => {
    const pressed = followPressed.current;
    followPressed.current = false;
    if (pressed && (document.activeElement === null || document.activeElement === document.body)) followButton.current?.focus({ preventScroll: true });
  }, [followOn]);
  const toggleFollow = () => { followPressed.current = true; following?.onToggle(); };
  const closeButton = close && (
    <button type="button" className="ic-close" aria-label={`Close ${name}`} onClick={close.ask ? undefined : close.onClose}>
      <Icon name="x" size={15} />Close{close.ask && <Icon name="down" size={13} className="chev" />}
    </button>
  );
  const presentButton = present && (
    <button type="button" className="ic-present" title="Everyone follows you" disabled={present.busy} aria-busy={present.busy || undefined}
      onClick={present.ask ? undefined : present.onPress}>
      {present.busy ? <Spinner /> : <Icon name="presentation" size={15} />}Present
    </button>
  );
  const focusSays = focus?.on ? 'Leave focus' : 'Fill your window with it';
  return (
    <section className={cn('ic-frame-box', lit && 'is-lit', focused && 'is-focused', phone && 'is-phone', className)} style={style} aria-label={label} data-frame="" tabIndex={-1}>
      <div className="ic-fbar">
        <div className="ic-fwho">
          {who ? <Avatar person={who} size={24} /> : <span className="ic-fic"><Icon name={icon} size={15} /></span>}
          <div className="ic-fnm">
            {menu ? (
              <Popover open={menu.open} onOpenChange={menu.onOpenChange} label={menu.label} align="start" className={cn('ic-menu', phone && 'is-sheet')}
                anchor={<button type="button" className="ic-fname">{title}<Icon name="down" size={14} /></button>}>
                {menu.children}
              </Popover>
            ) : <span className="ic-fname">{title}</span>}
            <span className="ic-fmeta">{meta}</span>
          </div>
        </div>
        <div className="ic-fend">
          {following && (following.on ? (
            <div className="ic-fol">
              <Avatar person={following.person} size={20} />
              <span className="t">Following {following.name}</span>
              <button ref={followButton} type="button" className="ic-unf" aria-label={`Unfollow ${following.name}`} onClick={toggleFollow}>Unfollow</button>
            </div>
          ) : (
            <button ref={followButton} type="button" className="ic-follow" onClick={toggleFollow}>
              <Avatar person={following.person} size={20} />
              <span className="ft"><b>Follow {following.name}</b><small>{following.where}</small></span>
            </button>
          ))}
          {present && (present.ask ? <PresentAsk {...present.ask} anchor={presentButton} /> : presentButton)}
          {focus && (
            <Tooltip label={`${focusSays} · ⌘⇧F`}>
              <button type="button" className={cn('ic-fib', focus.on && 'is-on')} aria-label={focusSays} onClick={focus.onToggle}><Icon name={focus.on ? 'shrink' : 'grow'} size={16} /></button>
            </Tooltip>
          )}
          {onStop && <Tooltip label="Ends it for everyone"><button type="button" className="ic-stop" onClick={onStop}>Stop sharing</button></Tooltip>}
          {close && (close.ask ? <CloseAsk {...close.ask} tip={close.tip} anchor={closeButton} /> : <Tooltip label={close.tip}>{closeButton}</Tooltip>)}
        </div>
      </div>
      <div className="ic-fbody">
        {children}
        {foot ? <div className="ic-ffoot">{foot}</div> : null}
      </div>
    </section>
  );
}

/**
 * What someone presents while it isn't on your stage: a tile with the people, saying who presents it. The whole tile is one
 * button, which takes you there. `children` is its live miniature (a screen's video, a board drawn small); without one it
 * shows the kind and where its presenter is, calmly. `small` is an arch among arches, or on the horizon: the kind's icon and
 * the presenter's face, and nothing else. It fills the box it's given.
 */
export function PresentedTile({ name, icon, sub, by, go, onPress, label, where, small = false, tabIndex, children, className }: {
  /** "Launch review · 4 Nov", "Priya’s screen". */
  name: string;
  icon: IconName;
  /** "Priya is presenting", "You’re presenting". */
  sub: string;
  by: AvatarPerson;
  /** The chip at the top right, with the presenter's face: Join their presentation, or Open your own. */
  go: 'Join' | 'Open';
  onPress: () => void;
  /** What pressing it does: "Join Launch review · 4 Nov", "Go back to Your screen". */
  label: string;
  /** Where the presenter is, while there's no miniature: "Launch plan". */
  where?: string | undefined;
  small?: boolean | undefined;
  /** -1 where the tile around it is what Tab reaches, as on the stage, so it isn't a second stop. */
  tabIndex?: number | undefined;
  children?: ReactNode;
  className?: string | undefined;
}) {
  /* `{live && <video />}` hands over `false` while there's nothing live: the calm placeholder then, too. */
  const mini = children !== undefined && children !== null && typeof children !== 'boolean';
  return (
    <button type="button" className={cn('ic-ptile', small && 'is-small', className)} aria-label={label} tabIndex={tabIndex} onClick={onPress}>
      {small ? (
        <span className="ic-tsm"><Icon name={icon} size={18} /><Avatar person={by} size={16} /></span>
      ) : (
        <>
          <span className="ic-tmini">
            {mini ? children : <span className="ic-tplace"><span className="sq"><Icon name={icon} size={22} /></span>{where && <b className="ac-clamp-1">{where}</b>}</span>}
          </span>
          <span className="ic-tback"><Avatar person={by} size={16} />{go}</span>
          <span className="ac-tile-name"><Icon name={icon} size={14} /><span className="nm ac-clamp-1">{name}</span><span className="ic-tsub">{sub}</span></span>
        </>
      )}
    </button>
  );
}

/**
 * Close's question while you present a board or the workspace, or on a board in the call that nobody presents for whoever may
 * take it out of the call: for you, or for everyone. Each says what it does.
 */
export interface CloseAskProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Close Launch review · 4 Nov" */
  title: string;
  /** For you: everyone else keeps it open, on their own, unless `me` says otherwise. */
  onMe: () => void;
  /** For everyone: it closes for everyone in the call, unless `everyone` says otherwise ("It closes for everyone in this room."). */
  onEveryone: () => void;
  me?: string | undefined;
  everyone?: string | undefined;
  /** A phone: a sheet from the bottom. */
  phone?: boolean | undefined;
}

/** What closing it can be: for you, or for everyone. Close's question and Share's last step both ask it. */
function CloseChoices({ onMe, onEveryone, me = 'Everyone else keeps it open, on their own.', everyone = 'It closes for everyone in the call.' }: Pick<CloseAskProps, 'onMe' | 'onEveryone' | 'me' | 'everyone'>) {
  return (
    <>
      <button type="button" className="ic-cm" onClick={onMe}>
        <span className="sq"><Icon name="user" size={18} /></span>
        <span><b>For you</b><small>{me}</small></span>
      </button>
      <button type="button" className="ic-cm" onClick={onEveryone}>
        <span className="sq"><Icon name="people" size={18} /></span>
        <span><b>For everyone</b><small>{everyone}</small></span>
      </button>
    </>
  );
}

/** Close's question, under `anchor` (Close ▾ on the frame's bar). `tip` names Close on hover, as it does without the question. */
export function CloseAsk({ open, onOpenChange, title, onMe, onEveryone, me, everyone, phone = false, anchor, tip }: CloseAskProps & { anchor: ReactNode; tip?: ReactNode }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} tip={tip} side="bottom" align="end" stage label={title} className={cn('ic-closeask', phone && 'is-sheet')}>
      <p className="ic-askh ac-clamp-2">{title}</p>
      <CloseChoices onMe={onMe} onEveryone={onEveryone} me={me} everyone={everyone} />
    </Popover>
  );
}

/** Present's question when some people here can't open the board: the presenter decides before it's presented. */
export interface PresentAskProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** First names of who can't open it. */
  names: string[];
  board: string;
  /** Where it's kept, as it reads after "It’s in". */
  where: string;
  /** Only for someone who may share the board: without it, the one way on is without them. */
  onLetIn?: (() => void) | undefined;
  onWithout: () => void;
  /** Something chosen is on its way, so nothing else can be. */
  busy?: boolean | undefined;
  /** A phone: a sheet from the bottom. */
  phone?: boolean | undefined;
}

/** Names as a sentence says them, as the board picker does: "Theo", "Theo and Sam", "Theo, Sam and Kofi". */
const andList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** Present's question, under `anchor` (Present on the frame's bar). */
export function PresentAsk({ open, onOpenChange, names, board, where, onLetIn, onWithout, busy = false, phone = false, anchor }: PresentAskProps & { anchor: ReactNode }) {
  const who = andList(names);
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} side="bottom" align="end" stage label={`${who} can’t open ${board}`} className={cn('ic-presentask', phone && 'is-sheet')}>
      <p><b>{who} can’t open {board}.</b> It’s in {where}.</p>
      <div className="acts">
        {onLetIn && <Button variant="primary" size="sm" disabled={busy} onClick={onLetIn}>Let them in for this call</Button>}
        <Button variant={onLetIn ? 'secondary' : 'primary'} size="sm" disabled={busy} onClick={onWithout}>Present without them</Button>
      </div>
    </Popover>
  );
}

/**
 * Whoever presents a board steps through its frames from its foot, and everyone following moves with them: back, where
 * they are, next, and their own notes. The arrows stay pressable at either end, so the arrow keys do too; they just do nothing.
 */
export function FramePager({ at, total, part, onBack, onNext, notes }: {
  /** Which frame, from 1. */
  at: number;
  total: number;
  /** That frame's name: "Went well". */
  part: string;
  onBack: () => void;
  onNext: () => void;
  /** Your notes in your side, lit while they're open. Null without an account. */
  notes: { on: boolean; onToggle: () => void } | null;
}) {
  const first = at <= 1;
  const last = at >= total;
  return (
    <div className="ic-pager" role="group" aria-label="Step through its frames; everyone following you moves with you">
      <Tooltip label="Back a frame · ←">
        <button type="button" className="ic-pb" aria-label="Back a frame" aria-keyshortcuts="ArrowLeft" aria-disabled={first || undefined} onClick={first ? undefined : onBack}>
          <Icon name="left" size={17} />
        </button>
      </Tooltip>
      <span className="ic-pt" aria-live="polite"><b>{at} of {total}</b><small>{part}</small></span>
      <Tooltip label="Next frame · →">
        <button type="button" className="ic-pb" aria-label="Next frame" aria-keyshortcuts="ArrowRight" aria-disabled={last || undefined} onClick={last ? undefined : onNext}>
          <Icon name="right" size={17} />
        </button>
      </Tooltip>
      {notes && (
        <>
          <span className="ic-psep" aria-hidden="true" />
          <Tooltip label="Your notes · only you">
            <button type="button" className={cn('ic-pb', notes.on && 'is-on')} aria-label="Your notes, only you see them" aria-pressed={notes.on} onClick={notes.onToggle}>
              <Icon name="notesPen" size={17} />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

/* ---------- Share, from the dock ---------- */

/*
 * Share opens one popover over the dock (`ic-sharepop`, a sheet on a phone), and each step takes the place of the one before:
 * what you can present (`ShareKinds`), then your screen (`ShareScreenStep`) or a board (`BoardPicker` with its `step`), or,
 * stopping a board or the workspace you present, Close's question (`ShareStopStep`).
 */

/** One thing you can present, or why you can't here. */
function ShareKind({ icon, title, says, onPress, more }: { icon: IconName; title: string; says: string; onPress: (() => void) | null; more: boolean }) {
  return (
    <button type="button" className="ic-sp-row" aria-disabled={onPress ? undefined : true} onClick={onPress ?? undefined}>
      <span className="sq"><Icon name={icon} size={20} /></span>
      <span className="tx"><b>{title}</b><small>{says}</small></span>
      {onPress && more && <Icon name="chevron" size={16} />}
    </button>
  );
}

/** Share's first step: your screen, a board or the workspace, presented to everyone straight away. */
export function ShareKinds({ sharing, screenWhy, onScreen, board, workspace }: {
  /** What you present now, and Stop sharing: "You’re sharing {what}". */
  sharing: { what: string; onStop: () => void } | null;
  /** Why your screen can't be shared here ("Sharing a screen needs a computer"; "4 people are sharing. You can share once one of them stops."), or null. */
  screenWhy: string | null;
  onScreen: () => void;
  /** A board: the next step, or why you can't start or present one here. */
  board: { onPress: () => void } | { why: string };
  /** The workspace, presented straight away, or why not. */
  workspace: { onPress: () => void } | { why: string };
}) {
  return (
    <>
      <div className="ic-sp-hd"><b>Share with everyone</b><span>Everyone in the call sees what you share, in the middle of their screen.</span></div>
      {sharing && (
        <div className="ic-sp-mine">
          <Icon name="screen" size={17} />
          <span className="ac-clamp-2">You’re sharing {sharing.what}</span>
          <button type="button" className="ic-stop" onClick={sharing.onStop}>Stop sharing</button>
        </div>
      )}
      <ShareKind icon="screen" title="Your screen" says={screenWhy ?? 'A tab, a window or your whole screen'} onPress={screenWhy === null ? onScreen : null} more />
      <ShareKind icon="presentation" title="A board" says={'why' in board ? board.why : 'Start one, or open one your team has'} onPress={'onPress' in board ? board.onPress : null} more />
      <ShareKind icon="folderOpen" title="The workspace" says={'why' in workspace ? workspace.why : 'This call’s notes and documents'} onPress={'onPress' in workspace ? workspace.onPress : null} more={false} />
      <div className="ic-sp-foot"><Icon name="sealed" size={15} /><span>Sealed. Alcove can’t read what you share.</span></div>
    </>
  );
}

/** The head of Share's later steps: back to Share, and the step's name. */
export function ShareStepHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="ic-sp-step">
      <button type="button" className="ic-sp-back" aria-label="Back to Share" onClick={onBack}><Icon name="left" size={16} />Share</button>
      <b className="ac-clamp-1">{title}</b>
    </div>
  );
}

/**
 * Share › Stop sharing, on a board or the workspace you present: Close's question, in Share's own menu, so it's asked wherever
 * what you present is, on your stage, a tile, or out of sight.
 */
export function ShareStopStep({ what, onBack, onMe, onEveryone, everyone }: {
  /** What you present, as Share's first step says it: "Launch retro", "the workspace". */
  what: string;
  onBack: () => void;
} & Pick<CloseAskProps, 'onMe' | 'onEveryone' | 'everyone'>) {
  return (
    <>
      <ShareStepHead title={`Stop sharing ${what}`} onBack={onBack} />
      <CloseChoices onMe={onMe} onEveryone={onEveryone} everyone={everyone} />
    </>
  );
}

/** What part of your screen to share: the browser's own choices. */
export type ShareSurfaceKind = 'browser' | 'window' | 'monitor';
const SURFACES: { kind: ShareSurfaceKind; label: string; icon: IconName }[] = [
  { kind: 'browser', label: 'A tab', icon: 'panel' },
  { kind: 'window', label: 'A window', icon: 'layers' },
  { kind: 'monitor', label: 'Your whole screen', icon: 'monitor' }
];

/** Share › Your screen: a tab, a window or your whole screen, its sound where the browser can share it, then Share. The browser asks which one next. */
export function ShareScreenStep({ surface, onSurface, sound, read, trouble, changing = false, onBack, onShare }: {
  surface: ShareSurfaceKind;
  onSurface: (surface: ShareSurfaceKind) => void;
  /** The sound switch, where this browser can share sound for that kind ("Also share the tab’s sound"); null hides it. */
  sound: { label: string; on: boolean; onChange: (on: boolean) => void } | null;
  /** Whether what you share is read for the notes: they're on, or paused. Null says nothing. */
  read: 'on' | 'paused' | null;
  /** Why the last try didn't start, or null. */
  trouble: string | null;
  /** Sharing already: Share says "Share this instead". */
  changing?: boolean | undefined;
  onBack: () => void;
  onShare: () => void;
}) {
  return (
    <>
      <ShareStepHead title="Your screen" onBack={onBack} />
      {trouble && <Notice tone="caution" icon="stopShare" className="ic-sp-trouble">{trouble}</Notice>}
      <div className="ic-sp-picks" role="group" aria-label="What to share">
        {SURFACES.map((s) => (
          <button key={s.kind} type="button" className="ic-sp-pick" aria-pressed={surface === s.kind} onClick={() => onSurface(s.kind)}>
            <span className="pic"><Icon name={s.icon} size={22} /></span>{s.label}
          </button>
        ))}
      </div>
      {sound && <div className="ic-sp-sw"><span>{sound.label}</span><Switch checked={sound.on} label={sound.label} onChange={sound.onChange} /></div>}
      {read === 'on' && <p className="ic-sp-read"><RecDot />Notes are on: what you share is read for the notes.</p>}
      {read === 'paused' && <p className="ic-sp-read is-paused"><Icon name="pause" size={13} />Notes are paused. Once they resume, what you share is read for them.</p>}
      <div className="ic-sp-acts">
        <Button variant="quiet" onClick={onBack}>Back</Button>
        <Button variant="primary" icon="screen" onClick={onShare}>{changing ? 'Share this instead' : 'Share'}</Button>
      </div>
    </>
  );
}

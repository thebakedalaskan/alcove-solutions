/* The call stage, always night: tiles, the dock, captions, pointers on a share, and how loud someone is for you. */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Dots } from './motion';
import { Tooltip } from './overlay';
import { Avatar, PortraitArt, type AvatarPerson } from './people';
import { IconButton, Scope, Slider } from './primitives';

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
export function CallTile({ person, name, speaking = false, muted = false, hand = false, connecting = false, className, children, chrome, label }: {
  person: AvatarPerson; name: ReactNode; speaking?: boolean; muted?: boolean; hand?: boolean;
  /** In the call, but this browser can't play their media yet (their keys are on the way): not the same as a camera that's off. */
  connecting?: boolean | undefined;
  className?: string | undefined; children?: ReactNode;
  /** Controls and state drawn over the tile: what's pinned or spotlighted, its options. */
  chrome?: ReactNode; label?: string | undefined;
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
      {chrome}
    </div>
  );
}

/** The call's controls in one floating bar, bottom-centre on the stage. `tucked`: only what's marked `keep` shows. */
export function CallDock({ children, label = 'Call controls', tucked = false, className }: { children: ReactNode; label?: string; tucked?: boolean | undefined; className?: string | undefined }) {
  return <div className={cn('ac-dock', tucked && 'is-tucked', className)} role="toolbar" aria-label={label}>{children}</div>;
}

/**
 * One dock control. `off`: a switched-off device turns solid. `on`: an open panel or a running share.
 * `alert`: a device that can't work right now (blocked or unplugged) gets a caution mark; say why in the label.
 * `tip` shows above it on hover and focus, in place of the browser's own title.
 */
export const DockButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; label: string; off?: boolean; on?: boolean; alert?: boolean; badge?: number; tip?: ReactNode;
}>(function DockButton({ icon, label, off = false, on = false, alert = false, badge = 0, tip, className, type = 'button', ...rest }, ref) {
  const button = (
    <button ref={ref} type={type} aria-label={label} title={tip ? undefined : label} aria-pressed={off ? false : on || undefined}
      className={cn('ac-dock-btn', off && 'is-off', on && 'is-on', className)} {...rest}>
      <Icon name={icon} size={20} />
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

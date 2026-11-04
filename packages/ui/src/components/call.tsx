/* The call stage, always night: tiles, the dock and captions. */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { Tooltip } from './overlay';
import { Avatar, PortraitArt, type AvatarPerson } from './people';

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
export function CallTile({ person, name, speaking = false, muted = false, hand = false, className, children, chrome, label }: {
  person: AvatarPerson; name: ReactNode; speaking?: boolean; muted?: boolean; hand?: boolean; className?: string | undefined; children?: ReactNode;
  /** Controls and state drawn over the tile: what's pinned or spotlighted, its options. */
  chrome?: ReactNode; label?: string | undefined;
}) {
  const ground = children ? undefined : tileGround(person);
  return (
    <div className={cn('ac-tile', speaking && 'is-speaking', hand && 'is-hand', className)} style={ground ? { background: ground } : undefined} aria-label={label}>
      {children ?? (person.portrait
        ? <svg className="ac-figure" viewBox="0 20 200 220" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><PortraitArt p={person.portrait} /></svg>
        : <span className="ac-tile-face"><Avatar person={person} size={88} /></span>)}
      <span className="ac-tile-name">
        {speaking && <span className="ac-level" aria-hidden="true"><i /><i /><i /></span>}
        {hand && <Icon name="hand" size={14} />}
        {name}
      </span>
      {muted && !hand && <span className="ac-tile-mic" aria-label="Microphone off"><Icon name="micOff" size={14} /></span>}
      {hand && <span className="ac-tile-hand" aria-label="Hand raised"><Icon name="hand" size={15} /></span>}
      {chrome}
    </div>
  );
}

/** The call's controls in one floating bar, bottom-centre on the stage. */
export function CallDock({ children, label = 'Call controls', className }: { children: ReactNode; label?: string; className?: string | undefined }) {
  return <div className={cn('ac-dock', className)} role="toolbar" aria-label={label}>{children}</div>;
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
export const DockSplit = ({ children }: { children: ReactNode }) => <span className="ac-dock-split">{children}</span>;
export const DockChevron = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; on?: boolean }>(
  function DockChevron({ label, on = false, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} aria-haspopup="menu" className={cn('ac-dock-chev', on && 'is-on', className)} {...rest}>
        <Icon name="up" size={14} />
      </button>
    );
  });

export const DockSeparator = () => <span className="ac-dock-sep" aria-hidden="true" />;

/** Leave: the last item in the dock and its only text button. */
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

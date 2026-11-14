/*
 * The scheduler's editor, beside the week on Calls (calls/scheduler.css, sc-): a property list with two edges. The outer
 * edge holds the kicker, the title, the hairlines and the foot; the inner edge is where every value starts. Each row is an
 * icon in an 18px column and its value; a row that carries on the one above (a status, a note) has no icon and starts on
 * the inner edge. Anything pressable keeps its text on the edge and lets its hover reach 10px past it. Sections are 18px
 * apart with a hairline. Every part is stateless: what each says and does is the app's.
 */
import { Popover as RPopover } from 'radix-ui';
import { forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { IconButton } from '../foundation/primitives';

/* ---------- the column ---------- */

/**
 * The editor's column: its top pinned (the kicker and ×, "Close, back to Calls"), then its body, then `foot`, which follows
 * the content and stays at the bottom while the body has to scroll. On a phone it's the page, and its foot sits above the tabs.
 */
export function SchedPanel({ kicker, label, onClose, busy = false, foot, children, className }: {
  /** What it's doing: "New call", "Move a call", "Ask to move a call". */
  kicker: string;
  /** Names it for assistive tech: "Schedule a call", "Move Hiring sync". */
  label: string;
  onClose: () => void;
  /** What it starts from is still being read. */
  busy?: boolean | undefined;
  foot?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <aside className={cn('sc-ed', className)} aria-label={label} aria-busy={busy || undefined}>
      <div className="sc-top">
        <span className="sc-kicker">{kicker}</span>
        <IconButton icon="x" size={17} label="Close, back to Calls" className="sc-x" onClick={onClose} />
      </div>
      <div className="sc-body">{children}</div>
      {foot}
    </aside>
  );
}

/** The call's name, large, to type over: Enter does what the foot's button does. */
export const SchedTitle = forwardRef<HTMLInputElement, { value: string; placeholder: string; label: string; onChange: (value: string) => void; onEnter?: (() => void) | undefined }>(
  function SchedTitle({ value, placeholder, label, onChange, onEnter }, ref) {
    return (
      <input ref={ref} className="sc-title" type="text" value={value} placeholder={placeholder} aria-label={label} autoComplete="off" enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && onEnter) { e.preventDefault(); onEnter(); } }} />
    );
  });

/** The name of a call that's already there, which doesn't change here, and once its time has, where it was, struck through. */
export function SchedName({ title, was }: { title: string; was?: string | undefined }) {
  return (
    <div className="sc-name">
      <h2 className="sc-title is-fixed">{title}</h2>
      {was !== undefined && <p className="sc-was"><s>Was {was}</s></p>}
    </div>
  );
}

/** A section: a hairline over it and 18px either side. `label` names it (Who, When, Details). */
export function SchedGroup({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return <div className={cn('sc-grp', className)} role="group" aria-label={label}>{children}</div>;
}

/**
 * A row: its icon in the 18px column (in rec when it says notes are on), and its value from the inner edge. Without an icon
 * it carries on the row above. `top` sets the icon level with the first line of a value that's taller than one. A value
 * that's pressed lets its hover reach 10px past the edge; `flush` is for one that isn't (a list, a segmented choice).
 */
export function SchedRow({ icon, rec = false, top = false, flush = false, children, className }: {
  icon?: IconName | undefined; rec?: boolean | undefined; top?: boolean | undefined; flush?: boolean | undefined; children: ReactNode; className?: string | undefined;
}) {
  return (
    <div className={cn('sc-row', top && 'is-top', className)}>
      {icon ? <Icon name={icon} size={17} className={cn('sc-ic', rec && 'is-rec')} /> : <span aria-hidden="true" />}
      <div className={cn('sc-val', flush && 'is-flush')}>{children}</div>
    </div>
  );
}

/** What a line's action does: moves the call (Next free: 16:00), or opens a page in a new tab (Connect Google Calendar). */
export interface SchedAction { label: string; onClick?: (() => void) | undefined; href?: string | undefined }

/**
 * A line that carries on the row above, on the inner edge: a status ("You’re all free"), in `caution` for a clash, or a
 * `quiet` note ("It stops at midnight…"), with an action after it in horizon.
 */
export function SchedLine({ tone, action, children, className }: {
  tone?: 'caution' | 'quiet' | undefined; action?: SchedAction | undefined; children: ReactNode; className?: string | undefined;
}) {
  return (
    <div className={cn('sc-row is-line', className)}>
      <span aria-hidden="true" />
      <p className={cn('sc-line', tone && `is-${tone}`)}>
        <span>{children}</span>
        {action && (action.href
          ? <a className="sc-link" href={action.href} target="_blank" rel="noopener noreferrer">{action.label}</a>
          : <button type="button" className="sc-link" onClick={action.onClick}>{action.label}</button>)}
      </p>
    </div>
  );
}

type Pressable = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** A value to press, bold: "Thu 12 Nov", with what it means said quietly after it ("Today"), and a chevron when it opens something. */
export const SchedValue = forwardRef<HTMLButtonElement, Pressable & { children: ReactNode; quiet?: ReactNode; chevron?: boolean | undefined }>(
  function SchedValue({ children, quiet, chevron = false, className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={cn('sc-value', className)} {...rest}>
        {children}{quiet !== undefined && quiet !== null && quiet !== '' && <small>{quiet}</small>}{chevron && <Icon name="down" size={14} className="sc-chev" />}
      </button>
    );
  });

/** A quieter value to press: "Doesn’t repeat", "45 min each", "Add an agenda", "What the notes keep". */
export const SchedQuiet = forwardRef<HTMLButtonElement, Pressable & { children: ReactNode; chevron?: boolean | undefined }>(
  function SchedQuiet({ children, chevron = false, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={cn('sc-quiet', className)} {...rest}>{children}{chevron && <Icon name="down" size={13} className="sc-chev" />}</button>;
  });

/**
 * A switch that's the whole row: its title, a `line` under it inside it (one hover, one focus ring), and the switch at the
 * end. It's named by its title alone; the line describes it. `tip` is its tooltip.
 */
export function SchedSwitch({ title, line, checked, onChange, tip, disabled = false }: {
  title: string; line?: ReactNode; checked: boolean; onChange: (on: boolean) => void; tip?: string | undefined; disabled?: boolean | undefined;
}) {
  const id = useId();
  const lined = line !== undefined && line !== null && line !== '';
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={title} aria-describedby={lined ? id : undefined} title={tip} disabled={disabled}
      className={cn('sc-switch', lined && 'has-line')} onClick={() => onChange(!checked)}>
      <span>{lined ? <><b>{title}</b><small id={id}>{line}</small></> : title}</span>
      <span className="ac-switch" aria-hidden="true" />
    </button>
  );
}

/** A setting shaped like a switch's row, with another control at its end (a Select): its title and a line under it. */
export function SchedChoice({ title, line, children }: { title: string; line?: ReactNode; children: ReactNode }) {
  return (
    <div className="sc-switch is-choice">
      <span><b>{title}</b>{line !== undefined && line !== null && line !== '' && <small>{line}</small>}</span>
      {children}
    </div>
  );
}

/* ---------- who ---------- */

/**
 * The Who field: the tokens and the line to type in, as one box. Pressing anywhere in it is pressing into the line, as a
 * text box would; a press in something a token opens (where someone is) is that list's, though React carries it here.
 * `open` while the people under it are showing.
 */
export const SchedField = forwardRef<HTMLDivElement, { open?: boolean | undefined; fixed?: boolean | undefined; onPress?: (() => void) | undefined; children: ReactNode }>(
  function SchedField({ open = false, fixed = false, onPress, children }, ref) {
    return (
      <div ref={ref} className={cn('sc-people', open && 'is-open', fixed && 'is-fixed')}
        onClick={(e) => { if (onPress && e.target instanceof Node && e.currentTarget.contains(e.target)) onPress(); }}>
        {children}
      </div>
    );
  });

/** Over a list in a popover: "Often with you", "People and groups". */
export const SchedListHead = ({ children }: { children: ReactNode }) => <p className="sc-pp-h">{children}</p>;
/** A list's words when there's nothing in it. */
export const SchedListNote = ({ children }: { children: ReactNode }) => <p className="sc-pp-none">{children}</p>;

/**
 * Someone, a group or the company to add, in the people under the Who field: a face in a centred 40px column (a group shows two
 * of its faces), the name, what they do or their address, and +. Pressing it keeps the field's focus, so several can be added
 * one after another; `lit` is the one Enter takes.
 */
export function SchedPersonOption({ id, face, title, sub, lit, onPick }: { id: string; face: ReactNode; title: string; sub: string; lit: boolean; onPick: () => void }) {
  return (
    <div id={id} role="option" aria-selected={lit} aria-label={`${title}, ${sub}`} tabIndex={-1} className={cn('sc-pp', lit && 'is-lit')} onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      <span className="sc-pp-f">{face}</span>
      <span className="min-w-0"><b className="ac-clamp-1">{title}</b><small className="ac-clamp-1">{sub}</small></span>
      <Icon name="plus" size={15} />
    </div>
  );
}

/* ---------- when ---------- */

/**
 * One of the times a guest picks from: its number, the day, the time, and at its end what the guest's clock says then or,
 * when it clashes with something of yours, a caution mark and its name. Pressing its body makes it the active one (the one
 * the week moves); its tick is its own button, and two at least stay ticked (`lock`).
 */
export function SchedOffer({ n, day, time, said, side, clash, active, on, lock, onSelect, onTick }: {
  n: number; day: string; time: string;
  /** The time as it's read out: "Tomorrow, 11:30 to 12:15". */
  said: string;
  side?: string | undefined; clash?: string | undefined;
  active: boolean; on: boolean; lock: boolean;
  onSelect: () => void; onTick: () => void;
}) {
  return (
    <div className={cn('sc-opt', active && 'is-active', !on && 'is-off')}>
      <button type="button" className="sc-opt-main" aria-pressed={active} aria-label={`Time ${n}: ${said}${active ? ', the one the week moves' : ''}`} onClick={onSelect}>
        <i className="sc-nb" aria-hidden="true">{n}</i>
        <span className="min-w-0"><b>{day}</b><span>{time}</span></span>
        {clash ? <small className="is-clash"><Icon name="alert" size={12} /><span className="ac-clamp-1">{clash}</span></small> : side ? <small>{side}</small> : null}
      </button>
      <button type="button" role="checkbox" className="sc-tick" aria-checked={on} aria-label={`Offer time ${n}`} aria-disabled={lock || undefined}
        title={lock ? 'Offer at least two times' : on ? 'Leave this time out' : 'Offer this time'} onClick={() => { if (!lock) onTick(); }}>
        <span><Icon name="check" size={13} /></span>
      </button>
    </div>
  );
}

/** A choice in a list of times (or of lengths, or places): what it says, a note after it, and whether it's gone. */
export interface SchedTime {
  value: string;
  label: string;
  /** Said quietly after it, and read out after a comma: the length an end makes ("45 min"). */
  note?: string | undefined;
  /** It's gone: greyed, and it can't be picked. */
  gone?: boolean | undefined;
}

/** Focuses `el` and scrolls the list, never the page, to show it. */
function showIn(list: HTMLElement, el: HTMLElement, middle: boolean) {
  if (middle) list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
  else if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 4;
  else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 4;
}

/**
 * A list of times to pick from (or lengths, or places): the picked one marked and in the middle as it opens (`near` when none
 * is), gone ones greyed. `autoFocus` gives the picked one the keyboard, for a list opened from a button; opened from a field,
 * focus stays in the field. The arrow keys, Home, End, Page Up and Page Down move; Enter or Space picks.
 */
export function SchedTimes({ id, label, options, value, near, autoFocus = false, onPick, listRef }: {
  id?: string | undefined; label: string; options: readonly SchedTime[]; value: string | null;
  near?: string | undefined; autoFocus?: boolean | undefined; onPick: (value: string) => void;
  listRef?: Ref<HTMLDivElement> | undefined;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const centre = value ?? near ?? null;
  useLayoutEffect(() => {
    const show = () => {
      const list = box.current;
      const el = centre === null ? null : list?.querySelector<HTMLElement>(`[data-v="${CSS.escape(centre)}"]`);
      if (!list || !el) return;
      showIn(list, el, true);
      if (autoFocus) el.focus({ preventScroll: true });
    };
    show();
    /* Once it's placed, and maybe shortened to fit the window, the picked one is still in the middle. */
    const frame = requestAnimationFrame(show);
    return () => cancelAnimationFrame(frame);
  }, [centre, autoFocus]);

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = box.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])'));
    const at = items.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? (at < 0 ? last : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last
      : e.key === 'PageDown' ? at + 8 : e.key === 'PageUp' ? at - 8 : null;
    if (to !== null) {
      e.preventDefault();
      e.stopPropagation();
      const el = items[Math.max(0, Math.min(last, to))];
      if (el) { el.focus({ preventScroll: true }); showIn(list, el, false); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
      e.preventDefault();
      e.stopPropagation();
      const v = items[at]?.dataset['v'];
      if (v !== undefined) onPick(v);
    }
  };

  return (
    <div ref={(el) => { box.current = el; if (typeof listRef === 'function') listRef(el); else if (listRef) listRef.current = el; }}
      id={id} role="listbox" aria-label={label} className="sc-times" onKeyDown={keys}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <div key={o.value} role="option" tabIndex={-1} data-v={o.value} aria-selected={on} aria-disabled={o.gone || undefined}
            aria-label={o.note ? `${o.label}, ${o.note}` : undefined} className={cn('sc-li', on && 'is-on')}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!o.gone) onPick(o.value); }}>
            <span>{o.label}</span>{o.note && <small>{o.note}</small>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What opens under a field without taking its focus: the people under Who, and a time's list under its field. It's placed
 * like a Popover (it turns upward near the window's foot), and Escape or pressing anywhere but its field puts it away.
 */
export function SchedPop({ open, onClose, anchor, label, children, className }: {
  open: boolean; onClose: () => void; anchor: ReactNode; label: string; children: ReactNode; className?: string | undefined;
}) {
  const at = useRef<HTMLDivElement>(null);
  return (
    <RPopover.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <RPopover.Anchor ref={at} asChild>{anchor}</RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content side="bottom" align="start" sideOffset={4} collisionPadding={12} aria-label={label} className={cn('ac-pop sc-pop', className)}
          onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (e.target instanceof Node && at.current?.contains(e.target)) e.preventDefault(); }}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/* ---------- details ---------- */

/** Something the call brings, listed under Add an agenda: its kind's icon, its name, and × to take it off. */
export function SchedDoc({ icon, name, removeLabel, onRemove }: { icon: IconName; name: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="sc-doc">
      <Icon name={icon} size={15} />
      <span className="ac-clamp-1">{name}</span>
      <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove}><Icon name="x" size={13} /></button>
    </span>
  );
}

/** A note on the inner edge that holds more than words (what a paste couldn't read, no notes left): any content, no icon. */
export function SchedNote({ children }: { children: ReactNode }) {
  return <div className="sc-row is-note"><span aria-hidden="true" /><div className="sc-note">{children}</div></div>;
}

/* ---------- the foot ---------- */

/**
 * The foot: one line on what will happen, then the quiet way out and the one filled button (`children`). `lead` sits at its
 * start (Cancel this call, moving), and `notice` above the line (a save that failed, with its reference; a question asked in
 * place).
 */
export function SchedFoot({ line, notice, lead, children }: { line?: ReactNode; notice?: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <footer className="sc-foot">
      {notice}
      {line !== undefined && line !== null && line !== '' && <p className="sc-foot-l">{line}</p>}
      <div className="sc-acts">{lead}<span className="sc-acts-e">{children}</span></div>
    </footer>
  );
}

/** A question asked once, in place, in the foot: Cancel this call? and its answers. */
export function SchedAsk({ label, children, actions, ...rest }: { label: string; children: ReactNode; actions: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className="sc-ask" role="group" aria-label={label} {...rest}>
      <p>{children}</p>
      <span className="sc-ask-a">{actions}</span>
    </div>
  );
}

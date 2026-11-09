import { Dialog as RDialog, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import { createContext, forwardRef, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';

/* Where popovers sit: 8px from what opened them, and at least 12px inside the window's edges. */
const OFFSET = 8;
const EDGE = 12;

/**
 * A part of a page scoped to one theme (`.light` or `.dark` on it), such as your side of a call in the light theme while the
 * call around it is night: what opens from inside it (a popover, a list of choices) opens out of it, and takes the same theme.
 */
const Scoped = createContext<'light' | 'dark' | null>(null);
export function ThemeScope({ theme, children }: { theme: 'light' | 'dark' | null; children: ReactNode }) {
  return <Scoped.Provider value={theme}>{children}</Scoped.Provider>;
}

/**
 * A panel anchored to what opened it. `stage` is for the always-night call stage. `tip` puts a tooltip on
 * the anchor, for an icon button that opens a menu (pass the IconButton `title={undefined}` so there's one).
 * The tooltip shows on hover and when the anchor is reached with the keyboard, but not when focus comes back
 * to it after the panel closes, or after something it opened, and not when a script focuses it.
 * `takeFocus={false}` for one that opens as you hover or focus its anchor: focus doesn't move into it when it
 * opens, nor back to the anchor when it closes, so Tab carries on past it and moving the mouse away doesn't
 * open it again. `caret` points it at its anchor, and it keeps pointing there when the panel slides to stay in the window.
 * `onCloseFocus` puts focus somewhere else when it closes: return true once it has, as a Modal's does.
 */
export function Popover({ open, onOpenChange, anchor, children, align = 'start', side = 'bottom', stage = false, takeFocus = true, caret = false, onCloseFocus, label, tip, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; children: ReactNode;
  align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; stage?: boolean; takeFocus?: boolean; caret?: boolean | undefined;
  onCloseFocus?: (() => boolean) | undefined; label: string; tip?: ReactNode; className?: string;
}) {
  const returning = useRef(false);
  const scoped = useContext(Scoped);
  const trigger = <RPopover.Trigger asChild>{anchor}</RPopover.Trigger>;
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      {tip === undefined ? trigger : (
        <RTooltip.Root>
          <RTooltip.Trigger asChild onFocus={(e) => {
            // Only Tab from something else on the page shows it. preventDefault stops it opening on this focus; hovering still opens it.
            const from = e.relatedTarget instanceof Element ? e.relatedTarget : null;
            if (returning.current || !e.currentTarget.matches(':focus-visible') || !from || from.closest('.ac-pop, [role="dialog"]')) e.preventDefault();
            returning.current = false;
          }}>{trigger}</RTooltip.Trigger>
          <RTooltip.Portal><RTooltip.Content side="top" sideOffset={OFFSET} className="ac-tip">{tip}</RTooltip.Content></RTooltip.Portal>
        </RTooltip.Root>
      )}
      <RPopover.Portal>
        <RPopover.Content side={side} align={align} sideOffset={OFFSET} collisionPadding={EDGE} aria-label={label} className={cn('ac-pop', stage && 'is-stage', scoped, className)}
          onOpenAutoFocus={takeFocus ? undefined : (e) => e.preventDefault()}
          // Radix focuses the anchor right after this, synchronously, if it focuses it at all (not when it already has
          // focus, or after a click elsewhere), so the mark lasts only until then.
          onCloseAutoFocus={(e) => {
            if (!takeFocus || onCloseFocus?.()) { e.preventDefault(); return; }
            returning.current = true;
            queueMicrotask(() => { returning.current = false; });
          }}>
          {children}
          {caret && <RPopover.Arrow className="ac-pop-caret" width={18} height={9} />}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
export const PopoverClose = RPopover.Close;

export interface SelectOption<T extends string> {
  value: T; label: string; icon?: IconName | undefined; mark?: ReactNode | undefined;
  /** Muted text after the label, e.g. "(default)". Type-ahead still matches the label alone. */
  note?: string | undefined;
  /** Shown at the end of the row, before the tick, e.g. an `Unencrypted` badge. */
  tag?: ReactNode;
}

/**
 * Picks one of a list: a button showing the current choice opens a listbox, placed like a Popover (it
 * turns upward near the bottom of the window, scrolls when it's long, and follows its button when a
 * page or panel scrolls). Arrow keys, Home and End move; Enter or Space picks; Escape or Tab closes
 * without changing anything; typing jumps to the option whose name starts with what was typed. Focus
 * goes back to the button. `label` names the choice for screen readers ("Language"). `stage` is for
 * the night recorder and the call.
 */
export function Select<T extends string>({ value, onChange, options, label, icon, placeholder, align = 'start', stage = false, disabled = false, className }: {
  value: T | undefined; onChange: (value: T) => void; options: SelectOption<T>[]; label: string;
  /** Drawn before the value, e.g. `mic` for the microphone. */
  icon?: IconName | undefined;
  /** Shown when `value` isn't one of the options. */
  placeholder?: string | undefined;
  align?: 'start' | 'center' | 'end' | undefined; stage?: boolean | undefined; disabled?: boolean | undefined; className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const scoped = useContext(Scoped);
  const list = useRef<HTMLDivElement>(null);
  /** The option to focus when the list opens, when it isn't the chosen one. */
  const start = useRef<number | null>(null);
  const typed = useRef({ text: '', timer: 0 });
  useEffect(() => { const t = typed.current; return () => window.clearTimeout(t.timer); }, []);

  const chosen = options.findIndex((o) => o.value === value);
  const picked = options[chosen];
  const shown = picked?.label ?? placeholder ?? '';
  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  const focused = () => items().findIndex((el) => el === document.activeElement);

  /** Focuses option `i` and scrolls the list, never the page, so it shows: to the middle when the list opens. */
  const focusAt = (i: number, middle = false) => {
    const box = list.current;
    const all = items();
    const el = all[Math.max(0, Math.min(all.length - 1, i))];
    if (!box || !el) return;
    el.focus({ preventScroll: true });
    if (middle) box.scrollTop = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2;
    else if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 6;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 6;
  };

  /**
   * The option whose name starts with what's been typed in the last 0.7 s, looking on from `from`. A
   * single letter, or the same letter again, moves on to the next option that starts with it.
   */
  const match = (key: string, from: number): number | undefined => {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += key.toLowerCase();
    t.timer = window.setTimeout(() => { t.text = ''; }, 700);
    const first = t.text.charAt(0);
    const want = [...t.text].every((c) => c === first) ? first : t.text;
    const base = from < 0 ? 0 : from + (want.length === 1 ? 1 : 0);
    for (let k = 0; k < options.length; k++) {
      const i = (base + k) % options.length;
      if (options[i]?.label.toLowerCase().startsWith(want)) return i;
    }
    return undefined;
  };
  const printable = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    setOpen(false);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      start.current = chosen;
      setOpen(true);
    } else if (printable(e) && e.key !== ' ') {
      /* Typing on the button opens the list at the match; keys typed before it takes focus still count. */
      e.preventDefault();
      e.stopPropagation();
      const hit = match(e.key, open ? focused() : chosen);
      if (open) { if (hit !== undefined) focusAt(hit); return; }
      start.current = hit ?? chosen;
      setOpen(true);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = focused();
    const last = options.length - 1;
    let to: number | undefined;
    if (e.key === 'ArrowDown') to = i < 0 ? 0 : Math.min(last, i + 1);
    else if (e.key === 'ArrowUp') to = i < 0 ? last : Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else if (e.key === 'Enter' || (e.key === ' ' && !typed.current.text)) { if (i >= 0) choose(i); }
    else if (e.key === 'Tab') setOpen(false);
    else if (printable(e)) to = match(e.key, i);
    else return;
    /* Handled here: the page's own shortcuts (N to start a call) mustn't see it. Escape is left to the popover. */
    e.preventDefault();
    e.stopPropagation();
    if (to !== undefined) focusAt(to);
  };

  return (
    <RPopover.Root open={open} onOpenChange={setOpen}>
      <RPopover.Trigger aria-haspopup="listbox" aria-label={shown ? `${label}: ${shown}` : label} disabled={disabled} onKeyDown={onButtonKey}
        className={cn('ac-select', stage && 'is-stage', className)}>
        {options[chosen]?.mark ?? (icon && <Icon name={icon} size={15} />)}
        <span className="v ac-clamp-1">{shown}</span>
        {picked?.note && <span className="ac-note">{picked.note}</span>}
        {picked?.tag}
        <Icon name="down" size={15} className="caret" />
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content ref={list} role="listbox" aria-label={label} side="bottom" align={align} sideOffset={OFFSET} collisionPadding={EDGE} hideWhenDetached
          className={cn('ac-pop ac-select-list', stage && 'is-stage', scoped)} onKeyDown={onListKey}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const at = start.current ?? chosen;
            start.current = null;
            focusAt(at, true);
            /* Once it's placed (and maybe shortened to fit), keep that option in view. */
            requestAnimationFrame(() => focusAt(at, true));
          }}>
          {options.map((o, i) => (
            <div key={o.value} role="option" tabIndex={-1} aria-selected={i === chosen} className="ac-option"
              onClick={() => choose(i)}
              onPointerMove={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true }); }}>
              {o.mark ?? (o.icon && <Icon name={o.icon} size={16} className="lead" />)}
              <span>{o.label}</span>
              {o.note && <span className="ac-note">{o.note}</span>}
              {o.tag}
              {i === chosen && <Icon name="check" size={15} />}
            </div>
          ))}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** The element that has focus, unless that's nothing in particular (the page itself). */
const focusedElement = (): HTMLElement | null =>
  typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

/** What has focus when something opens, to go back to when it closes: a shortcut can open it from anywhere, with no button to return to. */
function useFocusBack(open: boolean) {
  const [shown, setShown] = useState(open);
  const [back, setBack] = useState<HTMLElement | null>(() => (open ? focusedElement() : null));
  if (open !== shown) {
    setShown(open);
    if (open) setBack(focusedElement());
  }
  return (e: Event) => { if (back?.isConnected) { e.preventDefault(); back.focus({ preventScroll: true }); } };
}

/** A single sheet that drops from the top around one input, for finding something. Closing it puts focus back where it was. */
export function Sheet({ open, onOpenChange, label, children, className }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode; className?: string }) {
  const focusBack = useFocusBack(open);
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ac-scrim" />
        <RDialog.Content aria-describedby={undefined} className={cn('ac-sheet', className)} onCloseAutoFocus={focusBack}>
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>;
}
export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal><RTooltip.Content side={side} sideOffset={8} className="ac-tip">{label}</RTooltip.Content></RTooltip.Portal>
    </RTooltip.Root>
  );
}

/**
 * A modal over the page: centred for a choice that needs room (what to share), or rising from the
 * bottom for a quick decision (leaving a call). The rest of the page waits behind a veil. Something with
 * several questions asks them one at a time inside the one modal: no window ever opens over another.
 * Closing it puts focus back where it was when it opened, since a shortcut can open it from anywhere;
 * `onCloseFocus` puts it somewhere else instead, when what it came from has gone (return true once it has).
 * Focus starts on the first thing to press, or with `focusSelf` on the modal, for one that's mostly to read.
 */
export const Modal = forwardRef<HTMLDivElement, {
  open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode; placement?: 'center' | 'bottom'; className?: string | undefined;
  onCloseFocus?: (() => boolean) | undefined; focusSelf?: boolean | undefined;
}>(function Modal({ open, onOpenChange, label, children, placement = 'center', className, onCloseFocus, focusSelf = false }, ref) {
  const focusBack = useFocusBack(open);
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ac-scrim" />
        <RDialog.Content ref={ref} aria-describedby={undefined} className={cn('ac-modal', placement === 'bottom' && 'is-bottom', className)}
          onOpenAutoFocus={focusSelf ? (e) => { e.preventDefault(); if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus(); } : undefined}
          onCloseAutoFocus={(e) => { if (onCloseFocus?.()) e.preventDefault(); else focusBack(e); }}>
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
});

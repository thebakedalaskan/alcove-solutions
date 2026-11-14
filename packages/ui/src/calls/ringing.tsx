/*
 * Bringing people into a call, in the design system: the arches to ring from in the organizer's lobby, the empty arches
 * people wait in on the stage, the card someone rung sees on whatever page they have open, the card for someone asking
 * to join, and the page for picking a time. What each says comes from the app; how it looks and moves is here.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FocusScope } from 'radix-ui/internal';
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon, type IconName } from '../foundation/icon';
import { CheckDraw, EASE } from '../foundation/motion';
import { Avatar, GhostArch, type AvatarPerson } from '../foundation/people';
import { Button } from '../foundation/primitives';

/** One person to ring, in the lobby. Pressing picks them or takes them off; `busy` dims them, and they can still be picked. */
export function RingArch({ person, name, picked, busy = false, onToggle }: { person: AvatarPerson; name: string; picked: boolean; busy?: boolean | undefined; onToggle: () => void }) {
  return (
    <button type="button" className={cn('rg-arch', picked && 'on', busy && 'dim')} aria-pressed={picked} aria-label={busy ? `Ring ${name}, busy now` : `Ring ${name}`} onClick={onToggle}>
      <span className="ring"><Avatar person={person} size={52} />{picked && <span className="tk"><Icon name="check" size={13} /></span>}</span>
      <span className="ac-clamp-1">{name}</span>
    </button>
  );
}

/** The arch at the end of the lobby's row, which finds anyone else to ring. It's the anchor of a picker. */
export const RingAddArch = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function RingAddArch({ className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={cn('rg-arch add', className)} {...rest}><span className="ring"><Icon name="plus" size={20} /></span><span>Add</span></button>;
});

/**
 * A call's link with a Copy button, whose tick says it's on the clipboard. `onCopy` copies it; `link` is what to show,
 * without its https://. On the stage and on a page alike.
 */
export function LinkRow({ link, onCopy, className }: { link: string; onCopy: () => void; className?: string | undefined }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    onCopy();
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2400);
  };
  return (
    <div className={cn('rg-link', className)}>
      <span>{link}</span>
      <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the link'}><Icon key={copied ? 'tick' : 'copy'} name={copied ? 'check' : 'copy'} size={15} className="rg-swap" />{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/**
 * The arch someone is awaited in: an empty arch with their face in it. It ripples while they're being rung, twice in
 * every 2.4 seconds, and holds still (`still`) once they've answered. Under reduced motion it holds a plain ring.
 */
export function WaitArch({ person, size = 60, still = false, className }: { person: AvatarPerson; size?: number | undefined; still?: boolean | undefined; className?: string | undefined }) {
  return <span className={cn('rg-garch', still && 'still', className)} style={{ '--size': `${size + 8}px` }}><GhostArch size={size + 8} /><Avatar person={person} size={size} /></span>;
}

/** Someone's answer to a ring, as a small mark. */
export function RingReply({ icon, children }: { icon: IconName; children: ReactNode }) {
  return <span className="rg-reply"><Icon name={icon} size={14} />{children}</span>;
}

/** Rings someone again, from the arch they're waiting in: one quiet press. */
export const RingAgain = ({ onClick }: { onClick: () => void }) => <button type="button" className="rg-again" onClick={onClick}><Icon name="phoneCall" size={14} />Ring again</button>;

/**
 * Someone rung who isn't in the call, as they wait on the stage: their arch, what's happening, and their answer. It
 * fills the tile it's given. `action` is the one quiet thing to do about it, such as ringing them again.
 */
export function WaitTile({ person, title, detail, reply, ringing, action }: {
  person: AvatarPerson; title: ReactNode; detail?: ReactNode; reply?: ReactNode; ringing: boolean; action?: ReactNode;
}) {
  return (
    <div className={cn('rg-wait', ringing && 'is-ringing')}>
      <WaitArch person={person} still={!ringing} />
      <div className="say"><b role="status">{title}</b>{detail && <small>{detail}</small>}</div>
      {reply}
      {action}
    </div>
  );
}

export interface RingAnswer<T extends string> { value: T; icon: IconName; label: string }

/**
 * Someone ringing you, on any page. It drops in without taking the focus, so someone typing keeps typing: the arch
 * ripples, Join and Can't now answer it, and Can't now opens the answers in the same card. `night` is for pages on the
 * night stage. Put it in a `RingShelf`. While it's here a dialog's hold on the focus lets go, so Tab can reach the card;
 * focus left in the card goes back to the last place it was outside the cards.
 */
export function RingCard<T extends string>({ person, title, line, answers, night = false, onJoin, onAnswer }: {
  person: AvatarPerson; title: string; line: string; answers: RingAnswer<T>[]; night?: boolean | undefined; onJoin: () => void; onAnswer: (value: T) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const before = useRef(document.activeElement);
  const said = useId();
  useEffect(() => { if (open) first.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => {
    const note = (e: FocusEvent) => { if (e.target instanceof HTMLElement && !e.target.closest('.rg-rings')) before.current = e.target; };
    document.addEventListener('focusin', note);
    return () => document.removeEventListener('focusin', note);
  }, []);
  const t = reduce ? { duration: 0 } : { duration: 0.42, ease: EASE.out };
  return (
    <FocusScope.FocusScope asChild onMountAutoFocus={(e) => e.preventDefault()} onUnmountAutoFocus={(e) => { e.preventDefault(); if (document.activeElement === document.body && before.current instanceof HTMLElement) before.current.focus({ preventScroll: true }); }}>
    <motion.section layout={!reduce} className={cn('rg-ringcard', night && 'is-night')} role="alertdialog" aria-label={title} aria-describedby={said}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.24, ease: EASE.out } }} transition={t}>
      <div className="top">
        <WaitArch person={person} size={46} className="rg-rav" />
        <span className="min-w-0"><b>{title}</b><small id={said} className="ac-clamp-2">{line}</small></span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="answers" className="rg-replies" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE.out }}>
            {answers.map((a, i) => <button key={a.value} ref={i === 0 ? first : undefined} type="button" onClick={() => onAnswer(a.value)}><Icon name={a.icon} size={17} />{a.label}</button>)}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="acts">
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Can’t now</Button>
        <Button variant="primary" icon="video" onClick={onJoin}>Join</Button>
      </div>
    </motion.section>
    </FocusScope.FocusScope>
  );
}

/** Where Tab stops inside `box`, in order. */
function tabStops(box: Element): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
}

/**
 * Where ring cards sit: above everything, a modal and toasts included. It's a live region, so what arrives is read out
 * without moving the focus, and Radix's dialogs leave it open to assistive tech. Pressing a card mustn't count as
 * pressing outside a dialog, which would close it: those presses stop here. A card lets go of a dialog's hold on the
 * focus, and Tab would then walk out into the page hidden behind it, so with a dialog open Tab goes round the two:
 * from the end of the dialog to the cards, and from the end of the cards to the dialog. Nothing moves until someone tabs.
 * Escape in a card goes no further: closing the dialog behind it would lose what's in it, and Radix hears it first on the
 * document, so it stops at the window.
 */
export function RingShelf({ children }: { children: ReactNode }) {
  const shelf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shelf.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const tab = (e: KeyboardEvent) => {
      const dialog = document.querySelector('.ac-modal, .ac-sheet');
      const cards = tabStops(el);
      if (e.key !== 'Tab' || !dialog || !cards.length) return;
      const at = document.activeElement;
      const inDialog = tabStops(dialog);
      const here = at !== null && el.contains(at) ? cards : inDialog;
      const there = here === cards ? inDialog : cards;
      /* The focus fell out of what it was on, or it's on the dialog itself, which comes before everything in it. */
      const lost = at === document.body;
      const leaving = e.shiftKey ? at === here[0] || at === dialog : at === here.at(-1);
      if (!lost && !leaving) return;
      e.preventDefault();
      (lost ? inDialog : there).at(e.shiftKey ? -1 : 0)?.focus();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && el.contains(document.activeElement)) e.stopPropagation(); };
    el.addEventListener('pointerdown', stop);
    document.addEventListener('keydown', tab);
    addEventListener('keydown', escape, true);
    return () => { el.removeEventListener('pointerdown', stop); document.removeEventListener('keydown', tab); removeEventListener('keydown', escape, true); };
  }, []);
  return <div ref={shelf} className="rg-rings" aria-live="assertive"><AnimatePresence initial={false}>{children}</AnimatePresence></div>;
}

/** Someone asking to join, for the organizer: it drops in and stays until it's answered. */
export function KnockCard({ person, title, detail, busy = false, onLetIn, onNotNow }: {
  person: AvatarPerson; title: string; detail: ReactNode; busy?: boolean | undefined; onLetIn: () => void; onNotNow: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <motion.div layout={!reduce} className="rg-knock" role="status" initial={reduce ? { opacity: 1 } : { opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.24, ease: EASE.out } }} transition={reduce ? { duration: 0 } : { duration: 0.42, ease: EASE.out }}>
      <div className="top"><Avatar person={person} size={40} /><span className="min-w-0"><b className="ac-clamp-1">{title}</b><small className="ac-clamp-2">{detail}</small></span></div>
      <div className="acts">
        <Button variant="secondary" disabled={busy} onClick={onNotNow}>Not now</Button>
        <Button variant="primary" loading={busy} onClick={onLetIn}>Let in</Button>
      </div>
    </motion.div>
  );
}

/** A public page with one card on it, such as picking a time. It rises 8 px when it opens. */
export function GuestCard({ children }: { children: ReactNode }) {
  return <main className="rg-guest"><div className="rg-gcard">{children}</div></main>;
}

/** One time to pick from. Picking fills it, and its tick pops. */
export function TimeChoice({ time, day, picked, onPick }: { time: ReactNode; day: ReactNode; picked: boolean; onPick?: (() => void) | undefined }) {
  const body = <><span className="min-w-0"><b>{time}</b><small>{day}</small></span>{picked && <span className="tk"><Icon name="check" size={13} /></span>}</>;
  if (!onPick) return <div className="rg-time">{body}</div>;
  return <button type="button" className={cn('rg-time', picked && 'on')} aria-pressed={picked} onClick={onPick}>{body}</button>;
}

/** Done, on a card: a soft tile whose tick draws in. */
export function DoneTick() {
  const [done, setDone] = useState(false);
  useEffect(() => setDone(true), []);
  return <span className="rg-done"><CheckDraw done={done} size={24} duration={0.24} /></span>;
}

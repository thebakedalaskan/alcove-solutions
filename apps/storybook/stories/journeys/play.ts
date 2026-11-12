/*
 * What the journeys share. A journey finds what it clicks the way a person would, by its role and its label, anywhere on
 * the page: in the story's root or in what opened over it (a modal, a popover, a toast or a sheet, which the app puts at
 * the end of the page). Nothing here checks anything: it waits for what the next click needs, and no longer.
 *
 * The other side of a journey (someone else, the server, the connection) is played by the stand-in: what a journey
 * needs in its world goes in with `before()`, and what goes wrong for it with `outage()`, both in its `beforeEach`.
 */
import { AlcoveApiError } from '@alcove/api';
import { screen, waitFor } from 'storybook/test';
import { current } from '../../src/api/state';
import type { World } from '../../src/world';

type Role = Parameters<typeof screen.findByRole>[0];

/** Long enough for the page to settle: a modal stepping on, a popover opening, a row rising. */
export const SOON = { timeout: 8000 };
/** Long enough for something that takes a while: an account being made, notes being written. */
export const LATER = { timeout: 30000 };

/** For the journeys that need the wide layout (a note's preview beside the list, the call's side panel): they play at a laptop's
 * size whatever the window around Storybook. Every other journey fills the window it's given. */
export const LAPTOP = { viewport: { value: 'laptop', isRotated: false } };

const says = (el: Element, text: string | RegExp) => (typeof text === 'string' ? (el.textContent ?? '').includes(text) : text.test(el.textContent ?? ''));

/** The `role` (a tile, a row, an article) that says `text`: the innermost, when one holds another. */
export function holding(role: Role, text: string | RegExp, wait = SOON): Promise<HTMLElement> {
  return waitFor(() => {
    const all = screen.queryAllByRole(role).filter((el) => says(el, text));
    const inner = all.find((el) => !all.some((other) => other !== el && el.contains(other)));
    if (!inner) throw new Error(`Nothing on the page (${String(role)}) says “${String(text)}” yet.`);
    return inner;
  }, wait);
}

/**
 * The `role` named `name` once it can be pressed: a button that waits for someone else (the organizer, say), or for
 * something to be picked. In `scope` (a dialog, say) when it's given.
 */
export function pressable(role: Role, name: string | RegExp, wait = SOON, scope: Pick<typeof screen, 'getByRole'> = screen): Promise<HTMLElement> {
  return waitFor(() => {
    const el = scope.getByRole(role, { name });
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') throw new Error(`${String(name)} can’t be pressed yet.`);
    return el;
  }, wait);
}

/** `el` once a person could press it: nothing it sits in still has pointer events off, as a popover has while it comes in. */
export function reachable(el: HTMLElement, wait = SOON): Promise<HTMLElement> {
  return waitFor(() => {
    for (let at: Element | null = el; at; at = at.parentElement) if (getComputedStyle(at).pointerEvents === 'none') throw new Error('It’s still coming in.');
    return el;
  }, wait);
}

/** How long a menu takes no press after its rows move (`useSettledPress` in @alcove/ui says 400 ms), and a little over. */
const SETTLE = 450;

/**
 * `menu` once its rows have stopped moving. A menu takes no press for a moment after they move (a list coming in under it, a
 * row joining it), so that what's under the pointer is what someone aimed at, and nothing on the page says when that moment is
 * over: this watches the rows, and waits until they've been still for as long as the menu waits. A person's press comes later
 * anyway.
 */
export function still(menu: HTMLElement, wait = SOON): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const end = (): void => { rows.disconnect(); clearTimeout(quiet); clearTimeout(limit); };
    const calm = (): void => { clearTimeout(quiet); quiet = setTimeout(() => { end(); resolve(menu); }, SETTLE); };
    const rows = new MutationObserver(calm);
    const limit = setTimeout(() => { end(); reject(new Error('The menu’s rows kept moving.')); }, wait.timeout);
    rows.observe(menu, { childList: true, subtree: true });
    calm();
  });
}

/** Waits until nothing with `role` and `name` is on the page any more: a row that left the list. */
export function away(role: Role, name: string | RegExp, wait = SOON): Promise<void> {
  return waitFor(() => {
    if (screen.queryAllByRole(role, { name }).length) throw new Error(`${String(name)} is still on the page.`);
  }, wait);
}

/** The `i`th of what a `findAll…` found, counting from 0 (and from the end, below 0): the third line, the last answer. */
export async function nth(found: Promise<HTMLElement[]>, i: number): Promise<HTMLElement> {
  const all = await found;
  const el = all.at(i);
  if (!el) throw new Error(`There are only ${all.length} of those on the page.`);
  return el;
}
/** The first of what a `findAll…` found: the top of the page's, when the bottom has the same. */
export const first = (found: Promise<HTMLElement[]>): Promise<HTMLElement> => nth(found, 0);

/** Waits `ms`, for what the page does by itself: a toast going, a line arriving. */
export const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/* ---------- the other side ---------- */

/** What the journey needs in its world before the page opens: a meeting on the calendar, someone's say on a decision. */
export const before = (change: (w: World) => void) => (): void => { change(current()); };

/** Puts `by` in place of `on[key]` (one of the stand-in's answers) and hands back what puts it back. */
export function swap<T extends object, K extends keyof T>(on: T, key: K, by: T[K]): () => void {
  const was = on[key];
  on[key] = by;
  return () => { on[key] = was; };
}

/**
 * Something that goes wrong for a while. `begin` is a story's `beforeEach` (Storybook puts it right before the next story
 * opens); `end` puts it right halfway through a play, so Try again works.
 */
export function outage(start: () => () => void): { begin: () => () => void; end: () => void } {
  let stop: (() => void) | null = null;
  const end = () => { stop?.(); stop = null; };
  return { begin: () => { end(); stop = start(); return end; }, end };
}

/**
 * Email can't open from Storybook: a `mailto:` link does everything the app does with it (marking people invited, say)
 * up to the browser handing the message to the mail app, which it doesn't. A story's `beforeEach`.
 */
export function keepMail(): () => void {
  const stop = (e: MouseEvent) => { if (e.target instanceof Element && e.target.closest('a[href^="mailto:"]')) e.preventDefault(); };
  document.addEventListener('click', stop, true);
  // A message the app writes itself goes by a link it clicks without putting it on the page.
  const click = HTMLAnchorElement.prototype.click;
  const unswap = swap(HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) { if (!this.href.startsWith('mailto:')) click.call(this); });
  return () => { document.removeEventListener('click', stop, true); unswap(); };
}

/**
 * Other apps can't open from Storybook: a link or a window to another site in a new tab (Claude's connectors, say), or to
 * an app on this computer (cursor:, vscode:), does everything the app does with it up to the browser opening it, which it
 * doesn't. A story's `beforeEach`.
 */
export function keepTabs(): () => void {
  const away = (a: HTMLAnchorElement) => a.target === '_blank' || !['http:', 'https:'].includes(new URL(a.href, location.href).protocol);
  const stop = (e: MouseEvent) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (a instanceof HTMLAnchorElement && away(a)) e.preventDefault();
  };
  document.addEventListener('click', stop, true);
  const unswap = swap(window, 'open', () => null);
  return () => { document.removeEventListener('click', stop, true); unswap(); };
}

/** Alcove not answering, while the browser itself is online: what the client says when a request doesn't get through. */
export const unreachable = (): AlcoveApiError => new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');
/** The server saying no, and why. */
export const refusal = (message: string): AlcoveApiError => new AlcoveApiError('invalid', message, { requestId: 'sb-journey' });

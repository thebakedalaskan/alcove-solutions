/*
 * The demo clock. Every story starts at its scenario's moment on the demo day, Wednesday 4 November 2026 (16:12 unless
 * the scenario says otherwise), in whatever time zone Storybook is opened in, and the clock runs on from there: what the
 * pages work out from the time ("Today", "in 4 minutes", the day's calls) reads the same whenever Storybook is opened.
 * `Date` itself is moved, so the app's code is untouched. Timers aren't: a second is still a second.
 */

/** The demo day, as the design canvas tells it. Months count from 0. */
export const DEMO_DAY = { year: 2026, month: 10, day: 4 } as const;

const Real = Date;
let offset = 0;

/** A moment on the demo day, `days` after it, in local time. */
export function on(days: number, hours: number, minutes = 0, seconds = 0): Date {
  return new Real(DEMO_DAY.year, DEMO_DAY.month, DEMO_DAY.day + days, hours, minutes, seconds);
}
/** The same, as the contract writes times: ISO 8601 in UTC. */
export const iso = (days: number, hours: number, minutes = 0, seconds = 0): string => on(days, hours, minutes, seconds).toISOString();

/** Sets the clock: it reads `at` now, and runs on from there. */
export function setClock(at: Date): void {
  offset = at.getTime() - Real.now();
}
/** What the clock says, in ms. */
export const now = (): number => Real.now() + offset;
/** `ms` from now, as an ISO time. */
export const fromNow = (ms: number): string => new Real(now() + ms).toISOString();

class DemoDate extends Real {
  constructor(...args: [] | [string | number | Date] | [number, number, number?, number?, number?, number?, number?]) {
    if (args.length === 0) super(now());
    else if (args.length === 1) super(args[0]);
    else super(args[0], args[1], args[2] ?? 1, args[3] ?? 0, args[4] ?? 0, args[5] ?? 0, args[6] ?? 0);
  }
  static override now(): number { return now(); }
}

let installed = false;
/** Puts the demo clock in place of the browser's. Once, before any story renders. */
export function installClock(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, 'Date', { configurable: true, writable: true, value: DemoDate });
}

/*
 * What scheduling's stories share (Pages / Scheduling, and Journeys / 4 Start or schedule a call): the scheduler and the week
 * found by their names, as a person finds them, and the week pressed, pointed at, dragged and held with the pointer where a
 * person's would be. The week works out a time from where the pointer is, not from what was pressed, so every press here has
 * its place on the screen: the middle of a half hour, on whatever is on top there (a free half hour, the call, a meeting).
 * Nothing here checks anything: it waits for what the next press needs, and no longer.
 *
 *   export const Clash = page('/calls?schedule=new', 'busy', {
 *     play: playing(withPriyaAndKofi, pressingAt(THURSDAY, '12:00', 'Press 12:00, when Priya is busy'))
 *   });
 *
 * Days are counted from the demo day (Wednesday 4 November; src/world/scheduling.ts names the ones stories press), and a
 * half hour is found by how its name starts: "Thursday 5 November, 14:00", then who's free.
 */
import { screen, waitFor, within } from 'storybook/test';
import { longDay } from '~/lib/time';
import type { PageStory } from './page';
import { on } from './world/clock';

type Play = NonNullable<PageStory['play']>;
/** What a play is handed: `userEvent`, `step` and the page. */
export type Ctx = Parameters<Play>[0];
type UserEvent = Ctx['userEvent'];
type Role = Parameters<typeof screen.findByRole>[0];
interface Coords { clientX: number; clientY: number }

/** Long enough for the page to settle: a popover opening, the calendars read, the week turning. */
export const SOON = { timeout: 8000 };

/** One part of a play, in a labelled step. */
export type Step = (ctx: Ctx) => Promise<void>;
/** Parts one after another, as one play. */
export const playing = (...steps: Step[]): Play => async (ctx) => { for (const s of steps) await s(ctx); };

/* ---------- finding things ---------- */

/** The scheduler, by what it's doing: "Schedule a call", "Move Hiring sync", "Propose another time for Design crit". */
export const scheduler = (name = 'Schedule a call'): Promise<HTMLElement> => screen.findByRole('complementary', { name }, SOON);

/** The first thing with any of these roles and this name: a control the editor may draw either way (a field that opens a list). */
export function oneOf(roles: readonly Role[], name: string | RegExp, wait = SOON): Promise<HTMLElement> {
  return waitFor(() => {
    for (const role of roles) {
      const [el] = screen.queryAllByRole(role, { name });
      if (el) return el;
    }
    throw new Error(`Nothing called ${String(name)} on the page yet.`);
  }, wait);
}
/** Who: one field, "Add people" until someone's in, then "Add someone". */
export const whoField = (): Promise<HTMLElement> => oneOf(['combobox', 'textbox'], /^Add (people|someone)/);
/** The start or the end of the time: typed, or picked from the list it opens. */
export const timeField = (name: 'Starts' | 'Ends'): Promise<HTMLElement> => oneOf(['textbox', 'combobox', 'button'], name);
/** A switch, by how its title starts: "Let Jonas pick the time", "Notes", "Everyone joins muted". */
export const switchFor = (name: RegExp): Promise<HTMLElement> => oneOf(['switch', 'checkbox', 'button'], name);
/** One choice in a list or a menu that's open: a start or an end, a length, how it repeats, a place. */
export const choice = (name: string | RegExp): Promise<HTMLElement> => oneOf(['option', 'menuitemradio', 'radio', 'menuitem'], name);

/** The week while scheduling: every half hour of the days it shows is a button in it. */
export const pickATime = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Pick a time' }, SOON);
/** The Calls page's week, named by the days it shows: "2 – 8 Nov". */
export const browsing = (days: string): Promise<HTMLElement> => screen.findByRole('group', { name: new RegExp(`^${escaped(days)}`) }, SOON);

/** A day as the week says it, `day` days after the demo day: "Thursday 5 November". */
export const dayName = (day: number): string => longDay(on(day, 12));
function escaped(words: string): string { return words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * The half hour at `time` on `day` (days after the demo day): on the week while scheduling, or in `scope` (the Calls page's
 * week). Its name starts with the day and the time, "Thursday 5 November, 14:00", and goes on with who's free then.
 */
export async function halfHour(day: number, time: string, scope?: HTMLElement | undefined): Promise<HTMLElement> {
  const name = new RegExp(`^${escaped(`${dayName(day)}, ${time}`)}\\b`);
  const [first] = await within(scope ?? await pickATime()).findAllByRole('button', { name }, SOON);
  if (!first) throw new Error(`${dayName(day)}, ${time} isn’t on the week.`);
  return first;
}

/* ---------- where a person's pointer goes ---------- */

/** The box the week's hours scroll in: `el` itself, or the nearest thing round it that scrolls up and down. */
function hoursRound(el: Element): Element | null {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight + 1) return at;
  }
  return null;
}
/** How much of the top of the hours the row of days covers as they scroll under it, and a little more. */
const DAY_ROW = 56;
/** Scrolls the week's hours as a person would, until `el` is well in view: to the middle of the hours, unless it's there already. */
function inView(el: Element): void {
  const box = hoursRound(el);
  if (!box || box === el) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top >= b.top + DAY_ROW && r.bottom <= b.bottom - 2) return;
  box.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
}
/** The point `along` the way down the middle of `el`. */
function pointIn(el: Element, along = 0.5): Coords {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height * along };
}
/** What's on top at a point, as the browser finds what a pointer is over (nothing that lets the pointer through). */
const topAt = (at: Coords, or: Element): Element => document.elementFromPoint(at.clientX, at.clientY) ?? or;
/** What a held pointer's moves go to: what it pressed while that's still there to take them, else what's under it now. */
const holding = (pressed: Element, at: Coords): Element =>
  (pressed.isConnected && getComputedStyle(pressed).pointerEvents !== 'none' ? pressed : topAt(at, document.body));

/** Whether `el` is laid out where it is on the week: a half hour drawn as its cell, not one kept for the keyboard alone. */
function drawn(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= 4 && r.height >= 4;
}
/**
 * Presses `el` as a person would: the pointer comes over its middle and presses there without moving. A half hour the week
 * keeps for the keyboard alone is pressed the keyboard's way: Enter on it moves the call there, as a press does.
 */
export async function pressOn(userEvent: UserEvent, el: Element, along = 0.5): Promise<void> {
  if (!drawn(el) && el instanceof HTMLElement) {
    el.focus();
    await userEvent.keyboard('{Enter}');
    return;
  }
  inView(el);
  const coords = pointIn(el, along);
  const target = topAt(coords, el);
  await userEvent.pointer([{ target, coords }, { keys: '[MouseLeft]', target, coords }]);
}
/** Points at `el` without pressing: what the week shows under a pointer. */
export async function pointAt(userEvent: UserEvent, el: Element): Promise<void> {
  if (!drawn(el)) return;
  inView(el);
  const coords = pointIn(el);
  await userEvent.pointer({ target: topAt(coords, el), coords });
}

/** A drag under way: the pointer held down on what it grabbed. */
export interface Drag {
  /** Drags on over `el`, `along` the way down it, in small moves as a hand does. */
  over: (el: Element, along?: number) => Promise<void>;
  /** Drags on to the right-hand edge of the days, where holding it turns the week on. */
  toEdge: () => Promise<void>;
  /** Lets go where the pointer is. */
  drop: () => Promise<void>;
}
/**
 * Grabs `el` (the call, by its first half hour; or free time, to drag across it) `along` the way down it, and holds on. The
 * call keeps where in it you grabbed it, so dropping it in the middle of a half hour, when it was grabbed in the middle of its
 * first, puts its start there.
 */
export async function grabbing(userEvent: UserEvent, el: Element, along = 0.5): Promise<Drag> {
  if (!drawn(el)) throw new Error('The week keeps its half hours for the keyboard alone, so a drag has nowhere on the screen to start from.');
  inView(el);
  let at = pointIn(el, along);
  const pressed = topAt(at, el);
  await userEvent.pointer([{ target: pressed, coords: at }, { keys: '[MouseLeft>]', target: pressed, coords: at }]);
  const glide = async (to: Coords, steps: number): Promise<void> => {
    const from = at;
    for (let i = 1; i <= steps; i++) {
      const coords = { clientX: from.clientX + ((to.clientX - from.clientX) * i) / steps, clientY: from.clientY + ((to.clientY - from.clientY) * i) / steps };
      await userEvent.pointer({ target: holding(pressed, coords), coords });
      at = coords;
    }
  };
  return {
    over: async (to, toAlong = along) => {
      if (!drawn(to)) throw new Error('The week keeps its half hours for the keyboard alone, so a drag has nowhere on the screen to go to.');
      await glide(pointIn(to, toAlong), 6);
    },
    toEdge: async () => {
      const days = (await pickATime()).getBoundingClientRect();
      await glide({ clientX: days.right - 6, clientY: at.clientY }, 8);
    },
    drop: async () => { await userEvent.pointer({ keys: '[/MouseLeft]', target: holding(pressed, at), coords: at }); }
  };
}
/** Grabs `from`, drags it over `to` and lets go: the call onto another time, or across free time from one half hour to another. */
export async function dragOnto(userEvent: UserEvent, from: Element, to: Element, along = 0.5): Promise<void> {
  const drag = await grabbing(userEvent, from, along);
  await drag.over(to);
  await drag.drop();
}

/**
 * Scrolls the hours of the week (the scheduling week, or `scope`) as far as they go: down to midnight, or up to 00:00. A
 * person's wheel does the same.
 */
export async function scrollHours(to: 'top' | 'bottom', scope?: HTMLElement | undefined): Promise<void> {
  const [some] = await within(scope ?? await pickATime()).findAllByRole('button', { name: /^\S+ \d+ \S+, \d\d:\d\d/ }, SOON);
  const box = some ? hoursRound(some) : null;
  if (box) box.scrollTop = to === 'bottom' ? box.scrollHeight : 0;
}

/* ---------- the steps scheduling plays share ---------- */

/** The first row under Who that `who` names: a person or a group by how its name starts, or an address anywhere in it. */
async function row(who: RegExp): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole('option', { name: who }, SOON);
  if (!first) throw new Error(`Nobody under Who is ${String(who)}.`);
  return first;
}
/** Someone from the people under Who, by how their row's name starts: Often with you, then Add someone else. */
export const adding = (who: RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await whoField());
    await userEvent.click(await row(who));
  });
};
/** Something typed into Who (an address, a name, "Everyone"), then the row `who` names picked: by default, the one with what was typed. */
export const typingIn = (typed: string, said: string, who = new RegExp(escaped(typed))): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.type(await whoField(), typed);
    await userEvent.click(await row(who));
  });
};
/** That's everyone: Escape puts the people away. */
export const thatsEveryone: Step = async ({ userEvent, step }) => {
  await step('That’s everyone: Escape puts the people away', async () => { await userEvent.keyboard('{Escape}'); });
};
/** The first button with this name, or a name that starts this way. */
export async function button(name: string | RegExp): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole('button', { name }, SOON);
  if (!first) throw new Error(`There’s no ${String(name)} to press.`);
  return first;
}
/** Presses a button, by its name or how its name starts. */
export const pressing = (name: string | RegExp, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => { await userEvent.click(await button(name)); });
};
/** Presses the week at `time` on `day` (days after the demo day). */
export const pressingAt = (day: number, time: string, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => { await pressOn(userEvent, await halfHour(day, time)); });
};
/** Opens the start's or the end's list and picks from it: "06:30", or an end by how it starts ("16:00", then its length). */
export const picking = (field: 'Starts' | 'Ends', at: string, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await timeField(field));
    const list = await screen.findByRole('listbox', { name: field }, SOON);
    await userEvent.click(await within(list).findByRole('option', { name: new RegExp(`^${escaped(at)}`) }, SOON));
  });
};
/** Types over the start or the end, as a person types a time ("1415", "13:00", "24:00"), and Enter: it counts then, or says why it can't. */
export async function typeTime(userEvent: UserEvent, field: 'Starts' | 'Ends', typed: string): Promise<void> {
  const el = await timeField(field);
  await userEvent.clear(el);
  await userEvent.type(el, `${typed}{Enter}`);
}
/** A step that types over the start or the end. */
export const typingTime = (field: 'Starts' | 'Ends', typed: string, said: string): Step => async ({ userEvent, step }) => {
  await step(said, async () => { await typeTime(userEvent, field, typed); });
};
/** Waits until the page says something (a status under the time, a toast), wherever it says it first. */
export const says = async (text: RegExp): Promise<void> => { await screen.findAllByText(text, {}, SOON); };
/** A step that waits until the page says something. */
export const saying = (text: RegExp, said: string): Step => async ({ step }) => {
  await step(said, async () => { await says(text); });
};

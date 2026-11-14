/*
 * What call stories share. A call story is a page story whose `beforeEach` does what the lobby does before the call
 * screen opens: your microphone and camera start (from the browser's made-up devices), you join through the stand-in
 * (src/api/call/scripted-call.ts), and the people you picked are rung. Then the app opens at the call's address with
 * you in it, and the call plays its script (src/api/call/script.ts). A door story stops at the call's link, before
 * joining.
 *
 *   export const Speaking = inCall({ scenario: 'call-soon', call: 'dsn-revw-pka', script: { here: [...], talk: {...} } });
 *   export const Waiting = atTheDoor({ scenario: 'busy', call: CHECK_IN, script: { door: { hostArrives: 8 } } });
 *   export const SpeakingPhone = phone(Speaking);
 *
 * The call is always night, so its stories are too. What follows your own theme in a call, a board on its stage, has a
 * story in a light theme as well (`light`): the board is light there, and the stage around it night. The toolbar renders a
 * story again without starting it over: the call carries on.
 */
import type { CallSession, Meeting, NotesChoices, Person } from '@alcove/api';
import { screen } from 'storybook/test';
import { LocalMedia } from '~/features/call/media/media';
import { sessions } from '~/features/call/session/handoff';
import type { ScenarioName } from './api/scenarios';
import { ringFrom, scriptCall, type CallScript } from './api/call/script';
import { ringYou } from './api/calls/rings';
import { standIn } from './api/standin';
import { current, me } from './api/state';
import { page, type PageStory } from './page';
import type { World } from './world/world';
import { call, type CallSpec } from './world/build';

/**
 * A call the story puts in the world first: a call as `call()` writes it, started just now, set up to join muted, with a
 * workspace chosen as its home when it was scheduled, or keeping other than everything in its notes.
 */
export interface StoryCall extends CallSpec { instant?: boolean | undefined; joinMuted?: boolean | undefined; workspaceId?: string | undefined; choices?: NotesChoices | undefined }
/** The story's call: one of the scenario's own, by its link's code, or one of its own. */
type Which = string | StoryCall;
const codeOf = (c: Which): string => (typeof c === 'string' ? c : c.code);

/** The story's own calls go into the world, as you see them, unless the world has them already. */
function settle(...calls: Which[]): void {
  const w = current();
  for (const c of calls) {
    if (typeof c === 'string' || w.meetings.some((m) => m.code === c.code)) continue;
    const m: Meeting = { ...call(c, me()), instant: c.instant ?? false, joinMuted: c.joinMuted ?? false, workspaceId: c.workspaceId ?? null, ...(c.choices ? { choices: c.choices } : {}) };
    w.meetings.push(m);
  }
}

/** The worlds a call story has set up: rendered again (the toolbar), a story carries on instead of joining twice. */
const prepared = new WeakSet<World>();
const once = (setup: () => Promise<void>) => async (): Promise<void> => {
  const w = current();
  if (prepared.has(w)) return;
  prepared.add(w);
  await setup();
};

export interface InCall {
  scenario: ScenarioName;
  call: Which;
  script?: CallScript | undefined;
  /** Other calls the story needs in the world: one that rings you, say. */
  also?: readonly StoryCall[] | undefined;
  /**
   * Your microphone and camera as you join: the microphone on and the camera off unless it says, so everyone shows in their arch.
   * `name`: the name you typed, coming in with the link signed out, as a guest does.
   */
  you?: { mic?: boolean | undefined; cam?: boolean | undefined; name?: string | undefined } | undefined;
  /** People to ring as you join, as the lobby's Join and ring does. */
  ring?: readonly Person[] | undefined;
  /** Anything you do the moment you're in, before the screen shows (rooms opened, say). */
  then?: ((session: CallSession) => void) | undefined;
}

/** The app in the call, with you in it, as the lobby would have left you. */
export function inCall(o: InCall, more: Omit<PageStory, 'args'> = {}): PageStory {
  const code = codeOf(o.call);
  return page(`/call/${code}`, o.scenario, {
    ...more,
    globals: { theme: 'dark', ...more.globals },
    beforeEach: once(async () => {
      settle(o.call, ...(o.also ?? []));
      if (o.script) scriptCall(code, o.script);
      const mic = o.you?.mic ?? true;
      const cam = o.you?.cam ?? false;
      const media = new LocalMedia();
      await media.start({ mic, cam });
      sessions.media = media;
      const session = await standIn.calls.join(code, { mic, cam, ...(o.you?.name ? { name: o.you.name } : {}) });
      sessions.call = { code, session };
      if (o.ring?.length) await session.ring(o.ring.map((p) => p.email));
      o.then?.(session);
    })
  });
}

/** The app at the call's link, before joining: the organizer's lobby, or the page everyone else waits on. */
export function atTheDoor(o: { scenario: ScenarioName; call: Which; script?: CallScript | undefined; also?: readonly StoryCall[] | undefined }, more: Omit<PageStory, 'args'> = {}): PageStory {
  const code = codeOf(o.call);
  return page(`/join/${code}`, o.scenario, {
    ...more,
    globals: { theme: 'dark', ...more.globals },
    beforeEach: once(async () => {
      settle(o.call, ...(o.also ?? []));
      if (o.script) scriptCall(code, o.script);
      await Promise.resolve();
    })
  });
}

/**
 * The app at `path` while someone rings you: `from` rings you into their call `after` seconds in, a card on whatever
 * page is open. The call they ring you to is in the world, and plays `script` once you join it.
 */
export function rung(o: { scenario: ScenarioName; path: string; call: StoryCall; from: Person; after?: number | undefined; script?: CallScript | undefined }, more: Omit<PageStory, 'args'> = {}): PageStory {
  return page(o.path, o.scenario, {
    ...more,
    beforeEach: async () => {
      const w = current();
      if (prepared.has(w)) return undefined;
      prepared.add(w);
      settle({ ...o.call, status: 'live' });
      if (o.script) scriptCall(o.call.code, o.script);
      const t = setTimeout(() => { if (current() === w) ringYou(ringFrom(o.from, o.call.code, o.call.title, o.call.notes ?? 'on')); }, (o.after ?? 1.5) * 1000);
      return () => clearTimeout(t);
    }
  });
}

type Play = NonNullable<PageStory['play']>;
type Then = { then?: readonly (string | RegExp)[] | undefined; tab?: string | undefined };
/** A button's name as a step says it: a pattern's words, without its anchors. */
const said = (name: string | RegExp): string => (typeof name === 'string' ? name : name.source.replace(/^\^|\$$/g, ''));
/** The dock's More, by what its label starts with on any screen. */
export const MORE = /^More:/;

/** Then any buttons that come up (in a sheet or a menu, which open over the page), and a tab of your side. */
const andThen = (o: Then): Play => async ({ canvas, userEvent, step }) => {
  for (const next of o.then ?? []) {
    await step(`Press ${said(next)}`, async () => {
      await userEvent.click(await screen.findByRole('button', { name: next }, { timeout: 8000 }));
    });
  }
  const tab = o.tab;
  if (tab) {
    await step(`Open ${tab}`, async () => {
      await userEvent.click(await canvas.findByRole('tab', { name: tab }, { timeout: 5000 }));
    });
  }
};

/** A play that does what a person would: presses a button on the page (in the dock, say), then any that come up after it. */
export const press = (label: string | RegExp, o: Then = {}): Play => async (c) => {
  await c.step(`Press ${said(label)}`, async () => {
    await c.userEvent.click(await c.canvas.findByRole('button', { name: label }, { timeout: 10000 }));
  });
  await andThen(o)(c);
};

/** What's yours, by its label: at the top right on a wider screen, and in the grid at the top of More on a phone. */
const YOURS = { Board: 'Board', Workspace: /^Workspace/, Notes: 'Notes', Chat: /^Chat/, People: /^People in this call/ } as const;
/**
 * A play that opens what's yours as a person would: at the top right, or on a phone from the grid at the top of More. What's
 * open already (Notes, which a call opens by itself on a wide screen while notes are on) isn't pressed again. Then any buttons
 * that come up after it, and a tab of your side.
 */
export const reach = (what: keyof typeof YOURS, o: Then = {}): Play => async (c) => {
  const { canvas, userEvent, step } = c;
  await step(`Open ${what}`, async () => {
    await canvas.findByRole('toolbar', { name: 'Call controls' }, { timeout: 10000 });
    const [top] = canvas.queryAllByRole('button', { name: YOURS[what] });
    if (top) {
      if (top.getAttribute('aria-pressed') !== 'true') await userEvent.click(top);
      return;
    }
    await userEvent.click(await canvas.findByRole('button', { name: MORE }, { timeout: 8000 }));
    await userEvent.click(await screen.findByRole('button', { name: YOURS[what] }, { timeout: 8000 }));
  });
  await andThen(o)(c);
};

/** A play that opens Settings from More, as a person would, then one of its parts by its tab (Audio and video shows first). */
export const settings = (tab?: string): Play => async (c) => {
  await press(MORE, { then: ['Settings'] })(c);
  if (!tab) return;
  await c.step(`Open ${tab}`, async () => {
    await c.userEvent.click(await screen.findByRole('tab', { name: tab }, { timeout: 8000 }));
  });
};

/** Puts your side away, if it's showing anything (Notes opens by itself as a call starts on a wide screen). */
export const clearSide: Play = async ({ canvas, userEvent, step }) => {
  await step('Put your side away', async () => {
    await canvas.findByRole('toolbar', { name: 'Call controls' }, { timeout: 10000 });
    const [close] = canvas.queryAllByRole('button', { name: /^Close (Notes|Chat|People)$/ });
    if (close) await userEvent.click(close);
  });
};
/** Plays one after another. */
export const plays = (...all: Play[]): Play => async (c) => { for (const p of all) await p(c); };

/** The same story on a phone. */
export const phone = (story: PageStory, name?: string): PageStory => ({
  ...story,
  ...(name ? { name } : story.name ? { name: `${story.name}, on a phone` } : {}),
  globals: { ...story.globals, viewport: { value: 'phone', isRotated: false } }
});

/** The same story in a narrow window, wider than a phone: your side sits over the stage there, rather than squeezing it. */
export const narrow = (story: PageStory, name?: string): PageStory => ({
  ...story,
  ...(name ? { name } : story.name ? { name: `${story.name}, in a narrow window` } : {}),
  globals: { ...story.globals, viewport: { value: 'narrow', isRotated: false } }
});

/**
 * The same story for someone whose theme is light. The stage stays night, as the call always is; a board on it follows their
 * theme, so it's light, as the canvas's in-call frames are.
 */
export const light = (story: PageStory, name?: string): PageStory => ({
  ...story,
  ...(name ? { name } : story.name ? { name: `${story.name}, in a light theme` } : {}),
  globals: { ...story.globals, theme: 'light' }
});

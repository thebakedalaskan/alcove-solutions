/*
 * What call stories share. A call story is a page story whose `beforeEach` does what the lobby does before the call
 * screen opens: your microphone and camera start (from the browser's made-up devices), you join through the stand-in
 * (src/api/call.ts), and the people you picked are rung. Then the app opens at the call's address with you in it, and
 * the call plays its script (src/api/script.ts). A door story stops at the call's link, before joining.
 *
 *   export const Speaking = inCall({ scenario: 'call-soon', call: 'dsn-revw-pka', script: { here: [...], talk: {...} } });
 *   export const Waiting = atTheDoor({ scenario: 'busy', call: CHECK_IN, script: { door: { hostArrives: 8 } } });
 *   export const SpeakingPhone = phone(Speaking);
 *
 * The call is always night, so its stories are too. What follows your own theme in a call, a board on its stage, has a
 * story in a light theme as well (`light`): the board is light there, and the stage around it night. The toolbar renders a
 * story again without starting it over: the call carries on.
 */
import type { CallSession, Meeting, Person } from '@alcove/api';
import { screen } from 'storybook/test';
import { LocalMedia } from '~/features/call/media/media';
import { sessions } from '~/lib/live';
import type { ScenarioName } from './api/scenarios';
import { ringFrom, scriptCall, type CallScript } from './api/script';
import { ringYou, standIn } from './api/standin';
import { current, me } from './api/state';
import { page, type PageStory } from './page';
import type { World } from './world';
import { call, type CallSpec } from './world/build';

/**
 * A call the story puts in the world first: a call as `call()` writes it, started just now, set up to join muted, or with a
 * workspace chosen as its home when it was scheduled.
 */
export interface StoryCall extends CallSpec { instant?: boolean | undefined; joinMuted?: boolean | undefined; workspaceId?: string | undefined }
/** The story's call: one of the scenario's own, by its link's code, or one of its own. */
type Which = string | StoryCall;
const codeOf = (c: Which): string => (typeof c === 'string' ? c : c.code);

/** The story's own calls go into the world, as you see them, unless the world has them already. */
function settle(...calls: Which[]): void {
  const w = current();
  for (const c of calls) {
    if (typeof c === 'string' || w.meetings.some((m) => m.code === c.code)) continue;
    const m: Meeting = { ...call(c, me()), instant: c.instant ?? false, joinMuted: c.joinMuted ?? false, workspaceId: c.workspaceId ?? null };
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
  /** Your microphone and camera as you join: the microphone on and the camera off unless it says, so everyone shows in their arch. */
  you?: { mic?: boolean | undefined; cam?: boolean | undefined } | undefined;
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
      const session = await standIn.calls.join(code, { mic, cam });
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

/**
 * A play that does what a person would: presses a button on the page (in the dock, say), then any buttons that come up
 * after it (in a sheet or a menu, which open over the page), and opens a tab of a panel.
 */
export const press = (label: string, o: { then?: readonly string[] | undefined; tab?: string | undefined } = {}): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(`Press ${label}`, async () => {
    await userEvent.click(await canvas.findByRole('button', { name: label }, { timeout: 10000 }));
  });
  for (const next of o.then ?? []) {
    await step(`Press ${next}`, async () => {
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

/** The same story on a phone. */
export const phone = (story: PageStory, name?: string): PageStory => ({
  ...story,
  ...(name ? { name } : story.name ? { name: `${story.name}, on a phone` } : {}),
  globals: { ...story.globals, viewport: { value: 'phone', isRotated: false } }
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

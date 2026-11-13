/*
 * What a page's stories share: the real app (src/app.tsx) full screen at an address, on a scenario that Controls can
 * switch. A page story is an address and a scenario:
 *
 *   const meta = { title: 'Pages/Calls', ...pages } satisfies Meta<PageArgs>;
 *   export default meta;
 *   export const Busy = page('/calls', 'busy');
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SCENARIO_NAMES, checked, type ScenarioName } from './api/scenarios';
import { current } from './api/state';
import { App } from './app';
import type { World } from './world';

export interface PageArgs {
  /** Where the app opens. */
  path: string;
  /** The world the stand-in serves (src/api/scenarios.ts). */
  scenario: ScenarioName;
}

export const pages = {
  render: ({ path }) => <App key={path} path={path} />,
  parameters: { layout: 'fullscreen', page: true },
  argTypes: {
    path: { control: 'text', description: 'Where the app opens' },
    scenario: { control: 'select', options: SCENARIO_NAMES, description: 'The world the stand-in serves' }
  }
} satisfies Meta<PageArgs>;

export type PageStory = StoryObj<PageArgs>;

/** A page story: the app at `path`, on `scenario`, and anything else a story needs (`parameters`, `globals`, `play`). */
export const page = (path: string, scenario: ScenarioName, more: Omit<PageStory, 'args'> = {}): PageStory => ({ ...more, args: { path, scenario } });

/**
 * Puts the caret at the end of a line in a document. user-event can't press End inside the editor (it logs "Not
 * implemented" and does nothing), so a play clicks the line, calls this, then types.
 */
export const caretAtEnd = (line: Element): void => {
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

/** The worlds a story has changed already: the toolbar renders a story again, and it isn't changed twice. */
const changed = new WeakSet<World>();
/**
 * A story's own change to its scenario's world, made as it opens and checked against the contract as a scenario's is:
 * notes in a state no scenario has, a part of Alcove that fails, recordings kept on this device. It goes in the story's
 * `beforeEach`, and may wait for what it puts in place.
 *
 *   export const Unwritten = page('/calls/n-unwritten', 'busy', { beforeEach: changing(inEveryState) });
 */
export const changing = (...changes: ((w: World) => void | Promise<void>)[]) => async (): Promise<void> => {
  const w = current();
  if (changed.has(w)) return;
  changed.add(w);
  for (const change of changes) await change(w);
  checked(w);
};

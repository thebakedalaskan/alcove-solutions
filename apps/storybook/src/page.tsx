/*
 * What a page's stories share: the real app (src/app.tsx) full screen at an address, on a scenario that Controls can
 * switch. A page story is an address and a scenario:
 *
 *   const meta = { title: 'Pages/Notes', ...pages } satisfies Meta<PageArgs>;
 *   export default meta;
 *   export const Busy = page('/notes', 'busy');
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SCENARIO_NAMES, type ScenarioName } from './api/scenarios';
import { App } from './app';

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

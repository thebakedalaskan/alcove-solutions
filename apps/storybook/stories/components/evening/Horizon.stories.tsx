/*
 * Horizon: the evening behind every page, a sky and a sea meeting at --hz, which the page sets. Each page is a moment of
 * the same evening (`moment`): Home is the sunset, then the sun lower and gone, and Record the night, in both themes. It
 * moves a little, the water, the light on it, the clouds, the stars, and now and then something passes through: on a
 * page one at a time, at random. `only` is for the scene shown for itself, as here: one kind of visitor (VISITORS lists
 * them all and the moments each comes to) over and over, or nothing. With reduced motion nothing comes, and it's still.
 * Foundations › The evening has every moment and every visitor side by side.
 */
import { Horizon, PlanSunset, VISITORS, type Moment, type Showing, type Visitor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const MOMENTS = ['home', 'team', 'notes', 'drive', 'plans', 'note', 'settings', 'record'] as const satisfies readonly Moment[];
/** Where the sky meets the sea in the story's 480px box, for each moment: about as much of it as each page gives the sky. */
const HZ: Record<Moment, number> = { home: 300, team: 250, notes: 190, drive: 165, plans: 150, note: 130, settings: 96, record: 330 };

/** Boats and ships take minutes to cross a page; shown for themselves, they cross five times as fast. */
const SHIPS: ReadonlySet<Visitor> = new Set<Visitor>(['sail', 'steamer', 'trawler', 'tall', 'freighter', 'tug']);
/** The choices for `only` in Controls: as on a page, nothing, or one kind of visitor. */
const ONLY: Record<string, Showing | undefined> = {
  'As on a page': undefined,
  Nothing: { kind: null },
  ...Object.fromEntries(VISITORS.map((v): [string, Showing] => [v.kind, { kind: v.kind, pace: SHIPS.has(v.kind) ? 5 : undefined }]))
};

/** What Plans draws on its own sky: the last sliver of the sun, where its moment has none. */
const SUNSET = <PlanSunset />;

const meta = {
  title: 'Components/The evening/Horizon',
  component: Horizon,
  args: { moment: 'home' },
  argTypes: {
    moment: { control: 'inline-radio', options: MOMENTS },
    only: { control: 'select', options: Object.keys(ONLY), mapping: ONLY },
    land: { control: false }, sky: { control: false }
  },
  render: (args) => (
    <div className="relative isolate h-[480px] overflow-hidden rounded-[var(--radius-lg)]" style={{ '--hz': `${HZ[args.moment]}px` }}>
      <Horizon {...args} sky={args.sky ?? (args.moment === 'plans' ? SUNSET : undefined)} />
    </div>
  )
} satisfies Meta<typeof Horizon>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Home's sunset, as a page has it: the first quick visitor comes after 5 to 12 seconds, and half the time a ship is already out. */
export const AsOnAPage: Story = { name: 'As on a page' };
/** Dolphins, over and over, as `only` shows one kind. */
export const OneVisitor: Story = { name: 'One visitor', args: { only: { kind: 'dolphins' } } };
/** A tall ship crossing Team's evening, five times as fast as on the page. */
export const AShip: Story = { name: 'A ship', args: { moment: 'team', only: { kind: 'tall', pace: 5 } } };
/** Nothing passing: Notes, just after sunset. The water, the light and the clouds still move. */
export const NothingPassing: Story = { name: 'Nothing passing', args: { moment: 'notes', only: { kind: null } } };
/** Plans, just after sunset: a long low glow, and the last sliver of the sun the page draws on the sky (`sky`), behind whatever passes. */
export const Plans: Story = { args: { moment: 'plans', only: { kind: 'sail', pace: 5 } } };
/** Record is night in both themes; shooting stars come to it. */
export const RecordAtNight: Story = { name: 'Record at night', args: { moment: 'record', only: { kind: 'star' } } };

/*
 * BoardSheet: the board itself, a sheet of paper with dots on it, in a BoardLayout that holds it beside its rail. What's on
 * it goes in a BoardWorld, the one layer the camera moves, so nothing on the board draws again as it pans and zooms: the dots
 * keep up through the sheet's own variables. The sheet takes the person's theme wherever it is, a night board goes dark
 * whatever the theme, and a colour round it says the view is someone else's. Change the zoom in Controls.
 */
import { BoardLayout, BoardLines, BoardSheet, BoardWorld, type BoardSheetProps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FOLK } from '../../../src/world/boards';
import { KitSheet, RetroPiece } from './parts';

interface SheetArgs extends Pick<BoardSheetProps, 'clean' | 'night' | 'follow'> {
  /** The camera's zoom. */
  zoom: number;
  page?: boolean | undefined;
}

const COLOURS = Object.values(FOLK).map((f) => f.colour);

const meta = {
  title: 'Components/Board/BoardSheet',
  component: BoardSheet,
  subcomponents: { BoardLayout, BoardWorld, BoardLines },
  args: { zoom: 0.75, clean: false, night: false },
  argTypes: { zoom: { control: { type: 'range', min: 0.2, max: 2, step: 0.05 } }, follow: { control: 'select', options: COLOURS } },
  render: ({ zoom, page, ...sheet }) => (
    <KitSheet width={760} height={460} page={page} cam={{ x: 40, y: 34, z: zoom }} sheet={sheet}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<SheetArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: dots 24 pixels apart at 100%, so the board reads as paper and never as a grid to fill in. */
export const AtRest: Story = { name: 'At rest' };
/** Zoomed out, the dots close up with the board, and stop at 12 pixels apart. */
export const ZoomedOut: Story = { name: 'Zoomed out', args: { zoom: 0.4 } };
/** Zoomed in, they spread out with it. */
export const ZoomedIn: Story = { name: 'Zoomed in', args: { zoom: 1.6 } };
/** Clean: no dots, for presenting, a phone and a live tile. */
export const Clean: Story = { args: { clean: true } };
/** Following Priya: a ring in her colour round the sheet says this view isn't yours. It fades in and out as following starts and stops. */
export const Following: Story = { args: { follow: FOLK.priya.colour } };
/** Night board, from the bar's More: this sheet goes dark, whatever the theme is. */
export const NightBoard: Story = { name: 'Night board', args: { night: true } };
/** On the board's own page: day round it, and a fine edge and a shadow round the sheet. */
export const OnItsPage: Story = { name: 'On its page', args: { page: true } };

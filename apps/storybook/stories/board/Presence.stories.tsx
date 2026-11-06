/*
 * The people in the call are how you find your way round a board. Each pointer carries a face and a name, in that person's
 * colour; whoever is talking glows, on their tile and on their pointer; dots show who's typing, and their colour goes round
 * what they're typing in. Following someone keeps you with them until you stop, with a ring in their colour to say this view
 * isn't your own. Each is the real surface, hearing the others on the board's awareness as a provider would bring them.
 */
import type { Meta } from '@storybook/react-vite';
import { BoardScene, whereItShows, type BoardStory } from '../../src/board';
import { AROUND, WRITING, launchRetro } from '../../src/world/boards';

const meta = {
  title: 'Board/Presence',
  component: BoardScene,
  decorators: [whereItShows],
  parameters: { layout: 'fullscreen' },
  args: { board: () => launchRetro(), mode: 'call', name: 'Launch retro', others: AROUND, talking: ['priya'] },
  argTypes: { board: { control: false }, others: { control: false }, talking: { control: false }, follow: { control: false }, children: { control: false }, sealIcon: { control: false } }
} satisfies Meta<typeof BoardScene>;
export default meta;

/** Five people on the board. Priya is talking, so Priya's pointer glows with the same ring as Priya's tile; Theo is quiet. */
export const SeveralPeople: BoardStory = { name: 'Several people' };
export const SeveralPeopleDark: BoardStory = { name: 'Several people, dark', globals: { theme: 'dark' } };

/** Everyone writes at once: Priya and Theo are typing, so dots show on their pointers and their colour goes round what they're in. */
export const EveryoneWriting: BoardStory = { name: 'Everyone writing', args: { board: () => launchRetro({ links: false, only: ['w1', 'w2', 'w3', 'f1', 'f3', 'a1'] }), others: WRITING, talking: [] } };

/**
 * Following Priya: the board glides to where Priya is looking, and a ring in Priya's colour says this view isn't your own.
 * Scroll, zoom or press Esc and it stops; so does Stop.
 */
export const FollowingSomeone: BoardStory = { name: 'Following someone', args: { follow: 'priya' } };

/** On a phone: the same pointers and the same glow, over a board that fills the space between the faces and the dock. */
export const OnAPhone: BoardStory = { name: 'On a phone', globals: { viewport: { value: 'phone', isRotated: false } }, args: { mode: 'phone' } };

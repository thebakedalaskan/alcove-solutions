/*
 * WsPersonCard: someone's card, from their face in the list, their name in a line, or their arch in a call on a phone,
 * where it's a sheet with the same choices a tile gives on a laptop: Follow, Go to where they are, and Tag them here.
 * From an arch it also leads on to the tile's own options, such as pinning them or how loud they are.
 */
import { WsPersonCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PopSurface, did } from '../../src/component';
import { PRIYA } from '../../src/world/people';

const meta = {
  title: 'Components/WsPersonCard',
  component: WsPersonCard,
  args: { person: PRIYA, where: 'Launch plan', followed: false, onFollow: did('follow'), onStop: did('stop following') },
  argTypes: { onFollow: { control: false }, onStop: { control: false }, onGo: { control: false }, onTag: { control: false }, onOptions: { control: false } },
  render: (args) => <PopSurface ws><WsPersonCard {...args} /></PopSurface>
} satisfies Meta<typeof WsPersonCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const ALL = { onGo: did('go there'), onTag: did('tag') };
/** From an arch in a call: the tile's own options too. */
const ARCH = { ...ALL, onOptions: did('pin, volume and more') };

export const InADocument: Story = { args: ALL };
export const Following: Story = { args: { ...ALL, followed: true } };
/** In a document you can't open: nothing is named, and there's nowhere to go. */
export const SomewhereYouCantOpen: Story = { args: { where: 'A document you can’t open', onTag: did('tag') } };
/** What's open here is read-only, so there's no tagging. */
export const ReadingOnly: Story = { args: { onGo: did('go there') } };
/** From Priya's arch in a call, on a phone: a sheet, with the rest of her tile's options a press away. */
export const FromAnArchPhone: Story = { args: ARCH, globals: { viewport: { value: 'phone' } } };
export const FromAnArchPhoneNight: Story = { args: ARCH, globals: { viewport: { value: 'phone' }, theme: 'dark' } };
export const FollowingFromAnArchPhone: Story = { args: { ...ARCH, followed: true }, globals: { viewport: { value: 'phone' } } };

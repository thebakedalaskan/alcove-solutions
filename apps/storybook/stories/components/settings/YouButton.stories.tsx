/*
 * YouButton: your face at the top right of every page, and in the phone's top bar, as the button that opens your menu
 * (YouMenu). A thin ring follows the arch while it's hovered, a firmer one while the menu is open (`aria-expanded`), and
 * the focus colour's from the keyboard. While notifications are paused, `until` says until when: a small crossed-out bell
 * sits on its lower right all the time the pause lasts, and its label and tooltip say until when. 32px at the top right,
 * 34 in the phone's top bar. Press it: the open ring comes and goes.
 */
import { YouButton } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { ART } from '../../../src/world/people';
import { ROUND_PHOTO } from '../../../src/world/photos';

const meta = {
  title: 'Components/Settings/YouButton',
  component: YouButton,
  parameters: { layout: 'centered' },
  args: { person: ART, size: 32, until: null, 'aria-expanded': false, onClick: did('onClick') },
  argTypes: {
    person: { control: 'object' },
    size: { control: { type: 'range', min: 24, max: 48, step: 2 } },
    until: { control: 'text' },
    'aria-expanded': { control: 'boolean' },
    onClick: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <YouButton {...args} onClick={(e) => { args.onClick?.(e); update({ 'aria-expanded': !args['aria-expanded'] }); }} />;
  }
} satisfies Meta<typeof YouButton>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: your face. Hover it for its ring. */
export const AtRest: Story = { name: 'At rest' };
export const AtRestNight: Story = { ...AtRest, name: 'At rest, night', globals: { theme: 'dark' } };
/** Your photo cut to a circle before it reached your sign-in provider: it fills the arch, as any photo does, never a circle
 * standing in it on the arch's pale fill. */
export const RoundPhotoNight: Story = { name: 'Round photo, night', args: { person: { ...ART, photoUrl: ROUND_PHOTO } }, globals: { theme: 'dark' } };
/** Notifications paused until 17:12: the bell, crossed out, on its lower right. Its label says until when after your name, and so does its tooltip. */
export const Paused: Story = { args: { until: '17:12' } };
export const PausedNight: Story = { ...Paused, name: 'Paused, night', globals: { theme: 'dark' } };
/** The menu open under it: a ring in the line colour round the arch. */
export const Open: Story = { args: { 'aria-expanded': true } };
export const OpenNight: Story = { ...Open, name: 'Open, night', globals: { theme: 'dark' } };
/** Paused, with the menu open. */
export const PausedOpen: Story = { name: 'Paused, open', args: { ...Paused.args, 'aria-expanded': true } };
/** In the phone's top bar, a little larger. */
export const InThePhonesTopBar: Story = { name: 'In the phone’s top bar', args: { size: 34, until: '17:12' }, globals: { viewport: { value: 'phone' } } };

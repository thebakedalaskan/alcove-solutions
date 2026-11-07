/*
 * PresentedTile: what someone presents, waiting among the people while it isn't on your stage, always at night. It has a
 * tile only while they present it, and pressing it takes you back in, following them. A live miniature fills it; without
 * one it says what it is and where its presenter is. Among arches, or on the horizon, it's an arch: the kind's icon and
 * the presenter's face.
 */
import { ICON_NAMES, PresentedTile } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenImage } from '../../../src/api/media';
import { Box, did, onStage, Row } from '../../../src/component';
import { PRIYAS_SCREEN } from '../../../src/world/boards';
import { ART, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/PresentedTile',
  component: PresentedTile,
  ...onStage,
  args: {
    name: 'Launch review · 4 Nov', icon: 'folderOpen', sub: 'Priya is presenting', by: PRIYA, go: 'Join', label: 'Join Launch review · 4 Nov',
    where: 'Launch plan', small: false, onPress: did('onPress')
  },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, go: { control: 'inline-radio', options: ['Join', 'Open'] }, by: { control: false }, children: { control: false } },
  render: (args) => <Box width="min(560px, 100%)" height={340}><PresentedTile {...args} /></Box>
} satisfies Meta<typeof PresentedTile>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya’s screen, live and small: Join takes you back to it. */
export const WithAMiniature: Story = {
  name: 'With a miniature',
  args: {
    name: 'Priya’s screen', icon: 'screen', label: 'Join Priya’s screen', where: undefined,
    children: <img src={screenImage(PRIYAS_SCREEN)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  }
};
/** No miniature yet: what it is and where Priya is, calmly, and nothing made up. */
export const Placeholder: Story = {};
/** What you present yourself, closed for you: Open takes you back to it. */
export const Yours: Story = { args: { sub: 'You’re presenting', by: ART, go: 'Open', label: 'Go back to Launch review · 4 Nov' } };
/** A long name in a narrow tile: who presents it gives way first, then the name, and the tile never widens. */
export const Narrow: Story = {
  args: { name: 'Launch review and the pricing follow-up for the whole of November', label: 'Join Launch review and the pricing follow-up for the whole of November' },
  render: (args) => <Box width={260} height={160}><PresentedTile {...args} /></Box>
};
/** As an arch among the people's arches, and smaller still on the horizon: the kind's icon and Priya's face. */
export const Small: Story = {
  name: 'Small, as an arch',
  args: { small: true },
  render: (args) => (
    <Row>
      <Box width={72} height={78}><PresentedTile {...args} /></Box>
      <Box width={48} height={52}><PresentedTile {...args} /></Box>
      <Box width={36} height={40}><PresentedTile {...args} icon="screen" name="Priya’s screen" label="Join Priya’s screen" /></Box>
    </Row>
  )
};

/*
 * KnockCard: someone asking to join, at the top right of the night stage, for whoever hosts the call. It drops in and
 * stays until it's answered: who they are, their address, and for the organizer, that they get the notes once let in.
 * A guest who gave only a name says so. Let in is busy while the call lets them in, and Not now waits for it.
 */
import { KnockCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did, onStage } from '../../../src/component';
import { DIEGO, JONAS } from '../../../src/world/people';

const meta = {
  title: 'Components/Ringing and waiting/KnockCard',
  component: KnockCard,
  ...onStage,
  args: {
    person: DIEGO, title: 'Diego Ruiz asks to join', detail: <>{DIEGO.email}<br />Gets the notes once let in</>, busy: false,
    onLetIn: did('onLetIn'), onNotNow: did('onNotNow')
  },
  argTypes: { person: { control: false }, title: { control: 'text' }, detail: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width="min(340px, 100%)" height="auto"><KnockCard {...args} onLetIn={() => { args.onLetIn(); update({ busy: true }); }} /></Box>;
  }
} satisfies Meta<typeof KnockCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Press Let in: it's busy while the call lets Diego in. */
export const Asking: Story = {};
/** While you host for the organizer: they're let in as a guest, so the card doesn't promise the notes. */
export const WhileYouHost: Story = { name: 'While you host', args: { detail: DIEGO.email } };
/** A guest who gave only their name. */
export const AGuest: Story = { name: 'A guest', args: { person: { name: JONAS.name }, title: 'Jonas Weber asks to join', detail: 'Guest, by name only' } };
/** Letting them in: Let in is busy, and Not now waits. */
export const LettingIn: Story = { name: 'Letting in', args: { busy: true } };
/** Two asking at once, one under the other, as the stage stacks them. */
export const TwoAsking: Story = {
  name: 'Two asking',
  render: (args) => (
    <Box width="min(340px, 100%)" height="auto">
      <div style={{ display: 'grid', gap: 8 }}>
        <KnockCard {...args} />
        <KnockCard {...args} person={{ name: JONAS.name }} title="Jonas Weber asks to join" detail="Guest, by name only" />
      </div>
    </Box>
  )
};

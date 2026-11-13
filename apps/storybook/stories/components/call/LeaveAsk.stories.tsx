/*
 * LeaveAsk: Leave's question for whoever hosts, over Leave at the end of the dock, the way Close's question opens under Close;
 * on a phone, a sheet from the bottom. End for everyone, or Leave, Kofi hosts: the best person to host is chosen already, and
 * Change lists who else could, in the same question. Hosting in someone's place puts leaving it going first. Nobody here who
 * can host (guests can't) leaves End alone. Anyone who doesn't host is out at once, so isn't asked. Alone in a call, Leave
 * ends it at once; any other way out (going back a page, say) asks, with End for everyone only. The floating call asks the
 * same in its own window (`LeaveChoices`, In a call › FloatingCall).
 */
import { CallDock, DockButton, DockLeave, DockSeparator, LeaveAsk } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { screen } from 'storybook/test';
import { did, onStage } from '../../../src/component';
import { KOFI, MAYA, PRIYA } from '../../../src/world/people';

const HOSTS = [{ id: 'p-kofi', person: KOFI }, { id: 'p-priya', person: PRIYA }, { id: 'p-maya', person: MAYA }];

const meta = {
  title: 'Components/In a call/LeaveAsk',
  component: LeaveAsk,
  ...onStage,
  args: {
    open: true, title: 'Leave Team standup', notes: true, alone: false, hosts: HOSTS, standingInFor: null, busy: null, error: null, phone: false,
    anchor: <DockLeave />,
    onOpenChange: did('onOpenChange'), onEnd: did('End for everyone'), onKeep: did('Leave, someone else hosts')
  },
  argTypes: {
    anchor: { control: false }, hosts: { control: 'object' },
    busy: { control: 'inline-radio', options: [null, 'end', 'keep'] }, error: { control: 'text' }, standingInFor: { control: 'text' }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', width: '100%', minHeight: 'calc(100dvh - 80px)' }}>
        {/* The dock in its bar, as the call has it, so a phone draws it as the call does. */}
        <div className="ic-dockbar">
          <CallDock>
            <DockButton icon="mic" label="Mute microphone" />
            <DockButton icon="video" label="Turn off camera" />
            <DockSeparator />
            <DockButton icon="screen" label="Share" word="Share" />
            <DockButton icon="more" label="More" />
            <DockSeparator />
            <LeaveAsk {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
          </CallDock>
        </div>
      </div>
    );
  }
} satisfies Meta<typeof LeaveAsk>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The organizer, with notes on: End for everyone says everyone invited gets them; Kofi would host, and Change lists who else could. */
export const Organizer: Story = {};
/** Hosting in Priya's place: leaving it going comes first, with Kofi hosting until she's back. */
export const StandingIn: Story = { name: 'Standing in', args: { standingInFor: 'Priya', hosts: [{ id: 'p-kofi', person: KOFI }, { id: 'p-maya', person: MAYA }] } };
/** Nobody here can host (everyone else is a guest): End for everyone is the one choice, and says why. */
export const NobodyCanHost: Story = { name: 'Nobody here can host', args: { hosts: [] } };
/**
 * Alone in the call: pressing Leave ends it at once, so this is asked only on another way out, such as going back a page. End
 * for everyone is the one choice, and says leaving ends the call; closing the question stays.
 */
export const Alone: Story = { args: { alone: true, hosts: [] } };
/** One person could host: no Change. Notes were never on, so End says only what it does. */
export const OneHostNoNotes: Story = { name: 'One host, no notes', args: { notes: false, hosts: [{ id: 'p-kofi', person: KOFI }] } };
/** End for everyone on its way: it says so, and nothing else can be pressed. */
export const Ending: Story = { name: 'Ending the call', args: { busy: 'end' } };
/** Leaving it going, on its way. */
export const Leaving: Story = { args: { busy: 'keep' } };
/** It didn't go through: why, in caution under the choices, and both can be pressed again. */
export const Failed: Story = { args: { error: 'Couldn’t end the call. Check your connection and try again.' } };
/** Change: who else could host, the chosen one ticked. Pressing one takes it back to the question with them hosting. */
export const Change: Story = {
  play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: /^Change who hosts/ })); }
};
/** On a phone it's a sheet from the bottom, over the call. */
export const Phone: Story = { args: { phone: true }, globals: { viewport: { value: 'phone', isRotated: false } } };
/** Change on a phone. */
export const PhoneChange: Story = {
  name: 'Phone, Change', args: { phone: true }, globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ userEvent }) => { await userEvent.click(await screen.findByRole('button', { name: /^Change who hosts/ })); }
};
/** The call is night in the light theme too. */
export const LightTheme: Story = { name: 'Light theme', globals: { theme: 'light' } };

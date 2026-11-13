/*
 * AgentLine: the agents on the horizon in one line. The ones you've connected stand first, solid, with when each was last
 * used under its name; half a place (AgentGap); then the agents people use that aren't connected yet, dashed; then
 * Another agent. While it loads, empty windows breathe in its place (AgentWaitingPlace). Each window is an AgentPlace,
 * which opens a popover; its stories show them open.
 */
import { AgentGap, AgentLine, AgentPlace, AgentWaitingPlace, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { OnTheHorizon } from './frames';

const meta = {
  title: 'Components/Agents/AgentLine',
  component: AgentLine,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Your agents', loading: false, children: null },
  argTypes: { children: { control: false } }
} satisfies Meta<typeof AgentLine>;
export default meta;
type Story = StoryObj<typeof meta>;

interface Standing { icon: IconName; name: string; line?: string; dashed?: boolean; caution?: boolean }
const place = (s: Standing, at: number) => (
  <AgentPlace key={s.name} place={s.name} icon={s.icon} name={s.name} line={s.line} look={s.dashed ? 'dashed' : 'solid'} caution={s.caution}
    label={s.dashed ? `Connect ${s.name}` : `${s.name}, ${s.line ?? ''}`} popLabel={s.name} open={false} onOpenChange={did('onOpenChange')} at={at}>
    {null}
  </AgentPlace>
);
const CONNECTED: Standing[] = [{ icon: 'sparkle', name: 'Claude', line: '4 min ago' }, { icon: 'pointer', name: 'Cursor', line: 'Yesterday' }, { icon: 'key', name: 'Weekly digest', line: 'Mon' }];
const YET: Standing[] = [
  { icon: 'thread', name: 'ChatGPT', dashed: true }, { icon: 'code', name: 'VS Code', dashed: true }, { icon: 'squareTerminal', name: 'Claude Code', dashed: true },
  { icon: 'terminal', name: 'Codex', dashed: true }, { icon: 'plug', name: 'Another agent', dashed: true }
];
const FIRST: Standing[] = [{ icon: 'sparkle', name: 'Claude', dashed: true }, { icon: 'thread', name: 'ChatGPT', dashed: true }, { icon: 'pointer', name: 'Cursor', dashed: true }, ...YET.slice(1)];
const ENDING: Standing[] = [{ icon: 'sparkle', name: 'Claude', line: '4 min ago' }, { icon: 'pointer', name: 'Cursor', line: 'Ends tomorrow', caution: true }, { icon: 'key', name: 'Weekly digest', line: 'Mon' }];

/** Claude, Cursor and the Weekly digest, half a place, then the rest. */
export const Today: Story = {
  render: (args) => <OnTheHorizon><AgentLine {...args}>{CONNECTED.map(place)}<AgentGap />{YET.map((s, i) => place(s, i + 4))}</AgentLine></OnTheHorizon>
};
/** Nothing connected yet: every agent people use, dashed. */
export const FirstDay: Story = {
  name: 'First day',
  render: (args) => (
    <OnTheHorizon places={7}>
      <AgentLine {...args}>{FIRST.map(place)}</AgentLine>
    </OnTheHorizon>
  )
};
/** Cursor's access ends tomorrow: its line says so in caution, with a dot on its window. */
export const Ending: Story = {
  render: (args) => (
    <OnTheHorizon>
      <AgentLine {...args}>{ENDING.map(place)}<AgentGap />{YET.map((s, i) => place(s, i + 4))}</AgentLine>
    </OnTheHorizon>
  )
};
/** On its way: three empty windows, breathing. */
export const Loading: Story = {
  args: { loading: true },
  render: (args) => <OnTheHorizon places={7}><AgentLine {...args}>{[0, 1, 2].map((i) => <AgentWaitingPlace key={i} at={i} />)}</AgentLine></OnTheHorizon>
};
export const TodayPhone: Story = { ...Today, name: 'Today, phone', globals: { viewport: { value: 'phone', isRotated: false } } };

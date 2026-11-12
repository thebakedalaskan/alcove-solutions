/*
 * AgentLevels: the parts of Alcove an agent asked for, one row each, with its level at the right edge, which opens a menu
 * of the levels and what each allows: Notes off, read, or read and edit; Calls off, see, or see and book; Calendar off or
 * see. Sharing and deleting notes are their own row, two switches that start off. Lowering one gives the agent less;
 * nothing gives it more than it asked for.
 */
import { AgentLevels, type AgentLevelRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { choiceFor, picked, rowsOf, switched, type Choice } from '~/features/agents/levels';
import { did } from '../../../src/component';
import { onTheSky } from './frames';

const EVERYTHING = ['notes:read', 'notes:write', 'notes:share', 'notes:delete', 'meetings:read', 'meetings:write', 'calendar:read'] as const;
const rows = (choice: Choice, asked: readonly (typeof EVERYTHING)[number][] = EVERYTHING): AgentLevelRow[] => rowsOf(choice, asked);

const meta = {
  title: 'Components/Agents/AgentLevels',
  component: AgentLevels,
  decorators: [onTheSky],
  parameters: { layout: 'fullscreen' },
  args: { rows: rows(choiceFor(EVERYTHING)), open: undefined, disabled: false, onOpen: did('onOpen'), onPick: did('onPick'), onSwitch: did('onSwitch') },
  argTypes: { rows: { control: false }, open: { control: 'inline-radio', options: [undefined, 'notes', 'calls', 'calendar', 'extra'] } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <section className="ag-ask" style={{ justifyContent: 'flex-start' }}>
        <h2 className="ag-qt">Claude wants to use your Alcove</h2>
        <AgentLevels {...args} onOpen={(open) => { args.onOpen(open); update({ open }); }} />
      </section>
    );
  }
} satisfies Meta<typeof AgentLevels>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Everything Claude asked for, each part at its highest level, sharing and deleting off. */
export const AsAsked: Story = { name: 'As asked' };
/** Calls' levels, each saying what it allows. */
export const ALevelsMenu: Story = { name: 'A level’s menu', args: { open: 'calls' } };
/** Lowered to See: Allow gives Claude only that. */
export const Lowered: Story = { args: { rows: rows(picked(choiceFor(EVERYTHING), 'calls', 'see')) } };
/** Sharing and deleting, their own row: two switches. */
export const Switches: Story = { args: { open: 'extra' } };
/** Sharing turned on. */
export const SharingOn: Story = { name: 'Sharing on', args: { rows: rows(switched(choiceFor(EVERYTHING), 'notes:share', true)), open: 'extra' } };
/** Claude Code asks for less: only the parts it asked for are there, and only up to what it asked. */
export const AskedForLess: Story = { name: 'Asked for less', args: { rows: rows(choiceFor(['notes:read', 'notes:write', 'meetings:read']), ['notes:read', 'notes:write', 'meetings:read']) } };
/** While the answer goes: nothing can change. */
export const Answering: Story = { args: { disabled: true } };
export const ALevelsMenuPhone: Story = { ...ALevelsMenu, name: 'A level’s menu, phone', globals: { viewport: { value: 'phone', isRotated: false } } };

/*
 * WsTrash: Trash on the page, the newest first, kept for 30 days. Each thing has Restore, and Delete forever behind one ask
 * (WsDeleteAsk). Someone who can only read sees what's there with nothing to press; empty, it says how long things stay.
 */
import { WsDeleteAsk, WsTrash, type WsPop, type WsTrashItem } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../../src/component';
import { ART, LENA, PRIYA } from '../../../../src/world/people';

const first = (name: string) => name.split(' ')[0] ?? name;
const deleting = (name: string, open: boolean): WsPop => ({ open, onOpenChange: did('delete forever'), content: <WsDeleteAsk name={name} onDelete={did('delete forever')} onKeep={did('keep it')} /> });
/** What's in Trash, for someone who can change the workspace; `asking` has its Delete forever open. */
const binned = (asking?: string): WsTrashItem[] => [
  { id: 'roadmap', name: 'Old roadmap', sub: `${first(PRIYA.name)}, yesterday · 29 days left` },
  { id: 'research', name: 'Old research', sub: `${first(LENA.name)}, Monday · 28 days left`, kind: 'folder' as const },
  { id: 'draft', name: 'Launch plan, first draft', sub: `${first(ART.name)}, Sunday · 27 days left` },
  { id: 'retro', name: 'Launch retro', sub: `${first(PRIYA.name)}, Sunday · 27 days left`, kind: 'board' as const }
].map((t): WsTrashItem => ({ ...t, onOpen: did(`open ${t.name}`), onRestore: did(`restore ${t.name}`), onDelete: deleting(t.name, t.id === asking) }));

const meta = {
  title: 'Components/Workspace/Trash/WsTrash',
  component: WsTrash,
  args: { items: binned() },
  argTypes: { items: { control: false } },
  render: (args) => <Box width="min(900px, 100%)" height={520}><WsTrash {...args} /></Box>
} satisfies Meta<typeof WsTrash>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeThings: Story = {};
/** Delete forever asks once, starting on Keep it. */
export const DeleteAsks: Story = { args: { items: binned('roadmap') } };
/** Someone who can only read: what's there, and nothing to press but opening it. */
export const Reading: Story = { args: { items: binned().map((t): WsTrashItem => ({ id: t.id, name: t.name, sub: t.sub, kind: t.kind, onOpen: t.onOpen })) } };
export const Empty: Story = { args: { items: [] } };

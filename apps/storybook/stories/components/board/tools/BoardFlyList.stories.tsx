/*
 * BoardFlyList: what two of More's items offer, beside the rail where More was, at night as the rail is. Templates offers the
 * four to put beside what's on the board; From your workspace, what you can open in the board's workspace, the board aside,
 * and says so when there's nothing, or while it's being read.
 */
import { BoardFlyList, BoardRail, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../../src/component';
import { KitSheet, RetroPiece } from '../parts';

const pick = did('onPick');
const TEMPLATES: { id: string; icon: IconName; label: string; onPick: () => void }[] = [
  { id: 'retro', icon: 'layoutTemplate', label: 'Retro', onPick: pick },
  { id: 'ideas', icon: 'stickyNote', label: 'Ideas', onPick: pick },
  { id: 'flow', icon: 'workflow', label: 'Flow', onPick: pick },
  { id: 'what-why-next', icon: 'layoutTemplate', label: 'What, why, next', onPick: pick }
];
const IN_PRODUCT: { id: string; icon: IconName; label: string; onPick: () => void }[] = [
  { id: 'plan', icon: 'fileText', label: 'Launch plan', onPick: pick },
  { id: 'copy', icon: 'fileText', label: 'Pricing page copy', onPick: pick },
  { id: 'flow', icon: 'presentation', label: 'Onboarding flow', onPick: pick }
];

const meta = {
  title: 'Components/Board/Tools/BoardFlyList',
  component: BoardFlyList,
  args: { label: 'Templates', items: TEMPLATES, empty: '' },
  argTypes: { items: { control: false }, label: { control: 'text' }, empty: { control: 'text' } },
  render: (args) => (
    <KitSheet width={820} height={460} rail={<BoardRail tool="select" moreOpen onTool={did('onTool')} onMore={did('onMore')} />} over={<BoardFlyList {...args} />}>
      <RetroPiece />
    </KitSheet>
  )
} satisfies Meta<typeof BoardFlyList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Templates: Retro, Ideas, Flow, and What, why, next. */
export const Templates: Story = {};
/** From your workspace: what you can open in Product, the board aside. */
export const FromYourWorkspace: Story = { name: 'From your workspace', args: { label: 'From your workspace', items: IN_PRODUCT, empty: 'Nothing here you can open yet.' } };
/** Nothing there you can open yet. */
export const NothingYet: Story = { name: 'Nothing yet', args: { label: 'From your workspace', items: [], empty: 'Nothing here you can open yet.' } };
/** While the workspace is being read. */
export const Reading: Story = { args: { label: 'From your workspace', items: [], empty: 'Getting what’s here…' } };

/*
 * ComposerLine: one line to type in, for finding something: the palette's, which finds a note or asks every note you
 * have, and pins notes to the side panel. An input with className="text" goes in after the icon, and the line's
 * `action` after that: who it's for, and the key that closes it. Anything that needs more than a line asks one thing at
 * a time in a Modal instead.
 */
import { Button, ComposerLine, ICON_NAMES, Icon, Kbd, Scope } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';

const FIND = 'Search your notes, or ask a question';

const meta = {
  title: 'Components/Forms/ComposerLine',
  component: ComposerLine,
  parameters: { layout: 'centered' },
  args: {
    icon: 'search',
    children: <input className="text" placeholder={FIND} aria-label="Search or ask your notes, for you alone" autoComplete="off" spellCheck={false} />,
    action: <><Scope>Only you</Scope><Kbd>esc</Kbd></>
  },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, children: { control: false }, action: { control: false }, className: { control: false } },
  render: (args) => <Box width="min(640px, 90vw)" height="auto"><ComposerLine {...args} /></Box>
} satisfies Meta<typeof ComposerLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed yet: what it's for, and that only you see what's found. */
export const Search: Story = {};
/** A question typed. Enter asks every note you have. */
export const Typed: Story = {
  args: { children: <input className="text" defaultValue="When does the new onboarding ship?" placeholder={FIND} aria-label="Search or ask your notes, for you alone" autoComplete="off" spellCheck={false} /> }
};
/** Pinning: the same line finds the notes to pin. */
export const PinANote: Story = {
  name: 'Pin a note',
  args: {
    icon: 'pin',
    children: <input className="text" placeholder="Find a note to pin" aria-label="Find a note to pin" autoComplete="off" spellCheck={false} />,
    action: <Kbd>esc</Kbd>
  }
};
/** In the palette, which drops from the top of the page: the line sits on its sheet, with Ask in the foot. */
export const InThePalette: Story = {
  name: 'In the palette',
  render: (args) => (
    <div className="ac-sheet pal" style={{ position: 'relative', left: 'auto', top: 'auto', transform: 'none', animation: 'none', width: 'min(680px, 90vw)' }}>
      <ComposerLine {...args} className="pal-line" />
      <div className="pal-body"><p className="pal-none"><b>No notes yet.</b>Notes from your calls and recordings show up here, and you can ask about them.</p></div>
      <div className="pal-foot">
        <span className="hint is-sealed"><Icon name="sealed" size={15} /><span>Answers come from your notes only, in confidential compute.</span></span>
        <Button variant="primary" icon="ask" kb="↵" disabled onClick={did('onAsk')}>Ask</Button>
      </div>
    </div>
  )
};

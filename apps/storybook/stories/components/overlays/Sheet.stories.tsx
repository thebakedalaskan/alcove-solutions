/*
 * Sheet: the one panel that drops from the top, around one line to type in, for finding something. The palette is one
 * (⌘K, or Search or ask): its line, then what it finds. The page waits behind a veil, focus goes to the line, and
 * closing it (Escape, or pressing the veil) puts focus back where it was.
 */
import { Button, ComposerLine, Icon, Kbd, Scope, Sheet } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';

/** The palette's line and foot, as the palette draws them. */
const SEARCH = (
  <>
    <ComposerLine icon="search" className="pal-line" action={<><Scope>Only you</Scope><Kbd className="pal-esc">esc</Kbd></>}>
      <input className="text" placeholder="Search your notes, or ask a question" aria-label="Search or ask your notes, for you alone" autoComplete="off" spellCheck={false} />
    </ComposerLine>
    <div className="pal-foot">
      <span className="hint is-sealed"><Icon name="sealed" size={15} /><span>Answers come from your notes only, in confidential compute.</span></span>
      <Button variant="primary" icon="ask" kb="↵" onClick={did('Ask')}>Ask</Button>
    </div>
  </>
);

/** Finding a note to pin: the same sheet around another line, with Done to close it. */
const pinning = (done: () => void) => (
  <>
    <ComposerLine icon="pin" className="pal-line" action={<Kbd className="pal-esc">esc</Kbd>}>
      <input className="text" placeholder="Find a note to pin" aria-label="Find a note to pin" autoComplete="off" spellCheck={false} />
    </ComposerLine>
    <div className="pal-foot">
      <span className="hint"><Icon name="pin" size={15} /><span>Pinned notes stay in the side panel, in the order you pin them.</span></span>
      <Button variant="primary" onClick={done}>Done</Button>
    </div>
  </>
);

const meta = {
  title: 'Components/Overlays/Sheet',
  component: Sheet,
  args: { open: true, label: 'Search or ask', className: 'pal', children: SEARCH, onOpenChange: did('onOpenChange') },
  argTypes: { children: { control: false } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <>
        <Button icon="search" kb="⌘K" onClick={() => update({ open: true })}>Search or ask</Button>
        <Sheet {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
      </>
    );
  }
} satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The palette, open: type to search your notes, or ask them. Escape or the veil closes it; Search or ask opens it again. */
export const Open: Story = {};
/** Closed: only what opens it is on the page. */
export const Closed: Story = { args: { open: false } };
/** The same sheet around another line: finding a note to pin. Done closes it. */
export const FindANoteToPin: Story = {
  name: 'Find a note to pin',
  args: { label: 'Pin a note' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const close = () => { args.onOpenChange(false); update({ open: false }); };
    return (
      <>
        <Button icon="pin" onClick={() => update({ open: true })}>Pin a note</Button>
        <Sheet {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }}>{pinning(close)}</Sheet>
      </>
    );
  }
};

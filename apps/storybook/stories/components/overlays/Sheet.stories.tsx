/*
 * Sheet: the one panel that drops from the top, around one line to type in, for finding something. The palette is one
 * (⌘K, or Search or ask), over a veil of its own (`overlayClassName="pal-scrim"`: solid night, no blur); Add credits in
 * Settings is another, over the usual veil. The page waits behind it, focus goes to the line, and closing it (Escape, or
 * pressing the veil) puts focus back where it was. `onEscapeKeyDown` can keep it open on Escape, as the palette does to go
 * back from an answer to its results first.
 */
import { Button, PaletteBody, PaletteFoot, PaletteGroup, PaletteLine, PaletteNoteLine, PalettePin, Sheet, coverFor, paletteRow } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { Nothing } from '../search/parts';

const KEYS = [{ keys: ['↑', '↓'], label: 'Move' }, { keys: ['↵'], label: 'Open' }, { keys: ['esc'], label: 'Close' }];

/** The palette with nothing found yet: its line, an empty list and its foot. */
const SEARCH = (
  <>
    <PaletteLine onCancel={did('cancel')}>
      <input className="pal-in" placeholder="Search everything said, or ask a question" aria-label="Search or ask your notes" autoComplete="off" spellCheck={false} />
    </PaletteLine>
    <PaletteBody>
      <Nothing icon="mic" title="Nothing to search yet">After your first call with notes on, everything said in it can be found here: who said it, and when.</Nothing>
    </PaletteBody>
    <PaletteFoot keys={KEYS}>Only you can see what you search.</PaletteFoot>
  </>
);

/** Finding a note to pin: the same sheet around another line, with Done to close it. */
function Pinning({ done }: { done: () => void }) {
  return (
    <>
      <PaletteLine icon="pin" onCancel={done}>
        <input className="pal-in" placeholder="Find a note to pin" aria-label="Find a note to pin" autoComplete="off" spellCheck={false} />
      </PaletteLine>
      <PaletteBody>
        <div role="listbox" aria-label="Notes" aria-multiselectable="true">
          <PaletteGroup label="Recent notes">
            <div role="option" aria-selected className={paletteRow('note', true)}><PaletteNoteLine cover={coverFor('n2')} title="Team standup" meta="Today" end={<PalettePin pinned label="Unpin" />} /></div>
            <div role="option" aria-selected={false} className={paletteRow('note', false)}><PaletteNoteLine cover={coverFor('n3')} title="Pricing sync" meta="Yesterday" end={<PalettePin pinned={false} label="Pin" />} /></div>
          </PaletteGroup>
        </div>
      </PaletteBody>
      <PaletteFoot icon="pin" action={<Button variant="primary" size="sm" onClick={done}>Done</Button>}>Pinned notes stay in the side panel, in the order you pin them.</PaletteFoot>
    </>
  );
}

const meta = {
  title: 'Components/Overlays/Sheet',
  component: Sheet,
  args: { open: true, label: 'Search or ask', className: 'pal', overlayClassName: 'pal-scrim', children: SEARCH, onOpenChange: did('onOpenChange') },
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

/** The palette, open over its own veil. Escape or the veil closes it; Search or ask opens it again. */
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
        <Sheet {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }}><Pinning done={close} /></Sheet>
      </>
    );
  }
};

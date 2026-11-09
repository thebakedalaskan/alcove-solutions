/*
 * Popover: a panel anchored to what opened it, 8px from it and kept 12px inside the window. A row's menu is an IconButton
 * as its anchor, with `tip` naming it on hover (the button's own title is turned off, so only one shows). `caret` points
 * it at the anchor, `side` and `align` place it, and `stage` is for the night of a call. Focus goes into it when it opens
 * and back to the anchor when it closes; PopoverClose closes it from inside, as each item here does.
 */
import { Icon, IconButton, Popover, PopoverClose, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Row, did, onStage } from '../../../src/component';

/** A menu item that closes the menu as it's pressed, as the app's menus do. */
function Item({ icon, title, detail }: { icon: IconName; title: string; detail?: string | undefined }) {
  return (
    <PopoverClose asChild>
      <button type="button" className="ac-pop-item" onClick={did(title)}>
        <Icon name={icon} size={18} /><span><b>{title}</b>{detail && <small>{detail}</small>}</span>
      </button>
    </PopoverClose>
  );
}

/** A note's More menu, as the note's page has it. */
const NOTE_MENU = (
  <>
    <Item icon="copy" title="Copy as text" />
    <div className="ac-pop-sep" />
    <Item icon="trash" title="Delete notes" detail="For everyone. Can’t be undone." />
  </>
);

/** The notes options in a call, on the night stage. */
const NOTES_OPTIONS = (
  <>
    <Item icon="pause" title="Pause notes" />
    <Item icon="notesPen" title="Turn notes off" />
    <Item icon="transcript" title="Open the transcript" />
  </>
);

/** What the seal says about the call, with an X in its head that closes it. */
const SEALED = (
  <div style={{ display: 'grid', gap: 4, width: 300, maxWidth: '100%', padding: '0 4px 10px 10px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="sealed" size={17} style={{ color: 'var(--sun-text)' }} />
      <b style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Confidential compute</b>
      <PopoverClose asChild><IconButton icon="x" size={16} label="Close" /></PopoverClose>
    </div>
    <p style={{ paddingRight: 8, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>Alcove encrypts stored notes and uses the call’s sharing permissions to decide who can open them.</p>
  </div>
);

const meta = {
  title: 'Components/Overlays/Popover',
  component: Popover,
  subcomponents: { PopoverClose },
  parameters: { layout: 'centered' },
  args: {
    open: true, label: 'More', side: 'bottom', align: 'start', caret: false, stage: false, takeFocus: true,
    anchor: <IconButton icon="more" label="More" title={undefined} />,
    children: NOTE_MENU,
    onOpenChange: did('onOpenChange')
  },
  argTypes: {
    side: { control: 'inline-radio', options: ['top', 'bottom'] },
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
    tip: { control: 'text' },
    className: { control: 'text' },
    anchor: { control: false }, children: { control: false }, onCloseFocus: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Popover {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />;
  }
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A note's More menu, open under its button. Pressing outside or Escape closes it; the button opens it again. */
export const Open: Story = {};
/** `caret` points it at its anchor, and keeps pointing there when the panel slides to stay in the window. */
export const WithACaret: Story = { name: 'With a caret', args: { caret: true } };
/** Hover the button: its `tip` says what it opens. Press it for the menu. */
export const WithATip: Story = {
  name: 'With a tip',
  args: { open: false, tip: 'More' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Row>
        <Popover {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} />
        <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Hover the button to see its tip.</p>
      </Row>
    );
  }
};
/** Above its anchor, lined up with the anchor's end: for a button low on the page or at the right of a row. */
export const AboveAtTheEnd: Story = { name: 'Above at the end', args: { side: 'top', align: 'end', caret: true } };
/** On the call's night stage: the notes options in a call. */
export const OnTheStage: Story = {
  name: 'On the stage',
  ...onStage,
  args: { stage: true, align: 'end', label: 'Notes options', anchor: <IconButton icon="more" label="Notes options" title={undefined} />, children: NOTES_OPTIONS }
};
/** PopoverClose closes it from inside: here, the X in its head. */
export const WithACloseButton: Story = {
  name: 'With a close button',
  args: { label: 'Confidential compute', caret: true, anchor: <IconButton icon="sealed" label="Confidential compute" title={undefined} />, children: SEALED }
};

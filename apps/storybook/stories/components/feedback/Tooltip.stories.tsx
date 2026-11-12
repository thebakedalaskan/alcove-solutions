/*
 * Tooltip: a short label over a control, shown on hover after a moment and straight away when the control is reached with
 * the keyboard. Tile and toolbar actions are icon buttons with a tooltip, not a text label; give the IconButton
 * `title={undefined}` so the browser's own title doesn't show as well. TooltipProvider sets the delay (300ms) and is
 * given by the app's root, as it is to every story here.
 */
import { IconButton, Tooltip, TooltipProvider } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import { Row } from '../../../src/component';

const Hint = ({ children }: { children: string }) => <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>{children}</p>;

const meta = {
  title: 'Components/Feedback/Tooltip',
  component: Tooltip,
  subcomponents: { TooltipProvider },
  parameters: { layout: 'centered' },
  args: { label: 'Copy link', side: 'top', children: <IconButton icon="copy" label="Copy link" title={undefined} /> },
  argTypes: { side: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] }, label: { control: 'text' }, children: { control: false } },
  render: (args) => <Row><Tooltip {...args} /><Hint>Hover the button to see its tooltip.</Hint></Row>
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Above the button, as most are. Hover the button to see it. */
export const Above: Story = {};
/** Below, for a button along the top of the window: the phone's top bar has Search or ask. Hover the button to see it. */
export const Below: Story = { args: { side: 'bottom', label: 'Search or ask', children: <IconButton icon="search" size={20} label="Search or ask" title={undefined} /> } };
/** Reached with the keyboard, it shows at once: here the button has focus as the story opens. */
export const WhenFocused: Story = {
  name: 'When focused',
  render: function Render(args) {
    const button = useRef<HTMLButtonElement>(null);
    useEffect(() => { button.current?.focus(); }, []);
    return (
      <Row>
        <Tooltip {...args}><IconButton ref={button} icon="copy" label="Copy link" title={undefined} /></Tooltip>
        <Hint>The button has focus, as if reached with Tab, so its tooltip shows.</Hint>
      </Row>
    );
  }
};

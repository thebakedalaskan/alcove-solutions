/*
 * SkyBar: the slim band of sky a page starts with when its job is to find something, as Calls has it: the title at the top
 * left, the one search in the middle (SkySearch), and the one filled button at the right. You stay at the top right, outside
 * the page. The search is set in Newsreader, because it's the page's hero: ⌘K until something's typed, then × and Ask,
 * tinted so the page keeps its one filled button. Someone it's narrowed to is a token before the words, with its own ×. On a
 * phone the title steps back for the phone's top bar and the search takes the width.
 */
import { Avatar, Button, Evening, IconButton, SkyBar, SkySearch } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { did } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';

/** The line, kept as it's typed. Enter asks. */
function Line({ start = '', asked = false, asking = false, token = false }: { start?: string; asked?: boolean; asking?: boolean; token?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(start);
  const [someone, setSomeone] = useState(token);
  return (
    <SkySearch inputRef={ref} value={text} placeholder="Search every call, or ask" maxLength={500} keyHint="⌘K" keyShortcuts="Meta+K" asked={asked} asking={asking}
      onChange={setText} onKeyDown={(e) => { if (e.key === 'Enter') did('ask')(text); }} onClear={() => { setText(''); ref.current?.focus(); }} onAsk={did('ask')}
      token={someone && <span className="cs-q-tok"><Avatar person={PRIYA} size={22} /><span>Priya</span><IconButton icon="x" size={14} label="Show everyone’s calls" onClick={() => setSomeone(false)} /></span>} />
  );
}

/** The sky the bar stands in, as Calls has it: just after sunset, with the page's gutters. */
function Sky({ line }: { line: Parameters<typeof Line>[0] }) {
  return (
    <Evening moment="calls" className="cs" style={{ '--page-x': 'clamp(28px, 3.4vw, 60px)', '--page-max': '1760px' }}>
      <SkyBar title="Calls" search={<Line {...line} />} action={<Button variant="primary" icon="cal" onClick={did('schedule a call')}>Schedule a call</Button>} />
    </Evening>
  );
}

const meta = {
  title: 'Components/Calls/SkyBar',
  component: SkyBar,
  parameters: { layout: 'fullscreen' },
  args: { title: 'Calls', search: null }
} satisfies Meta<typeof SkyBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed: the line says what it does, and ⌘K comes here. */
export const Empty: Story = { render: () => <Sky line={{}} /> };
/** Words typed: × clears them, and Ask asks every call. */
export const Typed: Story = { render: () => <Sky line={{ start: 'flag' }} /> };
/** Asked, and being answered: Ask waits. */
export const Asking: Story = { render: () => <Sky line={{ start: 'What did we decide about the launch?', asked: true, asking: true }} /> };
/** Narrowed to someone: their token before the words, with its own ×. */
export const WithSomeone: Story = { name: 'With someone', render: () => <Sky line={{ token: true }} /> };
export const Night: Story = { render: () => <Sky line={{ start: 'flag' }} />, globals: { theme: 'dark' } };
export const Phone: Story = { render: () => <Sky line={{}} />, globals: { viewport: { value: 'phone' } } };

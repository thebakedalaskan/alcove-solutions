/*
 * CallRow: a call on the Calls page, ahead or past, in fixed columns so things line up down the sheet: who (their faces, or
 * an arch with what it is), then its name with only what matters under it, then when, then its menu. Its name is its link and
 * covers the row; what you can press in it sits above that. Ahead: who's on it; an invitation or a request to move, in rose,
 * answered in place (CallReply, then CallAnswered); how others answered, quietly; No notes only on a call that won't write
 * them. Past: what it was about, how it came to you, and what waits on you from it (CallChip); found by a search, the line it
 * was said in, with a chip for each moment (MomentChip).
 */
import { Button, CallAnswered, CallChip, CallReply, CallRow, CallsGroup, CallsSheet, Dots, MomentChip, RowMenu, type LinkRender, type RowMenuItem } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { did } from '../../../src/component';
import { DIEGO, INES, JONAS, KOFI, MAYA, PRIYA } from '../../../src/world/people';

const stay = (e: { preventDefault: () => void }) => e.preventDefault();
/** A row's link, going nowhere here. */
const open: LinkRender = (p) => <a href="#call" {...p} onClick={stay} />;
/** A moment a search found: it opens the call there. */
const moment = (call: string, time: string) => <MomentChip key={time} time={time} label={`Open ${call} at ${time}`} link={(p) => <a href="#moment" {...p} onClick={stay} />} />;

/** ⋯ on a call ahead: what its kind allows. */
const AHEAD: RowMenuItem[] = [
  { id: 'move', label: 'Change the time', icon: 'cal', onSelect: did('change the time') },
  { id: 'copy', label: 'Copy link', icon: 'link', onSelect: did('copy link') },
  { id: 'cancel', label: 'Cancel this call', icon: 'trash', tone: 'caution', separatorBefore: true, onSelect: did('cancel') }
];
/** ⋯ on a call that happened. */
const PAST: RowMenuItem[] = [
  { id: 'again', label: 'Meet again', icon: 'cal', onSelect: did('meet again') },
  { id: 'share', label: 'Share the notes', icon: 'share', onSelect: did('share the notes') }
];

/** A call's menu, opening when pressed. */
function Menu({ call, items }: { call: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return <RowMenu label={`More for ${call}`} open={open} onOpenChange={setOpen} items={items.map((m) => ({ ...m, onSelect: () => { m.onSelect?.(); setOpen(false); } }))} />;
}

/** The sheet the rows sit on, under a group's name, at a laptop's width. */
function Sheet({ label, soon = false, children }: { label: string; soon?: boolean; children: ReactNode }) {
  return (
    <div style={{ width: 820, maxWidth: '100%' }}>
      <CallsSheet label="Calls"><CallsGroup label={label} soon={soon}>{children}</CallsGroup></CallsSheet>
    </div>
  );
}

const meta = {
  title: 'Components/Calls/CallRow',
  component: CallRow,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof CallRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One call ahead: who's on it, then when in sun, and its menu. The name is the row's link. */
export const Ahead: Story = {
  args: {
    who: { faces: [PRIYA, KOFI] }, title: 'Design sync', open, line: 'Priya, Kofi and you', when: { at: '17:30', length: '30 min' }, soon: true,
    menu: <Menu call="Design sync" items={AHEAD} />
  },
  render: (args) => <Sheet label="Later today" soon><CallRow {...args} /></Sheet>
};

/**
 * What a call ahead can say, one thing each: a meeting from your calendar (its name steps back, and it opens there); how others
 * answered, quietly; a call that won't write notes; a call waiting for a guest to pick a time (no time yet, the times quietly);
 * a series' call; and one scheduled a moment ago, lit once.
 */
export const KindsAhead: Story = {
  name: 'Kinds ahead',
  args: Ahead.args,
  render: () => (
    <Sheet label="Tomorrow" soon>
      <CallRow who={{ arch: 'cal' }} title="Harbourline weekly" open={open} muted soon tag={{ icon: 'cal', text: 'From your calendar · Google Meet' }} line="Diego and you"
        when={{ at: '18:00', length: '30 min' }} menu={<Menu call="Harbourline weekly" items={[{ id: 'open', label: 'Open in Google Calendar', icon: 'external', href: '#calendar' }]} />} />
      <CallRow who={{ faces: [PRIYA, KOFI, MAYA] }} title="Roadmap review" open={open} soon line="Priya, Kofi, Maya and you" quiet="2 going · Maya hasn’t answered"
        when={{ at: '10:00', length: '45 min' }} menu={<Menu call="Roadmap review" items={AHEAD} />} />
      <CallRow who={{ faces: [MAYA] }} title="1:1 with Maya" open={open} soon line="Maya and you" notesOff when={{ at: '15:30', length: '30 min' }} menu={<Menu call="1:1 with Maya" items={AHEAD} />} />
      <CallRow who={{ arch: 'clock' }} title="Portfolio follow-up" open={open} line="Jonas and you" quiet="Jonas picks from Thu 10:00, Thu 14:00 or Fri 11:00"
        when={{ at: '', length: '45 min' }} menu={<Menu call="Portfolio follow-up" items={AHEAD} />} />
      <CallRow who={{ faces: [PRIYA, KOFI, MAYA] }} title="Team standup" open={open} soon tag={{ icon: 'repeat', text: 'Every weekday' }} line="Priya, Kofi, Maya and you"
        when={{ at: '09:00', length: '20 min' }} menu={<Menu call="Team standup" items={AHEAD} />} />
      <CallRow who={{ faces: [DIEGO] }} title="Supplier check-in" open={open} soon fresh note={{ text: 'Just scheduled', tone: 'sun' }} line="Diego and you"
        when={{ at: '11:00', length: '30 min' }} menu={<Menu call="Supplier check-in" items={AHEAD} />} />
    </Sheet>
  )
};

/** Someone invited you: it waits on you, in rose, with Yes, Maybe and No as equal buttons. */
export const AnInvitation: Story = {
  name: 'An invitation',
  args: {
    who: { faces: [PRIYA, KOFI, MAYA] }, title: 'Roadmap review', open, soon: true, line: 'Priya, Kofi, Maya and you', note: { text: 'Priya invited you', tone: 'rose' },
    reply: (
      <CallReply label="Are you going to Roadmap review?">
        <Button size="xs" onClick={did('yes')}>Yes</Button><Button size="xs" onClick={did('maybe')}>Maybe</Button><Button size="xs" onClick={did('no')}>No</Button>
      </CallReply>
    ),
    when: { at: '10:00', length: '45 min' }, menu: <Menu call="Roadmap review" items={[{ id: 'propose', label: 'Propose another time', icon: 'cal', onSelect: did('propose') }]} />
  },
  render: (args) => <Sheet label="Tomorrow" soon><CallRow {...args} /></Sheet>
};

/** After Yes: what you said, with Change to open the answers again. */
export const Answered: Story = {
  args: {
    ...AnInvitation.args, note: undefined,
    reply: <CallAnswered change={did('change')} changeLabel="Change your answer to Roadmap review">You’re going</CallAnswered>
  },
  render: (args) => <Sheet label="Tomorrow" soon><CallRow {...args} /></Sheet>
};

/** Someone invited asks to move your call: Move it, or Keep its time. */
export const ARequestToMove: Story = {
  name: 'A request to move',
  args: {
    who: { faces: [PRIYA, DIEGO] }, title: 'Harbourline proposal', open, soon: true, line: 'Priya, Diego and you', note: { text: 'Diego asks to move it to 14:00', tone: 'rose' },
    reply: (
      <CallReply label="Diego asks to move Harbourline proposal">
        <Button size="xs" onClick={did('move it')}>Move it</Button><Button size="xs" onClick={did('keep')}>Keep 11:00</Button>
      </CallReply>
    ),
    when: { at: '11:00', length: '45 min' }, menu: <Menu call="Harbourline proposal" items={AHEAD} />
  },
  render: (args) => <Sheet label="Tomorrow" soon><CallRow {...args} /></Sheet>
};

/** A call that happened: what it was about in a line, what waits on you from it, pinned, and when it was. */
export const Past: Story = {
  args: {
    who: { faces: [INES] }, title: 'Art’s call', open, gist: 'Orders before the move ship from the old warehouse, and the movers come first.',
    chips: <><CallChip kind="decide">1 to confirm</CallChip><CallChip kind="follow">3 follow-ups</CallChip></>,
    pinned: true, when: { at: '11:58', length: '14 min' }, menu: <Menu call="Art’s call" items={PAST} />
  },
  render: (args) => <Sheet label="Earlier today"><CallRow {...args} /></Sheet>
};

/** What a call that happened can say: how it came to you, recorded in the room, still recording, and notes being written. */
export const KindsPast: Story = {
  name: 'Kinds past',
  args: Past.args,
  render: () => (
    <Sheet label="Earlier this week">
      <CallRow who={{ faces: [MAYA, KOFI] }} title="Pricing sync" open={open} tag={{ icon: 'share', text: 'Shared by Maya' }}
        gist="Keep the monthly option behind a flag until the pricing page is ready." when={{ at: 'Tue', length: '32 min' }} menu={<Menu call="Pricing sync" items={PAST} />} />
      <CallRow who={{ arch: 'mic' }} title="Site visit, Harbourline" open={open} tag={{ icon: 'mic', text: 'In the room, only you' }}
        gist="The loading bay takes two trucks at once, so deliveries can double up." when={{ at: 'Mon', length: '48 min' }} menu={<Menu call="Site visit, Harbourline" items={PAST} />} />
      <CallRow who={{ arch: 'mic' }} title="Harbourline walkthrough" open={open} tag={{ icon: 'mic', text: 'In the room, only you' }} gist="Recording now."
        chips={<CallChip kind="rec">Still recording</CallChip>} when={{ at: '16:02', length: '1 min' }} />
      <CallRow who={{ faces: [PRIYA, JONAS] }} title="Pricing follow-up" open={open} gist="The summary, decisions and follow-ups show here once they’re written."
        chips={<CallChip kind="writing"><Dots />Being written</CallChip>} when={{ at: '15:40', length: '26 min' }} menu={<Menu call="Pricing follow-up" items={PAST} />} />
    </Sheet>
  )
};

/** Found by a search: the line it was said in, with who said it and the words marked, and a chip for each moment. */
export const FoundByASearch: Story = {
  name: 'Found by a search',
  args: {
    who: { faces: [MAYA, KOFI] }, title: 'Pricing sync', open,
    quote: <>“Keep the monthly option behind a <mark>flag</mark> until the pricing page is ready.”<small> Maya</small></>,
    chips: <>{moment('Pricing sync', '28:15')}{moment('Pricing sync', '31:02')}</>,
    when: { at: 'Tue', length: '32 min' }, menu: <Menu call="Pricing sync" items={PAST} />
  },
  render: (args) => <Sheet label="Yesterday"><CallRow {...args} /></Sheet>
};

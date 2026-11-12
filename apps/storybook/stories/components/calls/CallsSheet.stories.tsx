/*
 * CallsSheet: what a place opens, beside the rail, on the page's surface. Its head (SheetHead) says what's on it in Newsreader,
 * with a line under that when there's something to say and what you can do with all of it at its right. The calls come in
 * groups (CallsGroup), each under its name on a hairline, in sun while they're still to come, with what else there is under
 * the last row (CallsMore). Asking every call puts the answer at the top (CallsAnswer): where it was read and from how many
 * calls, the answer, and a chip for each moment it comes from. A series' sheet ends with what carries over from call to call
 * (CarryRow): a question, a follow-up with the tick box that settles it, a decision, each with where it was said.
 */
import { Button, CallRow, CallsAnswer, CallsGroup, CallsMore, CallsSheet, CarryRow, Check, Dots, Icon, MomentChip, Segmented, SheetHead, type LinkRender } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { did } from '../../../src/component';
import { KOFI, MAYA, PRIYA } from '../../../src/world/people';

const stay = (e: { preventDefault: () => void }) => e.preventDefault();
const to = (where: string): LinkRender => (p) => <a href={`#${where}`} {...p} onClick={stay} />;
const moment = (time: string, label: string) => <MomentChip key={time} time={time} label={label} link={to('moment')} />;

/** The sheet at a laptop's width. */
const Frame = ({ children }: { children: ReactNode }) => <div style={{ width: 820, maxWidth: '100%' }}><CallsSheet label="Your calls">{children}</CallsSheet></div>;

/** List or week, at the head's right. */
function Toggle() {
  const [view, setView] = useState<'list' | 'week'>('list');
  return (
    <Segmented className="cs-view" label="Show as" value={view} onChange={setView}
      options={[{ value: 'list', label: <span className="cs-vl">List</span>, icon: 'list' }, { value: 'week', label: <span className="cs-vl">Week</span>, icon: 'cal' }]} />
  );
}

const meta = {
  title: 'Components/Calls/CallsSheet',
  component: CallsSheet,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof CallsSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** All calls: the head with List and Week, later today in sun, and Show more coming up under the last row. */
export const AllCalls: Story = {
  name: 'All calls',
  args: { label: 'Your calls', children: null },
  render: () => (
    <Frame>
      <SheetHead title="All calls" actions={<Toggle />} />
      <CallsGroup label="Later today" soon more={<CallsMore link={to('soon')}>Show 6 more coming up</CallsMore>}>
        <CallRow who={{ faces: [PRIYA, KOFI] }} title="Design sync" open={to('call')} soon line="Priya, Kofi and you" when={{ at: '17:30', length: '30 min' }} />
      </CallsGroup>
      <CallsGroup label="Earlier today">
        <CallRow who={{ faces: [MAYA, KOFI] }} title="Pricing sync" open={to('call')} gist="Keep the monthly option behind a flag until the pricing page is ready." when={{ at: '11:00', length: '32 min' }} />
      </CallsGroup>
    </Frame>
  )
};

/** A head with a line under it: a series, and what you can do with all of it. */
export const AHeadWithALine: Story = {
  name: 'A head with a line',
  args: AllCalls.args,
  render: () => (
    <Frame>
      <SheetHead title="Team standup" sub="Every weekday at 09:00 · 12 calls" actions={<Button size="sm" icon="cal" onClick={did('change the series')}>Change the series</Button>} />
    </Frame>
  )
};

/** Asking every call: read in confidential compute, the answer, and a chip for each moment it comes from. */
export const AnAnswer: Story = {
  name: 'An answer',
  args: AllCalls.args,
  render: () => (
    <Frame>
      <SheetHead title="Asked across every call" />
      <CallsAnswer sealed="Read in confidential compute, from 2 calls" onClose={did('put away')}
        cites={<>{moment('Team standup · 1:48', 'Open Team standup at 1:48')}{moment('Pricing sync · 28:15', 'Open Pricing sync at 28:15')}</>}>
        The launch is on 12 November, with the new onboarding behind a flag. The monthly option stays behind its own flag until the pricing page is ready.
      </CallsAnswer>
    </Frame>
  )
};

/** While it's read: dots, and nothing to press but ×. */
export const Reading: Story = {
  args: AllCalls.args,
  render: () => (
    <Frame>
      <SheetHead title="Asked across every call" />
      <CallsAnswer sealed="Reading your calls" reading onClose={did('put away')}><Dots />Reading every call you have, in confidential compute</CallsAnswer>
    </Frame>
  )
};

/** What a series carries over: a question still open, a follow-up to tick, one done since, a decision, and one a later call replaced. */
function Carried() {
  const [done, setDone] = useState(false);
  const from = (time: string) => moment(time, `Open Team standup, Tue, at ${time}`);
  return (
    <Frame>
      <CallsGroup label="What carries over">
        <CarryRow kind="ask" sub={<>Still open, 2 calls later{from('4:12')}</>} actions={<Button size="xs" onClick={did('it was answered')}>It was answered</Button>}>
          Who signs off the help article before it goes out?
        </CarryRow>
        <CarryRow kind="follow" done={done} mark={<Check checked={done} onChange={setDone} label={`${done ? 'Mark not done' : 'Mark done'}: Send the help article to support`} />}
          sub={<>{done ? 'Done since the last call' : 'Yours, due Friday'}{from('6:40')}</>}>
          Send the help article to support
        </CarryRow>
        <CarryRow kind="follow" sub={<>Suggested for you{from('9:05')}</>} actions={<Button size="xs" onClick={did('take it on')}>I’ll do it</Button>}>
          List which suppliers move with us
        </CarryRow>
        <CarryRow kind="decide" sub={<>Confirmed by Priya{from('2:30')}</>}>The new onboarding ships behind a flag on 12 November</CarryRow>
        <CarryRow kind="decide" done sub={<>No longer holds{from('11:20')}</>}
          later={<span className="carry-later"><Icon name="swap" size={13} /><span>Replaced on Wed: the monthly option waits for the new pricing page</span></span>}
          actions={<Button variant="quiet" size="xs" onClick={did('it still holds')}>It still holds</Button>}>
          The team plan gets a monthly option
        </CarryRow>
      </CallsGroup>
    </Frame>
  );
}
export const WhatCarriesOver: Story = { name: 'What carries over', args: AllCalls.args, render: () => <Carried /> };

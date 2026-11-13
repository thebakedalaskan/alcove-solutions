/*
 * The scheduler's editor (components/scheduler.tsx): the column beside the week on Calls while a call is scheduled, moved or
 * asked to move. A property list with two edges: the kicker, the title, the hairlines and the foot on the outer edge, every
 * value on the inner one, each row an icon in its column and its value, the lines that carry on a row starting on the inner
 * edge. Anything pressable keeps its text on the edge and lets its hover reach past it. Here on made-up data, with nothing
 * behind the buttons; the page itself is Pages/Scheduling.
 */
import {
  Avatar, Button, Faces, GhostArch, Icon, PersonToken, SchedAsk, SchedChoice, SchedDoc, SchedField, SchedFoot, SchedGroup, SchedLine, SchedListHead, SchedListNote, SchedName,
  SchedOffer, SchedPanel, SchedPersonOption, SchedPop, SchedQuiet, SchedRow, SchedSwitch, SchedTimes, SchedTitle, SchedValue, Select, type SchedTime
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { PopSurface, did } from '../../../src/component';
import { AIKO, INES, JONAS, KOFI, PRIYA } from '../../../src/world/people';

/** The sheet the editor stands on, as tall as a laptop's page under the sky. */
function Sheet({ children }: { children: ReactNode }) {
  return <div className="sc-sheet" style={{ margin: 0, width: 'min(356px, 100%)', height: 760, gridTemplateColumns: 'minmax(0, 1fr)' }}>{children}</div>;
}

/** The time, as When shows it: the start and end to press, and how long, quietly. */
function Time({ start, end, length }: { start: string; end: string; length: string }) {
  return (
    <SchedRow icon="clock">
      <input className="sc-in" aria-label="Starts" defaultValue={start} />
      <span className="sc-dash" aria-hidden="true">–</span>
      <input className="sc-in" aria-label="Ends" defaultValue={end} />
      <span className="sc-len">{length}</span>
    </SchedRow>
  );
}

function Details() {
  const [notes, setNotes] = useState(true);
  return (
    <SchedGroup label="Details">
      <SchedRow icon="notes" rec={notes}><SchedSwitch title="Notes" tip="Everyone invited gets the notes" checked={notes} onChange={setNotes} /></SchedRow>
      {notes && <SchedRow><SchedQuiet chevron aria-expanded={false} onClick={did('onWhatTheyKeep')}>What the notes keep</SchedQuiet></SchedRow>}
      <SchedRow icon="fileText"><SchedQuiet onClick={did('onAgenda')}>Add an agenda</SchedQuiet></SchedRow>
    </SchedGroup>
  );
}

const meta = {
  title: 'Components/Starting a call/Scheduler',
  component: SchedPanel,
  parameters: { layout: 'centered', controls: { disable: true } },
  args: { kicker: 'New call', label: 'Schedule a call', onClose: did('onClose'), children: null }
} satisfies Meta<typeof SchedPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A new call, with Priya and Kofi in: the soonest time they're all free, how it repeats, notes and an agenda, then the foot. */
export const ANewCall: Story = {
  name: 'A new call',
  render: () => (
    <Sheet>
      <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')} foot={(
        <SchedFoot line="Google Calendar invites Priya and Kofi.">
          <Button variant="quiet" onClick={did('onCancel')}>Cancel</Button>
          <Button variant="primary" onClick={did('onSchedule')}>Schedule</Button>
        </SchedFoot>
      )}>
        <SchedTitle value="Call with Priya and Kofi" placeholder="Add a title" label="The call’s name" onChange={did('onTitle')} />
        <SchedGroup label="Who">
          <SchedRow icon="people">
            <SchedField>
              <PersonToken people={[PRIYA]} label="Priya" onRemove={did('onRemove')} />
              <PersonToken people={[KOFI]} label="Kofi" onRemove={did('onRemove')} />
              <input aria-label="Add people" placeholder="Add someone" />
            </SchedField>
          </SchedRow>
        </SchedGroup>
        <SchedGroup label="When">
          <SchedRow icon="cal"><SchedValue chevron quiet="Today" aria-label="Day, Thursday 12 November. Pick another">Thu 12 Nov</SchedValue></SchedRow>
          <Time start="16:00" end="16:45" length="45 min" />
          <SchedLine>The soonest time you’re all free</SchedLine>
          <SchedRow icon="repeat"><SchedQuiet chevron>Doesn’t repeat</SchedQuiet></SchedRow>
        </SchedGroup>
        <Details />
      </SchedPanel>
    </Sheet>
  )
};
export const ANewCallNight: Story = { ...ANewCall, name: 'A new call, at night', globals: { theme: 'dark' } };
export const ANewCallPhone: Story = { ...ANewCall, name: 'A new call, on a phone', globals: { viewport: { value: 'phone', isRotated: false } } };

/** Nobody in yet: Add a title, Add people, and the soonest time you're free. */
export const NobodyYet: Story = {
  name: 'Nobody yet',
  render: () => (
    <Sheet>
      <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')} foot={(
        <SchedFoot line="You’ll get a link to share.">
          <Button variant="quiet" onClick={did('onCancel')}>Cancel</Button>
          <Button variant="primary" onClick={did('onSchedule')}>Schedule</Button>
        </SchedFoot>
      )}>
        <SchedTitle value="" placeholder="Add a title" label="The call’s name" onChange={did('onTitle')} />
        <SchedGroup label="Who"><SchedRow icon="people"><SchedField><input aria-label="Add people" placeholder="Add people" /></SchedField></SchedRow></SchedGroup>
        <SchedGroup label="When">
          <SchedRow icon="cal"><SchedValue chevron quiet="Today" aria-label="Day, Thursday 12 November. Pick another">Thu 12 Nov</SchedValue></SchedRow>
          <Time start="11:30" end="12:15" length="45 min" />
          <SchedRow icon="repeat"><SchedQuiet chevron>Doesn’t repeat</SchedQuiet></SchedRow>
        </SchedGroup>
        <Details />
      </SchedPanel>
    </Sheet>
  )
};

/** A clash, in caution, with the next time everyone's free in horizon; a time that stops at midnight says so. */
export const Lines: Story = {
  render: () => (
    <Sheet>
      <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')}>
        <SchedGroup label="When">
          <Time start="14:00" end="14:45" length="45 min" />
          <SchedLine tone="caution" action={{ label: 'Next free: 16:00', onClick: did('onNextFree') }}>Priya is busy then</SchedLine>
          <Time start="23:00" end="24:00" length="1 h" />
          <SchedLine tone="quiet">It stops at midnight: a call ends on the day it starts.</SchedLine>
          <SchedLine action={{ label: 'Move it there', onClick: did('onMoveThere') }}>Aiko asked for Fri 11:00</SchedLine>
          <SchedLine tone="quiet" action={{ label: 'Connect Google Calendar', href: '#connect' }}>Only your Alcove calls are known without a calendar.</SchedLine>
        </SchedGroup>
      </SchedPanel>
    </Sheet>
  )
};

/**
 * Letting Jonas pick: the switch with its line inside it, then the three times offered, numbered, the active one ringed in sun
 * (the week moves it), one left out struck through; two at least stay ticked. What Jonas's clock says then is at each end.
 */
export const LettingAGuestPick: Story = {
  name: 'Letting a guest pick',
  render: function Render() {
    const [active, setActive] = useState(1);
    const [on, setOn] = useState([true, true, false]);
    const ticked = on.filter(Boolean).length;
    const times = [['Today', '11:30', '12:30'], ['Tomorrow', '15:00', '16:00'], ['Mon 16 Nov', '11:30', '12:30']] as const;
    return (
      <Sheet>
        <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')} foot={(
          <SchedFoot line="Your calendar holds the times until Jonas picks.">
            <Button variant="quiet" onClick={did('onCancel')}>Cancel</Button>
            <Button variant="primary" onClick={did('onSend')}>Send Jonas the times</Button>
          </SchedFoot>
        )}>
          <SchedTitle value="Call with Jonas" placeholder="Add a title" label="The call’s name" onChange={did('onTitle')} />
          <SchedGroup label="Who">
            <SchedRow icon="people">
              <SchedField>
                <PersonToken people={[JONAS]} label="Jonas" onRemove={did('onRemove')} place={<button type="button" className="sc-where" aria-label="Where Jonas is: Berlin">Berlin</button>} />
                <input aria-label="Add people" placeholder="Add someone" />
              </SchedField>
            </SchedRow>
            <SchedRow><SchedSwitch title="Let Jonas pick the time" line="You can’t see Jonas’s calendar." checked onChange={did('onPick')} /></SchedRow>
          </SchedGroup>
          <SchedGroup label="When">
            <SchedRow icon="cal" top>
              <div className="sc-opts" role="group" aria-label="Times to offer">
                {times.map(([day, from, to], i) => (
                  <SchedOffer key={day} n={i + 1} day={day} time={`${from} – ${to}`} said={`${day}, ${from} to ${to}`} side={i === 0 ? undefined : `${String(Number(from.slice(0, 2)) + 1)}${from.slice(2)} for Jonas`}
                    clash={i === 0 ? 'Design review' : undefined} active={i === active} on={on[i] ?? false} lock={(on[i] ?? false) && ticked <= 2}
                    onSelect={() => setActive(i)} onTick={() => setOn(on.map((x, k) => (k === i ? !x : x)))} />
                ))}
              </div>
            </SchedRow>
            <SchedLine tone="quiet">Press the week to move time {active + 1}.</SchedLine>
            <SchedRow icon="clock"><SchedQuiet chevron>1 h each</SchedQuiet></SchedRow>
          </SchedGroup>
        </SchedPanel>
      </Sheet>
    );
  }
};
export const LettingAGuestPickNight: Story = { ...LettingAGuestPick, name: 'Letting a guest pick, at night', globals: { theme: 'dark' } };

/**
 * Moving a call: its name fixed, where it was struck through once the time has changed, who's on it with their answers, and
 * Cancel this call at the foot's start, which asks once, in place. There's no quiet Cancel beside the button: × closes it,
 * and a second Cancel would read as the same thing.
 */
export const MovingACall: Story = {
  name: 'Moving a call',
  render: function Render() {
    const [asking, setAsking] = useState(true);
    return (
      <Sheet>
        <SchedPanel kicker="Move a call" label="Move Hiring sync" onClose={did('onClose')} foot={(
          <SchedFoot line="Google Calendar tells Ines and Aiko."
            notice={asking && (
              <SchedAsk label="Cancel this call" actions={<><Button variant="quiet" size="sm" onClick={() => setAsking(false)}>Keep it</Button><Button size="sm" onClick={did('onCancelCall')}>Cancel the call</Button></>}>
                Cancel this call? It comes off your calendar, and everyone invited is told.
              </SchedAsk>
            )}
            lead={asking ? undefined : <Button variant="quiet" size="sm" icon="trash" className="sc-cancel" onClick={() => setAsking(true)}>Cancel this call</Button>}>
            <Button variant="primary" onClick={did('onMove')}>Move to tomorrow 15:30</Button>
          </SchedFoot>
        )}>
          <SchedName title="Hiring sync" was="Thu 5 Nov, 10:00 – 10:45" />
          <SchedGroup label="Who">
            <SchedRow icon="people">
              <SchedField fixed>
                <PersonToken people={[INES]} label="Ines" state="Going" />
                <PersonToken people={[AIKO]} label="Aiko" state="No answer yet" />
              </SchedField>
            </SchedRow>
          </SchedGroup>
          <SchedGroup label="When">
            <SchedRow icon="cal"><SchedValue chevron quiet="Tomorrow" aria-label="Day, Friday 13 November. Pick another">Fri 13 Nov</SchedValue></SchedRow>
            <Time start="15:30" end="16:15" length="45 min" />
            <SchedLine>You’re all free</SchedLine>
          </SchedGroup>
        </SchedPanel>
      </Sheet>
    );
  }
};

/** The switch that's a whole row: off, on, and with its line inside it. */
export const Switches: Story = {
  render: function Render() {
    const [a, setA] = useState(false);
    const [b, setB] = useState(true);
    return (
      <Sheet>
        <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')}>
          <SchedGroup label="Details">
            <SchedRow icon="notes" rec={b}><SchedSwitch title="Notes" tip="Everyone invited gets the notes" checked={b} onChange={setB} /></SchedRow>
            <SchedRow><SchedSwitch title="Keep the transcript" line="Who said what, and anyone invited can correct it" checked={a} onChange={setA} /></SchedRow>
            <SchedRow icon="megaphone"><SchedSwitch title="Everyone joins muted" line="Microphones and cameras off, for a call this big" checked onChange={did('onMuted')} /></SchedRow>
            <SchedRow icon="fileText"><SchedQuiet>Add an agenda</SchedQuiet></SchedRow>
            <SchedRow flush>
              <span className="sc-docs" role="list" aria-label="What the call brings">
                <span role="listitem"><SchedDoc icon="fileText" name="Hiring plan" removeLabel="Take Hiring plan off" onRemove={did('onRemove')} /></span>
                <span role="listitem"><SchedDoc icon="stickyNote" name="Onboarding board" removeLabel="Take Onboarding board off" onRemove={did('onRemove')} /></span>
              </span>
            </SchedRow>
          </SchedGroup>
        </SchedPanel>
      </Sheet>
    );
  }
};

/**
 * What the notes keep, opened in place under Notes: a switch row for each, then Where they go, shaped like a switch's row with a
 * Select at its end (`SchedChoice`), and how the notes are written.
 */
export const WhatTheNotesKeep: Story = {
  name: 'What the notes keep',
  render: function Render() {
    const [home, setHome] = useState('new');
    const [recording, setRecording] = useState(false);
    return (
      <Sheet>
        <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')}>
          <SchedGroup label="Details">
            <SchedRow icon="notes" rec><SchedSwitch title="Notes" tip="Everyone invited gets the notes" checked onChange={did('onNotes')} /></SchedRow>
            <SchedRow><SchedQuiet chevron aria-expanded onClick={did('onWhatTheyKeep')}>What the notes keep</SchedQuiet></SchedRow>
            <div className="sc-keep">
              <SchedRow><SchedSwitch title="Keep the transcript" line="Who said what, and anyone invited can correct it" checked onChange={did('onTranscript')} /></SchedRow>
              <SchedRow>
                <SchedSwitch title="Keep the recording" line={recording ? 'Play back any moment from the notes' : 'Deleted when the call ends'} checked={recording} onChange={setRecording} />
              </SchedRow>
              <SchedRow><SchedSwitch title="Read shared screens" line="Whoever shares is asked whether it goes in the notes" checked onChange={did('onScreens')} /></SchedRow>
              <SchedRow>
                <SchedChoice title="Where they go" line={home === 'new' ? 'Everyone invited is in it' : 'In a folder of their own'}>
                  <Select label="Where the notes go" value={home} align="end" onChange={setHome}
                    options={[{ value: 'new', label: 'A new workspace', icon: 'plus' }, { value: 'launch', label: 'Launch', icon: 'folders' }, { value: 'design', label: 'Design', icon: 'folders' }]} />
                </SchedChoice>
              </SchedRow>
              <SchedLine tone="quiet"><Icon name="sealed" size={14} />Written by an AI model in confidential compute.</SchedLine>
            </div>
          </SchedGroup>
        </SchedPanel>
      </Sheet>
    );
  }
};

/** Who, pressed: the people under the field in a popover that leaves the field its focus (`SchedPop`), headed by what they are. */
function Who({ typed = '', head, children }: { typed?: string | undefined; head: string; children: ReactNode }) {
  /* As wide as the editor beside the week, however little is in it. */
  return (
    <div style={{ width: 356, maxWidth: '100%' }}>
      <Sheet>
        <SchedPanel kicker="New call" label="Schedule a call" onClose={did('onClose')}>
          <SchedGroup label="Who">
            <SchedRow icon="people">
              <SchedPop open onClose={did('onClose')} label="People to add" className="is-people"
                anchor={<SchedField open><input aria-label="Add people" placeholder="Add people" defaultValue={typed} /></SchedField>}>
                <SchedListHead>{head}</SchedListHead>
                {children}
              </SchedPop>
            </SchedRow>
          </SchedGroup>
        </SchedPanel>
      </Sheet>
    </div>
  );
}

/**
 * The people under Who, before anything's typed: Often with you, each a face in its column (a group two of its faces, the
 * company its building), the name, what they do, and +. The arrows have lit Priya, so Enter adds her.
 */
export const PeopleToAdd: Story = {
  name: 'People to add',
  render: () => (
    <Who head="Often with you">
      <div role="listbox" aria-label="People to add">
        <SchedPersonOption id="pp-priya" face={<Avatar person={PRIYA} size={26} />} title="Priya Raman" sub="Product" lit onPick={did('onPick')} />
        <SchedPersonOption id="pp-kofi" face={<Avatar person={KOFI} size={26} />} title="Kofi Asante" sub="Design lead" lit={false} onPick={did('onPick')} />
        <SchedPersonOption id="pp-leads" face={<Faces people={[PRIYA, KOFI]} size={24} max={2} />} title="Leads" sub="Group · 3 people" lit={false} onPick={did('onPick')} />
        <SchedPersonOption id="pp-everyone" face={<span className="sc-tile"><Icon name="building" size={16} /></span>} title="Everyone at Vandelay" sub="30 people" lit={false} onPick={did('onPick')} />
      </div>
    </Who>
  )
};
/** An address typed that nobody has yet: People and groups, with the address itself first, lit, and an empty arch for its face. */
export const AnAddressTyped: Story = {
  name: 'An address typed',
  render: () => (
    <Who typed="jonas@weber.design" head="People and groups">
      <div role="listbox" aria-label="People to add">
        <SchedPersonOption id="pp-jonas" face={<GhostArch size={24} initial="jonas@weber.design" />} title="jonas@weber.design" sub="New to you" lit onPick={did('onPick')} />
      </div>
    </Who>
  )
};
/** A name nobody has: nothing to list, and the words for that under the head (`SchedListNote`). */
export const NobodyByThatName: Story = {
  name: 'Nobody by that name',
  render: () => (
    <Who typed="Odile" head="People and groups">
      <div role="listbox" aria-label="People to add" />
      <SchedListNote>Nobody by that name yet. Type their full email address to add them.</SchedListNote>
    </Who>
  )
};

const pad = (n: number) => String(n).padStart(2, '0');
const STARTS: SchedTime[] = Array.from({ length: 96 }, (_, i) => ({ value: `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`, label: `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`, gone: i < 45 }));
const ENDS: SchedTime[] = [15, 30, 45, 60, 75, 90, 105, 120].map((l) => ({ value: String(l), label: `${pad(11 + Math.floor((30 + l) / 60))}:${pad((30 + l) % 60)}`, note: l < 60 ? `${l} min` : l % 60 ? `${Math.floor(l / 60)} h ${l % 60} min` : `${l / 60} h` }));

/** A start's list: every quarter hour, those gone greyed, the one picked in the middle. */
export const Starts: Story = {
  render: () => <PopSurface className="sc-pop is-list" width={172}><SchedTimes label="Starts" options={STARTS} value="11:30" onPick={did('onPick')} /></PopSurface>
};
/** An end's list: from a quarter hour after the start, each with the length it makes. */
export const Ends: Story = {
  render: () => <PopSurface className="sc-pop is-list" width={172}><SchedTimes label="Ends" options={ENDS} value="45" onPick={did('onPick')} /></PopSurface>
};

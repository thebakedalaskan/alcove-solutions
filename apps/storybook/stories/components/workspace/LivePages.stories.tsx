/*
 * The call's own pages, at the top of the workspace's list while the call goes on. Notes (WsNotesPage) are written as
 * people talk: the summary, what's been decided (a time opens the transcript there, an arrow adds the line to the
 * document you were last in) and the first follow-ups. Follow-ups (WsFollowUps) has everything to do from the call,
 * everyone's or yours, ticked by anyone, with a line to add one. Transcript (WsTranscript) is the call so far, what's
 * being said at the end, and a field to find a line. With notes off the three pages stay and say so (WsNotesOff). After
 * the call, the note says which documents were worked on (WsWorkedOn).
 */
import { WsDoc, WsDocHead, WsFollowUps, WsNotesOff, WsNotesPage, WsPane, WsScroll, WsToasts, WsTranscript, WsWorkedOn, wsToast, type WsFollowUp, type WsSave } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Box, did } from '../../../src/component';
import { ART } from '../../../src/world/people';
import { CALL, DECIDED, FOLLOW_UPS, LINES, NotesLive, SPEAKING, SUMMARY, first, useToasts } from './parts';

/**
 * One of the call's pages in the document's place: its head says where it is, and Live while notes are on. `end`: it
 * keeps to its last line, as a transcript does while people talk.
 */
function LiveFrame({ name, save = 'live', end = false, children }: { name: string; save?: WsSave | undefined; end?: boolean | undefined; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = scroller.current; if (end && el) el.scrollTop = el.scrollHeight; }, [end]);
  return (
    <Box width="100%" height={600}>
      <WsPane>
        <WsDoc>
          <WsDocHead crumbs={[CALL.title, name]} save={save} onToggleList={did('onToggleList')} zen={false} onZen={did('onZen')} />
          <WsScroll ref={scroller}>{children}</WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}

const meta = {
  title: 'Components/Workspace/Live pages',
  component: WsNotesPage,
  subcomponents: { WsFollowUps, WsTranscript, WsNotesOff, WsWorkedOn },
  parameters: { layout: 'padded' }
} satisfies Meta<typeof WsNotesPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- notes ---------- */

/** The notes page with its follow-ups ticking as you press them. */
function Notes(args: ComponentProps<typeof WsNotesPage>) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set(args.followUps.filter((f) => f.done).map((f) => f.id)));
  const tick = (id: string) => { args.onTick(id); setDone((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; }); };
  /* `allFollowUps` counts every open one, shown or not: ticking one here takes it off, unticking puts it back. */
  const ticked = args.followUps.filter((f) => !f.done && done.has(f.id)).length;
  const unticked = args.followUps.filter((f) => f.done && !done.has(f.id)).length;
  const left = args.allFollowUps - ticked + unticked;
  return <LiveFrame name="Notes"><WsNotesPage {...args} followUps={args.followUps.map((f) => ({ ...f, done: done.has(f.id) }))} allFollowUps={Math.max(0, left)} onTick={tick} /></LiveFrame>;
}
const said = FOLLOW_UPS.filter((f) => f.source.startsWith('Said'));
const NOTES = {
  summary: SUMMARY, decided: DECIDED, followUps: said, allFollowUps: FOLLOW_UPS.filter((f) => !f.done).length, put: { target: 'Launch plan', onPut: did('onPut') },
  onTime: did('onTime'), onTick: did('onTick'), onAll: did('onAll')
};
const notesTypes: Story['argTypes'] = { summary: { control: 'text' }, decided: { control: 'object' }, followUps: { control: false }, put: { control: false } };
/**
 * Twelve minutes into Priya's Launch check-in: the summary, two decisions (each time opens the transcript there, the
 * arrow adds it to Launch plan) and the first follow-ups, which tick. All 5 goes to Follow-ups.
 */
export const NotesPage: Story = { name: 'Notes', args: NOTES, argTypes: notesTypes, render: (args) => <Notes key={args.summary} {...args} /> };
/** Before anything's been said: each part says it's empty. */
export const NotesNothingYet: Story = {
  name: 'Notes: nothing yet', args: { ...NOTES, summary: '', decided: [], followUps: [], allFollowUps: 0 }, argTypes: notesTypes, render: (args) => <Notes key={args.summary} {...args} />
};
/** No document open yet, so there's nowhere to add a line: no arrows. */
export const NotesNoArrows: Story = { name: 'Notes: nowhere to add to', args: { ...NOTES, put: undefined }, argTypes: notesTypes, render: (args) => <Notes key={args.summary} {...args} /> };

/* ---------- follow-ups ---------- */

/** Follow-ups that answer: Everyone and Mine switch, ticking works, and Enter on the last line adds one with your name. */
function FollowUps(args: ComponentProps<typeof WsFollowUps>) {
  const [mine, setMine] = useState(args.mine);
  const [rows, setRows] = useState(args.rows);
  const [draft, setDraft] = useState(args.draft);
  const yours = rows.filter((r) => r.person === ART);
  const add = () => {
    args.onAdd();
    const text = draft.trim();
    if (!text) return;
    setRows((now) => [...now, { id: `f${now.length + 1}`, text, done: false, person: ART, name: first(ART), due: 'No date', source: 'Added by you' }]);
    setDraft('');
  };
  return (
    <LiveFrame name="Follow-ups">
      <WsFollowUps mine={mine} onMine={(m) => { args.onMine(m); setMine(m); }} everyoneCount={rows.length} mineCount={yours.length} rows={mine ? yours : rows}
        onTick={(id) => { args.onTick(id); setRows((now) => now.map((r) => (r.id === id ? { ...r, done: !r.done } : r))); }}
        draft={draft} onDraft={(d) => { args.onDraft(d); setDraft(d); }} onAdd={add} />
    </LiveFrame>
  );
}
type FollowStory = StoryObj<typeof WsFollowUps>;
const FOLLOW = {
  mine: false, everyoneCount: FOLLOW_UPS.length, mineCount: FOLLOW_UPS.filter((f) => f.person === ART).length, rows: FOLLOW_UPS, draft: '',
  onMine: did('onMine'), onTick: did('onTick'), onDraft: did('onDraft'), onAdd: did('onAdd')
};
const followTypes: FollowStory['argTypes'] = { rows: { control: false }, everyoneCount: { table: { disable: true } }, mineCount: { table: { disable: true } } };
const followUps: FollowStory['render'] = (args) => <FollowUps key={`${String(args.mine)}${args.rows.length}`} {...args} />;
/** Everyone's: said out loud, or a dated line with someone tagged in a document, which opens the line it came from. */
export const FollowUpsEveryone: FollowStory = { name: 'Follow-ups: everyone', args: FOLLOW, argTypes: followTypes, render: followUps };
/** Only what has your name on it. */
export const FollowUpsMine: FollowStory = { name: 'Follow-ups: mine', args: { ...FOLLOW, mine: true }, argTypes: followTypes, render: followUps };
const nothing: WsFollowUp[] = [];
/** Nothing to do yet: the line to add one is still there. */
export const FollowUpsEmpty: FollowStory = { name: 'Follow-ups: nothing yet', args: { ...FOLLOW, rows: nothing, everyoneCount: 0, mineCount: 0 }, argTypes: followTypes, render: followUps };

/* ---------- transcript ---------- */

/** The transcript, with the find field narrowing it as you type. */
function Transcript(args: ComponentProps<typeof WsTranscript>) {
  const [query, setQuery] = useState(args.query);
  const words = query.trim().toLowerCase();
  const lines = words ? args.lines.filter((l) => l.text.toLowerCase().includes(words) || l.name.toLowerCase().includes(words)) : args.lines;
  return <LiveFrame name="Transcript" end><WsTranscript {...args} query={query} onQuery={(q) => { args.onQuery(q); setQuery(q); }} lines={lines} now={words ? null : args.now} /></LiveFrame>;
}
type TranscriptStory = StoryObj<typeof WsTranscript>;
const TRANSCRIPT = { query: '', lines: LINES, now: SPEAKING, put: { target: 'Launch plan', onPut: did('onPut') }, onQuery: did('onQuery') };
const transcriptTypes: TranscriptStory['argTypes'] = { lines: { control: false }, now: { control: false }, put: { control: false } };
const transcript: TranscriptStory['render'] = (args) => <Transcript key={args.query} {...args} />;
/** The call so far, and Priya saying something right now at the end. The arrow on a line quotes it in Launch plan. */
export const TranscriptPage: TranscriptStory = { name: 'Transcript: the call so far', args: TRANSCRIPT, argTypes: transcriptTypes, render: transcript };
/** Finding a word keeps the lines that have it. */
export const TranscriptFound: TranscriptStory = { name: 'Transcript: finding', args: { ...TRANSCRIPT, query: 'legal' }, argTypes: transcriptTypes, render: transcript };
export const TranscriptNothingFound: TranscriptStory = { name: 'Transcript: nothing matches', args: { ...TRANSCRIPT, query: 'warehouse photos' }, argTypes: transcriptTypes, render: transcript };
/** A time pressed in the notes opens the transcript at its line, which glows for 1.6 s. */
export const TranscriptOpened: TranscriptStory = {
  name: 'Transcript: a line a time opened', args: { ...TRANSCRIPT, now: null, lines: LINES.map((l) => (l.id === 'l3' ? { ...l, flash: true } : l)) }, argTypes: transcriptTypes, render: transcript
};
/** The call has just begun. */
export const TranscriptNothingYet: TranscriptStory = { name: 'Transcript: nothing said yet', args: { ...TRANSCRIPT, lines: [], now: null }, argTypes: transcriptTypes, render: transcript };

/* ---------- notes off ---------- */

/** Notes off, in the Notes page's place. The organizer turns them on; anyone else asks them, and a toast says so. */
function Off(args: ComponentProps<typeof WsNotesOff>) {
  const [on, setOn] = useState(false);
  const { toasts, say } = useToasts();
  if (on) return <LiveFrame name="Notes"><NotesLive nothingYet /></LiveFrame>;
  return (
    <>
      <LiveFrame name="Notes" save="quiet">
        <WsNotesOff organizer={args.organizer}
          onTurnOn={args.onTurnOn && (() => { args.onTurnOn?.(); setOn(true); say(wsToast.notesOn()); })}
          onAsk={args.onAsk && (() => { args.onAsk?.(); say(wsToast.askedForNotes(args.organizer)); })} />
      </LiveFrame>
      <WsToasts toasts={toasts} />
    </>
  );
}
type OffStory = StoryObj<typeof WsNotesOff>;
/** The organizer's: Turn notes on, and the page starts writing. */
export const NotesOffOrganizer: OffStory = { name: 'Notes off: the organizer', args: { organizer: first(CALL.organizer), onTurnOn: did('onTurnOn') }, render: (args) => <Off {...args} /> };
/** Anyone else's: they can ask Priya. */
export const NotesOffSomeoneElse: OffStory = { name: 'Notes off: someone else', args: { organizer: first(CALL.organizer), onAsk: did('onAsk') }, render: (args) => <Off {...args} /> };

/* ---------- after the call ---------- */

type WorkedStory = StoryObj<typeof WsWorkedOn>;
const WORKED = [
  { id: 'plan', name: 'Launch plan', sub: 'Priya, Aiko and you edited this' },
  { id: 'checklist', name: 'Launch checklist', sub: 'Kofi ticked 1 item' },
  { id: 'pricing', name: 'Pricing page copy', sub: 'Kofi and you edited this' }
];
/** On the note after the call, beside what was decided: only documents the reader can open. */
export const WorkedOn: WorkedStory = {
  name: 'Worked on: on the note', args: { documents: WORKED, onOpen: did('onOpen') }, argTypes: { documents: { control: 'object' } },
  render: (args) => <Box width={760} height="auto"><WsWorkedOn {...args} /></Box>
};
/** On a phone, one under another. */
export const WorkedOnPhone: WorkedStory = {
  name: 'Worked on: on a phone', args: { documents: WORKED, onOpen: did('onOpen') }, argTypes: { documents: { control: 'object' } },
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: (args) => <WsWorkedOn {...args} />
};

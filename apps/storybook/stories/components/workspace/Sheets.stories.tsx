/*
 * What opens in a popover in the workspace, and the two things that open over everything. Someone's card (WsPersonCard),
 * the question asked once when you tag someone who can't open the document (WsMentionPrompt), a comment and its thread
 * (WsCommentCompose, WsCommentThread), Share (WsShareSheet), the one question before a call changes workspace
 * (WsSwitchSheet), what presenting will look like (WsPresentPreview), and photos to add (WsUploadPicker). Find (WsFind,
 * ⌘K) dims the page and opens over it; someone asking to see the workspace (WsKnock) drops in at the top of the
 * organizer's screen.
 */
import type { Person } from '@alcove/api';
import {
  Avatar, Button, Icon, WsCaptionField, WsCommentCompose, WsCommentThread, WsDoc, WsFind, WsKnock, WsMentionPrompt, WsPage, WsPane, WsPersonCard, WsPopover,
  WsPresentPreview, WsScroll, WsShareSheet, WsSwitchSheet, WsToasts, WsUploadPicker, wsToast, type WsComment, type WsFindHit
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState, type ComponentProps } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, PopSurface, Stack, did } from '../../../src/component';
import { ART, KOFI, PRIYA } from '../../../src/world/people';
import { DocOf, GUEST, ListOf, PHOTOS, ShareFor, first, useToasts, useWorkspace } from './parts';

const meta = {
  title: 'Components/Workspace/Sheets',
  component: WsShareSheet,
  subcomponents: { WsCaptionField, WsPersonCard, WsMentionPrompt, WsCommentCompose, WsCommentThread, WsSwitchSheet, WsPresentPreview, WsFind, WsKnock, WsUploadPicker },
  parameters: { layout: 'centered' }
} satisfies Meta<typeof WsShareSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The workspace in a call behind what opens over it, answering. */
function Behind({ onFind, start, height = 560 }: { onFind?: (() => void) | undefined; start?: string | undefined; height?: number | undefined }) {
  const ws = useWorkspace({ call: true, start });
  return <><Box width="100%" height={height}><WsPane><ListOf ws={ws} onFind={onFind} /><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box><WsToasts toasts={ws.toasts} /></>;
}
const WIDE = { parameters: { layout: 'padded' } };

/* ---------- share ---------- */

const SHARE = { title: 'Share Launch plan', query: '', onQuery: did('onQuery'), rows: [] };
const shareTypes: Story['argTypes'] = {
  rows: { table: { disable: true } }, matches: { table: { disable: true } }, guest: { table: { disable: true } }, onQuery: { table: { disable: true } }, onAdd: { table: { disable: true } }
};
/**
 * Who has the document: everyone in the workspace, and anyone it was shared with, each with what they can do, which
 * the arrow beside it changes. Typing finds people to add; Enter adds the first.
 */
export const Share: Story = { name: 'Share sheet', args: SHARE, argTypes: shareTypes, render: ({ title, query }) => <PopSurface ws><ShareFor key={query} title={title} call={false} query={query} /></PopSurface> };
/** People the field found as you typed, not added yet: pressing one adds them. */
export const ShareMatches: Story = { name: 'Share sheet: finding people as you type', args: { ...SHARE, query: 's' }, argTypes: shareTypes, render: ({ title, query }) => <PopSurface ws><ShareFor key={query} title={title} call={false} query={query} /></PopSurface> };
/** In a call, a guest who can't open it is offered too: Let them read shares it with them for the call. */
export const ShareGuest: Story = { name: 'Share sheet: a guest in the call', args: SHARE, argTypes: shareTypes, render: ({ title, query }) => <PopSurface ws><ShareFor key={query} title={title} call query={query} /></PopSurface> };
/** Only the people added here: the workspace can't open it, and whoever made it always can. */
export const ShareRestricted: Story = { name: 'Share sheet: only people added here', args: SHARE, argTypes: shareTypes, render: ({ title, query }) => <PopSurface ws><ShareFor key={query} title={title} call={false} query={query} restricted /></PopSurface> };

/* ---------- someone's card ---------- */

type CardStory = StoryObj<typeof WsPersonCard>;
/** Follow and Stop following change places, as they do in the call. */
const card: CardStory['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsPersonCard>>();
  return (
    <PopSurface ws>
      <WsPersonCard person={args.person} where={args.where} followed={args.followed} onGo={args.onGo} onTag={args.onTag}
        onFollow={() => { args.onFollow(); update({ followed: true }); }} onStop={() => { args.onStop(); update({ followed: false }); }} />
    </PopSurface>
  );
};
const CARD = { person: PRIYA, where: 'Launch checklist', followed: false, onFollow: did('onFollow'), onStop: did('onStop'), onGo: did('onGo'), onTag: did('onTag') };
const cardTypes: CardStory['argTypes'] = { person: { control: false } };
/** Someone in another document: follow them, go to where they are, or tag them. */
export const PersonCard: CardStory = { name: 'Person card: not followed', args: CARD, argTypes: cardTypes, render: card };
export const PersonCardFollowed: CardStory = { name: 'Person card: followed', args: { ...CARD, followed: true }, argTypes: cardTypes, render: card };
/** They're somewhere you can't open: the card doesn't name it, and there's nowhere to go. */
export const PersonCardCantGo: CardStory = { name: 'Person card: in a document you can’t open', args: { ...CARD, where: 'A document you can’t open', onGo: undefined }, argTypes: cardTypes, render: card };
export const PersonCardOutside: CardStory = { name: 'Person card: not in the workspace', args: { ...CARD, person: KOFI, where: 'Not in the workspace', onGo: undefined }, argTypes: cardTypes, render: card };

/* ---------- tagging someone who can't open it ---------- */

type MentionStory = StoryObj<typeof WsMentionPrompt>;
export const MentionPrompt: MentionStory = {
  name: 'Mention prompt', args: { person: GUEST, document: 'Launch plan', onEdit: did('onEdit'), onRead: did('onRead'), onNotNow: did('onNotNow') }, argTypes: { person: { control: false } },
  render: (args) => <PopSurface ws><WsMentionPrompt {...args} /></PopSurface>
};

/** Tagging Jonas, a guest, in a line of Launch plan: the question opens at his name, and the answer says what changed. */
function Tagged() {
  const chip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(true);
  const { toasts, say } = useToasts();
  const answer = (level: 'read' | 'edit' | null) => { setOpen(false); if (level) say(wsToast.canOpen(first(GUEST), level, 'Launch plan')); };
  return (
    <>
      <Box width={620} height={320}>
        <WsPane page>
          <WsDoc>
            <WsScroll>
              <WsPage>
                <div className="ws-ed"><div className="ws-text">
                  <h1 className="wd-title">Launch plan</h1>
                  <div className="wb is-todo" style={{ '--ind': 0 }}>
                    <button type="button" className="wb-box" role="checkbox" aria-checked={false} aria-label="Done"><Icon name="check" size={13} /></button>
                    <div className="wb-col"><div className="wb-t">Press photos for the launch page <span ref={chip} className="wn" onClick={() => setOpen(true)}><span className="wn-f"><Avatar person={GUEST} size={17} /></span><b>{first(GUEST)}</b></span></div></div>
                  </div>
                </div></div>
              </WsPage>
            </WsScroll>
          </WsDoc>
        </WsPane>
      </Box>
      <WsPopover open={open} onOpenChange={setOpen} label="Share Launch plan" at={() => chip.current?.getBoundingClientRect() ?? new DOMRect()}>
        <WsMentionPrompt person={GUEST} document="Launch plan" onEdit={() => answer('edit')} onRead={() => answer('read')} onNotNow={() => answer(null)} />
      </WsPopover>
      <WsToasts toasts={toasts} />
    </>
  );
}
export const MentionPromptAtName: Story = { name: 'Mention prompt: at the name you tagged', args: SHARE, parameters: { controls: { disable: true } }, render: () => <Tagged /> };

/* ---------- comments ---------- */

const QUOTE = 'Pilot customers cut the time they spend chasing shipments by more than half.';
const THREAD: WsComment[] = [
  { id: 'c1', person: KOFI, name: 'Kofi', text: 'Can we name the two pilots here, or not yet?' },
  { id: 'c2', person: PRIYA, name: 'Priya', text: 'Both said yes by email. I’ll add their names once legal has read it.' }
];

/** A thread that answers: a reply rises in under the others, and Resolve closes it with a toast that can reopen it. */
function Thread({ quote, messages: said, value: start, onSend, onResolve, onChange }: ComponentProps<typeof WsCommentThread>) {
  const [messages, setMessages] = useState(said);
  const [value, setValue] = useState(start ?? '');
  const [resolved, setResolved] = useState(false);
  const { toasts, say } = useToasts();
  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSend?.();
    setMessages((now) => [...now, { id: `c${now.length + 1}`, person: ART, name: first(ART), text }]);
    setValue('');
  };
  const resolve = () => { onResolve?.(); setResolved(true); say(wsToast.resolved(() => setResolved(false))); };
  return (
    <>
      {resolved
        ? <Button size="sm" icon="message" onClick={() => setResolved(false)}>Show the comment again</Button>
        : <PopSurface ws><WsCommentThread quote={quote} messages={messages} value={value} onChange={(v) => { onChange?.(v); setValue(v); }} onSend={send} onResolve={resolve} /></PopSurface>}
      <WsToasts toasts={toasts} />
    </>
  );
}

/** A new comment: Enter sends it, and it becomes the start of a thread. */
function Compose({ quote, person, value: start, onChange, onSend }: ComponentProps<typeof WsCommentCompose>) {
  const [value, setValue] = useState(start);
  const [sent, setSent] = useState<WsComment[]>([]);
  if (sent.length > 0) return <Thread quote={quote} messages={sent} value="" onChange={did('onChange')} onSend={did('onSend')} onResolve={did('onResolve')} />;
  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSend();
    setSent([{ id: 'c1', person: ART, name: first(ART), text }]);
  };
  return <PopSurface ws><WsCommentCompose quote={quote} person={person} value={value} onChange={(v) => { onChange(v); setValue(v); }} onSend={send} /></PopSurface>;
}
export const CommentCompose: StoryObj<typeof WsCommentCompose> = {
  name: 'Comment: a new one', args: { quote: QUOTE, person: ART, value: '', onChange: did('onChange'), onSend: did('onSend') }, argTypes: { person: { control: false } },
  render: (args) => <Compose key={args.quote} {...args} />
};
export const CommentThread: StoryObj<typeof WsCommentThread> = {
  name: 'Comment: a thread', args: { quote: QUOTE, messages: THREAD, value: '', onChange: did('onChange'), onSend: did('onSend'), onResolve: did('onResolve') }, argTypes: { messages: { control: false } },
  render: (args) => <Thread key={args.quote} {...args} />
};
/** Someone who can only read it, on a board they can only look at: what's been said, with no field and no Resolve. */
export const CommentThreadReading: StoryObj<typeof WsCommentThread> = {
  name: 'Comment: a thread, only to read', args: { quote: 'Nobody owned the status page', messages: THREAD, value: '', onChange: did('onChange') }, argTypes: { messages: { control: false } },
  render: (args) => <PopSurface ws><WsCommentThread {...args} /></PopSurface>
};
/** On a board, a comment on a picture of a screen or anything else with no words of its own quotes nothing. */
export const CommentComposeNoQuote: StoryObj<typeof WsCommentCompose> = {
  name: 'Comment: a new one, on something with no words', args: { quote: '', person: ART, value: '', onChange: did('onChange'), onSend: did('onSend') }, argTypes: { person: { control: false } },
  render: (args) => <Compose key="no-quote" {...args} />
};

/* ---------- a photo's caption ---------- */

type CaptionStory = StoryObj<typeof WsCaptionField>;
/** What `@` offers in a caption: people, one of whom can't open the document yet, and dates. */
const CAPTION_TAGGING = {
  sections: (query: string) => [
    { title: 'In this call', choices: [PRIYA, KOFI].filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).map((p) => ({ key: p.id, label: p.name, person: p, words: first(p), ...(p === KOFI ? { sub: 'Can’t open this yet' } : {}) })) },
    { title: 'Dates', choices: [{ key: 'today', label: 'Today', icon: 'cal' as const, words: 'Today' }].filter((d) => d.label.toLowerCase().includes(query.toLowerCase())) }
  ].filter((x) => x.choices.length > 0),
  onPick: did('onPick')
};
/** A caption under a photo, as the page has it: typed in place, with who it tags marked once it's written. */
function Captioned({ value: start, tagged, readOnly, tagging }: ComponentProps<typeof WsCaptionField>) {
  const [value, setValue] = useState(start);
  const [names, setNames] = useState<readonly string[]>(tagged ?? []);
  const picking = tagging && { ...tagging, onPick: (c: Parameters<typeof tagging.onPick>[0]) => { tagging.onPick(c); if (c.person) setNames((n) => [...n, c.person?.name ?? '']); } };
  return (
    <Box width={340} height={290}>
      <figure className="wb-fig" style={{ margin: 0 }}><div className="wb-ph" style={{ aspectRatio: '3 / 2' }} /><WsCaptionField value={value} tagged={names} readOnly={readOnly} tagging={picking} onChange={setValue} onDone={did('onDone')} /></figure>
    </Box>
  );
}
export const CaptionWritten: CaptionStory = {
  name: 'Caption: written', args: { value: 'Felixstowe at dawn', tagged: [], readOnly: false, tagging: CAPTION_TAGGING, onChange: did('onChange'), onDone: did('onDone') }, argTypes: { tagging: { control: false } },
  render: (args) => <Captioned key={args.value} {...args} />
};
/** Someone tagged in it: their name marked, as a tag in a line is. */
export const CaptionTagged: CaptionStory = {
  name: 'Caption: someone tagged', args: { value: 'Stacks, bay 14, counted by @Kofi', tagged: [KOFI.name], readOnly: false, tagging: CAPTION_TAGGING, onChange: did('onChange'), onDone: did('onDone') }, argTypes: { tagging: { control: false } },
  render: (args) => <Captioned key={args.value} {...args} />
};
/** Typing @: who to tag drops below the line, and says who can't open the document yet. */
export const CaptionTagging: CaptionStory = {
  name: 'Caption: tagging someone', args: { value: 'Warehouse 3', tagged: [], readOnly: false, tagging: CAPTION_TAGGING, onChange: did('onChange'), onDone: did('onDone') }, argTypes: { tagging: { control: false } },
  parameters: { layout: 'padded' },
  render: (args) => <div style={{ minHeight: 320 }}><Captioned key={args.value} {...args} /></div>,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('textbox', { name: 'Caption' }));
    await userEvent.keyboard('{End} with @');
  }
};
/** Someone who can only read it: the words, and nothing to type in. */
export const CaptionReading: CaptionStory = {
  name: 'Caption: only to read', args: { value: 'Stacks, bay 14, counted by @Kofi', tagged: [KOFI.name], readOnly: true, onChange: did('onChange'), onDone: did('onDone') },
  render: (args) => <Captioned key={args.value} {...args} />
};

/* ---------- switching the call's workspace ---------- */

type SwitchStory = StoryObj<typeof WsSwitchSheet>;
const SWITCH = { name: 'Design', current: 'Product', cantOpen: [], onSwitch: did('onSwitch'), onKeep: did('onKeep') };
const switching: SwitchStory['render'] = (args) => <PopSurface ws><WsSwitchSheet {...args} /></PopSurface>;
/** Everyone in the call can open it: only the question. */
export const SwitchEveryone: SwitchStory = { name: 'Switch sheet: everyone can open it', args: SWITCH, render: switching };
/** Maya can't open Design: she stays in the call and sees it's private. */
export const SwitchOne: SwitchStory = { name: 'Switch sheet: one person can’t open it', args: { ...SWITCH, cantOpen: ['Maya'] }, render: switching };
/** Nobody else can open a workspace that's only yours. */
export const SwitchSeveral: SwitchStory = { name: 'Switch sheet: several can’t open it', args: { ...SWITCH, name: 'Art’s workspace', cantOpen: ['Priya', 'Kofi', 'Aiko', 'Maya'] }, render: switching };

/** In your own call: choosing Design in the list's head asks this in the menu's place. Switch changes it for everyone. */
function SwitchInPlace() {
  const ws = useWorkspace({ call: true, organizer: true, opened: { key: 'picker', step: 'switch', to: 'ws-design' } });
  return <><Box width={244} height={560}><WsPane><ListOf ws={ws} /></WsPane></Box><WsToasts toasts={ws.toasts} /></>;
}
export const SwitchOpen: Story = { name: 'Switch sheet: in the picker’s place', parameters: { layout: 'padded', controls: { disable: true } }, args: SHARE, render: () => <SwitchInPlace /> };

/* ---------- presenting ---------- */

type PresentStory = StoryObj<typeof WsPresentPreview>;
/** What everyone will see, and one button to start: Launch plan has three sections. */
export const PresentPreview: PresentStory = {
  name: 'Present preview: several sections', args: { name: 'Launch plan', sections: 3, onStart: did('onStart') }, render: (args) => <PopSurface ws><WsPresentPreview {...args} /></PopSurface>
};
export const PresentPreviewOne: PresentStory = {
  name: 'Present preview: one section', args: { name: 'Pricing page copy', sections: 1, onStart: did('onStart') }, render: (args) => <PopSurface ws><WsPresentPreview {...args} /></PopSurface>
};

/* ---------- find ---------- */

/** What find turns up: documents, and lines in documents, the notes and the transcript. `doc` is where opening it goes. */
type Hit = WsFindHit & { doc: string };
const DOCS: Hit[] = [
  { id: 'plan', doc: 'plan', name: 'Launch plan', sub: 'Product', icon: 'fileText' },
  { id: 'checklist', doc: 'checklist', name: 'Launch checklist', sub: 'Product', icon: 'fileText' },
  { id: 'interviews', doc: 'interviews', name: 'Interview notes', sub: 'Product / Research', icon: 'fileText' },
  { id: 'pricing', doc: 'pricing', name: 'Pricing page copy', sub: 'Product', icon: 'fileText' }
];
const LINES_FOUND: Hit[] = [
  { id: 'line-1', doc: 'pricing', name: 'Legal reads this before it goes live.', sub: 'Pricing page copy', icon: 'textLines' },
  { id: 'line-2', doc: '$notes', name: 'The pricing page goes to legal today', sub: 'Notes · decided at 16:08', icon: 'notes' },
  { id: 'line-3', doc: '$transcript', name: 'Legal needs the final copy by Friday or we miss the window.', sub: 'Transcript · Kofi at 16:10', icon: 'transcript' },
  { id: 'line-4', doc: 'checklist', name: 'Embargo lifts, 09:00 GMT', sub: 'Launch checklist', icon: 'textLines' },
  { id: 'line-5', doc: 'interviews', name: 'I ring the port. Then I ring the port again.', sub: 'Interview notes', icon: 'textLines' }
];
const RECENT: Hit[] = [DOCS[0], DOCS[1], { id: 'notes', doc: '$notes', name: 'Notes', sub: 'Launch check-in', icon: 'notes' }, DOCS[2]].filter((h): h is Hit => h !== undefined);

/**
 * Find over the workspace: with nothing typed it's what you opened last; typing narrows it to documents and lines. Up
 * and Down move the highlight, Enter or a click opens it (the page behind goes there), and the list's search reopens it.
 */
function Finding(args: ComponentProps<typeof WsFind>) {
  const [open, setOpen] = useState(args.open);
  const [query, setQuery] = useState(args.query);
  const [selected, setSelected] = useState(args.selected);
  const [go, setGo] = useState<string | null>(null);
  const words = query.trim().toLowerCase();
  const hits = words ? [...DOCS, ...LINES_FOUND].filter((h) => h.name.toLowerCase().includes(words)) : RECENT;
  return (
    <>
      <Behind key={go ?? ''} start={go ?? undefined} onFind={() => { setQuery(''); setSelected(0); setOpen(true); }} />
      <WsFind open={open} onOpenChange={(o) => { args.onOpenChange(o); setOpen(o); }} query={query} onQuery={(q) => { args.onQuery(q); setQuery(q); setSelected(0); }}
        hits={hits} selected={Math.min(selected, Math.max(0, hits.length - 1))} onSelected={(i) => { args.onSelected(i); setSelected(i); }}
        onOpen={(hit) => { args.onOpen(hit); setGo([...DOCS, ...LINES_FOUND, ...RECENT].find((h) => h.id === hit.id)?.doc ?? null); setOpen(false); }} />
    </>
  );
}
type FindStory = StoryObj<typeof WsFind>;
const FIND = { open: true, query: '', hits: [], selected: 0, onOpenChange: did('onOpenChange'), onQuery: did('onQuery'), onSelected: did('onSelected'), onOpen: did('onOpen') };
const findTypes: FindStory['argTypes'] = { hits: { table: { disable: true } } };
export const FindRecent: FindStory = { name: 'Find: recent, nothing typed', ...WIDE, args: FIND, argTypes: findTypes, render: (args) => <Finding key={args.query} {...args} /> };
/** Documents and lines that have the words in them. */
export const FindMatches: FindStory = { name: 'Find: what matches', ...WIDE, args: { ...FIND, query: 'legal', selected: 1 }, argTypes: findTypes, render: (args) => <Finding key={args.query} {...args} /> };
export const FindNothing: FindStory = { name: 'Find: nothing found', ...WIDE, args: { ...FIND, query: 'warehouse photos' }, argTypes: findTypes, render: (args) => <Finding key={args.query} {...args} /> };

/* ---------- asking to see the workspace ---------- */

/** On the organizer's screen: Jonas, a guest, asked to see the workspace. Letting him read or edit shares just this document. */
function Knocking(args: ComponentProps<typeof WsKnock>) {
  const [person, setPerson] = useState<Person | null>(args.person === null ? null : GUEST);
  const { toasts, say } = useToasts();
  return (
    <Stack>
      {person === null && <Button size="sm" icon="hand" onClick={() => setPerson(GUEST)}>{first(GUEST)} asks to see the workspace</Button>}
      <Behind height={520} />
      <WsKnock person={person} document={args.document}
        onLet={() => { args.onLet(); setPerson(null); if (args.document) say(wsToast.canOpen(first(GUEST), 'read', args.document)); }}
        onEdit={() => { args.onEdit(); setPerson(null); if (args.document) say(wsToast.canOpen(first(GUEST), 'edit', args.document)); }}
        onChoose={() => { args.onChoose(); setPerson(null); }} onNotNow={() => { args.onNotNow(); setPerson(null); }} />
      <WsToasts toasts={toasts} />
    </Stack>
  );
}
type KnockStory = StoryObj<typeof WsKnock>;
export const Knock: KnockStory = { name: 'Knock: someone asks', ...WIDE, args: { person: GUEST, document: 'Launch plan', onLet: did('onLet'), onEdit: did('onEdit'), onChoose: did('onChoose'), onNotNow: did('onNotNow') }, argTypes: { person: { control: false } }, render: (args) => <Knocking {...args} /> };
/** Answered, or not asked yet: nothing over the call. The button asks, and it drops in. */
export const KnockGone: KnockStory = { name: 'Knock: gone', ...WIDE, args: { person: null, document: 'Launch plan', onLet: did('onLet'), onEdit: did('onEdit'), onChoose: did('onChoose'), onNotNow: did('onNotNow') }, argTypes: { person: { control: false } }, render: (args) => <Knocking {...args} /> };

/* ---------- photos ---------- */

type UploadStory = StoryObj<typeof WsUploadPicker>;
const uploadTypes: UploadStory['argTypes'] = { photos: { control: false }, heading: { control: 'text' } };
/** Photos, from the / menu, in a workspace with none yet. */
export const UploadNone: UploadStory = { name: 'Upload picker: no photos yet', args: { onChoose: did('onChoose') }, argTypes: uploadTypes, render: (args) => <PopSurface ws><WsUploadPicker {...args} /></PopSurface> };
/** Photos already in the workspace, to use again: pressing one adds it. */
export const UploadPhotos: UploadStory = {
  name: 'Upload picker: photos in the workspace', args: { heading: 'In Research', photos: PHOTOS, onChoose: did('onChoose'), onPhoto: did('onPhoto') }, argTypes: uploadTypes,
  render: (args) => <PopSurface ws><WsUploadPicker {...args} /></PopSurface>
};
/** With a way to add them all at once. */
export const UploadAll: UploadStory = {
  name: 'Upload picker: add them all', args: { heading: 'In Research', photos: PHOTOS, onChoose: did('onChoose'), onPhoto: did('onPhoto'), onAll: did('onAll') }, argTypes: uploadTypes,
  render: (args) => <PopSurface ws><WsUploadPicker {...args} /></PopSurface>
};

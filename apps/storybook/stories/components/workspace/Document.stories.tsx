/*
 * A document's side of the pane (WsDoc). Its head (WsDocHead) has the path, the quiet word that says it's saved
 * (WsSaveState), who's in it, Share and ⋯. Bars drop in under the head: you're
 * following someone (WsFollowBar), the connection dropped (WsOfflineBar), someone moved it to Trash (WsGoneBar), or you
 * can only read it (WsReadOnlyBar). Under them it scrolls (WsScroll), with the page in it (WsPage): whose it is
 * (WsDocBy), the editor's text, and the space under the last line (WsTail), or ways to start an empty page
 * (WsTemplates). A workspace with nothing in it (WsEmpty) and one you can't open (WsNoAccess) draw in WsArch.
 */
import {
  WsArch, WsDoc, WsDocBy, WsDocHead, WsDocMenu, WsEmpty, WsFollowBar, WsGoneBar, WsMovePicker, WsNoAccess, WsOfflineBar,
  WsPage, WsPane, WsPersonCard, WsReadOnlyBar, WsSaveState, WsScroll, WsTail, WsTemplates, WsToasts, wsToast,
  type WsFace, type WsPop, type WsSave
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { TEMPLATES } from '~/features/workspace/editor/templates';
import { Box, Row, Stack, did } from '../../../src/component';
import { ART, KOFI, PRIYA } from '../../../src/world/people';
import { CALL, DocOf, FIRST_LINE, NotesLive, PRODUCT_ITEMS, PageText, ShareFor, TEMPLATE_LINES, TEXT, first, useToasts, useWorkspace, type Line } from './parts';

const SAVES: WsSave[] = ['saved', 'saving', 'offline', 'failed', 'live', 'quiet'];
const plan = TEXT.get('plan');
const checklist = TEXT.get('checklist');

/** Launch checklist's page. */
const ChecklistPage = () => <WsPage><PageText title="Launch checklist" by={checklist?.by} edited={checklist?.edited} lines={checklist?.lines ?? []} after={<WsTail onClick={did('onTail')} />} /></WsPage>;

/** The page a head is over: the call's Notes, or the document the path ends with. */
function PageFor({ name }: { name: string }) {
  if (name === 'Notes') return <NotesLive />;
  const id = PRODUCT_ITEMS.find((i) => i.name === name)?.id;
  const text = id === undefined ? undefined : TEXT.get(id);
  return <WsPage><PageText title={name} by={text?.by} edited={text?.edited} lines={text?.lines ?? [FIRST_LINE]} after={<WsTail onClick={did('onTail')} />} /></WsPage>;
}

/** The whole document side, answering, on the pane's card without the list. */
function Whole({ call }: { call: boolean }) {
  const ws = useWorkspace({ call });
  return (
    <>
      <Box width="100%" height={640}><WsPane page={!call}><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box>
      <WsToasts toasts={ws.toasts} />
    </>
  );
}

/** A new, empty page: templates under it, and picking one fills it in. */
function NewPage({ height = 640 }: { height?: number | undefined }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  return (
    <Box width="100%" height={height}>
      <WsPane>
        <WsDoc>
          <WsDocHead crumbs={['Product', 'Untitled']} save={lines ? 'saving' : 'saved'} onToggleList={did('onToggleList')} />
          <WsScroll>
            <WsPage>
              <PageText title="" by={ART} edited="Edited just now" lines={lines ?? [FIRST_LINE]}
                after={lines ? <WsTail onClick={did('onTail')} /> : <WsTemplates templates={TEMPLATES} onPick={(id) => { did('onPick')(id); setLines(TEMPLATE_LINES.get(id) ?? null); }} />} />
            </WsPage>
          </WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}

const meta = {
  title: 'Components/Workspace/Document',
  component: WsDoc,
  subcomponents: { WsDocHead, WsSaveState, WsFollowBar, WsOfflineBar, WsGoneBar, WsReadOnlyBar, WsScroll, WsPage, WsDocBy, WsTail, WsTemplates, WsArch, WsEmpty, WsNoAccess },
  parameters: { layout: 'padded' },
  args: { children: null },
  argTypes: { children: { table: { disable: true } }, className: { table: { disable: true } } }
} satisfies Meta<typeof WsDoc>;
export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- the document ---------- */

/** In a call: who's in it at the top, Share and ⋯. Every popover opens and does what it says. */
export const InACall: Story = { name: 'Document: in a call', render: () => <Whole call /> };
/** In the app: Share and ⋯, and nobody else's faces. */
export const InTheApp: Story = { name: 'Document: in the app', render: () => <Whole call={false} /> };
/** A page nobody has written on: Untitled waits in the title, and the templates under it fill the page in. */
export const NewDocument: Story = { name: 'Document: a new page', render: () => <NewPage /> };

/* ---------- the head ---------- */

type HeadStory = StoryObj<typeof WsDocHead>;
type Part = 'faces' | 'share' | 'more';
const headTypes: HeadStory['argTypes'] = { save: { control: 'inline-radio', options: SAVES }, crumbs: { control: 'object' }, faces: { control: false } };
const HEAD = { crumbs: ['Product', 'Launch plan'], save: 'saved', onToggleList: did('onToggleList') } satisfies ComponentProps<typeof WsDocHead>;

/**
 * The head over the top of its page. `parts`: what it has. `opened`: the popover that's open to begin with. `call`: it's in a
 * call, where the workspace is night and Share has the call's guest.
 */
function HeadIn({ args, parts, opened: startOpened = null, width = '100%', call }: {
  args: ComponentProps<typeof WsDocHead>; parts: Part[]; opened?: string | null | undefined; width?: number | string | undefined; call: boolean;
}) {
  const [opened, setOpened] = useState<string | null>(startOpened);
  const [moving, setMoving] = useState(false);
  const close = () => { setOpened(null); setMoving(false); };
  const pop = (key: string, content: ReactNode): WsPop => ({ open: opened === key, onOpenChange: (to) => { setOpened(to ? key : null); setMoving(false); }, content });
  const name = args.crumbs[args.crumbs.length - 1] ?? 'Untitled';
  const has = (p: Part) => parts.includes(p);
  const faces: WsFace[] = has('faces') ? [PRIYA, KOFI].map((p) => ({ person: p, card: pop(`face:${first(p)}`, <WsPersonCard person={p} where={name} onFollow={close} onStop={close} onTag={close} />) })) : [];
  const more = moving
    ? <WsMovePicker name={name} space="Product" folders={[{ id: 'research', name: 'Research' }]} onRoot={close} onFolder={close} />
    : <WsDocMenu onShare={has('share') ? () => setOpened('share') : undefined}
      onHistory={close} onDuplicate={close} onMove={() => setMoving(true)} onCopyLink={close} onExport={close} onTrash={close} />;
  return (
    <Box width={width} height={380}>
      <WsPane page={!call}>
        <WsDoc>
          <WsDocHead {...args} faces={faces}
            share={has('share') ? pop('share', <ShareFor title={`Share ${name}`} call={call} />) : undefined}
            more={has('more') ? pop('more', more) : undefined} />
          <WsScroll><PageFor name={name} /></WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}
const IN_A_CALL: Part[] = ['faces', 'share', 'more'];
const headed = (parts: Part[], o: { opened?: string | null; width?: number | string; call?: boolean } = {}) => function Render(args: ComponentProps<typeof WsDocHead>) {
  return <HeadIn args={args} parts={parts} opened={o.opened ?? null} width={o.width ?? '100%'} call={o.call ?? true} />;
};

/** In a call: the path, Saved, who's in it (up to four), Share and ⋯. */
export const Head: HeadStory = { name: 'Head: in a call', args: HEAD, argTypes: headTypes, render: headed(IN_A_CALL) };
/** Share: who has it and what they can do, people to add as you type, and a guest in the call who can't open it. */
export const HeadShare: HeadStory = { name: 'Head: Share open', args: HEAD, argTypes: headTypes, render: headed(IN_A_CALL, { opened: 'share' }) };
/** ⋯: History, Duplicate, Move to… (which takes the menu's place), Copy link, Export as PDF and Move to Trash. */
export const HeadMore: HeadStory = { name: 'Head: ⋯ open', args: HEAD, argTypes: headTypes, render: headed(IN_A_CALL, { opened: 'more' }) };
/** Pressing someone's face: follow them, or tag them here. They're in this document, so there's nowhere to go. */
export const HeadFace: HeadStory = { name: 'Head: someone’s card open', args: HEAD, argTypes: headTypes, render: headed(IN_A_CALL, { opened: 'face:Priya' }) };
/** In the app: Share and ⋯ only. */
export const HeadInTheApp: HeadStory = { name: 'Head: in the app', args: HEAD, argTypes: headTypes, render: headed(['share', 'more'], { call: false }) };
/** One of the call's pages: no Share or ⋯, and Live while notes are on. */
export const HeadLivePage: HeadStory = { name: 'Head: a page of the call', args: { ...HEAD, crumbs: [CALL.title, 'Notes'], save: 'live' }, argTypes: headTypes, render: headed([]) };
/** A narrow document gives up the path but the last name, then Saved, then the faces. */
export const HeadNarrow: HeadStory = { name: 'Head: a narrow document', args: { ...HEAD, crumbs: ['Product', 'Research', 'Interview notes'] }, argTypes: headTypes, render: headed(IN_A_CALL, { width: 440 }) };

/* ---------- saved ---------- */

type SaveStory = StoryObj<typeof WsSaveState>;
const saveStory = (state: WsSave, name: string, more: Partial<SaveStory> = {}): SaveStory => ({
  name, args: { state }, argTypes: { state: { control: 'inline-radio', options: SAVES } }, parameters: { layout: 'centered' }, render: ({ state: s }) => <WsSaveState state={s} />, ...more
});
/** Every state in a document's head, where it lives (a head under 640 px wide leaves it out): quiet says nothing at all. */
export const SaveEvery: Story = {
  name: 'Save state: every state',
  render: () => (
    <Stack>
      {SAVES.map((s) => (
        <Box key={s} width={720} height={52}>
          <WsPane><WsDoc><WsDocHead crumbs={s === 'live' || s === 'quiet' ? [CALL.title, 'Notes'] : ['Product', 'Launch plan']} save={s} onToggleList={did('onToggleList')} /></WsDoc></WsPane>
        </Box>
      ))}
    </Stack>
  )
};
export const SaveSaved = saveStory('saved', 'Save state: saved');
export const SaveSaving = saveStory('saving', 'Save state: saving');
/** The connection dropped: what's written waits in this browser. */
export const SaveOffline = saveStory('offline', 'Save state: offline');
export const SaveFailed = saveStory('failed', 'Save state: couldn’t save');
/** One of the call's pages while notes are on. */
export const SaveLive = saveStory('live', 'Save state: live');
/** One of the call's pages while notes are off: nothing. */
export const SaveQuiet = saveStory('quiet', 'Save state: quiet');

/* ---------- bars ---------- */

/** A bar under the head of Launch checklist, over its page. `follow` draws the pane's frame. */
function BarFrame({ children, follow = false }: { children: ReactNode; follow?: boolean | undefined }) {
  return (
    <Box width="100%" height={420}>
      <WsPane following={follow}>
        <WsDoc>
          <WsDocHead crumbs={['Product', 'Launch checklist']} save="saved" onToggleList={did('onToggleList')} />
          {children}
          <WsScroll><ChecklistPage /></WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}

type FollowStory = StoryObj<typeof WsFollowBar>;
/** Following, until you stop: Stop following lifts the bar and the frame, and a toast offers to follow again. */
function Follow(args: ComponentProps<typeof WsFollowBar>) {
  const [following, setFollowing] = useState(args.following);
  const { toasts, say } = useToasts();
  const stop = () => {
    args.onStop();
    const was = following;
    setFollowing(null);
    if (was) say(wsToast.stoppedFollowing(was.name, () => setFollowing(was)));
  };
  return <><BarFrame follow={following !== null}><WsFollowBar following={following} onStop={stop} /></BarFrame><WsToasts toasts={toasts} /></>;
}
export const FollowBar: FollowStory = {
  name: 'Follow bar: following', args: { following: { person: PRIYA, name: 'Priya', where: 'Launch checklist' }, onStop: did('onStop') },
  argTypes: { following: { control: false } }, render: (args) => <Follow {...args} />
};
/** They went somewhere you can't open: the bar doesn't name it. */
export const FollowLost: FollowStory = {
  name: 'Follow bar: somewhere you can’t open', args: { following: { person: PRIYA, name: 'Priya', where: 'Salary bands', lost: true }, onStop: did('onStop') },
  argTypes: { following: { control: false } }, render: (args) => <Follow {...args} />
};
/** The browser has no connection, and writing carries on: it sends when it's back. Turn `show` off and it closes up. */
export const OfflineBar: StoryObj<typeof WsOfflineBar> = {
  name: 'Offline bar', args: { show: true }, render: ({ show }) => <BarFrame><WsOfflineBar show={show} /></BarFrame>
};
/**
 * The browser has a connection but Alcove can't be reached: it says so rather than offline, and Try now tries again at once
 * rather than after the wait.
 */
export const UnreachableBar: StoryObj<typeof WsOfflineBar> = {
  name: 'Offline bar: Alcove can’t be reached', args: { show: true, online: true, onTry: did('Try now') },
  render: ({ show, online, onTry }) => <BarFrame><WsOfflineBar show={show} online={online} onTry={onTry} /></BarFrame>
};
export const UnreachableBarPhone: StoryObj<typeof WsOfflineBar> = { ...UnreachableBar, name: 'Offline bar: Alcove can’t be reached, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
export const UnreachableBarNight: StoryObj<typeof WsOfflineBar> = { ...UnreachableBar, name: 'Offline bar: Alcove can’t be reached, night', globals: { theme: 'dark' } };

/** Someone moved it to Trash while you were in it: keep reading, or Restore it. */
function Gone(args: ComponentProps<typeof WsGoneBar>) {
  const [who, setWho] = useState(args.who);
  const { toasts, say } = useToasts();
  return (
    <>
      <BarFrame><WsGoneBar who={who} onRestore={() => { args.onRestore?.(); setWho(null); say(wsToast.restored()); }} /></BarFrame>
      <WsToasts toasts={toasts} />
    </>
  );
}
export const GoneBar: StoryObj<typeof WsGoneBar> = { name: 'Gone bar', args: { who: 'Kofi', onRestore: did('onRestore') }, render: (args) => <Gone {...args} /> };
/** You can read this and not change it, and the bar says who to ask. */
export const ReadOnlyBar: StoryObj<typeof WsReadOnlyBar> = {
  name: 'Read-only bar', args: { show: true, organizer: 'Priya' }, render: ({ show, organizer }) => <BarFrame><WsReadOnlyBar show={show} organizer={organizer} /></BarFrame>
};

/* ---------- the page ---------- */

/** Launch plan scrolls under the head; pressing the space under the last line adds a line there. */
function Scrolling() {
  const [lines, setLines] = useState<Line[]>(plan?.lines ?? []);
  const tail = () => setLines((now) => (now[now.length - 1]?.text === undefined ? now : [...now, FIRST_LINE]));
  return (
    <Box width="100%" height={460}>
      <WsPane>
        <WsDoc>
          <WsDocHead crumbs={['Product', 'Launch plan']} save="saved" onToggleList={did('onToggleList')} />
          <WsScroll onWheel={did('onWheel')}>
            <WsPage><PageText title="Launch plan" by={plan?.by} edited={plan?.edited} lines={lines} after={<WsTail onClick={() => { did('onClick')(); tail(); }} />} /></WsPage>
          </WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}
export const Page: Story = { name: 'Page: scrolling, with the space under it', render: () => <Scrolling /> };
/** Whose it is and when it last changed, under the title. */
export const DocBy: StoryObj<typeof WsDocBy> = {
  name: 'Doc by', args: { person: PRIYA, name: 'Priya', edited: 'Edited 2 h ago' }, argTypes: { person: { control: false } }, parameters: { layout: 'centered' },
  render: ({ person, name, edited }) => <WsDocBy person={person} name={name} edited={edited} />
};
/** The four ways to start, on their own at the width of a page. */
export const Templates: StoryObj<typeof WsTemplates> = {
  name: 'Templates', args: { templates: TEMPLATES, onPick: did('onPick') }, argTypes: { templates: { control: false } },
  render: ({ templates, onPick }) => <Box width={616} height="auto"><WsTemplates templates={templates} onPick={onPick} /></Box>
};
/** Under a new page: picking one fills it in. */
export const TemplatesOnAPage: Story = { name: 'Templates: under a new page', render: () => <NewPage height={560} /> };

/* ---------- empty and private ---------- */

/** The dashed arch, empty and with what the empty workspace and the private one draw in it. */
export const Arch: StoryObj<typeof WsArch> = {
  name: 'Arch',
  parameters: { layout: 'centered' },
  render: () => (
    <span className="text-ink-3">
      <Row>
        <WsArch />
        <WsArch><path d="M15 58h36" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M22 58a11 11 0 0 1 22 0" fill="none" stroke="currentColor" strokeWidth="1.6" /></WsArch>
        <WsArch><path d="M24 44h18v14H24zM28 44v-5a5 5 0 0 1 10 0v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></WsArch>
      </Row>
    </span>
  )
};

/** A workspace nobody has written in. New document starts a page with templates under it. */
function EmptyFrame(args: ComponentProps<typeof WsEmpty>) {
  const [writing, setWriting] = useState(false);
  if (writing) return <NewPage />;
  return (
    <Box width="100%" height={640}>
      <WsPane>
        <WsDoc>
          <WsDocHead crumbs={[args.space]} save="quiet" onToggleList={did('onToggleList')} />
          <WsEmpty space={args.space} onDocument={() => { args.onDocument?.(); setWriting(true); }} onFolder={args.onFolder} />
        </WsDoc>
      </WsPane>
    </Box>
  );
}
export const Empty: StoryObj<typeof WsEmpty> = {
  name: 'Empty: a new workspace', args: { space: 'Art’s workspace', onDocument: did('onDocument'), onFolder: did('onFolder') }, render: (args) => <EmptyFrame {...args} />
};

/** The call's workspace, to someone who can't open it: Ask asks, and then it says so. */
const privately: StoryObj<typeof WsNoAccess>['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsNoAccess>>();
  return (
    <Box width="100%" height={560}>
      <WsPane>
        <WsDoc><WsNoAccess organizer={args.organizer} asked={args.asked} onAsk={() => { args.onAsk?.(); update({ asked: true }); }} /></WsDoc>
      </WsPane>
    </Box>
  );
};
export const NoAccess: StoryObj<typeof WsNoAccess> = { name: 'No access', args: { organizer: 'Priya', asked: false, onAsk: did('onAsk') }, render: privately };
/** They asked: it opens by itself once Priya shares something with them. */
export const NoAccessAsked: StoryObj<typeof WsNoAccess> = { name: 'No access: asked', args: { organizer: 'Priya', asked: true, onAsk: did('onAsk') }, render: privately };

/*
 * The list down the side of the workspace. WsList holds its head (WsListHead in the app: which workspace, Find, and New; in a
 * call WsListTools, Find and New, as the frame's bar names the workspace), the
 * headings (WsSection: This call, Documents) and a row for each document, folder and page of the call (WsRow), with the
 * sealed line at the foot. A row is named in place (WsRenameRow). A row being dragged leaves a ghost under the pointer
 * (WsDragGhost) and a line where it will land (WsDropLine). Arrow keys move through the rows, Left and Right close and
 * open a folder, a double-click renames, and right-clicking opens a row's menu where you clicked.
 */
import {
  Button, ICON_NAMES, WsDragGhost, WsDropLine, WsList, WsListHead, WsListTools, WsMovePicker, WsNewMenu, WsPane, WsPersonCard, WsRenameRow, WsRow, WsRowMenu,
  WsSection, WsSpacePicker, WsToasts, type IconName, type WsPop, type WsRowProps
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useLayoutEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, Stack, did } from '../../../src/component';
import { KOFI, PRIYA } from '../../../src/world/people';
import { LIVE, ListOf, NEW_SPACE, SPACES, useWorkspace, type Opened } from './parts';

/** The list on the pane's card, as a call's panel or the app's page holds it. */
function ListBox({ height = 560, children }: { height?: number | undefined; children: ReactNode }) {
  return <Box width={244} height={height}><WsPane>{children}</WsPane></Box>;
}

/** The Product workspace's list, answering everything, as the Pane stories have it. `switcher` puts a button above it to change workspace. */
function Live({ call, space, opened, switcher = false }: {
  call: boolean; space?: string | undefined; opened?: Opened | undefined; switcher?: boolean | undefined;
}) {
  const ws = useWorkspace({ call, space, start: space === NEW_SPACE.id ? '' : 'plan', opened });
  const other = SPACES.find((s) => s.id !== ws.space);
  return (
    <Stack>
      {switcher && other && <Button size="sm" icon="swap" onClick={() => ws.switchTo(other.id)}>Switch to {other.name}</Button>}
      <ListBox><ListOf ws={ws} /></ListBox>
      <WsToasts toasts={ws.toasts} />
    </Stack>
  );
}

/** A list with nothing in it yet: its head still finds, makes and switches. */
function Nothing(args: ComponentProps<typeof WsList>) {
  const [open, setOpen] = useState<'picker' | 'new' | null>(null);
  const pop = (key: 'picker' | 'new', content: ReactNode): WsPop => ({ open: open === key, onOpenChange: (to) => setOpen(to ? key : null), content });
  const close = () => setOpen(null);
  return (
    <ListBox>
      <WsList {...args} head={<WsListHead name={NEW_SPACE.name} onFind={did('onFind')}
        picker={pop('picker', <WsSpacePicker spaces={[...SPACES, NEW_SPACE]} current={NEW_SPACE.id} heading="Workspaces" onPick={close} onNew={close} />)}
        create={pop('new', <WsNewMenu onDocument={close} onFolder={close} onUpload={close} />)} />}>
        <WsSection key="docs" label="Documents" />
      </WsList>
    </ListBox>
  );
}

/** Puts the drag ghost where `selector` is on the page, offset a little, as if the pointer were there. */
function GhostOver({ selector, dx, dy, icon, label }: { selector: string; dx: number; dy: number; icon: IconName; label: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(selector);
    if (el) { const r = el.getBoundingClientRect(); setAt({ x: r.left + dx, y: r.top + dy }); }
  }, [selector, dx, dy]);
  return at && <WsDragGhost x={at.x} y={at.y} icon={icon} label={label} />;
}

const meta = {
  title: 'Components/Workspace/List',
  component: WsList,
  subcomponents: { WsListHead, WsSection, WsRow, WsRenameRow, WsDropLine, WsDragGhost },
  parameters: { layout: 'padded' }
} satisfies Meta<typeof WsList>;
export default meta;
export const NameSaving: StoryObj<typeof WsListHead> = { render: () => <ListBox height={120}><WsList head={<WsListHead name="Launch planning" saveState="saving" picker={{ open: false, onOpenChange: did('onOpenChange'), content: null }} />} /></ListBox> };
export const NameFailed: StoryObj<typeof WsListHead> = { render: () => <ListBox height={120}><WsList head={<WsListHead name="Product" saveState="failed" picker={{ open: false, onOpenChange: did('onOpenChange'), content: null }} />} /></ListBox> };
export const NameSavingNight: StoryObj<typeof WsListHead> = { ...NameSaving, globals: { theme: 'dark' } };
/** The list's own connection dropped, so it may not be up to date: it says Reconnecting, with Try now while the browser's online. */
export const ListReconnecting: StoryObj<typeof WsListHead> = {
  name: 'List reconnecting',
  render: () => <ListBox height={160}><WsList head={<WsListHead name="Product" reconnecting={{ onTry: did('Try now') }} picker={{ open: false, onOpenChange: did('onOpenChange'), content: null }} />} /></ListBox>
};
export const ListReconnectingNight: StoryObj<typeof WsListHead> = { ...ListReconnecting, name: 'List reconnecting, night', globals: { theme: 'dark' } };
export const ListReconnectingPhone: StoryObj<typeof WsListHead> = { ...ListReconnecting, name: 'List reconnecting, phone', globals: { viewport: { value: 'phone', isRotated: false } } };
export const NameFailedNight: StoryObj<typeof WsListHead> = { ...NameFailed, globals: { theme: 'dark' } };
type Story = StoryObj<typeof meta>;

/* ---------- the list ---------- */

/** In the app: Documents, folders first open or not as you left them. Rows open, folders twist, ⋯ and right-click open each row's menu. */
export const InTheApp: Story = { name: 'List: in the app', render: () => <Live call={false} /> };
/**
 * In a call: Find and New at the top, as the frame's bar names the workspace. This call at the top, with the call's Notes,
 * Follow-ups (and how many are still open) and Transcript, then the documents brought to it, each with the faces of whoever's
 * in it. A document there is in Documents too.
 */
export const InACall: Story = { name: 'List: in a call', render: () => <Live call /> };
/** Nothing made yet, in a workspace you can make things in: the list says what will appear. */
export const Empty: Story = { name: 'List: empty', args: { empty: 'yours', label: 'Documents' }, render: (args) => <Nothing {...args} /> };
/** Nothing in it yet, for someone who can only read it: what appears once someone makes something. */
export const EmptyReading: Story = { name: 'List: empty, for a reader', args: { empty: 'others', label: 'Documents' }, render: (args) => <Nothing {...args} /> };
/** Someone outside the workspace with nothing shared with them yet. */
export const EmptyShared: Story = { name: 'List: empty, shared with you', args: { empty: 'shared', label: 'Documents' }, render: (args) => <Nothing {...args} /> };
/** Changing workspace cross-fades the list (240 ms), because its `listKey` changes. */
export const Switching: Story = { name: 'List: switching workspace', render: () => <Live call={false} switcher /> };

/* ---------- the head ---------- */

/** The name at the top opens your workspaces; choosing one opens it. */
export const HeadWorkspaces: Story = { name: 'Head: workspaces, in the app', render: () => <Live call={false} opened={{ key: 'picker' }} /> };
/** Plus: a document opens at once, a folder is named in its row. */
export const HeadNew: Story = { name: 'Head: New', render: () => <Live call={false} opened={{ key: 'new' }} /> };
/** In a call: Find, as wide as there's room for, with its key, and New. The workspace's name and its one menu are on the frame's bar. */
export const HeadInACall: StoryObj<typeof WsListTools> = {
  name: 'Head: in a call',
  render: () => <ListBox height={160}><WsList head={<WsListTools onFind={did('onFind')} findKey="⌘K" create={{ open: false, onOpenChange: did('onOpenChange'), content: null }} />} /></ListBox>
};
/** In a call, for someone who can only read it: Find alone. */
export const HeadInACallReading: StoryObj<typeof WsListTools> = {
  name: 'Head: in a call, only to read',
  render: () => <ListBox height={160}><WsList head={<WsListTools onFind={did('onFind')} findKey="⌘K" />} /></ListBox>
};

/* ---------- headings ---------- */

type SectionStory = StoryObj<typeof WsSection>;
const sectionTypes: SectionStory['argTypes'] = { area: { control: 'inline-radio', options: ['pins', 'tree'] }, label: { control: 'text' } };

/** The two headings, and how names line up under each: under Documents a document's name lines up with a folder's, past its twist. */
function Headings(args: ComponentProps<typeof WsSection>) {
  return (
    <ListBox height={400}>
      <WsList>
        <WsSection key="call" {...args} />
        {LIVE.map((l) => <WsRow key={l.id} id={l.id} name={l.name} kind="live" icon={l.icon} area="pins" onOpen={did('onOpen')} />)}
        <WsRow key="pin-plan" id="plan" name="Launch plan" area="pins" onOpen={did('onOpen')} />
        <WsSection key="docs" label="Documents" />
        <WsRow key="plan" id="plan" name="Launch plan" onOpen={did('onOpen')} />
        <WsRow key="research" id="research" name="Research" kind="folder" open onOpen={did('onOpen')} />
        <WsRow key="interviews" id="interviews" name="Interview notes" depth={1} onOpen={did('onOpen')} />
      </WsList>
      {args.into && <GhostOver selector='[data-sec="pins"]' dx={70} dy={6} icon="fileText" label="Pricing page copy" />}
    </ListBox>
  );
}
export const Sections: SectionStory = { name: 'Section: This call and Documents', args: { label: 'This call', area: 'pins', into: false }, argTypes: sectionTypes, render: (args) => <Headings {...args} /> };
/** Dragging a document onto This call brings it to the call: the heading lights up while it's over it. */
export const SectionInto: SectionStory = { name: 'Section: something dragged onto it', args: { label: 'This call', area: 'pins', into: true }, argTypes: sectionTypes, render: (args) => <Headings {...args} /> };
/** The path over the page names the workspace or This call: This call lights up for 1.4 s, as a row that arrives does. Press to see it again. */
function Shown(args: ComponentProps<typeof WsSection>) {
  const [round, setRound] = useState(0);
  return (
    <Stack>
      <Button size="sm" icon="folderOpen" onClick={() => setRound((n) => n + 1)}>This call, on the path</Button>
      <Headings key={round} {...args} />
    </Stack>
  );
}
export const SectionFlash: SectionStory = { name: 'Section: shown from the path', args: { label: 'This call', area: 'pins', flash: true }, argTypes: sectionTypes, render: (args) => <Shown {...args} /> };

/* ---------- rows ---------- */

type RowStory = StoryObj<typeof WsRow>;
const rowTypes: RowStory['argTypes'] = {
  kind: { control: 'inline-radio', options: ['document', 'folder', 'board', 'live'] },
  area: { control: 'inline-radio', options: ['tree', 'pins'] },
  icon: { control: 'select', options: ICON_NAMES },
  depth: { control: { type: 'number', min: 0, max: 6 } },
  faces: { control: false }
};
const ROW: WsRowProps = {
  id: 'plan', name: 'Launch plan', kind: 'document', depth: 0, area: 'tree', open: false, current: false, count: 0,
  quiet: false, flash: false, into: false, ghosted: false, onOpen: did('onOpen'), onRename: did('onRename')
};

/**
 * The row the controls change, between two others: under This call for one of the call's pages, under Documents
 * otherwise. Opening it makes it the current one, a folder twists, and its menus and faces open their popovers.
 */
function RowIn({ args, update, start }: { args: WsRowProps; update: (next: Partial<WsRowProps>) => void; start: 'menu' | 'faces' | null }) {
  const [opened, setOpened] = useState<'menu' | 'move' | 'faces' | 'add' | null>(start);
  const close = () => setOpened(null);
  const pop = (key: 'menu' | 'faces' | 'add', content: ReactNode): WsPop => ({
    open: opened === key || (key === 'menu' && opened === 'move'), onOpenChange: (to) => setOpened(to ? key : null), content
  });
  const folder = args.kind === 'folder';
  const live = args.kind === 'live';
  const face = args.faces?.[0];
  const name = args.name || 'Untitled';
  const row = (
    <WsRow key="row" {...args}
      onOpen={() => { args.onOpen(); if (folder) update({ open: !args.open }); else update({ current: true }); }}
      onTwist={folder ? () => update({ open: !args.open }) : undefined}
      facesCard={face ? pop('faces', <WsPersonCard person={face} where={name} onFollow={close} onStop={close} onGo={close} onTag={close} />) : undefined}
      menu={live ? undefined : pop('menu', opened === 'move'
        ? <WsMovePicker name={name} space="Product" folders={[{ id: 'research', name: 'Research' }]} onRoot={close} onFolder={close} />
        : <WsRowMenu folder={folder} onRename={() => { close(); args.onRename?.(); }} onDuplicate={folder ? undefined : close} onMove={() => setOpened('move')}
          onCopyLink={folder ? undefined : close} onTrash={close} />)}
      add={folder ? pop('add', <WsNewMenu onDocument={close} onFolder={close} onUpload={close} />) : undefined} />
  );
  return (
    <ListBox height={live ? 260 : 300}>
      {live ? (
        <WsList>
          <WsSection key="call" label="This call" area="pins" />
          {LIVE.map((l) => (l.id === args.id ? row : <WsRow key={l.id} id={l.id} name={l.name} kind="live" icon={l.icon} area="pins" onOpen={did('onOpen')} />))}
        </WsList>
      ) : (
        <WsList>
          <WsSection key="docs" label={args.area === 'pins' ? 'This call' : 'Documents'} area={args.area} />
          <WsRow key="before" id="checklist" name="Launch checklist" area={args.area} onOpen={did('onOpen')} />
          {row}
          {folder && args.open && <WsRow key="inside" id="interviews" name="Interview notes" depth={(args.depth ?? 0) + 1} area={args.area} onOpen={did('onOpen')} />}
          <WsRow key="after" id="pricing" name="Pricing page copy" area={args.area} onOpen={did('onOpen')} />
        </WsList>
      )}
    </ListBox>
  );
}
const inList = (start: 'menu' | 'faces' | null = null) => function Render(args: WsRowProps) {
  const [, update] = useArgs<WsRowProps>();
  return <RowIn args={args} update={update} start={start} />;
};

export const RowDocument: RowStory = { name: 'Row: a document', args: ROW, argTypes: rowTypes, render: inList() };
/** Pressing the twist, or the name, opens it. */
export const RowFolderClosed: RowStory = { name: 'Row: a folder, closed', args: { ...ROW, id: 'research', name: 'Research', kind: 'folder' }, argTypes: rowTypes, render: inList() };
export const RowFolderOpen: RowStory = { name: 'Row: a folder, open', args: { ...ROW, id: 'research', name: 'Research', kind: 'folder', open: true }, argTypes: rowTypes, render: inList() };
/** A board, with a board's icon: it opens on its own page, as a document does. */
export const RowBoard: RowStory = { name: 'Row: a board', args: { ...ROW, id: 'retro', name: 'Launch retro', kind: 'board' }, argTypes: rowTypes, render: inList() };
/** One of the call's own pages, in the rec colour while notes are on. Hovering shows Open beside the document. */
export const RowLive: RowStory = {
  name: 'Row: a page of the call', args: { ...ROW, id: '$notes', name: 'Notes', kind: 'live', icon: 'notes', area: 'pins', onBeside: did('onBeside') }, argTypes: rowTypes, render: inList()
};
/** Follow-ups counts what's still open. Zero shows nothing. */
export const RowCount: RowStory = { name: 'Row: a page with a count', args: { ...ROW, id: '$followups', name: 'Follow-ups', kind: 'live', icon: 'todos', area: 'pins', count: 5 }, argTypes: rowTypes, render: inList() };
/** Notes are off: the call's pages stay, quiet. */
export const RowQuiet: RowStory = { name: 'Row: a page of the call, notes off', args: { ...ROW, id: '$notes', name: 'Notes', kind: 'live', icon: 'notes', area: 'pins', quiet: true }, argTypes: rowTypes, render: inList() };
/** The document on the page. */
export const RowCurrent: RowStory = { name: 'Row: the open document', args: { ...ROW, current: true }, argTypes: rowTypes, render: inList() };
/** Who's in it: pressing their faces opens the first one's card. */
export const RowFaces: RowStory = { name: 'Row: who’s in it', args: { ...ROW, faces: [PRIYA, KOFI] }, argTypes: rowTypes, render: inList('faces') };
/** ⋯, or right-clicking the row: Move to… takes the menu's place. */
export const RowMenu: RowStory = { name: 'Row: its menu open', args: ROW, argTypes: rowTypes, render: inList('menu') };
/** Something being dragged onto a folder: dropping it moves it in. */
export const RowInto: RowStory = {
  name: 'Row: something dragged onto it', args: { ...ROW, id: 'research', name: 'Research', kind: 'folder', into: true }, argTypes: rowTypes,
  render: function Render(args) {
    const [, update] = useArgs<WsRowProps>();
    return <><RowIn args={args} update={update} start={null} />{args.into && <GhostOver selector='[data-row="research"]' dx={96} dy={14} icon="fileText" label="Pricing page copy" />}</>;
  }
};
/** A long name stops at the edge of the list. */
export const RowLongName: RowStory = {
  name: 'Row: a long name', args: { ...ROW, id: 'long', name: 'Interview notes from the second round of pilot customers, and what each said about customs paperwork' }, argTypes: rowTypes, render: inList()
};

/** Folders four deep: each level steps in 16 px, and the controls move the last one. */
function Deep(args: WsRowProps) {
  return (
    <ListBox height={300}>
      <WsList>
        <WsSection key="docs" label="Documents" />
        <WsRow key="research" id="research" name="Research" kind="folder" open onOpen={did('onOpen')} />
        <WsRow key="pilots" id="pilots" name="Pilot customers" kind="folder" open depth={1} onOpen={did('onOpen')} />
        <WsRow key="round" id="round" name="Second round" kind="folder" open depth={2} onOpen={did('onOpen')} />
        <WsRow key="row" {...args} />
        <WsRow key="pricing" id="pricing" name="Pricing page copy" onOpen={did('onOpen')} />
      </WsList>
    </ListBox>
  );
}
export const RowDeep: RowStory = { name: 'Row: deep in folders', args: { ...ROW, id: 'interviews', name: 'Interview notes', depth: 3 }, argTypes: rowTypes, render: (args) => <Deep {...args} /> };

/** New document adds a row that glows for 1.4 s where it lands, as anything just made or moved does. */
function JustMade(args: WsRowProps) {
  const [made, setMade] = useState<string[]>([]);
  return (
    <Stack>
      <Button size="sm" icon="filePlus" onClick={() => setMade((now) => [...now, `made-${now.length + 1}`])}>New document</Button>
      <ListBox height={340}>
        <WsList>
          <WsSection key="docs" label="Documents" />
          <WsRow key="checklist" id="checklist" name="Launch checklist" onOpen={did('onOpen')} />
          <WsRow key="row" {...args} />
          {made.map((id) => <WsRow key={id} id={id} name="Untitled" flash onOpen={did('onOpen')} />)}
        </WsList>
      </ListBox>
    </Stack>
  );
}
export const RowFlash: RowStory = { name: 'Row: just made', args: { ...ROW, flash: true }, argTypes: rowTypes, render: (args) => <JustMade {...args} /> };

/** Launch plan on its way between Research and Pricing page copy: its row fades, the ghost follows the pointer and the line says where it lands. */
function Dragging(args: WsRowProps) {
  const [line, setLine] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const below = document.querySelector('[data-row="pricing"]');
    if (below instanceof HTMLElement) setLine({ top: below.offsetTop, left: 28 });
  }, []);
  return (
    <ListBox height={300}>
      <WsList>
        <WsSection key="docs" label="Documents" />
        <WsRow key="row" {...args} />
        <WsRow key="checklist" id="checklist" name="Launch checklist" onOpen={did('onOpen')} />
        <WsRow key="research" id="research" name="Research" kind="folder" onOpen={did('onOpen')} />
        <WsRow key="pricing" id="pricing" name="Pricing page copy" onOpen={did('onOpen')} />
        {line && <WsDropLine key="line" top={line.top} left={line.left} />}
      </WsList>
      {args.ghosted && <GhostOver selector='[data-row="pricing"]' dx={132} dy={-12} icon="fileText" label={args.name} />}
    </ListBox>
  );
}
export const RowGhosted: RowStory = { name: 'Row: being dragged', args: { ...ROW, ghosted: true }, argTypes: rowTypes, render: (args) => <Dragging {...args} /> };

/* ---------- naming in place ---------- */

type RenameStory = StoryObj<typeof WsRenameRow>;
const renameTypes: RenameStory['argTypes'] = { kind: { control: 'inline-radio', options: ['document', 'folder'] }, depth: { control: { type: 'number', min: 0, max: 6 } } };

/**
 * A row being named, between two others. Enter or clicking away keeps the name and the row glows; Esc goes back. A
 * double-click on the row names it again.
 */
function Naming(args: ComponentProps<typeof WsRenameRow>) {
  const [naming, setNaming] = useState(true);
  const [name, setName] = useState(args.name);
  const [glow, setGlow] = useState(false);
  useEffect(() => { if (!glow) return undefined; const t = window.setTimeout(() => setGlow(false), 1400); return () => clearTimeout(t); }, [glow]);
  const keep = (typed: string) => {
    args.onCommit(typed);
    const t = typed.trim();
    if (t) { setName(t); setGlow(true); }
    setNaming(false);
  };
  const folder = args.kind === 'folder';
  return (
    <Stack>
      {!naming && !name && <Button size="sm" icon="folderPlus" onClick={() => setNaming(true)}>New folder</Button>}
      <ListBox height={260}>
        <WsList>
          <WsSection key="docs" label="Documents" />
          <WsRow key="plan" id="plan" name="Launch plan" onOpen={did('onOpen')} />
          {naming
            ? <WsRenameRow key="naming" {...args} onCommit={keep} onCancel={() => { args.onCancel(); setNaming(false); }} />
            : name && <WsRow key="named" id="named" name={name} kind={folder ? 'folder' : 'document'} depth={args.depth} flash={glow} onOpen={did('onOpen')} onRename={() => setNaming(true)} />}
          <WsRow key="pricing" id="pricing" name="Pricing page copy" onOpen={did('onOpen')} />
        </WsList>
      </ListBox>
    </Stack>
  );
}
const NAMING = { kind: 'document', depth: 0, onCommit: did('onCommit'), onCancel: did('onCancel') } as const;
/** Renaming a document: the name is selected, so typing replaces it. */
export const RenameDocument: RenameStory = { name: 'Rename row: a document', args: { ...NAMING, name: 'Launch checklist', placeholder: 'Name this document' }, argTypes: renameTypes, render: (args) => <Naming {...args} /> };
export const RenameFolder: RenameStory = { name: 'Rename row: a folder', args: { ...NAMING, kind: 'folder', name: 'Research', placeholder: 'Name this folder' }, argTypes: renameTypes, render: (args) => <Naming {...args} /> };
/** A new folder starts here, empty: a name makes it, Esc or nothing typed makes nothing. */
export const RenameNewFolder: RenameStory = { name: 'Rename row: a new folder', args: { ...NAMING, kind: 'folder', name: '', placeholder: 'Name this folder' }, argTypes: renameTypes, render: (args) => <Naming {...args} /> };

/* ---------- dragging ---------- */

/** Where a dragged row will land: `top` from the top of the list's scroll, `left` from its edge, here between Research and Pricing page copy. */
export const DropLine: StoryObj<typeof WsDropLine> = {
  name: 'Drop line',
  args: { top: 126, left: 28 },
  argTypes: { top: { control: { type: 'range', min: 30, max: 160, step: 1 } }, left: { control: { type: 'range', min: 8, max: 120, step: 1 } } },
  render: (args) => (
    <ListBox height={260}>
      <WsList>
        <WsSection key="docs" label="Documents" />
        <WsRow key="plan" id="plan" name="Launch plan" onOpen={did('onOpen')} />
        <WsRow key="checklist" id="checklist" name="Launch checklist" onOpen={did('onOpen')} />
        <WsRow key="research" id="research" name="Research" kind="folder" onOpen={did('onOpen')} />
        <WsRow key="pricing" id="pricing" name="Pricing page copy" onOpen={did('onOpen')} />
        <WsDropLine key="line" top={args.top} left={args.left} />
      </WsList>
    </ListBox>
  )
};

/** What's being dragged, tilted a degree, under the pointer: move the pointer over the story and it follows. */
function Following(args: ComponentProps<typeof WsDragGhost>) {
  const [at, setAt] = useState({ x: args.x, y: args.y });
  useEffect(() => {
    const move = (e: PointerEvent) => setAt({ x: e.clientX + 12, y: e.clientY + 10 });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return (
    <>
      <ListBox height={260}>
        <WsList>
          <WsSection key="docs" label="Documents" />
          <WsRow key="plan" id="plan" name="Launch plan" ghosted onOpen={did('onOpen')} />
          <WsRow key="checklist" id="checklist" name="Launch checklist" onOpen={did('onOpen')} />
          <WsRow key="research" id="research" name="Research" kind="folder" onOpen={did('onOpen')} />
        </WsList>
      </ListBox>
      <WsDragGhost {...args} x={at.x} y={at.y} />
    </>
  );
}
export const DragGhost: StoryObj<typeof WsDragGhost> = {
  name: 'Drag ghost: following the pointer',
  args: { x: 140, y: 150, icon: 'fileText', label: 'Launch plan' },
  argTypes: { icon: { control: 'select', options: ICON_NAMES } },
  render: (args) => <Following {...args} />
};

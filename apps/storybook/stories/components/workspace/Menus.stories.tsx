/*
 * The workspace's menus. Every menu and sheet sits on WsPopover, against what opened it or against a place (where
 * someone right-clicked, or where some words are): it flips to stay on screen, closes on Esc or a click outside, hands
 * focus back, and on a phone it's a sheet at the bottom. WsMenu is one menu for everything (headings, separators, lines
 * of text, ticks, keys, people), and each of the others is its rows in the canvas's words: New (WsNewMenu), a row's ⋯
 * (WsRowMenu), a document's ⋯ (WsDocMenu), Move to… (WsMovePicker), the workspace at the top of the list
 * (WsSpacePicker), and Ask on a selection (WsAskMenu). Up, Down, Home and End move through a menu.
 */
import {
  Button, WsAskMenu, WsDoc, WsDocMenu, WsList, WsMenu, WsMovePicker, WsNewMenu, WsPage, WsPane, WsPopover, WsRow, WsRowMenu, WsScroll, WsSection, WsSpacePicker, WsToasts,
  type WsMenuRow, type WsPoint, type WsSpaceChoice
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, PopSurface, Row, did } from '../../../src/component';
import { AIKO, KOFI, MAYA, PRIYA } from '../../../src/world/people';
import { DocOf, ListOf, NEW_SPACE, PRODUCT_ITEMS, SPACES, first, useWorkspace, type Opened } from './parts';

const meta = {
  title: 'Components/Workspace/Menus',
  component: WsMenu,
  subcomponents: { WsPopover, WsNewMenu, WsRowMenu, WsDocMenu, WsMovePicker, WsSpacePicker, WsAskMenu },
  parameters: { layout: 'centered' }
} satisfies Meta<typeof WsMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The list, answering, with one of its popovers open from its control. */
function ListWith({ opened, call = true }: { opened: Opened; call?: boolean | undefined }) {
  const ws = useWorkspace({ call, opened });
  return <><Box width={244} height={560}><WsPane><ListOf ws={ws} /></WsPane></Box><WsToasts toasts={ws.toasts} /></>;
}
/** A document, answering, with one of its popovers open. */
function DocWith({ opened, height = 560 }: { opened: Opened; height?: number | string | undefined }) {
  const ws = useWorkspace({ call: true, opened });
  return <><Box width="100%" height={height}><WsPane><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box><WsToasts toasts={ws.toasts} /></>;
}
const WIDE = { parameters: { layout: 'padded' } };
const PHONE = { parameters: { layout: 'fullscreen' }, globals: { viewport: { value: 'phone', isRotated: false } } };

/* ---------- one menu for everything ---------- */

const pressed = did('onSelect');
/** A workspace picker's rows with one ticked, then one of every other kind. Pressing a workspace moves the tick. */
function Everything({ label }: { label: string }) {
  const [space, setSpace] = useState('ws-product');
  const rows: WsMenuRow[] = [
    { type: 'head', label: 'This call’s workspace' },
    ...SPACES.map((s): WsMenuRow => ({ id: s.id, icon: 'folders', label: s.name, sub: s.sub, ticked: s.id === space, onSelect: () => { pressed(s.id); setSpace(s.id); } })),
    { type: 'sep' },
    { type: 'head', label: 'In this call' },
    { id: 'priya', person: PRIYA, label: PRIYA.name, sub: 'In Launch plan', onSelect: pressed },
    { type: 'sep' },
    { id: 'document', icon: 'filePlus', label: 'New document', hint: 'N', onSelect: pressed },
    { id: 'trash', icon: 'trash', label: 'Move to Trash', tone: 'caution', onSelect: pressed },
    { type: 'text', icon: 'sealed', label: 'Written in confidential compute.' }
  ];
  return <PopSurface ws><WsMenu label={label} rows={rows} /></PopSurface>;
}
/** Headings, separators, people, keys, a caution and a line of text, with the chosen one ticked in the colour you can press. */
export const MenuEvery: Story = { name: 'Menu: every kind of row', args: { label: 'This call’s workspace', rows: [] }, argTypes: { rows: { control: false } }, render: ({ label }) => <Everything label={label} /> };

const chosen = (fixed: boolean): WsMenuRow[] => [
  { type: 'head', label: 'This call’s workspace' },
  { id: 'product', icon: 'folders', label: 'Product', sub: '6 people', ticked: true, fixed, onSelect: pressed },
  ...(fixed ? [{ type: 'text', label: 'Priya chooses the workspace for this call.' } satisfies WsMenuRow] : [{ id: 'design', icon: 'folders', label: 'Design', sub: '4 people', ticked: false, onSelect: pressed } satisfies WsMenuRow])
];
/** Ticked, for the one you chose and can change; fixed, when it only says what someone else chose, so the tick isn't in the colour you can press. */
export const MenuFixed: Story = {
  name: 'Menu: ticked, and fixed', args: { label: 'This call’s workspace', rows: [] }, argTypes: { rows: { control: false } },
  render: ({ label }) => <Row><PopSurface ws><WsMenu label={label} rows={chosen(false)} /></PopSurface><PopSurface ws><WsMenu label={label} rows={chosen(true)} /></PopSurface></Row>
};

/** A field that keeps focus while Up and Down move the highlight in the menu under it, as tagging someone does. */
function Picking({ label }: { label: string }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const people = [PRIYA, KOFI, AIKO, MAYA].filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (people.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => (n + 1) % people.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => (n - 1 + people.length) % people.length); }
    if (e.key === 'Enter') { e.preventDefault(); pressed(people[at]?.name); }
  };
  return (
    <PopSurface ws>
      <div className="wm">
        <input className="wm-in w-full" type="text" placeholder="Tag someone" aria-label="Tag someone" value={query} onChange={(e) => { setQuery(e.target.value); setAt(0); }} onKeyDown={keys} />
      </div>
      <WsMenu label={label} rows={people.length === 0
        ? [{ type: 'text', label: `Nobody called “${query}” in this call.` }]
        : people.map((p, i): WsMenuRow => ({ id: p.id, person: p, label: p.name, sub: 'In this call', selected: i === at, onSelect: () => pressed(p.name) }))} />
    </PopSurface>
  );
}
export const MenuSelected: Story = { name: 'Menu: highlighted from a field', args: { label: 'Tag someone', rows: [] }, argTypes: { rows: { control: false } }, render: ({ label }) => <Picking label={label} /> };

/* ---------- what they sit on ---------- */

type PopoverStory = StoryObj<typeof WsPopover>;
const popoverTypes: PopoverStory['argTypes'] = {
  side: { control: 'inline-radio', options: ['top', 'right', 'bottom', 'left'] },
  align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
  children: { table: { disable: true } }, anchor: { table: { disable: true } }, at: { control: 'object' }
};

/** Against the control that opened it, which it toggles. The controls move it to each side. */
const fromControl: PopoverStory['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsPopover>>();
  const close = () => update({ open: false });
  return (
    <WsPopover open={args.open} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} label={args.label} side={args.side} align={args.align} takeFocus={args.takeFocus}
      anchor={<Button size="sm" icon="more">More for this document</Button>}>
      <WsDocMenu onHistory={close} onDuplicate={close} onMove={close} onCopyLink={close} onExport={close} onTrash={close} />
    </WsPopover>
  );
};
export const PopoverAnchored: PopoverStory = {
  name: 'Popover: from its control', args: { open: true, label: 'More for this document', side: 'bottom', align: 'start', takeFocus: true, onOpenChange: did('onOpenChange'), children: null },
  argTypes: popoverTypes, render: fromControl
};

/** Right-click anywhere in the list: the row's menu opens where you clicked. */
const atPoint: PopoverStory['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsPopover>>();
  const close = () => update({ open: false });
  return (
    <div onContextMenu={(e) => { e.preventDefault(); const at: WsPoint = { x: e.clientX, y: e.clientY }; update({ open: true, at }); }}>
      <Box width={244} height={300}>
        <WsPane>
          <WsList>
            <WsSection key="docs" label="Documents" />
            {PRODUCT_ITEMS.filter((i) => i.parent === null).map((i) => <WsRow key={i.id} id={i.id} name={i.name} kind={i.kind} onOpen={did('onOpen')} />)}
          </WsList>
        </WsPane>
      </Box>
      <WsPopover open={args.open} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }} label={args.label} at={args.at}>
        <WsRowMenu onRename={close} onDuplicate={close} onMove={close} onCopyLink={close} onTrash={close} />
      </WsPopover>
    </div>
  );
};
export const PopoverAtAPoint: PopoverStory = {
  name: 'Popover: at a point, as a right-click', ...WIDE,
  args: { open: true, label: 'Options for Launch plan', at: { x: 150, y: 130 }, onOpenChange: did('onOpenChange'), children: null }, argTypes: popoverTypes, render: atPoint
};

/** Against some words: `at` says where they are now, here a selection Ask was pressed on. */
function OverWords() {
  const words = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(true);
  const close = () => setOpen(false);
  return (
    <Box width={560} height={300}>
      <WsPane page>
        <WsDoc>
          <WsScroll>
            <WsPage>
              <div className="ws-ed"><div className="ws-text">
                <div className="wb is-p" style={{ '--ind': 0 }}><div className="wb-col"><div className="wb-t">
                  Harbour lets importers follow every container from the port to the warehouse, in one place. <span ref={words} className="whl" onClick={() => setOpen(true)}>Pilot customers cut the time they spend chasing shipments by more than half.</span>
                </div></div></div>
              </div></div>
            </WsPage>
          </WsScroll>
        </WsDoc>
      </WsPane>
      <WsPopover open={open} onOpenChange={setOpen} label="Ask Alcove" at={() => words.current?.getBoundingClientRect() ?? new DOMRect()}>
        <WsAskMenu onShorter={close} onChecklist={close} onSaid={close} />
      </WsPopover>
    </Box>
  );
}

/* ---------- each menu ---------- */

/** Plus, at the top of the list and on a folder. */
export const NewMenu: StoryObj<typeof WsNewMenu> = {
  name: 'New menu', args: { onDocument: did('onDocument'), onFolder: did('onFolder'), onUpload: did('onUpload') },
  render: (args) => <PopSurface ws><WsNewMenu {...args} /></PopSurface>
};
/** From the list's +: a document opens at once, a folder is named in its row. */
export const NewMenuOpen: Story = { name: 'New menu: from the list’s +', args: { label: 'New', rows: [] }, ...WIDE, render: () => <ListWith opened={{ key: 'new' }} call={false} /> };

type RowMenuStory = StoryObj<typeof WsRowMenu>;
const ROW_MENU = { onRename: did('onRename'), onDuplicate: did('onDuplicate'), onMove: did('onMove'), onToggleCall: did('onToggleCall'), onCopyLink: did('onCopyLink'), onTrash: did('onTrash') };
const rowMenu: RowMenuStory['render'] = (args) => <PopSurface ws><WsRowMenu {...args} /></PopSurface>;
/** A document in a call that isn't in This call yet. */
export const RowMenuInACall: RowMenuStory = { name: 'Row menu: a document in a call', args: { ...ROW_MENU, folder: false, brought: false }, render: rowMenu };
/** A document already in This call. */
export const RowMenuBrought: RowMenuStory = { name: 'Row menu: a document brought to the call', args: { ...ROW_MENU, folder: false, brought: true }, render: rowMenu };
/** A folder: no Duplicate, Bring to this call or Copy link. */
export const RowMenuFolder: RowMenuStory = { name: 'Row menu: a folder', args: { ...ROW_MENU, folder: true, brought: false }, render: rowMenu };
/** Outside a call there's nothing to bring it to. */
export const RowMenuOutside: RowMenuStory = { name: 'Row menu: outside a call', args: { onRename: did('onRename'), onDuplicate: did('onDuplicate'), onMove: did('onMove'), onCopyLink: did('onCopyLink'), onTrash: did('onTrash') }, render: rowMenu };
/** From a row's ⋯ in a call: everything does what it says, and Move to… takes the menu's place. */
export const RowMenuOpen: Story = { name: 'Row menu: from a row’s ⋯', args: { label: 'Options', rows: [] }, ...WIDE, render: () => <ListWith opened={{ key: 'menu:tree:plan' }} /> };

type DocMenuStory = StoryObj<typeof WsDocMenu>;
const DOC_MENU = { onShare: did('onShare'), onPresent: did('onPresent'), onHistory: did('onHistory'), onDuplicate: did('onDuplicate'), onMove: did('onMove'), onCopyLink: did('onCopyLink'), onExport: did('onExport'), onTrash: did('onTrash') };
/** ⋯ at the top of a document. Share and Present are in it too, but show only on a phone, where the head has no room for them. */
export const DocMenu: DocMenuStory = { name: 'Doc menu', args: DOC_MENU, render: (args) => <PopSurface ws><WsDocMenu {...args} /></PopSurface> };
/** On a phone: the head's ⋯ opens a sheet at the bottom, with Share and Present at the top. */
export const DocMenuPhone: Story = { name: 'Doc menu: on a phone', args: { label: 'More for this document', rows: [] }, ...PHONE, render: () => <DocWith opened={{ key: 'more' }} height="100vh" /> };

type MoveStory = StoryObj<typeof WsMovePicker>;
/** Move to…: the top of the workspace, then its folders, each with the folders it's in. */
export const MovePicker: MoveStory = {
  name: 'Move picker',
  args: {
    name: 'Interview notes', space: 'Product', onRoot: did('onRoot'), onFolder: did('onFolder'),
    folders: [{ id: 'research', name: 'Research' }, { id: 'pilots', name: 'Pilot customers', path: 'Research' }, { id: 'round', name: 'Second round', path: 'Research / Pilot customers' }]
  },
  argTypes: { folders: { control: 'object' } },
  render: (args) => <PopSurface ws><WsMovePicker {...args} /></PopSurface>
};
/** In the row's menu's place: choosing moves it there, and the toast can undo it. */
export const MovePickerOpen: Story = { name: 'Move picker: in place of a row’s menu', args: { label: 'Move', rows: [] }, ...WIDE, render: () => <ListWith opened={{ key: 'menu:tree:interviews', step: 'move' }} /> };

type SpaceStory = StoryObj<typeof WsSpacePicker>;
/** Every kind: a team's workspace, one that's only yours, and the whole company's. */
const ALL_SPACES: WsSpaceChoice[] = [...SPACES, NEW_SPACE, { id: 'ws-company', name: 'Vandelay Industries', sub: 'Everyone', icon: 'building' }];
/** Picking moves the tick, as the list's head does. */
const picking: SpaceStory['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsSpacePicker>>();
  return <PopSurface ws><WsSpacePicker {...args} onPick={(id) => { args.onPick(id); update({ current: id }); }} /></PopSurface>;
};
const SPACE_PICKER = { spaces: ALL_SPACES, current: 'ws-product', onPick: did('onPick'), onNew: did('onNew') };
const spaceTypes: SpaceStory['argTypes'] = { spaces: { control: 'object' }, current: { control: 'inline-radio', options: ALL_SPACES.map((s) => s.id) } };
/** The organizer's: their workspaces, each with who's in it, and New workspace. */
export const SpacePickerOrganizer: SpaceStory = { name: 'Space picker: the organizer chooses', args: { ...SPACE_PICKER, canChoose: true }, argTypes: spaceTypes, render: picking };
/** Everyone else's: which workspace it is, and who chooses. */
export const SpacePickerSomeoneElse: SpaceStory = { name: 'Space picker: someone else', args: { ...SPACE_PICKER, canChoose: false, organizer: first(PRIYA) }, argTypes: spaceTypes, render: picking };
/** Outside a call it's just your workspaces. */
export const SpacePickerApp: SpaceStory = { name: 'Space picker: outside a call', args: { ...SPACE_PICKER, canChoose: true, heading: 'Workspaces' }, argTypes: spaceTypes, render: picking };

/** Ask, on the bar over a selection: three things Alcove can do with it. */
export const AskMenu: StoryObj<typeof WsAskMenu> = {
  name: 'Ask menu', args: { onShorter: did('onShorter'), onChecklist: did('onChecklist'), onSaid: did('onSaid') },
  render: (args) => <PopSurface ws><WsAskMenu {...args} /></PopSurface>
};
/** Against the words it's about, at a place that moves with them. Pressing the words opens it again. */
export const AskMenuOverWords: Story = { name: 'Ask menu: over a selection', args: { label: 'Ask Alcove', rows: [] }, render: () => <OverWords /> };

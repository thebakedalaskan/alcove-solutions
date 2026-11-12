/*
 * The workspace's toasts and the bar above a phone's keyboard. A toast (WsToast) is a face or an icon, the words, and
 * maybe one thing to press; they rise into the corner (WsToasts) and go after their time, and `wsToast` has every one
 * the workspace says, in its words, and what the call says as something is presented, followed, closed and stopped, in the
 * canvas's. On a phone, the keyboard bar (WsKeyboardBar) sits on top of the keyboard while you write, with blocks, styles,
 * tagging, photos and checklists, and Done to put the keyboard away.
 */
import { Button, WsKeyboardBar, WsPane, WsToast, WsToasts, wsToast, type WsToastData } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { Box, Stack, did } from '../../../src/component';
import { KOFI, PRIYA } from '../../../src/world/people';
import { DocOf, GUEST, NEW_SPACE, first, useToasts, useWorkspace } from './parts';

const undo = did('onUndo');
const go = did('onGo');
/** Every toast the workspace says, by its name in `wsToast`. A new one there fails the typecheck until it's here. */
const EVERY: { [K in keyof typeof wsToast]: WsToastData } = {
  linkCopied: wsToast.linkCopied(),
  exported: wsToast.exported(),
  moved: wsToast.moved('Research', undo),
  broughtToCall: wsToast.broughtToCall('Pricing page copy'),
  trashed: wsToast.trashed('Launch plan', undo),
  blockDeleted: wsToast.blockDeleted(undo),
  canOpen: wsToast.canOpen(first(GUEST), 'read', 'Launch plan'),
  stoppedFollowing: wsToast.stoppedFollowing(first(PRIYA), did('onAgain')),
  followingEnded: wsToast.followingEnded(first(PRIYA)),
  cantOpen: wsToast.cantOpen(first(PRIYA)),
  tagged: wsToast.tagged(PRIYA, first(PRIYA), 'Launch plan', go),
  resolved: wsToast.resolved(did('onReopen')),
  addedTo: wsToast.addedTo('Launch plan', go),
  restoredVersion: wsToast.restoredVersion('Wed 28 Oct', undo),
  restoredBy: wsToast.restoredBy(first(KOFI), 'Wed 28 Oct', did('onHistory')),
  restored: wsToast.restored(),
  deleted: wsToast.deleted('Old roadmap'),
  failed: wsToast.failed('That workspace isn’t there, or you can’t open it.'),
  presentingPrivate: wsToast.presentingPrivate(first(KOFI), { who: first(KOFI), onAsk: did('onAsk') }),
  presenterLeft: wsToast.presenterLeft(first(PRIYA)),
  switched: wsToast.switched('Design', 'Product', did('onBack')),
  newSpace: wsToast.newSpace(NEW_SPACE.name, 'Product'),
  askedForNotes: wsToast.askedForNotes(first(PRIYA)),
  notesOn: wsToast.notesOn(),
  backOnline: wsToast.backOnline(),
  reconnected: wsToast.reconnected(),
  copiedText: wsToast.copiedText(),
  savedAsNew: wsToast.savedAsNew(did('onOpen')),
  discarded: wsToast.discarded(),
  screenOn: wsToast.screenOn('tab'),
  screenOff: wsToast.screenOff(),
  screenAway: wsToast.screenAway(),
  boardOn: wsToast.boardOn('Launch retro'),
  workspaceOn: wsToast.workspaceOn(),
  closedForYou: wsToast.closedForYou(),
  closedForAll: wsToast.closedForAll(),
  closedWhile: wsToast.closedWhile(first(PRIYA)),
  followingWorkspace: wsToast.followingWorkspace(first(PRIYA)),
  followingBoard: wsToast.followingBoard(first(PRIYA), 'Launch retro'),
  presentingScreen: wsToast.presentingScreen(first(PRIYA)),
  presentingToo: wsToast.presentingToo(KOFI, first(KOFI), 'their screen', did('onShow')),
  stoppedPresentingIt: wsToast.stoppedPresentingIt('folderOpen', first(PRIYA), 'the workspace'),
  closedEverywhere: wsToast.closedEverywhere('Launch retro'),
  closedByOrganizer: wsToast.closedByOrganizer(first(PRIYA), 'the workspace'),
  stoppedSharing: wsToast.stoppedSharing(first(KOFI)),
  stoppedTheirShare: wsToast.stoppedTheirShare(first(PRIYA))
};
const ALL = Object.entries(EVERY);

const meta = {
  title: 'Components/Workspace/Toasts',
  component: WsToast,
  subcomponents: { WsToasts, WsKeyboardBar },
  parameters: { layout: 'centered' },
  argTypes: { toast: { control: false } }
} satisfies Meta<typeof WsToast>;
export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- one toast ---------- */

/** An icon and the words. */
export const WithAnIcon: Story = { name: 'Toast: with an icon', args: { toast: wsToast.linkCopied() } };
/** Someone's face in place of the icon, and Go there: Priya tagged you. */
export const WithAPerson: Story = { name: 'Toast: with a person', args: { toast: wsToast.tagged(PRIYA, first(PRIYA), 'Launch plan', go) } };
/** One thing to press: Undo. */
export const WithAnAction: Story = { name: 'Toast: with an action', args: { toast: wsToast.trashed('Launch plan', undo) } };

/** Every toast, by its name in `wsToast`, as it shows. */
export const Every: Story = {
  name: 'Toast: every one',
  args: { toast: wsToast.linkCopied() },
  parameters: { layout: 'padded', controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))] gap-x-6 gap-y-5">
      {ALL.map(([name, toast]) => (
        <div key={name} className="grid gap-1.5 justify-items-start">
          <code className="ac-mono text-xs text-ink-3">wsToast.{name}</code>
          <WsToast toast={toast} />
        </div>
      ))}
    </div>
  )
};

/* ---------- the corner ---------- */

/**
 * Toasts in the corner over the workspace, three at most, each leaving after its time. Say another adds the next one
 * the workspace says; pressing a toast's action does it and takes the toast away.
 */
const STARTING = [EVERY.linkCopied, EVERY.tagged, EVERY.moved].map((t) => ({ ...t, ms: 60_000 }));
function CornerToasts() {
  const ws = useWorkspace({ call: true });
  const { toasts, say } = useToasts(STARTING);
  const [next, setNext] = useState(0);
  const sayNext = () => {
    const entry = ALL[next % ALL.length];
    if (entry) say(entry[1]);
    setNext((n) => n + 1);
  };
  return (
    <Stack>
      <Button size="sm" icon="plus" onClick={sayNext}>Say another</Button>
      <Box width="100%" height={560}><WsPane><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box>
      <WsToasts toasts={toasts} />
    </Stack>
  );
}
export const Corner: Story = {
  name: 'Toasts: in the corner', args: { toast: wsToast.linkCopied() }, parameters: { layout: 'padded', controls: { disable: true } }, render: () => <CornerToasts />
};

/* ---------- above a phone's keyboard ---------- */

/**
 * On a phone, writing in Launch checklist: the bar sits where the keyboard begins, `lift` px up. Done puts the keyboard
 * away and the bar with it; touching the page brings them back.
 */
function Writing(args: ComponentProps<typeof WsKeyboardBar>) {
  const ws = useWorkspace({ call: true, start: 'checklist' });
  const [writing, setWriting] = useState(true);
  const lift = writing ? args.lift ?? 0 : 0;
  return (
    <>
      <div onPointerDown={() => setWriting(true)}>
        <Box width="100%" height={`calc(100vh - ${lift}px)`}><WsPane><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box>
      </div>
      {writing && <WsKeyboardBar {...args} lift={lift} onDone={() => { args.onDone(); setWriting(false); }} />}
    </>
  );
}
export const KeyboardBar: StoryObj<typeof WsKeyboardBar> = {
  name: 'Keyboard bar: above the keyboard',
  args: { lift: 336, onBlock: did('onBlock'), onStyle: did('onStyle'), onTag: did('onTag'), onPhoto: did('onPhoto'), onChecklist: did('onChecklist'), onDone: did('onDone') },
  argTypes: { lift: { control: { type: 'range', min: 0, max: 420, step: 4 } } },
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: (args) => <Writing {...args} />
};

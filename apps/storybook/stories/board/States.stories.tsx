/*
 * Every other state a board can be in, from the design canvas's States: saved, reconnecting, couldn't save, view only, and
 * a board you can't open. The seal beside the board's name says which, and the pill at the top says what it means for you.
 * Each is the real surface on the launch retro, in the call.
 */
import { BoardNoAccess, BoardPill, BoardPop } from '@alcove/ui';
import type { Meta } from '@storybook/react-vite';
import { BoardScene, whereItShows, type BoardStory } from '../../src/board';
import { did } from '../../src/component';
import { AROUND, launchRetro } from '../../src/world/boards';

const meta = {
  title: 'Board/States',
  component: BoardScene,
  decorators: [whereItShows],
  parameters: { layout: 'fullscreen' },
  args: { board: () => launchRetro(), mode: 'call', name: 'Launch retro', others: [], talking: ['priya'] },
  argTypes: { board: { control: false }, others: { control: false }, talking: { control: false }, follow: { control: false }, children: { control: false }, sealIcon: { control: false } }
} satisfies Meta<typeof BoardScene>;
export default meta;

/**
 * Saved, as it is almost all of the time: the seal says Sealed, and its menu says who can add to it, where it's saved, and
 * that it’s encrypted in storage.
 */
export const Saved: BoardStory = {
  args: {
    children: (
      <BoardPop left={12} top={62} title="Sealed" rows={[
        { icon: 'lock', text: 'Everyone in this call can add to it. Saved in Product.' },
        { icon: 'notes', text: 'The notes can use this board.' },
        { icon: 'sealed', text: 'Encrypted in storage.' }
      ]} />
    )
  }
};

/** Reconnecting: you keep working. What you add goes up when the connection comes back, once, with nothing lost or doubled. */
export const Reconnecting: BoardStory = {
  args: { seal: 'Reconnecting', sealIcon: 'wifiOff', children: <BoardPill icon="wifiOff" title="Reconnecting" text="Keep going. Your changes are safe here." /> }
};
export const ReconnectingDark: BoardStory = { ...Reconnecting, name: 'Reconnecting, dark', globals: { theme: 'dark' } };
/**
 * Reconnecting while the browser is online: it's Alcove that can't be reached, so the pill, and the seal's pop, have Try now,
 * which tries again at once rather than after the wait.
 */
export const ReconnectingTryNow: BoardStory = {
  name: 'Reconnecting, Try now',
  args: { seal: 'Reconnecting', sealIcon: 'wifiOff', children: <BoardPill icon="wifiOff" title="Reconnecting" text="Keep going. Your changes are safe here." action="Try now" onAction={did('try now')} /> }
};
export const ReconnectingTryNowDark: BoardStory = { ...ReconnectingTryNow, name: 'Reconnecting, Try now, dark', globals: { theme: 'dark' } };

/** Couldn't save: it says how many changes are only on this screen, and retries on its own as well. */
export const CouldNotSave: BoardStory = {
  name: 'Couldn’t save',
  args: { seal: 'Not saved', sealIcon: 'cloudOff', children: <BoardPill icon="cloudOff" title="Couldn’t save" text="Your last 3 changes are only here." action="Try again" onAction={did('try again')} /> }
};
export const CouldNotSaveDark: BoardStory = { ...CouldNotSave, name: 'Couldn’t save, dark', globals: { theme: 'dark' } };

/**
 * View only, for anyone given view access: the tools go away, and they can still look round, follow people and talk. In a call,
 * Vote stays on the bar, disabled, and says why: only people who can add to this board can vote. More stays theirs.
 */
export const ViewOnly: BoardStory = { name: 'View only', args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true, others: AROUND } };
/** Someone with view access still sees what the call runs: here, a vote's results, which someone who can add to the board started. */
export const ViewOnlyResults: BoardStory = {
  name: 'View only, a vote’s results',
  args: { mode: 'read', seal: 'View only', sealIcon: 'eye', acts: true, children: <BoardPill icon="vote" title="Results" text="7 people voted" /> }
};

/** A board you can't open: if the organizer opens without you, you never see its name or what's on it. You can ask for access. */
export const NoAccess: BoardStory = {
  name: 'No access',
  render: () => <BoardNoAccess who="Aiko" onAsk={did('ask Aiko for access')} />
};

/** Night board, from the bar's More: the sheet goes dark, whatever the theme. */
export const NightBoard: BoardStory = { name: 'Night board', args: { night: true, others: AROUND } };

/** On a phone: the same pill, over the board, as narrow as the phone. */
export const ReconnectingOnAPhone: BoardStory = { ...Reconnecting, name: 'Reconnecting, on a phone', globals: { viewport: { value: 'phone', isRotated: false } }, args: { ...Reconnecting.args, mode: 'phone' } };

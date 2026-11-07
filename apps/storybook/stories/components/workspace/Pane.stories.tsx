/*
 * WsPane: the workspace itself, the list of documents beside a document on one card that fills the box it's given: the
 * workspace's frame in a call, or the page in the app (`page`), where it follows the theme. In a call it's night, as the
 * whole call is. The list tucks away (`listOff`) and peeks back over the page (`listPeek`); on a phone it slides in over
 * everything (`phoneList`). Following someone draws a frame round it (`following`). Everything here answers: rows open,
 * folders twist, menus do what they say, and toasts say so.
 */
import type { Person } from '@alcove/api';
import { WsDoc, WsList, WsNoAccess, WsPane, WsToasts, wsToast } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState, type ComponentProps } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, did, onStage } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';
import { CALL, DocOf, ListOf, NEW_SPACE, first, useWorkspace } from './parts';

type PaneArgs = ComponentProps<typeof WsPane>;
type Update = (next: Partial<PaneArgs>) => void;
/** Where a story starts besides its args: which workspace, what's open, and whether Art organizes the call. */
interface Start { space?: string | undefined; start?: string | undefined; organizer?: boolean | undefined }

const onPhone = () => window.matchMedia('(max-width: 640px)').matches;
const PHONE = { parameters: { layout: 'fullscreen' }, globals: { viewport: { value: 'phone', isRotated: false } } };

/**
 * The workspace as the call and the app put it together. What the pane's args say (the list off, following) changes with
 * what's pressed, so the controls follow along.
 */
function Workspace({ args, update, space, start, organizer }: { args: PaneArgs; update: Update } & Start) {
  const [followee, setFollowee] = useState<{ person: Person; where: string }>({ person: PRIYA, where: 'Launch checklist' });
  const followingNow = useRef(args.following);
  followingNow.current = args.following;
  /* Opening anything from the list stops following, and puts a peek or a phone's list away. */
  const settle = () => {
    const next: Partial<PaneArgs> = {};
    if (args.following) next.following = false;
    if (args.listPeek) next.listPeek = false;
    if (args.phoneList) next.phoneList = false;
    if (Object.keys(next).length > 0) update(next);
  };
  const ws = useWorkspace({ call: !args.page, organizer, space, start: start ?? (args.following ? 'checklist' : 'plan'), onGo: settle });
  const follow = (person: Person, where: string) => {
    setFollowee({ person, where });
    const id = ws.shown.find((i) => i.name === where)?.id;
    if (id) ws.go(id);
    update({ following: true, listPeek: false, phoneList: false });
  };
  const stopFollowing = () => {
    if (!followingNow.current) return;
    followingNow.current = false;
    update({ following: false });
    ws.say(wsToast.stoppedFollowing(first(followee.person), () => update({ following: true })));
  };
  const toggleList = () => (onPhone() ? update({ phoneList: !args.phoneList }) : update({ listOff: !args.listOff, listPeek: false }));

  return (
    <>
      <WsPane label={args.label} page={args.page} listOff={args.listOff} listPeek={args.listPeek} phoneList={args.phoneList} following={args.following}>
        <ListOf ws={ws} onFollow={follow} />
        <DocOf ws={ws} following={args.following ? { person: followee.person, name: first(followee.person), where: followee.where } : null}
          onFollow={follow} onStopFollowing={stopFollowing} onToggleList={toggleList} />
      </WsPane>
      <WsToasts toasts={ws.toasts} />
    </>
  );
}

/** A story's render: the workspace in a box, from where it starts. */
const framed = (from: Start = {}, height: number | string = 640) => function Render(args: PaneArgs) {
  const [, update] = useArgs<PaneArgs>();
  return <Box width="100%" height={height}><Workspace key={String(args.page)} args={args} update={update} {...from} /></Box>;
};

/** Someone who can't open the call's workspace: it says it's private, and they can ask the organizer. */
function Private({ args, asked: wasAsked }: { args: PaneArgs; asked: boolean }) {
  const [asked, setAsked] = useState(wasAsked);
  return (
    <Box width="100%" height={640}>
      <WsPane label={args.label} page={args.page}>
        <WsDoc><WsNoAccess organizer={first(CALL.organizer)} asked={asked} onAsk={() => { did('onAsk')(); setAsked(true); }} /></WsDoc>
      </WsPane>
    </Box>
  );
}

const meta = {
  title: 'Components/Workspace/Pane',
  component: WsPane,
  subcomponents: { WsList, WsDoc },
  parameters: { layout: 'padded' },
  args: { children: null, label: 'Workspace', page: false, listOff: false, listPeek: false, phoneList: false, following: false },
  argTypes: { children: { table: { disable: true } }, className: { table: { disable: true } } },
  render: framed()
} satisfies Meta<typeof WsPane>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Outside a call, the workspace is a page in the app: Documents only, Share and ⋯ on a document, in the theme you chose. */
export const InTheApp: Story = { name: 'In the app', args: { page: true } };
/**
 * In a call it's night, as the whole call is. This call sits at the top of the list: the call's own Notes, Follow-ups and
 * Transcript, and the documents brought to it, with the faces of whoever's in each. Priya chooses the workspace for her
 * call, so the name at the top only says which it is.
 */
export const InACall: Story = { name: 'In a call', ...onStage, args: { page: false } };
/** The list tucked away: the panel button at the top left of the document brings it back. */
export const ListOff: Story = { name: 'List off', args: { listOff: true } };
/** The list brought back over the page for a moment. Opening something puts it away again. */
export const ListPeeking: Story = { name: 'List peeking', args: { listOff: true, listPeek: true } };
/**
 * Following Priya: the frame round the pane and the bar say so, and you go where she goes. Opening something yourself,
 * scrolling the page or Stop following ends it.
 */
export const Following: Story = { name: 'Following someone', args: { following: true } };
/** On a phone the document has the whole screen, its head keeps only the panel button and ⋯, and popovers are sheets. */
export const OnAPhone: Story = { name: 'On a phone', ...PHONE, render: framed({}, '100vh') };
/** The list on a phone slides in over the document. Opening something slides it away. */
export const PhoneList: Story = { name: 'On a phone: the list', ...PHONE, args: { phoneList: true }, render: framed({}, '100vh') };
/**
 * A workspace nobody has used: Art's call made it the first time anyone opened Workspace. New document starts a page
 * with templates under it, New folder names one in the list.
 */
export const NewWorkspace: Story = { name: 'A new workspace, empty', render: framed({ space: NEW_SPACE.id, start: '', organizer: true }) };
/** Someone in the call who can't open its workspace sees that it's private, and nothing more. Ask Priya asks. */
export const NoAccess: Story = { name: 'No access', render: (args) => <Private args={args} asked={false} /> };
/** They asked: it opens by itself once Priya shares something with them. */
export const NoAccessAsked: Story = { name: 'No access: asked', render: (args) => <Private args={args} asked /> };

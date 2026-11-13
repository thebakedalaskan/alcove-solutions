/*
 * The call screen, put together: it reads the call, starts what lasts while you're in it (each lifecycle a hook of the subfeature
 * it belongs to, in the order they start), and lays out the parts each subfeature draws: the top bar, the main area (the stage,
 * what's open on it in frames, and your side), the dock, the windows over the call, and the floating call.
 */
import { MAIN_PLACE, errorMessage, notesAreOn, type CallReaction, type CallSession, type Person } from '@alcove/api';
import { EASE, cn, useRaisedToasts, useTheme, useToast, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { accountQueries } from '~/features/account/queries';
import type { PillKind } from '~/features/board/pills';
import { useChangesSinceSaved } from '~/features/board/standing';
import { ringable } from '~/features/calls/ringing/ringWords';
import { Moved } from '~/features/move/Moved';
import { MoveSheet } from '~/features/move/MoveSheet';
import { useMoveOut } from '~/features/move/useMoveOut';
import { useCallSeries } from '~/features/notes/series/queries';
import { teamQueries } from '~/features/team/queries';
import { useWorkspaceName, workspaceQueries } from '~/features/workspace/queries';
import { captureHere } from '~/lib/capture';
import { useLeaveGuard, useLive, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { useCallAttention } from '../attention/attention';
import { useCallBrowserNotifications } from '../attention/browserNotifications';
import { useNudgeAlerts } from '../attention/nudgeAlerts';
import { statusNow, useCallClock, useStatusEndsWhenYouTalk } from '../attention/status';
import { BoardFrame, askerOf, usePresentBoard } from '../boards/BoardFrame';
import { useBoardHere } from '../boards/boardOnStage';
import { presentingWhy, useBoardPickers } from '../boards/BoardPicker';
import { useBoardPresenting, useNotesGoWithPresenting } from '../boards/boardPresenting';
import { useVoteStarted } from '../boards/boardRun';
import { BoardMine, BoardMini, loadBoard } from '../boards/BoardStage';
import { ChatPanel, newChatMemory } from '../chat/ChatPanel';
import { useMentionAlerts } from '../chat/mentionAlerts';
import { useReplyAlerts } from '../chat/replyAlerts';
import { useUnread } from '../chat/unread';
import { FloatingView } from '../floating/FloatingView';
import { useFloatingFailedSaid, useFloatingWindow } from '../floating/floatingWindow';
import { CallWindows, useCallWindows } from '../layout/CallSettings';
import { Dock } from '../layout/Dock';
import { holding, useLandKeys } from '../layout/landKeys';
import { MoreMenu } from '../layout/More';
import { PanelHost, TakingTurns, useMainArea, type HostSide } from '../layout/PanelHost';
import { PHONE_W } from '../layout/panels';
import { PeopleSeam } from '../layout/PeopleSeam';
import { usePop } from '../layout/pop';
import { useBurst } from '../layout/reactions';
import { DockShare } from '../layout/ShareMenu';
import { sideOpeners, useSide, useSideKept, useSidePlaces, type SidePlace, type SideView } from '../layout/side';
import { PeopleSide, RoomsSide, SidePanel, sideLabel } from '../layout/SidePanel';
import { TopBar } from '../layout/TopBar';
import { useWidth } from '../layout/useWidth';
import { useArrivals, useCallView, useYourView } from '../layout/view';
import { useBackgroundsOf } from '../media/backgrounds/backgrounds';
import { micName, useDevices } from '../media/devices';
import { LocalMedia } from '../media/media';
import { useMediaNotices } from '../media/notices';
import { useCallSounds } from '../media/sounds';
import { useCallRoom, useSoundUnblocked } from '../media/useCallRoom';
import { useSpeaking, useTalkingOnMute } from '../media/useSpeaking';
import { useVolumes } from '../media/volume';
import { CaptionsLine } from '../notes/CallCaptions';
import { CaptureButton, organizerName, useCaptureAlerts, whoGetsNotes } from '../notes/Capture';
import { useCallCaptions } from '../notes/captions';
import { useCatchingUp } from '../notes/catchingUp';
import { useNotesWatched } from '../notes/followNotes';
import { useLiveCall } from '../notes/liveCall';
import { NotesSide } from '../notes/NotesSide';
import { usePlanRestart, usePlanStop, useStopMarks, withRestart } from '../notes/PlanStop';
import { useNotesCapture } from '../notes/useNotesCapture';
import { useScreenCapture } from '../notes/useScreenCapture';
import { useOwnInCall } from '../notes/Yours';
import { PlayTogetherBar, useSharedVideo, useWorkspacePlaying } from '../playback/PlayTogether';
import { hostControls } from '../rooms/Hosting';
import { useBreakoutRooms, useRoomsSideGoes } from '../rooms/useBreakoutRooms';
import { ScreenFrame } from '../screen-sharing/ScreenFrame';
import { useShareScreen, useShares } from '../screen-sharing/share';
import { ShareWindows, useFocusBack, usePointing, usePopOut, useShareLooks } from '../screen-sharing/ShareInFrame';
import { useMarksGoWithPicture, useShareMarkCount } from '../screen-sharing/SharePointing';
import { useClosing } from '../stage/closing';
import type { FramePlace } from '../stage/frame';
import { isScreen, screenOf, sharerOf, useCallStage, type ThingId } from '../stage/onStage';
import { GLIDE, Stage, type StageParticipant, type StagePresented, type StageTogether } from '../stage/Stage';
import type { Box } from '../stage/stageLayout';
import { statusPills } from '../stage/statusBar';
import { TileHint } from '../stage/TileHint';
import { personMenus } from '../stage/TileMenu';
import { presentedTiles, ringWaiters, stagePeopleOf } from '../stage/tiles';
import { CallTimer } from '../timer/CallTimer';
import { useCallTimer, useTimerOpen } from '../timer/useCallTimer';
import { useWorkspacePresenting } from '../workspace/presenting';
import { WorkspaceFrame } from '../workspace/WorkspaceFrame';
import { useWorkspacePanel } from '../workspace/WorkspacePanel';
import type { Left } from './CallOver';
import { useForgetWhyLeft, useKeysLost, useOutOfTheCall, useReconnectedSaid } from './connection';
import { sessions, useClosingWithPage } from './handoff';
import { Knocks } from './Knocks';
import { letGoForMove, useDeparture, useLeaveAskGoesWithFloating, useLeaving, useQuietForLeave, whenOver } from './leaving';
import { useAloneCard, useCopyLink } from './links';
import { useOpenWhenStarted } from './opening';
import { SOMEONE, asShown, selfIn, useInvited } from './participants';
import { PlanBanners } from './PlanBanners';
import { useCallNotices } from './seen';
import { useCallControls } from './useCallControls';
import { useCallShortcuts } from './useCallShortcuts';

const clog = log.child({ component: 'call' });
/** Nobody's anywhere in the workspace, as far as the people list says while it's put away. */
const NOWHERE: Readonly<Record<string, string>> = {};

/**
 * The call screen. Once the call is over for you (you end it, whoever hosts ends it, you leave it, or you leave it with someone
 * hosting), it lets go of the call and hands its page what it needs to know of it (`onOver`), then eases back under that page
 * (`.ic-call.is-leaving`). `returning`: Rejoin brought you back from that page, and the call comes up again.
 */
export function InCall({ session, onOver, returning = false }: { session: CallSession; onOver: (left: Left) => void; returning?: boolean | undefined }) {
  useClosingWithPage(session);
  const told = useLive(session);
  /* The call as the server last said it while you were in it: a call that has ended says nothing of who was there. */
  const lastTold = useRef(told);
  if (told.phase === 'in-call' && told.participants.some((p) => p.isMe)) lastTold.current = told;
  const crypto = useLive(session.crypto);
  const direct = useLive(session.direct);
  const self = session.ticket.identity;
  const state = useMemo(() => asShown(told, crypto.members, self), [told, crypto.members, self]);
  /** The call's clock, which says when someone's status has run out. */
  const callClock = useCallClock(state);
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useForgetWhyLeft();
  const copy = useCopyLink();
  useRaisedToasts();
  const me = selfIn(state);
  const meId = me?.id ?? self;
  const organizer = state.isOrganizer;
  // Whoever hosts (the organizer, or someone standing in while they're away) lets people in and takes the notes.
  const hosting = state.isHost;
  // What the call captures now, the same for everyone; and where you are, in a breakout room, the room's, which captions,
  // catching up and asking follow.
  const mode = state.capture.mode;
  const on = notesAreOn(mode);
  const capHere = captureHere(state.capture);
  const live = state.phase === 'in-call';
  const width = useWidth();
  // One breakpoint for the layout and the dock: under it, it's a phone.
  const phone = width < PHONE_W;
  /* What's open over the call, one thing at a time; the reaction picker closes as the screen flips between phone and wide (pop.ts). */
  const [pop, setPop] = usePop(phone);
  /** Focus: what's in the frame fills your window, and everything else tucks away (⌘⇧F, Show everything, Esc). */
  const [focus, setFocus] = useState(false);
  /** Two on your stage with no room for both take turns: the one you brought to the front. */
  const [front, setFront] = useState<ThingId | null>(null);
  /** The board picker is open under Board, at the top right. */
  const [picking, setPicking] = useState(false);
  /** Which kind of pill the board on your stage shows: while it says the rooms' time, the status bar says nothing more. */
  const [boardPill, setBoardPill] = useState<PillKind | null>(null);
  const windows = useCallWindows();
  const departure = useDeparture();
  const { leaving, done } = departure;
  const callOver = done || leaving;
  // Your own view of the call (never sent anywhere): how you like calls, remembered for your account, and how you arranged this
  // one, kept in this tab until you leave it.
  const account = useQuery(accountQueries.session());
  const owner = account.data ? account.data.ownerId : account.isPending ? undefined : null;
  const layout = useCallView(state.callId, owner);
  // Whose pictures can show behind the camera: a guest's none.
  useBackgroundsOf(media, owner);
  // The call's state changes all the time; what it says about the workspace rarely does, and the workspace draws a lot. A
  // video playing tells the server's time on every read, which only its player uses, and it reads the call itself.
  const spaceKey = JSON.stringify(told.workspace, (k, v: unknown) => (k === 'nowMs' ? undefined : v));
  const space = useMemo(() => told.workspace, [spaceKey]);
  const presentNow = space.present;
  // What's been brought to this call, as the list will show it: what's in the workspace the call uses now.
  const broughtHere = space.documents.filter((d) => d.workspaceId === space.id).length;
  /* Your side: one view at a time, at the right, and a sheet on a phone. A reload finds it as it was (side.ts). */
  const side = useSide({ phone });
  const places = useSidePlaces(side);
  useSideKept({ side, kept: layout.layout.side, keep: layout.keepSide, notesOn: on });
  const chatMemory = useRef(newChatMemory());
  const devices = useDevices(m.camera);
  const speaking = useSpeaking(media, m.mic);
  /* How loud each person is for you (only your playback), kept for this call in this tab. */
  const { volumes, levels, canVolume } = useVolumes(session, told.participants);
  /* Going back a page, or anywhere else in the app, is a way out too: it asks first (leaving.ts). */
  const guard = useLeaveGuard(() => leave.request('elsewhere'), hosting);
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const unread = useUnread({ session, state, crypto, direct, self });
  const attentionAllowed = useCallAttention(state, crypto, unread.attentionMentions, !leaving && !done);
  const { room, roomView, marks, reactions } = useCallRoom({ session, media, toast, guard: guardRef });
  const burst = useBurst(reactions);
  const react = (r: CallReaction) => reactions?.fire(r);
  const capture = useNotesCapture({ session, state, crypto, media, room, departing: callOver });
  const myShare = roomView.people[self]?.screenSid ?? null;
  const screen = useScreenCapture({ session, state, media, screen: m.screen, departing: callOver });
  /* The organizer's plan and the call's notes: what's said while it has stopped them, where, and notes on again once it has more. */
  const planRestart = usePlanRestart(state, session);
  const planStop = withRestart(usePlanStop(state), planRestart);
  const stopMarks = useStopMarks(state);
  /* What the call says happened ("Notes are on…") arrives once, as a toast. Joining shows only the latest: the rest is history (seen.ts). */
  useCallNotices({ notices: state.notices, callId: state.callId, session, toast, notesBack: planRestart.notesBack });
  /* Who's invited, which only the organizer can read; everyone else learns who's here from the call (participants.ts). */
  const meeting = useInvited(state.code, organizer, told);
  useKeysLost(crypto.status, toast, guardRef);
  useMediaNotices({ hostMuted: roomView.hostMuted, changes: m.changes, toast });
  /* The browser holding back everyone's sound until the page is clicked: the status bar says so, with Play sound (useCallRoom.ts). */
  const playSound = () => { void room.startAudio(); };
  useSoundUnblocked(room, roomView.audioBlocked);
  /** Your microphone and camera as you leave: Rejoin brings them back as they were. */
  const mediaNow = () => ({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam });
  const overHere = whenOver({ last: lastTold, organizer, meeting, guard: guardRef, toast, departure, closeMenus: () => setPop(null), onOver });
  /* Ended, removed, or gone on elsewhere: it's over here, or you're told (connection.ts). `over`: this tab has let go of the call. */
  const outOfGroup = crypto.status === 'removed' || crypto.status === 'away';
  const over = useRef(false);
  useOutOfTheCall({
    session, code: state.code, phase: told.phase, roomView, cryptoStatus: crypto.status, outOfGroup, organizerTab: session.ticket.role === 'host', leaving, done, over,
    guard: guardRef, toast, navigate, qc, room, media, volumes, forgetLayout: layout.forget, discardDisplaced: capture.discardDisplaced, mediaNow, overHere
  });
  /* Moving to another device: letting go here comes first (leaving.ts). */
  const moving = useMoveOut(session, mediaNow, letGoForMove({ over, capture, session, room, media, guard: guardRef }));

  /* ---------- who is on the stage, and what's shared and presented there (tiles.tsx, share.ts, onStage.ts) ---------- */
  const stagePeople = stagePeopleOf({ state, roomView, room, m, crypto, meId, speaking, clock: callClock, levels, canVolume });
  /* Who came in when, by seat, so someone coming back keeps their place on your stage. Only people the call names have a seat. */
  const seatKey = told.participants.map((p) => p.seat).join(' ');
  useArrivals(layout.arrive, seatKey);
  // Names seen in this call, so chat from someone who has left keeps theirs.
  const named = useRef(new Map<string, Person>());
  for (const p of told.participants) named.current.set(p.id, p.person);
  const personOf = (id: string): Person => named.current.get(id) ?? state.participants.find((p) => p.id === id)?.person ?? SOMEONE;
  const byId = new Map(stagePeople.map((p) => [p.id, p.person]));
  const others = stagePeople.filter((p) => !p.isMe);
  const invited = meeting?.guests ?? [];
  const getting = whoGetsNotes(state, invited);
  const rooms = useBreakoutRooms({ session, state, room, roomView, invited, openSide: side.open });
  const { open, roomName, myRoomId } = rooms;
  const { shares, full } = useShares({
    state, live, meId, me: me?.person, m, myShare, keptMine: screen.keptMine, keptOf: screen.keptOf, others, people: rooms.unit ?? stagePeople.map((p) => p.id), part: crypto.place, roomView, room, marks, toast
  });
  const connected = roomView.connection === 'connected';
  /** A toast in the workspace's words. `topic`: what it's about, so a newer one about the same thing takes its place. */
  const sayIt = useCallback((t: WsToastData, topic?: string) => toast(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms, topic }), [toast]);
  const { stage, settled, about, presenterIn, stoppedByMe } = useCallStage({
    state, space, shares, place: myRoomId ?? MAIN_PLACE, inRoom: myRoomId !== null, kept: layout.layout.workspace.open, live, connected, unitKey: rooms.unitKey, say: sayIt
  });
  const { open: stageOpen, close: stageClose } = stage;
  const setWsOpen = useCallback((o: boolean) => { if (o) stageOpen('ws'); else stageClose('ws'); }, [stageOpen, stageClose]);
  const work = useWorkspacePanel(session, space, layout, { open: stage.on.includes('ws'), setOpen: setWsOpen });
  const { resolved: theme } = useTheme();
  /* The board in your part of the call, or a saved one just for you, on your stage (boardOnStage.ts). */
  const { board, saved, setSaved, spaceName, run: boardRun, rename: renameBoard, item: boardItem } = useBoardHere({
    session, state, stage, space, listing: picking || pop === 'board' || pop === 'shareBoard', place: myRoomId ?? MAIN_PLACE, cameBack: rooms.cameBack, me: meId,
    owner: account.data?.ownerId ?? null, talking: stagePeople.flatMap((p) => (p.speaking ? [p.id] : [])), room, myShare, whoIs: personOf, toast
  });
  /* Overseeing open rooms, the organizer's stage shows them, unless a board the rooms work on is on it (panels.ts). */
  const stageRooms = rooms.roomsView && !(rooms.roomsBoard && stage.on.includes('board')) ? rooms.roomsView : null;

  /* ---------- actions ---------- */
  const callControls = useCallControls({
    session, media,
    enabled: () => live && !leaving && !done && !over.current,
    problem: (kind) => setPop(kind),
    failed: (message) => toast(message, { icon: 'x' }),
    micChanged: (enabled) => callSounds.confirmMic(enabled),
    handChanged: (up) => toast(!up ? 'Your hand is lowered' : roomName && !organizer ? `Your hand is raised. The organizer sees that ${roomName} wants help.` : 'Your hand is raised. Everyone in this room can see it.', { icon: 'hand' })
  });
  const sharing = useShareScreen({ media, full, roomView, toast, say: sayIt, closeMenus: () => setPop(null), openPicker: () => setPop('shareScreen'), startMine: screen.startMine });
  const setHand = (up: boolean) => { callControls.hand(up); };
  const setSpot = (id: string | null) => {
    const name = id ? (id === meId ? 'You’re' : `${callName(byId.get(id) ?? SOMEONE)} is`) : '';
    session.setSpotlight(id);
    toast(id ? `${name} spotlighted for everyone` : 'Spotlight stopped for everyone', { icon: 'spotlight' });
  };
  /* Your view: pins, where you see yourself and reset, each with a way back; it waits while the stage shows every room (view.ts). */
  const yours = useYourView({ view: layout, seats: told.participants, seatKey, held: Boolean(stageRooms), toast });
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  // A board asked for as the call started (Start a call here) opens on your stage, just for you, once the call's under way here.
  const openAsked = useCallback((b: { workspaceId: string; documentId: string; name: string }) => {
    setSaved({ workspaceId: b.workspaceId, documentId: b.documentId, name: b.name || 'Untitled board' });
    stageOpen('saved');
  }, [stageOpen]);
  useOpenWhenStarted(state.code, live, openAsked);
  const controls = capture.controls({
    failed,
    notesEnabled: () => { if (!side.view && innerWidth >= 1100) side.open('notes'); },
    notesAsked: (up) => toast(up ? `You asked ${organizerName(state)} for notes` : 'You took back your ask', { icon: 'hand' })
  });
  useCaptureAlerts(state, controls);
  // Whatever brings your side up gives everything back: nothing else has a place while what's open fills your window.
  const openSide = (p: SidePlace) => { setPop(null); setFocus(false); places.goTo(p); };
  const flipSide = (v: SideView) => { setPop(null); setFocus(false); side.toggle(v); };
  /** Puts your side away. Focus that was in it goes back to the button that brings it up again, or More on a phone. */
  const closeSide = () => {
    const at = document.activeElement;
    if (at instanceof HTMLElement && at.closest('.ic-side')) {
      (document.querySelector<HTMLElement>(`.ic-top [data-side="${side.view ?? ''}"]`) ?? area.dock.current?.querySelector<HTMLElement>('[data-more]'))?.focus({ preventScroll: true });
    }
    side.close();
  };
  /* The people: your status, nudges, and whoever hosts' controls, from a tile's ⋯ or a row in People (TileMenu.tsx, Hosting.tsx). */
  const myStatus = statusNow(me?.status ?? null, callClock.now);
  const attentionReady = crypto.status === 'in' && state.attention.place === crypto.place && live;
  const host = hosting ? hostControls({ session, state, roomView, view: layout, qc }) : undefined;
  const menuOf = personMenus({ session, state, status: myStatus, peers: direct.peers, nudging: attentionReady, members: crypto.members, volumes, host, toast, failed, openPrivate: (id) => openers.privately(id) });
  /* Catching up and asking, for you alone, with a way back to live; and your own notes (catchingUp.ts, Yours.tsx). */
  const cu = useCatchingUp(session, { place: places.place, setPlace: (p) => { setPop(null); places.goTo(p); }, narrow: phone, everOn: state.notes.everOn, room: roomName, over: done });
  // Showing the notes is what keeps them up to date, for everyone in this part of the call.
  useNotesWatched(session, notesAreOn(capHere.mode) && live && places.place === 'notes');
  const own = useOwnInCall(session, {
    role: state.role, noteId: state.notes.noteId, showing: places.place === 'notes' || places.place === 'transcript' || places.place === 'yours', line: state.transcript.at(-1)?.id, place: state.capture.room?.id ?? null,
    onOpen: () => { cu.settle(); openSide('yours'); }
  });
  // What carries over is your account's, not the call's: a guest has none. It's read while it's on screen, in the notes and Ask.
  const carried = useCallSeries(state.code, Boolean(account.data) && (places.place === 'notes' || places.place === 'ask'));
  const captions = useCallCaptions({ session, lines: state.transcript, live, toast });
  const handLabel = me?.hand ? 'Lower your hand' : roomName && !organizer && !rooms.roomsOnBoards ? 'Ask for help' : 'Raise your hand';
  // Escape unpins only when you can see a pin: someone pinned who's here.
  const pinnedHere = layout.layout.pins.some((seat) => seatKey.split(' ').includes(seat));
  /**
   * ⇧P, and the seam beside the people: the people beside what's open fold into a rail of arches at the window's edge, or open
   * out into their column again. In a window too narrow for a column they're already a row of arches, so it says so instead.
   */
  const togglePeople = () => {
    if (yours.holds()) return;
    if (!focusOn && area.shownThings.length > 0 && area.placed.seam === null) { toast('In a window this narrow, the people stay a row over what’s open', { icon: 'eye' }); return; }
    setFocus(false);
    const hide = layout.panels.people !== 'hidden';
    layout.arrange((p) => ({ ...p, people: hide ? 'hidden' : 'tiles' }));
    if (hide && !stage.on.length) toast('People stay on the stage until something is open on it', { icon: 'eye' });
    else yours.onCustom();
  };
  // Where people are in the workspace is for the people list and their cards while it's on your stage; put away, only the
  // presented workspace's tile says where its presenter is (presenting.ts).
  const together: StageTogether = {
    ...work.together, where: stage.on.includes('ws') ? work.together.where : NOWHERE, lit: work.lit, onFollow: work.act.follow, onStop: work.act.stopFollowing, onGo: work.act.goTo, onTag: work.act.tagIn, canTag: work.act.canTag
  };
  /* Focus fills your window with what's on your stage: not on a phone, where it fills the screen already, nor with nothing open. */
  const focusOffered = !phone && !stageRooms && stage.on.length > 0;
  const focusOn = focusOffered && focus;
  const latestFocus = useRef(focusOn);
  latestFocus.current = focusOn;
  const toggleFocus = useCallback(() => { setFocus(!latestFocus.current); }, []);

  /* ---------- presenting the workspace (presenting.ts) and the board (boardPresenting.ts), and closing (closing.ts) ---------- */
  /** The call's board is one you can't open, brought by someone here: a presentation you can't open asks them for it. */
  const boardAccess = useRef<{ who: string; onAsk: () => void } | null>(null);
  const wsPresenting = useWorkspacePresenting({
    session, present: space.present, ended: space.ended, participants: state.participants, onStage: stage.on.includes('ws') && !done && !leaving, following: stage.following('ws'), together: work.together, at: work.at,
    act: { follow: work.act.follow, stopFollowing: work.act.stopFollowing, go: work.act.go }, say: work.act.say, failed: work.act.failed, onOwn: () => stage.setFollow('ws', false),
    access: () => boardAccess.current
  });
  const toggleMine = useCallback(() => side.toggle('mine'), [side]);
  const boardPresenting = useBoardPresenting({
    session, present: space.present, presenter: presenterIn?.id ?? null, board, account: (account.data?.ownerId ?? null) !== null, following: stage.following('board'), onFollow: (to) => stage.setFollow('board', to),
    notesOpen: side.view === 'mine', onNotes: toggleMine, failed, notesFailed: (message) => work.act.say(wsToast.failed(message))
  });
  /* Your notes beside the board go with presenting it. */
  useNotesGoWithPresenting(boardPresenting.mine, side.view, side.close);
  /** Where the keys go as what's on your stage changes under them (landKeys.ts). */
  const land = useLandKeys(phone);
  const callBoardOpen = state.board.open;
  /**
   * Whoever opened the call's board, or the organizer, may take it out of the call while nobody presents it: Close asks them for
   * whom. While rooms share it, only the organizer may, as someone in a room may be presenting it there.
   */
  const boardClosable = callBoardOpen !== null && (organizer || (callBoardOpen.canClose && open?.board !== 'shared'));
  const closing = useClosing({
    stage, land, side, session, inRoom: myRoomId !== null, sharedBoardLeaves: open?.board === 'shared' && (organizer || callBoardOpen?.canClose === true), boardClosable,
    stopWorkspace: wsPresenting.stop, stopBoard: boardPresenting.stop, stoppedByMe, stopShare: sharing.stop, toFront: setFront, leaveFocus: () => setFocus(false), say: sayIt, about, failed
  });

  /* ---------- opening: Board's picker, Workspace, and Share's steps ---------- */
  /** You may start a board: invited, not a guest. In a room it's the room's alone, and the picker says so. */
  const canStartBoard = state.role !== 'guest' && live;
  const boardOnStage: ThingId | null = stage.on.includes('board') ? 'board' : stage.on.includes('saved') ? 'saved' : null;
  /** Board, at the top right (in More on a phone), and O: the picker, or, with a board on your stage, Close. */
  const pressBoard = () => {
    if (boardOnStage) { setPop(null); setPicking(false); closing.closeThing(boardOnStage); return; }
    loadBoard();
    if (phone) setPop((p) => (p === 'board' ? null : 'board'));
    else setPicking((o) => !o);
  };
  /** Workspace, at the top right (in More on a phone), and W: opens it on your stage where you left it, or Close. */
  const pressWorkspace = () => {
    setPop(null);
    if (stage.on.includes('ws')) closing.closeThing('ws');
    else stageOpen('ws');
  };
  /** Someone else presents a board or the workspace where you are: nobody else presents until they stop, and Share says who. */
  const othersWhy = presentNow && !presentNow.mine ? presentingWhy(presentNow) : null;
  const pickerOpen = picking && !phone;
  const pickers = useBoardPickers({
    session, board, state, space, inRoom: myRoomId !== null, spaceName, showing: { open: pickerOpen || pop === 'board', share: pop === 'shareBoard' }, othersWhy,
    show: () => stageOpen('board'), closeOpen: () => { setPicking(false); setPop(null); }, closeShare: () => setPop(null), say: sayIt, failed
  });
  const presentBoard = usePresentBoard({ session, state, board, saved, presenting: boardPresenting, stage, land, spaceName, phone, say: sayIt, failed });
  /** Share › The workspace: presented straight away, once the call has said which workspace it uses. */
  const presentWorkspace = () => {
    setPop(null);
    stageOpen('ws');
    session.openWorkspace().then(() => wsPresenting.start(), failed).catch(() => undefined);
  };
  const shortcutWorkspace = useMemo(() => ({ find: () => { work.act.find(); }, toggle: () => pressWorkspaceNow.current() }), [work.act]);
  const pressWorkspaceNow = useRef(pressWorkspace);
  pressWorkspaceNow.current = pressWorkspace;
  useCallShortcuts({
    side: side.view !== null, pinned: pinnedHere, unpinAll: yours.unpinAll, closeSide, chat: () => flipSide('chat'), pressMic: () => callControls.mic(), pressCam: () => callControls.cam(), togglePeople,
    canMark: own.enabled, mark: own.mark, focusOffered, focused: focusOn, leaveFocus: () => setFocus(false), pressBoard
  }, shortcutWorkspace, toggleFocus);

  /* ---------- the connection, the timer, sounds, and leaving (connection.ts, useCallTimer.ts, sounds.ts, leaving.ts) ---------- */
  const online = useOnline();
  const down = !online || roomView.connection === 'reconnecting';
  const callTimer = useCallTimer(state, callClock, attentionReady && online && connected, m.speakerId);
  /* Timer for everyone, open over the top bar, or over the stage in focus. It closes with the timer for whoever can't start one. */
  const timerShown = callTimer.timer !== null || hosting;
  const [timerOpen, setTimerOpen] = useTimerOpen(timerShown);
  /* Nudges you got, said quietly on your side (Unmute only ever unmutes); and your status, which goes once you talk. */
  useNudgeAlerts({ state, ready: attentionReady, unmute: m.mic ? null : () => { if (!media.getSnapshot().mic) callControls.mic(); } });
  useStatusEndsWhenYouTalk(myStatus !== null && m.mic && attentionReady, () => media.level(), () => {
    session.setStatus(null).then(() => toast('You’re talking, so your status is cleared', { icon: 'check' }), failed);
  });
  const callSounds = useCallSounds({ call: session, state, chat: crypto, direct, speakerId: m.speakerId, presenting: shares.some((s) => s.mine) || Boolean(presentNow?.mine), connected: attentionReady && online && connected });
  useReconnectedSaid(down, done, work.act);
  useQuietForLeave({ done, leaveOpen: departure.leaveOpen, act: work.act, closeWindows: windows.closeAll });
  const leave = useLeaving({ session, state, hosting, departure, capture, room, media, volumes, forgetLayout: layout.forget, qc, over, guard: guardRef, controls: callControls, toast, mediaNow, overHere });

  /* ---------- the status bar over the stage, and who's rung (statusBar.tsx, tiles.tsx) ---------- */
  const marksOnMine = useShareMarkCount(marks, myShare);
  // Something else shared in place of what was: marks on it were about the old picture, so they go, for everyone.
  useMarksGoWithPicture(marks, m.screen, myShare);
  /* People the organizer rang: each waits on the stage while it's worth watching, and stays in People. */
  const team = useQuery({ ...teamQueries.team(), enabled: organizer });
  const rung = organizer ? state.ringing : [];
  const answers = useRef(new Map<string, number>());
  const ring = (p: Person) => { session.ring([p.email]).catch((e: unknown) => { clog.warn('ringing failed', { err: e }); toast(`Couldn’t ring ${callName(p)}. ${errorMessage(e)}`, { icon: 'x' }); }); };
  const stopRing = (id: string) => { session.stopRing(id).catch((e: unknown) => { clog.warn('stopping a ring failed', { err: e }); toast(`Couldn’t stop ringing. ${errorMessage(e)}`, { icon: 'x', ms: 6000 }); }); };
  const waiting = ringWaiters({ rung, answers: answers.current, now: Date.now(), rooms: !!open, ring });
  const justYou = organizer && others.length === 0 && !open && team.data !== undefined && !ringable(team.data, me?.person).length;
  const alone = useAloneCard({ justYou, captions: captions.on, callId: state.callId, code: state.code });
  const talkingOnMute = useTalkingOnMute(media, live && !m.mic && !leaving && !done);
  const spotlight = open ? null : state.spotlight;
  const bar = statusPills({
    state, organizer, hosting, live, rooms, moving: crypto.status === 'moving', pillSaysRooms: board.shown && !done && !leaving && !stageRooms && (boardPill === 'room' || boardPill === 'closing'),
    talkingOnMute, onUnmute: () => callControls.mic(), soundBlocked: roomView.audioBlocked, onPlaySound: playSound, camerasHidden: m.receiveVideo === 'off' && others.length > 0, onShowCameras: () => media.setReceiveVideo('auto'),
    alone: others.length === 0 && !open && !justYou && !alone.closed && !waiting.length && !(organizer && team.isPending), onCopyLink: () => copy(state.code),
    spotlight: spotlight ? { name: spotlight === meId ? null : callName(byId.get(spotlight) ?? SOMEONE) } : null, onStopSpotlight: () => setSpot(null),
    onBringBack: () => { session.closeRooms(); toast('Everyone is coming back to the main room', { icon: 'door' }); }
  });
  const roomsHere = organizer && (others.length > 0 || !!open);
  /* Breakout rooms in your side go with the last person who could be sent to one. */
  useRoomsSideGoes(!roomsHere && side.view === 'rooms', side.close);

  /* ---------- the main area: what's on your stage, each in its frame, and the people beside it (PanelHost.tsx) ---------- */
  const area = useMainArea({
    width, phone, focus: focusOn, side: side.view, timer: timerShown, bar: bar !== null, caption: captions.on, held: Boolean(stageRooms), on: stage.on, over: callOver,
    people: stagePeople, unit: rooms.unit, waiting, tiles: stage.tiles, spotlight, view: layout, front
  });
  const { live: liveCall, put } = useLiveCall(session, area.talking?.person ?? null, {
    // A list over the page goes, or it would cover what the panel opens beside.
    notes: controls.notes, ask: controls.ask, beside: (v) => { setPop(null); work.act.setPeek(false); places.goTo(v); },
    reveal: () => { work.act.reveal(); if (area.sideCovers) side.close(); }, covered: () => area.sideCovers
  });
  /* Screens on your stage: how you look at each, pointing, and its own window (ShareInFrame.tsx); and the floating call. */
  const screensShown = area.shownThings.flatMap((id) => { const sh = sharerOf(id); return sh ? [sh] : []; });
  const looks = useShareLooks({ shares, part: crypto.place, paused: mode === 'paused', kept: screensShown });
  useFocusBack(looks);
  const pointing = usePointing(shares, (id) => screensShown.includes(id), looks.popped);
  const popOut = usePopOut(looks.looks);
  const floating = useFloatingWindow(looks.looks, live && !done && !outOfGroup && !over.current && roomView.connection !== 'ended',
    media.micTrack()?.readyState === 'live' || media.camSource()?.readyState === 'live');
  const returnToCall = () => { floating.owner.returnToCall(); };
  const openers = sideOpeners({ places, openSide, returnToCall, part: crypto.place, generation: state.generation, openTimer: () => setTimerOpen(true) });
  const alertsAllowed = attentionAllowed && attentionReady && online && !leaving && !done;
  useReplyAlerts({ session, state, crypto, direct, allowed: alertsAllowed, onOpen: openers.addressed });
  useMentionAlerts({ session, state, crypto, direct, allowed: alertsAllowed, onOpen: openers.addressed });
  useCallBrowserNotifications({ session, state, crypto, direct, active: alertsAllowed && connected, foreground: floating.mainVisible, onOpen: openers.notification });
  /* A vote started on the board in the call while it isn't on your stage: you're told if you can vote in it, and Vote opens it there. */
  useVoteStarted({
    state, me: meId, place: myRoomId ?? MAIN_PLACE, settled, onStage: stage.on.includes('board'),
    say: (text, onVote) => { toast(text, { icon: 'vote', action: { label: 'Vote', onClick: onVote }, ms: 12000, topic: 'board-vote' }); },
    join: (frame) => {
      setSaved(null); loadBoard(); stageOpen('board'); setFront('board'); side.close(); setFocus(false);
      // Presented, opening it follows whoever presents; otherwise it goes to the vote's frame.
      if (frame && !stage.presentedOf('board')) board.showFrame(frame);
    }
  });
  useFloatingFailedSaid(floating.error, toast);
  useLeaveAskGoesWithFloating({ target: floating.target, inFloating: departure.leaveInFloating, leaving, setInFloating: departure.setLeaveInFloating, setLeaveOpen: departure.setLeaveOpen, guard: guardRef });
  const askingInFloating = departure.leaveInFloating && floating.target !== null;
  const boardChanges = useChangesSinceSaved(board.doc, board.status);
  const asker = askerOf({ board, me: meId, session, toast, failed });
  boardAccess.current = state.board.open?.role === null && asker.ask && asker.opener ? { who: asker.opener, onAsk: asker.ask } : null;
  /* A video played for everyone: the call's one player, until the call ends here (PlayTogether.tsx). */
  const player = useSharedVideo(session, !done, work.act.failed);
  const startPlaying = useCallback((documentId: string, mediaId: string) => { session.startPlaying(documentId, mediaId, 0).catch(work.act.failed); }, [session, work.act]);
  const playing = useWorkspacePlaying(player, startPlaying);
  /** The workspace's name on its frame: a new one shows while it's being kept, until the call says it. */
  const wsName = useWorkspaceName(space.id ?? '', space.name ?? 'Workspace', state.role !== 'guest').name;
  /* Where the workspace was last, so it stays there, out of sight, while it isn't on your stage. Kept above the moved page's early return, as every hook is. */
  const lastWsBox = useRef<Box | null>(null);

  if (moving.moved) {
    const leaveFor = (to: 'join' | 'home') => {
      sessions.call = null;
      void navigate(to === 'home' ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
    };
    return <Moved to={moving.moved.to} problem={moving.moved.problem} signedIn={session.ticket.role !== 'guest'} onAgain={() => leaveFor('join')} onHome={() => leaveFor('home')} />;
  }

  /* ---------- what's on your stage, each in its frame (frame.tsx), and what's presented that isn't, as tiles ---------- */
  const place: FramePlace = {
    focused: focusOn, focus: focusOffered ? { on: focusOn, onToggle: toggleFocus } : null, phone,
    // Everyone else in your part of the call follows what you present; with one thing on your stage, closing it clears the stage.
    followers: Math.max(0, area.onStage.length - 1), clears: stage.on.length <= 1
  };
  /** The organizer's, on someone else's board or workspace: it closes for everyone. */
  const closeTheirs = () => {
    stoppedByMe.current = presentNow?.key ?? null;
    session.stopPresenting(true).then(() => sayIt(wsToast.closedForAll()), (e: unknown) => { stoppedByMe.current = null; failed(e); });
  };
  // Anyone who can open the workspace presents it, guests too: before anyone's opened it, the call hasn't said which it is yet.
  const canPresentWs = (space.id === null || space.canOpen) && live;
  const wsAt = area.boxOf('ws');
  if (wsAt) lastWsBox.current = wsAt;
  const frames = callOver ? null : (
    <>
      {area.shownThings.map((id) => {
        const box = area.boxOf(id);
        if (!box) return null;
        if (isScreen(id)) {
          const s = shares.find((x) => screenOf(x.id) === id);
          return s ? (
            <ScreenFrame key={id} id={id} box={box} place={place} share={s} looks={looks} pointing={pointing} popOut={popOut} marks={marks} session={session} state={state} board={board} room={room} stage={stage}
              closing={closing} organizer={organizer} stoppedByMe={stoppedByMe} me={me?.person ?? SOMEONE} whoIs={personOf} say={sayIt} failed={failed}
              yours={{ published: Boolean(roomView.people[meId]?.screenSid), kept: screen.keptMine, m, othersPoint: me?.othersPoint ?? true, pointingOn: state.pointing, marksOn: marksOnMine, sid: myShare, onChange: () => sharing.pick() }} />
          ) : null;
        }
        if (id === 'board' || id === 'saved') return (
          <BoardFrame key={id} id={id} box={box} place={place} session={session} state={state} me={meId} board={board} run={boardRun} theme={theme} rooms={rooms} onPill={setBoardPill} notesOn={on} online={online}
            changes={boardChanges} presenting={boardPresenting} stage={stage} closing={closing} closable={boardClosable} mayPresent={canStartBoard && othersWhy === null} organizer={organizer} closeTheirs={closeTheirs}
            present={presentBoard} spaceName={spaceName} spaceId={space.id} act={work.act} rename={renameBoard} item={boardItem} asker={asker} say={sayIt} failed={failed} />
        );
        return null;
      })}
      {work.mounted && (wsAt ?? lastWsBox.current) && (
        <WorkspaceFrame key="ws" box={wsAt ?? lastWsBox.current ?? { x: 0, y: 0, w: area.mainW, h: area.size.h }} shown={wsAt !== null} place={place} session={session} state={state} participants={told.participants}
          invited={invited} space={space} work={work} name={wsName} presenting={wsPresenting} stage={stage} closing={closing} organizer={organizer} closeTheirs={closeTheirs} mayPresent={canPresentWs && othersWhy === null}
          land={land} live={liveCall} playing={playing} foot={alone.card} view={layout} onCustom={yours.onCustom} say={sayIt} failed={failed} />
      )}
    </>
  );
  const presented: StagePresented[] = callOver || area.roomsShown ? [] : presentedTiles({
    stage, shares, phone, wsWhere: wsPresenting.where, boardMini: board.savedDrawn ? null : (w, h) => <BoardMini board={board} width={w} height={h} theme={theme} />,
    onJoin: (t) => { setFocus(false); land(t.mine && t.id === 'board' ? { to: 'pager' } : { to: 'frame', id: t.id }, holding()); stageOpen(t.id); }
  });
  /** On a board being presented, whoever presents it and everyone following them go to and follow nobody else on it until they unfollow. */
  const boardOnFrame = boardPresenting.present !== null && (boardPresenting.present.mine || boardPresenting.present.watching);
  const stageBoard = board.drawn && board.shown && !callOver ? {
    find: (p: StageParticipant) => (!boardOnFrame && !p.isMe && board.onBoard.has(p.id)
      ? { goTo: () => board.goTo(p.id), follow: { on: board.following === p.id, toggle: () => board.follow(board.following === p.id ? null : p.id) } } : undefined)
  } : null;
  /* Two on your stage with no room for both take turns: the top bar says which is showing, or a phone under the arches. */
  const swap = area.placed.turns && area.shownThings.length > 1 && (
    <TakingTurns things={area.shownThings} front={area.frontId} covered={area.sideCovers} shares={shares} onPick={(id) => { setFront(id); if (area.sideCovers) side.close(); }} />
  );

  /* ---------- your side (SidePanel.tsx) ---------- */
  const sideClose = () => { cu.settle(); closeSide(); };
  const micLabel = micName(devices.mic, m.micId);
  const hostSide: HostSide | null = side.view === null || focusOn ? null : {
    view: side.view, label: sideLabel(side.view, !!open), width: area.sideW, phone: area.sideSheet, over: area.sideOver, theme, edge: area.edgeRoom, onClose: sideClose,
    children: (
      <SidePanel view={side.view} roomsOpen={!!open} onClose={sideClose}
        notes={<NotesSide session={session} state={state} getting={getting} controls={controls} capture={capture} screenProblem={screen.screenProblem} phone={phone} planStop={planStop} put={put} stops={stopMarks}
          carried={carried} account={account.data?.user.email} cu={cu} own={own} places={places} onClose={sideClose}
          onOpenPage={() => { cu.settle(); side.close(); stageOpen('ws', { own: true }); work.act.go({ kind: 'live', page: 'notes' }); }} />}
        chat={<ChatPanel session={session} state={state} crypto={crypto} direct={direct} memory={chatMemory.current} tab={places.chatTab} onTab={places.setChatTab} who={personOf} placeName={rooms.placeName}
          here={open ? roomName ?? 'the main room' : null} visible={floating.mainVisible && !focusOn && !departure.leaveOpen && !done && !moving.open && !windows.settingsOpen && !windows.backgroundOpen && pop === null}
          jump={places.chatTarget} questionJump={places.questionTarget} questionsReady={attentionReady} roomUnread={unread.unreadChat} unreadMentions={unread.unreadMentions} onRead={unread.readMentions} />}
        people={<PeopleSide state={state} named={told.participants} people={stagePeople} roomView={roomView} m={m} micLabel={micLabel} pins={layout.layout.pins} rooms={rooms} now={callClock.now} menuOf={menuOf}
          jump={places.actionTarget} invited={invited} host={host} together={together} rung={rung} canRing={(p) => team.data?.members.some((x) => x.onAlcove && sameEmail(x.person, p)) ?? false}
          ringing={organizer && live ? { ring, stop: stopRing } : null} copyLink={() => copy(state.code)} controls={controls} onRooms={roomsHere ? () => side.open('rooms') : null} />}
        rooms={<RoomsSide rooms={rooms} session={session} state={state} byId={byId} me={me} notesOn={on} />}
        mine={<BoardMine board={board} section={boardPresenting.section} notes={boardPresenting.notes} onNote={boardPresenting.setNote} theme={theme} />} />
    )
  };

  return (
    <div className="stage ac-stage" inert={done}>
      {/* Over here, the call eases back under its page; brought back by Rejoin, it comes up again. */}
      <motion.div className={cn('ic-call', done && 'is-leaving', focusOn && 'is-focus')} initial={returning && !area.reduce ? { scale: 0.985 } : false} animate={{ scale: 1 }}
        transition={{ duration: 0.56, delay: 0.1, ease: EASE.out }}>
        {focusOn && <CallTimer session={session} view={callTimer} host={hosting} connected={attentionReady && !down} open={timerOpen} onOpenChange={setTimerOpen} className="ic-timer-focus" />}
        <span className="sr-only" role="status" aria-live="polite">{callTimer.say}</span>
        <span className="sr-only" role="status" aria-live="polite">{attentionReady ? `${state.attention.hands.length === 1 ? '1 hand' : `${state.attention.hands.length} hands`} raised.${hosting ? ` ${state.waiting.length} waiting to join.` : ''}` : 'Connecting to this room.'}</span>
        <TopBar title={state.title} elapsed={state.elapsed} people={stagePeople.map((p) => p.person)} phone={phone}
          timer={<CallTimer session={session} view={callTimer} host={hosting} connected={attentionReady && !down} open={timerOpen && !focusOn} onOpenChange={setTimerOpen} phone={phone} />}
          sign={<CaptureButton state={state} role={session.ticket.role} getting={getting} controls={controls} pausing={capture.pausing} phone={phone} stop={planStop} notesOpen={side.view === 'notes'} onOpenNotes={() => openSide('notes')} />}
          asking={hosting ? state.waiting.length : 0} reconnecting={down || (crypto.status === 'joining' && !leaving)} screens={state.capture.screen.mode !== 'off'} modelPrivate={state.capture.modelPrivate}
          swap={!phone && swap}
          board={{
            on: boardOnStage !== null || pickerOpen, onPress: pressBoard,
            menu: { open: pickerOpen, onClose: () => { pickers.open.reset(); setPicking(false); }, content: pickers.open.picker, reach: () => { if (myRoomId === null && state.role !== 'guest') void qc.prefetchQuery(workspaceQueries.workspaces()); } }
          }}
          workspace={{ on: stage.on.includes('ws'), count: broughtHere, onPress: pressWorkspace }}
          side={{ view: side.view, toggle: flipSide, unread: unread.unread }} />
        <PanelHost area={area.ref} size={area.size} side={hostSide} swap={phone && swap} frames={frames}
          tiles={(
            <>
              <Stage staged={area.staged} frame={area.frame} phone={phone} people={area.onStage} waiting={waiting} presented={presented} spotlight={spotlight} view={layout} organizer={hosting}
                together={together} bar={bar} rooms={area.roomsShown ? stageRooms : null} onSpotlight={setSpot} onPin={yours.setPin} onSelf={yours.setSelf} onCustom={yours.onCustom} volumes={volumes}
                caption={captions.on ? <CaptionsLine captions={captions} hearing={capHere.transcript.mode === 'on'} mode={capHere.mode} modelPrivate={state.capture.modelPrivate} open={pop === 'cap'} onOpenChange={(o) => setPop(o ? 'cap' : null)} /> : null}
                onMorePeople={() => openSide('people')} board={stageBoard} menuOf={menuOf} />
              {area.seam && <PeopleSeam box={area.seam} small={area.peopleSmall} onToggle={togglePeople} />}
              <TileHint area={area.ref} account={owner} />
              <motion.div className="ic-frame" initial={false} animate={{ left: 0, top: 0, width: area.clearW, height: area.size.h }} transition={area.reduce ? { duration: 0 } : GLIDE}>
                <PlanBanners state={state} stop={planStop} notesOpen={side.view === 'notes'} />
                <Knocks show={hosting && side.view !== 'people' && state.waiting.length > 0} waiting={state.waiting} organizer={organizer} session={session} onMore={() => openSide('people')} />
                {!area.wsInSight && alone.card}
              </motion.div>
            </>
          )} />
        <PlayTogetherBar player={player} />
        <Dock dock={area.dock} burst={burst} tucked={focusOn} phone={phone} media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} micLabel={micLabel} controls={callControls} busy={callOver}
          pop={pop} setPop={setPop} onBackground={() => windows.setBackgroundOpen(true)} react={react} floating={floating} unread={unread.unread} onShowEverything={toggleFocus}
          leave={leave} asking={hosting && departure.leaveOpen && !askingInFloating}
          hand={{
            up: !!me?.hand, label: handLabel, ready: attentionReady, set: setHand,
            tip: me?.hand ? 'Lower your hand' : roomName && !organizer ? `Raise your hand to ask ${rooms.roomsOnBoards && rooms.organizerPerson ? callName(rooms.organizerPerson) : 'the organizer'} for help` : 'Raise your hand'
          }}
          share={<DockShare pop={pop} setPop={setPop} phone={phone} presented={stage.presented} closing={closing} sharing={sharing} full={full} changing={!!m.screen} capture={state.capture} sharingInRoom={screen.sharingInRoom}
            canStartBoard={canStartBoard} canPresentWs={canPresentWs} othersWhy={othersWhy} picker={pickers.share.picker} presentWorkspace={presentWorkspace} />}
          more={<MoreMenu pop={pop} setPop={setPop} phone={phone} picker={pickers.open.picker} react={react} board={{ on: boardOnStage !== null, press: pressBoard }}
            workspace={{ on: stage.on.includes('ws'), brought: broughtHere, press: pressWorkspace }} openSide={openSide} unread={unread.unread} waiting={hosting ? state.waiting.length : 0}
            hand={{ up: !!me?.hand, label: handLabel, set: setHand }} captions={captions} mark={own.enabled ? own.mark : null} catchUp={() => { setPop(null); cu.catchUp(); }}
            rooms={roomsHere ? { shown: side.view === 'rooms' } : null} floating={floating} live={live} done={done} resetView={yours.custom ? yours.reset : null} moveAway={moving.show}
            openSettings={() => windows.setSettingsOpen(true)} />} />
      </motion.div>
      <ShareWindows shares={shares} looks={looks} marks={marks} me={me?.person ?? SOMEONE} whoIs={personOf} />
      <MoveSheet open={moving.open} onOpenChange={(o) => { if (!o) moving.hide(); }} move={moving.move} media={{ mic: m.mic, cam: m.cam }} account={state.role !== 'guest'}
        sharing={!!m.screen} onStopSharing={sharing.stop} onMove={() => void moving.go()} onAgain={moving.again} />
      <CallWindows windows={windows} phone={phone} media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} host={host ?? null} organizer={organizer} dock={area.dock} />
      <FloatingView floating={floating} title={state.title} timer={callTimer} onTimer={() => setTimerOpen(true)} shares={shares} front={area.frontId} screensShown={screensShown} people={area.onStage}
        speaker={area.staged.speaker} crypto={crypto} connection={roomView.connection} m={m} controls={callControls} hand={!!me?.hand} busy={callOver} soundBlocked={roomView.audioBlocked} onSound={playSound}
        attention={{ hands: attentionReady ? state.attention.hands.length : 0, questions: attentionReady ? state.attention.questions.filter((q) => q.status === 'open').length : 0, waiting: hosting ? state.waiting.length : 0, chat: unread.unread }}
        onAttention={(kind) => { if (kind === 'questions') openers.questions(); else openSide(kind === 'chat' ? 'chat' : 'people'); }} leave={leave} asking={hosting && departure.leaveOpen && askingInFloating} />
    </div>
  );
}

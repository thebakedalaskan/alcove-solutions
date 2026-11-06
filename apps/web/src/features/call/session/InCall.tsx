import { useBreakoutRooms } from '../rooms/useBreakoutRooms';
import { CallCaption, CaptionLanguageMenu, captionLanguageName } from '../notes/CallCaptions';
import { useCallShortcuts } from './useCallShortcuts';
import { useCallRoom } from '../media/useCallRoom';
import { useSpeaking } from '../media/useSpeaking';
import { useWidth } from '../layout/useWidth';
import { useNotesCapture } from '../notes/useNotesCapture';
import { useScreenCapture } from '../notes/useScreenCapture';
import { asShown, SOMEONE } from './participants';
import {
  BOARD_SHOT_LIMITS, CALL_LAYOUT_MAX, CAPTION_LANGUAGES, CallPanelTabSchema, MAIN_PLACE, errorCode, errorMessage, notesAreOn, type CallAsker, type CallPanelGroup, type CallPanelGroupId, type CallPanels, type CallPeopleMode, type CallSession, type CallState, type CaptionLanguage,
  type CaptureMode, type Person, type SelfView
} from '@alcove/api';
import {
  Avatar, CallDock, DockButton, DockChevron, DockLeave, DockSeparator, DockSplit, DockWords, Dots, Icon, KnockCard, LinkRow, Popover, RecDot, RingAgain, RingReply, Scope, Tooltip, WaitTile, cn, useRaisedToasts, useTheme, useToast, volumeTag, wsToast,
  type IconName
} from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { stateOf } from '~/features/call/media/access';
import { BoardButton, BoardMoreView } from '~/features/call/boards/BoardMenu';
import type { BoardNameMenu } from '~/features/board/CallBoard';
import { StandingPill, roomPills, type PillKind } from '~/features/board/pills';
import { UNREAD, standingOf, useChangesSinceSaved } from '~/features/board/standing';
import { BoardLeaf, BoardTileOnStage, boardOverPeople, loadBoard } from '~/features/call/boards/BoardStage';
import { useBoardRun } from '~/features/call/boards/boardRun';
import { BOARD_SHOT_TOPIC, keepShot, shotHeard, shotNotice, useCallBoard } from '~/features/call/boards/callBoard';
import { useCaptions } from '~/features/call/notes/captions';
import { CamMenu, CamOptions, MicMenu, MicOptions } from '~/features/call/media/DevicePickers';
import { useDevices } from '~/features/call/media/devices';
import { HostSpill, organizerFirst } from '~/features/call/rooms/Hosting';
import { LeaveSheet, type Ended, type NextHost } from '~/features/call/session/LeaveSheet';
import { copyUrl, shownUrl, useCopyLink } from '~/features/call/session/links';
import { useOpenWhenStarted } from '~/features/call/session/opening';
import { AskView, MomentView } from '~/features/call/notes/CatchUp';
import { useCatchingUp } from '~/features/call/notes/catchingUp';
import { FromLastTime } from '~/features/call/notes/FromLastTime';
import { YoursView, useOwnInCall } from '~/features/call/notes/Yours';
import { useShareMarkCount } from '~/features/call/screen-sharing/SharePointing';
import { LocalMedia, type ShareChoice } from '~/features/call/media/media';
import { ChatView, NotesView, PeopleView, SidePanel, TranscriptView, type HostControls, type PanelPerson, type PanelView } from '~/features/call/layout/Panel';
import { PanelHost, tabName, useCallArea, useHorizon, type PanelHostHandle } from '~/features/call/layout/PanelHost';
import { PlayTogetherBar, useSharedVideo, useWorkspacePlaying } from '~/features/call/playback/PlayTogether';
import { useBoardPresenting } from '~/features/call/boards/boardPresenting';
import { usePresenting } from '~/features/call/workspace/presenting';
import {
  PHONE_W, closeAll, closeGroup, crowdedOut, frontGroup, groupOfLeaf, growShare, isArranged, isShareLeaf, mainRoom, moveLeaf, preset as layoutPreset, presetOf, setList, setPeople, shownViews, showView, solve, toggleView, zenRoom,
  type Leaf, type PanelFacts, type PanelPreset, type ShareLeaf
} from '~/features/call/layout/panels';
import { CaptureButton, NotesAsks, askedTag, organizerName, useCaptureAlerts } from '~/features/call/notes/Capture';
import { useNotesAskedNotifications } from '~/features/shell/notify';
import { captureHere } from '~/lib/capture';
import { RoomsLive, RoomsSetup } from '~/features/call/rooms/Rooms';
import { MAX_SHARES, SHARE_PROBLEMS, canShareScreen, type ShareProblem } from '~/features/call/screen-sharing/share';
import { keepSeen, seenNotices } from '~/features/call/session/seen';
import { SharePicker } from '~/features/call/screen-sharing/SharePicker';
import { VideoQuality } from '~/features/call/media/VideoQuality';
import { GLIDE, Stage, useStagePlan, type StageBoard, type StageParticipant, type StageShare, type StageTogether, type StageWaiter } from '~/features/call/layout/Stage';
import type { StageFrame } from '~/features/call/layout/stageLayout';
import { TopBar } from '~/features/call/layout/TopBar';
import type { Feed } from '~/features/call/media/Video';
import { isCustom, presetNow, useCallView, type Preset, type ViewSnapshot } from '~/features/call/layout/view';
import { ViewMenu } from '~/features/call/layout/ViewMenu';
import { canSetVolume, volumesFor } from '~/features/call/media/volume';
import { useLiveCall } from '~/features/call/notes/liveCall';
import { WorkspaceKnock } from '~/features/call/workspace/WorkspaceAsks';
import { WorkspacePanel, useWorkspacePanel } from '~/features/call/workspace/WorkspacePanel';
import { ShareSheetFor } from '~/features/workspace/Sheets';
import { ringable, rungWords, waitingOnStage } from '~/features/calls/ringing/RingWords';
import { Moved } from '~/features/move/Moved';
import { MoveSheet } from '~/features/move/MoveSheet';
import { useMoveOut } from '~/features/move/useMoveOut';
import { tickEverywhere } from '~/features/workspace/live/useFollowUps';
import { selfIn, sessions, useClosingWithPage, useLeaveGuard, useLive, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { q, qk, useCallSeries, useRenameBoard } from '~/lib/queries';
import { hm } from '~/lib/time';

const clog = log.child({ component: 'call' });
type Pop = 'mic' | 'cam' | 'cc' | 'cap' | 'more' | 'devices' | 'quality' | 'board' | null;
/** Time left in the rooms, as the rooms show it: 4:12. */
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
/** Whether what someone starts sharing is read for the notes: now, once notes resume, or not. */
const screenRead = (mode: CaptureMode): 'on' | 'paused' | undefined => (mode === 'on' || mode === 'paused' ? mode : undefined);
/** Takes away the toast that said why this tab left the call: it isn't true any more once the tab joins again. */
let leftToast: (() => void) | null = null;

const SHORT_DOCK_W = 640;

export function InCall({ session }: { session: CallSession }) {
  useClosingWithPage(session);
  const told = useLive(session);
  const crypto = useLive(session.crypto);
  const self = session.ticket.identity;
  const state = useMemo(() => asShown(told, crypto.members, self), [told, crypto.members, self]);
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  // Only the organizer can read the meeting (who's invited); everyone else learns who's here from the call.
  const meeting = useQuery({ ...q.byCode(state.code), enabled: state.isOrganizer }).data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => { leftToast?.(); leftToast = null; }, []);
  const copy = useCopyLink();
  useRaisedToasts();
  const me = selfIn(state);
  const meId = me?.id ?? self;
  const organizer = state.isOrganizer;
  // Whoever hosts (the organizer, or someone standing in while they're away) lets people in and takes the notes.
  const hosting = state.isHost;
  // What the call captures now, the same for everyone: notes on (unavailable while the host's browser can't
  // capture anything), paused by the organizer, or off. The recording follows it.
  const mode = state.capture.mode;
  const on = notesAreOn(mode);
  // What's captured where you are: in a breakout room, the room's, which the organizer can pause on its own. Captions,
  // catching up and asking follow it, and the live transcript is heard only while it says on.
  const capHere = captureHere(state.capture);
  const hearing = capHere.transcript.mode === 'on';
  const width = useWidth();
  const phone = width < PHONE_W;
  const short = width <= SHORT_DOCK_W;
  const [pop, setPop] = useState<Pop>(null);
  const [sharePick, setSharePick] = useState(false);
  /** Why the last share didn't start: the picker opens again and says what to do. */
  const [shareTrouble, setShareTrouble] = useState<Exclude<ShareProblem, 'cancelled' | 'unsupported'> | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [cc, setCc] = useState(false);
  const [lang, setLang] = useState<CaptionLanguage | null>(null);
  // Your own view of the call (never sent anywhere): how you like calls, remembered for your account, and how you
  // arranged this one, kept in this tab until you leave it.
  const account = useQuery(q.session());
  // A call opens with the panels you left, closed on a phone. With none of them open, on a wide screen, Notes opens if notes are on.
  const startPanels = (p: CallPanels) => (innerWidth < PHONE_W ? closeAll(p) : !p.groups.some((g) => g.open) && on && innerWidth >= 1100 ? showView(p, 'notes') : p);
  const owner = account.data ? account.data.ownerId : account.isPending ? undefined : null;
  const layout = useCallView(state.callId, owner, startPanels);
  // Whose pictures can show behind the camera: a guest's none.
  useEffect(() => { if (owner !== undefined) media.setAccount(owner); }, [media, owner]);
  const forgetLayout = layout.forget;
  const panels = layout.panels;
  // The call's state changes all the time; what it says about the workspace rarely does, and the workspace draws a lot. A
  // video playing tells the server's time on every read, which only its player uses, and it reads the call itself.
  const spaceKey = JSON.stringify(told.workspace, (k, v: unknown) => (k === 'nowMs' ? undefined : v));
  const space = useMemo(() => told.workspace, [spaceKey]);
  const work = useWorkspacePanel(session, space, layout);
  // What's been brought to this call, as the list will show it: what's in the workspace the call uses now.
  const broughtHere = space.documents.filter((d) => d.workspaceId === space.id).length;
  // What the side panels show now, and the view you last brought up: the one Escape closes and Back to live leaves.
  // A panel there's no room for shows nothing, so it doesn't count (`crowdedOut`).
  const [crowded, setCrowded] = useState<CallPanelGroupId[]>([]);
  const showing = shownViews(panels, phone, crowded);
  const panel: PanelView | null = frontGroup(panels, crowded)?.active ?? null;
  const setPanel = (v: PanelView | null) => layout.arrange((p) => {
    if (v) return showView(p, v);
    const g = frontGroup(p, crowded);
    return g ? closeGroup(p, g.id) : p;
  });
  /* What's typed in Chat and Ask: moving either to another panel keeps it. */
  const drafts = useRef({ chat: { text: '' }, ask: { text: '' } });
  const devices = useDevices(m.camera);
  const speaking = useSpeaking(media, m.mic);
  /* How loud each person is for you (only your playback), kept for this call in this tab. */
  const volumes = volumesFor(session);
  const levels = useLive(volumes);
  const [canVolume] = useState(canSetVolume);
  useEffect(() => { volumes.follow(told.participants); }, [volumes, told.participants]);
  const guard = useLeaveGuard(() => setLeaveOpen(true));
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const theirChat = crypto.chat.filter((c) => !c.isMe).length;
  const seenChat = useRef(theirChat);
  if (showing.includes('chat')) seenChat.current = theirChat;
  const unread = Math.max(0, theirChat - seenChat.current);

  const { room, roomView, marks } = useCallRoom({ session, media, toast, guard: guardRef });

  const live = state.phase === 'in-call';
  const capture = useNotesCapture({ session, state, crypto, media, room, departing: leaving || ended !== null });
  const { uploadError, heardProblem, pausing, discardDisplaced } = capture;

  const myShare = roomView.people[self]?.screenSid ?? null;
  const { frameProblem, sharingInRoom, screensOn } = useScreenCapture({ session, state, screen: m.screen, myShare });

  /* What the call says happened ("Notes are on…") arrives once, as a toast. Joining shows only the latest: the rest is history. */
  const shown = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Once each, in this tab: a reload doesn't say them again.
    shown.current ??= new Set([...seenNotices(state.callId), ...state.notices.slice(0, -1).map((n) => n.id)]);
    const seen = shown.current;
    let fresh = false;
    for (const n of state.notices) {
      if (seen.has(n.id)) { session.dismissNotice(n.id); continue; }
      seen.add(n.id);
      fresh = true;
      toast(n.text, { icon: n.kind === 'notes' ? 'notesPen' : n.kind === 'people' ? 'people' : 'screen', ms: 3200 });
      session.dismissNotice(n.id);
    }
    if (fresh) keepSeen(state.callId, seen);
  }, [state.notices, state.callId, session, toast]);

  /*
   * Someone asking to join: a card drops in for the organizer and stays until they're answered, wherever that happens
   * (here, in People, or on another device), or they take it back or go. A press that still comes too late lets nobody
   * in, and says why.
   */
  const [answering, setAnswering] = useState<string | null>(null);
  const answerAsk = (w: CallAsker, decide: (id: string) => Promise<void>) => {
    const now = session.getSnapshot();
    if (!now.waiting.some((x) => x.id === w.id)) {
      toast(now.participants.some((p) => p.id === w.id) ? `${w.person.name} is already in the call.` : `${w.person.name} isn’t asking to join any more.`, { icon: 'people' });
      return;
    }
    setAnswering(w.id);
    decide(w.id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setAnswering(null));
  };
  /* Letting someone signed in in from the link, or ringing them, adds them to the invite: the organizer reads who's invited again when someone is here, or rung, and not on it yet. */
  const onTheInvite = (who: { email: string }) => (meeting?.guests ?? []).some((g) => sameEmail(g, who));
  const uninvited = organizer && (told.participants.some((p) => !p.isOrganizer && p.person.email && !onTheInvite(p.person)) || told.ringing.some((r) => !onTheInvite(r.person)));
  useEffect(() => { if (uninvited) void qc.invalidateQueries({ queryKey: qk.byCode(state.code) }); }, [uninvited, state.code, qc]);

  /* This device's keys fell out of step: joining again (a reload) puts it back in, without anyone letting it in. */
  useEffect(() => {
    if (crypto.status !== 'failed') return;
    toast('This device lost the call’s encryption keys. Reload to join again.', { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guardRef.current.release(); location.reload(); } } });
  }, [crypto.status, toast]);
  /* The organizer muted your microphone: the dock already shows it off; say who did it. */
  const hostMuted = useRef(0);
  useEffect(() => {
    if (roomView.hostMuted <= hostMuted.current) return;
    hostMuted.current = roomView.hostMuted;
    toast('The organizer muted your microphone. Unmute when you’re ready.', { icon: 'micOff', ms: 5000 });
  }, [roomView.hostMuted, toast]);
  /* A device unplugged, back, or allowed again, without anyone pressing anything: said once, as it happens. */
  const seenChange = useRef(m.changes.at(-1)?.n ?? 0);
  useEffect(() => {
    for (const c of m.changes) {
      if (c.n <= seenChange.current) continue;
      seenChange.current = c.n;
      toast(c.text, { icon: c.kind === 'mic' ? 'mic' : c.kind === 'cam' ? 'video' : 'speaker', ms: 6000 });
    }
  }, [m.changes, toast]);
  /*
   * The browser is holding back everyone's sound until the page is clicked (Safari with nothing captured). The status
   * bar says so for as long as it lasts, with Play sound, and every click, tap or key tries again (iOS doesn't count
   * every touch), until sound plays.
   */
  const playSound = () => { void room.startAudio(); };
  useEffect(() => {
    if (!roomView.audioBlocked) return;
    const go = () => { void room.startAudio(); };
    const kinds = ['click', 'touchend', 'keydown'] as const;
    for (const k of kinds) addEventListener(k, go, { capture: true });
    return () => { for (const k of kinds) removeEventListener(k, go, { capture: true }); };
  }, [roomView.audioBlocked, room]);

  /*
   * The call ended, or the host removed you, or the call went on from another tab or device: you're told, and go back
   * to the call's page. The organizer is removed only by joining from another device; this screen then lets go of the
   * call. An organizer's tab that was away long enough for someone else to host goes back to the join page, where
   * joining takes the call back. A connection that dropped for good asks for a reload.
   */
  const organizerTab = session.ticket.role === 'host';
  const outOfGroup = crypto.status === 'removed' || crypto.status === 'away';
  const over = useRef(false);
  /* The connection dropped for good: its toast offers a reload, until the call says this tab is out of it (someone else hosts now). */
  const dropped = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (leaving || ended || (over.current && !(dropped.current && outOfGroup))) return;
    if (roomView.connection === 'ended' && roomView.endReason === 'error' && !outOfGroup) {
      over.current = true;
      dropped.current = toast('The call’s connection dropped. Reload to join again.', { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guardRef.current.release(); location.reload(); } } });
      return;
    }
    const gone = roomView.connection === 'ended' && (roomView.endReason === 'removed' || (!organizerTab && roomView.endReason === 'ended-by-host'));
    if (!gone && !outOfGroup) return;
    dropped.current?.();
    dropped.current = null;
    over.current = true;
    discardDisplaced();
    session.close();
    void room.leave();
    guardRef.current.release();
    sessions.call = null;
    forgetLayout();
    media.stop();
    volumes.clear();
    sessions.media = null;
    void qc.invalidateQueries();
    const away = crypto.status === 'away';
    leftToast = toast(away ? 'Your connection dropped, so someone else is hosting. Join again to take the call back.'
      : organizerTab ? 'You joined this call from another device.'
        : roomView.endReason === 'ended-by-host' ? 'The call has ended.'
          : roomView.endReason === 'removed' ? 'The host removed you from the call.'
            : 'You’re no longer in this call here. You can join again.', { icon: 'leave', ...(away ? { ms: 8000 } : {}) });
    void navigate(organizerTab && !away ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
  }, [roomView.connection, roomView.endReason, outOfGroup, crypto.status, leaving, ended, organizerTab, state.code, forgetLayout, media, volumes, navigate, toast, session, room, qc, discardDisplaced]);

  /*
   * Moving to another device. Letting go here comes first: what the notes heard so far is sent, then the microphone
   * and camera stop and this device leaves the room. Only then is the new device let in.
   */
  const moving = useMoveOut(session, () => ({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam }), async () => {
    over.current = true;
    const departure = capture.departure('move');
    await departure.flush();
    departure.finish();
    session.close();
    await room.leave().catch((e: unknown) => clog.debug('leaving the room to move', { err: e }));
    media.stop();
    sessions.media = null;
    guardRef.current.release();
  });

  /* ---------- who is on the stage: everyone in the call, with their media from the room ---------- */
  // With breakout rooms open, this browser's group is its own part of the call: someone in another part is never in it.
  const partRooms = state.breakouts.open?.rooms ?? null;
  const partOf = (id: string) => partRooms?.find((r) => r.members.includes(id))?.id ?? MAIN_PLACE;
  const stagePeople: StageParticipant[] = state.participants.map((p) => {
    const r = roomView.people[p.id];
    const video: Feed | null = p.isMe ? (m.cam && m.camera ? { stream: m.camera } : null) : r?.camSid ? { room, sid: r.camSid } : null;
    // In this part of the call by the server's word, but not in this browser's group yet (back with fresh keys after a reload, say).
    const connecting = !p.isMe && crypto.status === 'in' && partOf(p.id) === partOf(meId) && !crypto.members.includes(p.id);
    return { id: p.id, seat: p.seat, person: p.person, isMe: p.isMe, hand: p.hand, mic: p.isMe ? m.mic : r?.mic ?? false, speaking: p.isMe ? speaking : r?.speaking ?? false, video, volume: p.isMe || !canVolume ? null : levels[p.id] ?? 1, connecting };
  });
  /* Who came in when, by seat, so someone coming back keeps their place on your stage. Only people the call names have a seat. */
  const seatKey = told.participants.map((p) => p.seat).join(' ');
  const arrive = layout.arrive;
  useEffect(() => { if (seatKey) arrive(seatKey.split(' ')); }, [seatKey, arrive]);
  // Names seen in this call, so chat from someone who has left keeps theirs.
  const named = useRef(new Map<string, Person>());
  for (const p of told.participants) named.current.set(p.id, p.person);
  const personOf = (id: string): Person => named.current.get(id) ?? state.participants.find((p) => p.id === id)?.person ?? SOMEONE;
  const byId = new Map(stagePeople.map((p) => [p.id, p.person]));
  const others = stagePeople.filter((p) => !p.isMe);
  const invited = meeting?.guests ?? [];
  // As the call stands: someone signed in whom the organizer let in from the link is invited now.
  const viewerGuest = state.role === 'guest';
  /* Who gets the notes, as far as you can tell: the organizer knows everyone invited; a guest isn't told. */
  const getting: Person[] = organizer
    ? [...(me ? [me.person] : []), ...invited.filter((g) => !me || !sameEmail(g, me.person))]
    : viewerGuest ? [] : state.participants.flatMap((p) => (p.isOrganizer || p.person.email ? [p.person] : [])).filter((p, k, all) => all.findIndex((x) => x.id === p.id) === k);

  const {
    open, left, roomName, placeName, inARoom, unit, unitKey, activity, organizerPerson, message, roomsOnBoards, stageRooms, myRoomId,
    candidates, guestsHere, visit, renameRoom, moveTo, openRooms, landing, cameBack
  } = useBreakoutRooms({ session, state, room, roomView, invited, setPanel });

  /*
   * ---------- what's shared: yours, and everyone else's in your part of the call ----------
   * Several people share at once (a share starts while fewer than MAX_SHARES are going), each viewer chooses which to
   * see big, and anyone can mute the sound a share carries, for themselves.
   */
  // Pointing at a share: the organizer's switch for the call, and each presenter's own choice for others on theirs.
  const othersPointAt = (id: string) => state.participants.find((p) => p.id === id)?.othersPoint ?? true;
  const closedFor = (owner: string, mine: boolean): 'call' | 'presenter' | null => (!state.pointing ? 'call' : mine || othersPointAt(owner) ? null : 'presenter');
  const shares: StageShare[] = [
    ...(m.screen ? [{
      id: meId, feed: { stream: m.screen }, presenter: me?.person ?? SOMEONE, mine: true, label: `You’re sharing ${m.screenLabel ?? 'your screen'}`, name: 'Your screen', sound: null,
      point: myShare ? { sid: myShare, closed: closedFor(meId, true) } : null
    }] : []),
    ...others.flatMap((p): StageShare[] => {
      const r = roomView.people[p.id];
      const sid = r?.screenSid;
      if (!r || !sid) return [];
      const who = callName(p.person);
      const on = r.screenSound === 'on';
      const sound = r.screenSound ? {
        muted: !on,
        toggle: () => { room.muteShare(sid, on); toast(on ? `${who}’s share is muted for you` : `${who}’s share plays its sound again`, { icon: on ? 'speakerOff' : 'speaker' }); }
      } : null;
      return [{ id: p.id, feed: { room, sid }, presenter: p.person, mine: false, label: `${who} is sharing`, name: `${who}’s screen`, sound, point: { sid, closed: closedFor(p.id, false) } }];
    })
  ];
  /*
   * The marks store follows the call: the shares shown here (by their picture's track sid, with whose each is and whether
   * others may point at it), who's in your part of the call, which part that is, and whether pointing is on at all.
   */
  const pointingOn = state.pointing && live && roomView.connection === 'connected';
  const pointShares = shares.flatMap((s) => (s.point ? [{ sid: s.point.sid, owner: s.id, others: othersPointAt(s.id) }] : []));
  const pointPeople = unit ?? stagePeople.map((p) => p.id);
  // The part of the call is the one whose keys this browser holds (the main room, or a room by its ID): someone coming
  // or going changes who's in it, and only their own pointer and marks go.
  const pointKey = [pointingOn, crypto.place, pointShares.map((s) => `${s.sid}:${s.owner}:${s.others}`).join(','), [...pointPeople].sort().join(',')].join('|');
  useEffect(() => {
    marks?.use({ on: pointingOn, shares: new Map(pointShares.map((s) => [s.sid, { owner: s.owner, others: s.others }])), people: new Set(pointPeople), part: crypto.place });
    // pointKey says everything this reads.
  }, [marks, pointKey]);
  // A share's big-or-tile choice goes when the share stops: one seen on this connection that's gone. Before the room
  // connects (a reload) or just after it reconnects, a share may not be visible yet, and its choice stays.
  const shareKey = shares.map((s) => s.id).join(' ');
  const endShares = layout.endShares;
  const seenShares = useRef<Set<string> | null>(null);
  const connected = roomView.connection === 'connected';
  useEffect(() => {
    if (!connected) { seenShares.current = null; return; }
    const live = shareKey ? shareKey.split(' ') : [];
    const seen = seenShares.current;
    seenShares.current = new Set(live);
    const ended = seen ? [...seen].filter((id) => !live.includes(id)) : [];
    if (ended.length) endShares(ended);
  }, [shareKey, connected, endShares]);
  const sharing = shares.filter((s) => !s.mine);
  // At most MAX_SHARES going at once in your part of the call, yours counted; changing what you share is always fine.
  const full = !m.screen && sharing.length >= MAX_SHARES;

  /*
   * ---------- the board: one open for everyone in your part of the call, which only you can hide, for yourself (callBoard.ts) ----------
   * With none open, nothing here is drawn or loaded, and the call is as it always is.
   */
  const { resolved: theme } = useTheme();
  const [boardMenu, setBoardMenu] = useState(false);
  // Your workspaces, to name a board's and know whether you're in it: read only once a board is open or the Board menu opens,
  // so a call that never has one never lists them.
  const drive = useQuery({ ...q.workspaces(), enabled: state.role !== 'guest' && (state.board.open !== null || boardMenu || pop === 'board') }).data;
  const spaceName = (id: string): string | null => drive?.find((w) => w.id === id)?.name ?? (space.id === id ? space.name : null);
  const board = useCallBoard({
    place: myRoomId ?? MAIN_PLACE, cameBack,
    session, state, me: meId, owner: account.data?.ownerId ?? null, talking: stagePeople.flatMap((p) => (p.speaking ? [p.id] : [])), spaceName,
    say: (text, icon, action) => { toast(text, { icon, action }); }, sharer: sharing[0]?.presenter ?? null
  });
  const boardStatus = board.status;
  const boardRun = useBoardRun(session, state, m.speakerId);
  /*
   * Your role on the open board changed, by Share in this call or anywhere else: the board's own document hears it first, so the
   * call is read again then, and the board turns read-only, or back, in a moment rather than at the next read.
   */
  const docRole = boardStatus?.role ?? null;
  useEffect(() => {
    const said = board.open?.role ?? null;
    if (docRole === null || said === null || docRole === said) return;
    session.refresh({ call: true, log: false }).catch((e: unknown) => clog.info('call not read again for a board’s role', { code: errorCode(e) }));
  }, [docRole]);
  const renameBoard = useRenameBoard(session.ticket.pass);
  /* Who can add to it: the board's own Share, as its workspace has it, for someone in that workspace who can edit it there. */
  const boardSpace = board.open?.workspaceId ?? null;
  // The call says your place in the workspace it views; any other is in your Drive.
  const boardMember = boardSpace !== null && ((space.id === boardSpace && space.role !== null) || (drive ?? []).some((w) => w.id === boardSpace && w.role !== null));
  const boardItem = useQuery({ ...q.workspaceItem(boardSpace ?? '', board.open?.documentId ?? ''), enabled: boardMember && !!board.open?.documentId }).data;
  /* Someone put a picture of your screen on the board: you're told, so nothing of your screen goes there without you knowing. */
  useEffect(() => room.receive(BOARD_SHOT_TOPIC, (payload, from) => {
    const share = shotHeard(payload);
    if (share && share === myShare) toast(`${callName(personOf(from))} put a picture of your screen on the board.`, { icon: 'image' });
  }, BOARD_SHOT_LIMITS), [room, myShare]);
  /*
   * A share that starts once you're settled in and isn't big for you is told, with a way to see it; one you were
   * watching that stops, too. Not while the room connects or reconnects, when shares come and go with the connection.
   */
  const settledAt = useRef<number | null>(null);
  /* What a share's toast offers goes once it's been taken up some other way, or the share stops. */
  const offers = useRef(new Map<string, () => void>());
  // Starts again whenever the connection or your part of the call changes: shares come and go with either. A call that
  // ends empties the call (its state, or the room's disconnect, whichever comes first) in the render that says so, as a
  // reconnect does: `live` and `connected` cover those.
  useEffect(() => { settledAt.current = connected ? Date.now() : null; }, [connected, unitKey]);
  const settled = () => live && connected && settledAt.current !== null && Date.now() - settledAt.current > 4000;
  const shareStarted = (s: StageShare, big: boolean, show: () => void) => {
    if (big || !settled()) return;
    offers.current.get(s.id)?.();
    // While you're on the board, it comes in beside it at once, as it would have if the board had opened beside it, and nothing
    // you're doing stops. (A phone seats one at once, to take turns with the board, so it's big already.)
    if (surfaces.board) {
      show();
      toast(`${callName(s.presenter)} started sharing. It’s beside the board.`, { icon: 'screen' });
      return;
    }
    offers.current.set(s.id, work.act.announce(wsToast.sharing(s.presenter, callName(s.presenter), () => { work.act.setZen(false); show(); })));
  };
  const shareStopped = (s: StageShare, wasBig: boolean) => { if (wasBig && settled()) toast(`${callName(s.presenter)} stopped sharing`, { icon: 'stopShare' }); };

  /* ---------- actions ---------- */
  const fullText = `${MAX_SHARES} people are sharing. You can share once one of them stops.`;
  const share = (c: ShareChoice) => {
    setSharePick(false);
    setShareTrouble(null);
    // Others may have started while the picker was open: checked again here, at the click.
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    // The browser's picker needs this click: nothing is awaited before it opens.
    void media.shareScreen(c, () => toast('You stopped sharing', { icon: 'stopShare' })).then((r) => {
      if (!r.ok) {
        if (r.problem === 'unsupported') toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 });
        else if (r.problem !== 'cancelled') reopen.current(r.problem);
        return;
      }
      // The sound asked for didn't come (only asked where the browser can share it): its picker's switch was off, or
      // the computer wouldn't share it.
      if (r.sound !== 'left-out') return;
      toast(r.surface === 'browser' ? 'The tab’s sound isn’t shared. Change what you share and turn on Also share tab audio.' : 'Your computer’s sound isn’t shared here. A tab can share its sound.',
        { icon: 'speakerOff', ms: 9000, action: { label: 'Change', onClick: () => reopen.current() } });
    });
  };
  /** Opens the share picker (saying why the last try didn't start, if it didn't), unless this browser can't share or four already are. */
  const pickShare = (trouble: Exclude<ShareProblem, 'cancelled' | 'unsupported'> | null = null) => {
    if (!canShareScreen()) { toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 }); return; }
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    setShareTrouble(trouble);
    setSharePick(true);
  };
  // Toasts and refusals open the picker later, through what pickShare is then (who's sharing by then).
  const reopen = useRef(pickShare);
  reopen.current = pickShare;
  /* A screen LiveKit wouldn't publish reaches nobody: that capture is stopped (if it's still the one shared) and said. */
  useEffect(() => {
    const failed = roomView.screenFailed;
    if (!failed || media.getSnapshot().screen?.getVideoTracks()[0]?.id !== failed) return;
    media.stopScreen();
    toast('Your screen couldn’t reach the call, so sharing stopped.', { icon: 'stopShare', ms: 8000, action: { label: 'Try again', onClick: () => reopen.current() } });
  }, [roomView.screenFailed, media, toast]);
  const stopShare = () => { media.stopScreen(); toast('You stopped sharing', { icon: 'stopShare' }); };
  const setHand = (up: boolean) => {
    session.setHand(up);
    toast(!up ? 'Your hand is lowered' : roomName && !organizer ? `Your hand is raised. The organizer sees that ${roomName} wants help.` : 'Your hand is raised. Everyone can see it.', { icon: 'hand' });
  };
  const setSpot = (id: string | null) => {
    const name = id ? (id === meId ? 'You’re' : `${callName(byId.get(id) ?? SOMEONE)} is`) : '';
    session.setSpotlight(id);
    toast(id ? `${name} spotlighted for everyone` : 'Spotlight stopped for everyone', { icon: 'spotlight' });
  };
  /* ---------- your view: pins, where you see yourself, ready-made layouts and reset, each with a way back ---------- */
  // Names by seat, seen in this call: so a toast can name someone you pinned after they've gone. Kept in memory only.
  const seated = useRef(new Map<string, Person>());
  for (const p of told.participants) seated.current.set(p.seat, p.person);
  const seatName = (seat: string) => callName(seated.current.get(seat) ?? SOMEONE);
  const setPin = (p: { seat: string; person: Person }) => {
    const was = layout.layout.pins.includes(p.seat);
    if (!layout.togglePin(p.seat, new Set(seatKey.split(' ')))) { toast(`You can pin up to ${CALL_LAYOUT_MAX.pins} people. Unpin someone first.`, { icon: 'pin' }); return; }
    toast(was ? `${callName(p.person)} is unpinned` : `${callName(p.person)} is pinned for you. Only your view changes.`, { icon: was ? 'pinOff' : 'pin' });
  };
  const unpinAll = () => {
    const was = layout.layout.pins;
    const first = was[0];
    if (first === undefined) return;
    layout.setPins([]);
    toast(was.length === 1 ? `${seatName(first)} is unpinned` : 'Everyone you pinned is unpinned', { icon: 'pinOff', action: { label: 'Undo', onClick: () => layout.setPins(was) } });
  };
  const undoable = (text: string, icon: 'reset' | 'grid' | 'presenter', was: ViewSnapshot) => toast(text, { icon, action: { label: 'Undo', onClick: () => layout.restore(was) } });
  const setSelf = (where: SelfView) => {
    layout.setSelf(where);
    toast(where === 'hidden' ? 'You’re hidden from your own view. Everyone else still sees you.' : where === 'corner' ? 'You see yourself in a corner' : 'You see yourself in the grid',
      { icon: where === 'hidden' ? 'eyeOff' : 'eye' });
  };
  const applyPreset = (id: Preset) => {
    if (roomsHold()) return;
    undoable(id === 'equal' ? 'Everyone the same size, you included' : 'Whoever presents is big, and you’re in a corner', id === 'equal' ? 'grid' : 'presenter', layout.preset(id));
  };
  // A share brought in beside the workspace is what the workspace is for: that's not you arranging anything.
  const custom = isCustom(layout.prefs, work.open ? { ...layout.layout, shares: [] } : layout.layout) || isArranged(panels);
  /** While rooms are open the organizer's stage shows every room; their own view comes back after. */
  const roomsHold = () => { if (open && organizer) { toast('Your view comes back when the rooms close', { icon: 'door' }); return true; } return false; };
  const resetView = () => { if (!roomsHold()) undoable('Your view is back to the call’s layout', 'reset', layout.reset()); };
  const hinted = useRef(false);
  const onCustom = () => { if (!hinted.current) { hinted.current = true; toast('Only your view changes. Reset it from the top bar.', { icon: 'eye' }); } };
  /* Someone you pinned leaves: their pin waits, and comes back with them. */
  const pinsHere = useRef<{ here: string[]; away: string[] } | null>(null);
  const pinKey = layout.layout.pins.join(' ');
  useEffect(() => {
    const here = new Set(seatKey.split(' '));
    const pins = pinKey ? pinKey.split(' ') : [];
    const was = pinsHere.current;
    pinsHere.current = { here: pins.filter((s) => here.has(s)), away: pins.filter((s) => !here.has(s)) };
    if (!was) return;
    for (const s of was.here) if (pins.includes(s) && !here.has(s)) toast(`${seatName(s)} left. They’re pinned again if they come back.`, { icon: 'pin' });
    for (const s of was.away) if (pins.includes(s) && here.has(s)) toast(`${seatName(s)} is back, pinned for you`, { icon: 'pin' });
  }, [seatKey, pinKey, toast]);

  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  // A board asked for as the call started (Start a call here) opens for everyone once the call's under way here.
  useOpenWhenStarted(state.code, session, state.phase === 'in-call', board.open !== null, board.expect, failed);
  const controls = capture.controls({
    failed,
    notesEnabled: () => { if (!panel && innerWidth >= 1100) setPanel('notes'); },
    notesAsked: (up) => toast(up ? `You asked ${organizerName(state)} for notes` : 'You took back your ask', { icon: 'hand' })
  });
  useCaptureAlerts(state, controls);
  useNotesAskedNotifications(state);
  // Whatever brings a panel up gives everything back: nothing else has a place while it's just the document.
  const openPanel = (v: PanelView) => { setPop(null); work.act.setZen(false); setPanel(v); };
  const flip = (v: PanelView) => { work.act.setZen(false); layout.arrange((p) => toggleView(p, v, phone, crowded)); };
  /* Notes in the dock stands for what's written from the call: whichever panel shows any of it closes, or Notes opens. */
  const isNotes = (v: PanelView) => v === 'notes' || v === 'yours' || v === 'transcript' || v === 'ask';
  const notesShowing = showing.some(isNotes);
  const flipNotes = () => layout.arrange((p) => {
    const g = p.groups.find((x) => x.open && !crowded.includes(x.id) && isNotes(x.active));
    return notesShowing && g ? closeGroup(p, g.id) : showView(p, 'notes');
  });

  /* ---------- catching up and asking: for you alone, with the moments behind each answer, and a way back to live ---------- */
  const cu = useCatchingUp(session, { panel, showing, setPanel: (v) => { setPop(null); setPanel(v); }, narrow: phone, everOn: state.notes.everOn, room: roomName });
  const catchUp = () => { setPop(null); cu.catchUp(); };
  // Showing the notes is what keeps them up to date, for everyone in this part of the call.
  const watchingNotes = notesAreOn(capHere.mode) && live && showing.includes('notes');
  useEffect(() => (watchingNotes ? session.watchNotes() : undefined), [session, watchingNotes]);
  /* Your own notes: for someone with an account in the call, and for nobody else's eyes. */
  const own = useOwnInCall(session, { role: state.role, noteId: state.notes.noteId, showing: showing.includes('yours'), line: state.transcript.at(-1)?.id, place: state.capture.room?.id ?? null, onOpen: () => { cu.settle(); openPanel('yours'); } });
  // What carries over is your account's, not the call's: a guest has none, and everyone else reads only their own.
  // It's read while it's on screen, in the Notes and Ask views.
  const carried = useCallSeries(state.code, Boolean(account.data) && (showing.includes('notes') || showing.includes('ask')));
  const earlierNotes = carried?.notes.filter((n) => n.status === 'ready').map((n) => n.id) ?? [];

  /* ---------- captions: the live transcript's newest line, in your language if you chose one ---------- */
  const caption = useCaptions(session, state.transcript, lang, cc && live);
  const langMenu = <CaptionLanguageMenu language={lang} onPick={(code) => {
    setLang(code); setPop(null);
    const info = CAPTION_LANGUAGES.find((x) => x.code === code);
    toast(code ? `Captions in ${info?.english ?? code} for you` : 'Captions as they’re spoken', { icon: 'translate' });
  }} />;
  const capButton = (
    <Popover open={pop === 'cap'} onOpenChange={(o) => setPop(o ? 'cap' : null)} side="top" align="end" label="Caption language" className="ic-dmenu"
      anchor={<button type="button" className="ic-capbtn" aria-label="Choose the caption language"><Icon name="translate" size={14} />{captionLanguageName(lang)}</button>}>{langMenu}</Popover>
  );
  // Captions are the lines of the part of the call you're in: what's said in one room is never shown in another. While
  // notes are paused or off nothing new is said in them, so the last line isn't left up as if it were live.
  const capNode = !cc ? null : <CallCaption caption={caption} language={lang} hearing={hearing} mode={capHere.mode} languageButton={capButton} />;

  /* Turning on a device that isn't working opens its menu, which says what's wrong and how to fix it. */
  const pressMic = () => { void media.setMic(!media.getSnapshot().mic).then((ok) => { if (!ok) setPop('mic'); }); };
  const handLabel = me?.hand ? 'Lower your hand' : roomName && !organizer && !roomsOnBoards ? 'Ask for help' : 'Raise your hand';
  const flipCaptions = () => {
    const v = !cc;
    setCc(v);
    if (!v && pop === 'cc') setPop(null);
    toast(v ? `Captions on${lang ? `, in ${CAPTION_LANGUAGES.find((x) => x.code === lang)?.english ?? lang}` : ''}` : 'Captions off. The call is still transcribed for notes.', { icon: 'captions' });
  };
  const pressCam = () => { void media.setCam(!media.getSnapshot().cam).then((ok) => { if (!ok) setPop('cam'); }); };

  /* ---------- keys ---------- */
  // Escape unpins only when you can see a pin: someone pinned who's here.
  const pinnedHere = layout.layout.pins.some((seat) => seatKey.split(' ').includes(seat));
  /** Hides the people, or brings them back, as ⇧P and the People row do. It only ever changes your screen. */
  const setPeopleMode = (m: CallPeopleMode) => {
    if (roomsHold()) return;
    work.act.setZen(false);
    layout.arrange((p) => setPeople(p, m));
    if (m !== 'tiles' && !roomy) toast('People stay on the stage until the workspace is open or something is shared', { icon: 'eye' });
    else onCustom();
  };
  const togglePeople = () => setPeopleMode(panels.people === 'hidden' ? 'tiles' : 'hidden');
  /* `@` in the workspace: who's here and who's invited. The call changes all the time and these rarely do, and the workspace draws a lot. */
  const spacePeopleKey = JSON.stringify(told.participants.map((p) => [p.id, p.seat, p.person, p.isMe]));
  const spacePeople = useMemo(() => told.participants.map((p) => ({ id: p.id, seat: p.seat, person: p.person, isMe: p.isMe })), [spacePeopleKey]);
  const spaceInvitedKey = JSON.stringify(invited);
  const spaceInvited = useMemo(() => invited, [spaceInvitedKey]);
  const together: StageTogether = { ...work.together, lit: work.lit, onFollow: work.act.follow, onStop: work.act.stopFollowing, onGo: work.act.goTo, onTag: work.act.tagIn, canTag: work.act.canTag };
  const zenOffered = !phone && !stageRooms;
  const zenOn = zenOffered && work.zen;
  const latestZen = useRef(zenOn);
  latestZen.current = zenOn;
  const toggleZen = useCallback(() => { work.act.setZen(!latestZen.current); }, [work.act]);
  /** You may start a board: invited, not a guest. In a room it's the room's alone, and the menu says so. */
  const canStartBoard = state.role !== 'guest' && live;
  const boardInRoom = myRoomId !== null;
  /** The Board button and O: with a board open, hides it for you or brings it back; with none, the Board menu. */
  const pressBoard = () => {
    if (board.open) {
      // While you present it, it stays in front of you: `hold` says to stop presenting first.
      if (!board.hidden && boardPresented.hold) boardPresented.hold();
      else if (board.hidden) board.show();
      else board.hide();
      return;
    }
    if (!canStartBoard) return;
    loadBoard();
    if (short) setPop((p) => (p === 'board' ? null : 'board'));
    else setBoardMenu((o) => !o);
  };
  const shortcutWorkspace = useMemo(() => ({ find: () => { work.act.find(); setFront('ws'); }, toggle: work.act.toggle }), [work.act]);
  useCallShortcuts({ panel, pinned: pinnedHere, unpinAll, setPanel, flip, pressMic, pressCam, togglePeople, canMark: own.enabled, mark: own.mark, zenOffered, pressBoard }, shortcutWorkspace, toggleZen);

  /*
   * The connection: this browser offline, or the call's media finding its way back. It's said at the top of the call while it
   * lasts, and once it's back, in the workspace's place for what it says, so a document saying its edits are saved says so instead.
   */
  const online = useOnline();
  const down = !online || roomView.connection === 'reconnecting';
  const wasDown = useRef(false);
  useEffect(() => {
    if (down) { wasDown.current = true; return; }
    if (!wasDown.current || ended) return;
    wasDown.current = false;
    work.act.say(wsToast.reconnected());
  }, [down, ended, work.act]);

  /* What the workspace said last, such as a switch with Back, means nothing once the call's over, and sits over Leave's question. */
  useEffect(() => { if (ended || leaveOpen) work.act.hush(); }, [ended, leaveOpen, work.act]);

  /* ---------- leaving: whoever hosts ends the call for everyone, or leaves it with someone else hosting; anyone else just leaves ---------- */
  /*
   * The last audio and speech go before the call ends or this browser leaves it: the server refuses them after. That's
   * the host's, and a breakout room scribe's for its room. The recorder is paused, not stopped, until it has: if ending
   * fails, the same recorder carries on, so its pieces stay in order in the same segment (a new one would number its
   * pieces from the start again, and the server keeps the first of each).
   */
  const end = async () => {
    setLeaving(true);
    const departure = capture.departure('leave');
    try {
      await departure.flush();
      const r = await session.leave();
      departure.finish();
      over.current = true;
      if (r) guard.release();
      forgetLayout();
      // Ending the call deletes its room, which disconnects everyone at once; anyone else leaves the room now.
      if (!r) void room.leave();
      media.stop();
      volumes.clear();
      sessions.media = null;
      void qc.invalidateQueries();
      if (r) setEnded({ noteId: r.pendingNoteId, duration: r.duration });
      else {
        sessions.call = null;
        // Leaving on the way somewhere, such as to a call that rang, carries on there.
        if (!guard.proceed()) await navigate({ to: '/join/$code', params: { code: state.code }, replace: true });
        toast('You left the call', { icon: 'leave' });
      }
    } catch (e) {
      departure.rollback();
      clog.error('leaving the call failed', { err: e });
      toast(errorMessage(e), { icon: 'x' });
    } finally {
      setLeaving(false);
    }
  };
  /*
   * Leaving with someone else hosting: the last audio and speech go first, then the call is theirs. You go back to the
   * call's page, where the organizer's joining again takes it back. If they can't host after all, you stay, and the
   * paused recorder carries on in the same segment, as when ending fails.
   */
  const handOff = async (to: string) => {
    setLeaving(true);
    const who = state.participants.find((p) => p.id === to)?.person;
    const departure = capture.departure('hand-off');
    try {
      await departure.flush();
      await session.handOff(to);
      departure.finish(() => {
        over.current = true;
        guard.release();
        forgetLayout();
      });
      void room.leave();
      media.stop();
      volumes.clear();
      sessions.media = null;
      sessions.call = null;
      void qc.invalidateQueries();
      await navigate({ to: '/join/$code', params: { code: state.code }, replace: true });
      leftToast = toast(`You left the call. ${who ? callName(who) : 'Someone else'} is hosting${organizer ? ' until you’re back' : ''}.`, { icon: 'leave' });
    } catch (e) {
      departure.rollback();
      clog.warn('handing the call on failed', { err: e });
      setLeaveOpen(true);
      toast(errorMessage(e), { icon: 'x' });
    } finally {
      setLeaving(false);
    }
  };
  const away = async (to: { noteId: string } | null) => {
    sessions.call = null;
    if (to) await navigate({ to: '/notes/$noteId', params: { noteId: to.noteId }, replace: true });
    else await navigate({ to: '/home', replace: true });
  };

  /* ---------- the panel's people ---------- */
  const micLabel = devices.mic.find((d) => d.id === m.micId)?.label;
  const knownIds = new Set(told.participants.map((p) => p.id));
  const roleOf = (p: CallState['participants'][number]) => (p.isOrganizer ? 'Organizer' : !knownIds.has(p.id) || viewerGuest ? 'In the call' : p.person.email ? 'Invited' : 'Guest');
  const roomOf = (id: string) => open?.rooms.find((r) => r.members.includes(id))?.name;
  const panelPeople: PanelPerson[] = state.participants.map((p) => {
    const sp = stagePeople.find((x) => x.id === p.id);
    const r = roomView.people[p.id];
    const where = roomOf(p.id);
    const detail = p.isMe
      ? [organizer ? 'Organizer' : state.role === 'invited' ? 'Invited' : 'Guest', where ? `in ${where}` : '', micLabel, m.screen ? 'sharing' : '', !m.cam ? 'camera off' : '']
      : [roleOf(p), where ? `in ${where}` : '', r?.screenSid ? 'sharing' : ''];
    return {
      id: p.id, person: p.person, isMe: p.isMe, organizer: p.isOrganizer, mic: sp?.mic ?? false, hand: p.hand, speaking: sp?.speaking ?? false, volume: sp?.volume ?? null,
      detail: detail.filter(Boolean).join(' · '),
      tags: [state.host.standIn && state.host.id === p.id ? `Hosting while ${organizerFirst(state)} is away` : '', !open && state.spotlight === p.id ? 'Spotlight · everyone' : '', layout.layout.pins.includes(p.seat) ? 'Pinned for you' : '',
        p.hand ? (inARoom(p.id) ? `Asked for help in ${where ?? 'a room'}` : 'Hand raised') : '', volumeTag(sp?.volume ?? 1) ?? '', askedTag(state, p.id)].filter(Boolean)
    };
  });
  /* Who could host after you, best first, as the call names them: for the leave sheet. */
  const nextHosts: NextHost[] = state.host.next.flatMap((id) => { const p = state.participants.find((x) => x.id === id); return p ? [{ id, person: p.person }] : []; });
  const host: HostControls | undefined = hosting ? {
    admit: (id) => session.admit(id),
    deny: (id) => session.deny(id),
    mute: (id) => { const sid = roomView.people[id]?.micSid; return sid ? session.mute(id, sid) : Promise.resolve(); },
    remove: async (id) => {
      const gone = state.participants.find((p) => p.id === id);
      // Someone removed can't come back, so their pin goes with them (and nobody is told it waits for them).
      const seat = gone?.seat;
      if (seat && layout.layout.pins.includes(seat)) layout.setPins(layout.layout.pins.filter((s) => s !== seat));
      await session.remove(id);
      // Someone let in from the link comes off the invite as they go: who's invited is read again.
      if (gone?.person.email) void qc.invalidateQueries({ queryKey: qk.byCode(state.code) });
    },
    locked: state.locked,
    lock: (v) => session.lock(v),
    pointing: state.pointing,
    setPointing: (v) => session.setPointing(v)
  } : undefined;
  const privacyLine = [
    open ? 'Each room has its own encryption keys, so video, audio and chat reach only the people in the same room.'
      : on || mode === 'paused' ? 'Video, audio and chat are encrypted end to end.' : 'Video, audio and chat are encrypted end to end between the people here.',
    on ? `While notes are on, ${state.capture.screen.mode === 'on' ? 'what everyone says and what anyone shares on screen go' : 'what everyone says also goes'} to the notes, written in confidential compute.${open ? ' What’s said in each breakout room goes into them as that room’s own section; what’s shared there doesn’t.' : ''}`
      : mode === 'paused' ? 'Notes are paused, so nothing goes to the notes.' : ''
  ].filter(Boolean).join(' ');

  /* ---------- the status bar ---------- */
  const spotlight = open ? null : state.spotlight;
  const spotName = spotlight ? (spotlight === meId ? null : callName(byId.get(spotlight) ?? SOMEONE)) : null;
  // Shared means the call has it: until LiveKit has published it, it's starting. "With sound" only while its sound is live.
  const published = Boolean(roomView.people[meId]?.screenSid);
  const withSound = Boolean(m.screen?.getAudioTracks().some((t) => t.readyState === 'live'));
  /* Whether others may point at what you share (your choice, everyone sees it), and everyone's marks on it, to clear. */
  const othersPoint = me?.othersPoint ?? true;
  const marksOnMine = useShareMarkCount(marks, myShare);
  // Something else shared in place of what was (Change: the same share, a new picture): marks on it were about the old
  // picture, so they go, for everyone.
  const screenStream = m.screen;
  const lastScreen = useRef<MediaStream | null>(null);
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = screenStream;
    if (was && screenStream && was !== screenStream && myShare) marks?.clear(myShare);
  }, [screenStream, myShare, marks]);
  const flipOthersPoint = () => {
    const on = !othersPoint;
    session.letOthersPoint(on).then(() => toast(on ? 'Others can point at your screen again' : 'Only you can point at your screen now', { icon: on ? 'pointer' : 'pointerOff' }),
      (e: unknown) => toast(errorMessage(e), { icon: 'x' }));
  };
  const sharePill = m.screen && (
    <div className="ic-spill"><Icon name="screen" size={15} />
      <span className="tx2">{published ? <>You’re sharing <b>{m.screenLabel ?? 'your screen'}</b>{withSound && ' with sound'}</> : <>Starting to share <b>{m.screenLabel ?? 'your screen'}</b></>}</span>
      {!published && <Dots />}
      {published && screensOn && !sharingInRoom && <span className="sp-read"><RecDot />Read for the notes</span>}
      {published && state.pointing && (
        <Tooltip label={othersPoint ? 'Others can point at your screen. Press so only you can' : 'Only you can point at your screen. Press to let others'}>
          <button type="button" className={cn('sp-btn sp-ico', !othersPoint && 'is-off')} aria-pressed={othersPoint} aria-label="Others can point at your screen" onClick={flipOthersPoint}>
            <Icon name={othersPoint ? 'pointer' : 'pointerOff'} size={15} />
          </button>
        </Tooltip>
      )}
      {published && myShare && marksOnMine > 0 && <button type="button" className="sp-btn" onClick={() => marks?.clear(myShare)}>Clear marks</button>}
      <button type="button" className="sp-btn" onClick={() => pickShare()}>Change</button>
      <button type="button" className="sp-btn is-strong" onClick={stopShare}>Stop sharing</button>
    </div>
  );
  /* On the way to another part of the call: nothing is heard or sent until this browser holds the new part's keys. */
  const movingBar = crypto.status === 'moving' && (
    <div className="ic-spill" role="status"><Dots /><span className="tx2">{roomName ? <>Moving you to <b>{roomName}</b></> : <>Moving you back to the <b>main room</b></>}</span></div>
  );
  /*
   * The rooms' time on the board, in its one pill: the room you're in, or how many rooms share the main board, and how long is
   * left. While that's the pill the board on the stage shows, it's said there, and the rooms line above says nothing more. While
   * the board's pill says something more pressing (how it stands, someone presenting, a vote, following, the timer), the line
   * says it: the board hands up which kind it shows (`BoardPills`).
   */
  const roomsPill = roomPills(open ? { name: roomName, rooms: open.rooms.length, shared: open.board === 'shared', left } : null);
  const [boardPill, setBoardPill] = useState<PillKind | null>(null);
  const pillSaysRooms = board.shown && ended === null && !leaving && !stageRooms && (boardPill === 'room' || boardPill === 'closing');
  /*
   * In a room (or the main room while rooms are open): where you are and how long for. In rooms without boards, the organizer's
   * message to every room shows here for a moment; with boards it's a toast.
   */
  const roomBar = open && !organizer && (movingBar || (message && !roomsOnBoards ? (
    <div className="ic-banner">{organizerPerson && <Avatar person={organizerPerson} size={24} />}<span><b>{organizerPerson ? callName(organizerPerson) : 'The organizer'}</b> to all rooms: {message.text}</span></div>
  ) : !pillSaysRooms && (
    <div className="ic-spill"><Icon name={left <= 30 ? 'timer' : 'door'} size={15} />
      <span className="tx2">{left <= 30 ? <>Rooms close in <b>{mmss(left)}</b>. Everyone comes back to the main room.</> : <>You’re in <b>{roomName ?? 'the main room'}</b> · everyone comes back in {mmss(left)}</>}</span>
    </div>
  )));
  /*
   * People the organizer rang: each waits on the stage while it's worth watching, and stays in People. Nobody else is
   * rung by accident: on your own there's nobody to ring, and the link stays to hand instead.
   */
  const team = useQuery({ ...q.team(), enabled: organizer });
  const rung = organizer ? state.ringing : [];
  const answers = useRef(new Map<string, number>());
  const now = Date.now();
  const ring = (p: Person) => { session.ring([p.email]).catch((e: unknown) => { clog.warn('ringing failed', { err: e }); toast(`Couldn’t ring ${callName(p)}. ${errorMessage(e)}`, { icon: 'x' }); }); };
  const stopRing = (id: string) => { session.stopRing(id).catch((e: unknown) => { clog.warn('stopping a ring failed', { err: e }); toast(`Couldn’t stop ringing. ${errorMessage(e)}`, { icon: 'x', ms: 6000 }); }); };
  const waiting: StageWaiter[] = open ? [] : waitingOnStage(rung, answers.current, now).map((r) => {
    const said = rungWords(r, now);
    return {
      id: r.id, person: r.person,
      tile: <WaitTile person={r.person} title={said.title} detail={said.detail} ringing={r.state === 'ringing'}
        reply={said.reply && <RingReply icon={said.reply.icon}>{said.reply.text}</RingReply>} action={said.again ? <RingAgain onClick={() => ring(r.person)} /> : undefined} />
    };
  });
  const justYou = organizer && others.length === 0 && !open && team.data !== undefined && !ringable(team.data, me?.person).length;
  /**
   * On your own, the link for anyone to ask to join: at the bottom left of the stage, or at the foot of the workspace's list
   * while that's in sight, where it covers nothing (`WorkspaceCall.foot`). One element while it's the same, so the workspace
   * doesn't draw again for it.
   */
  const aloneCard = useMemo(() => (justYou && !cc ? (
    <div className="rg-alone">
      <div><b>Just you so far</b><p>Anyone with the link can ask to join.</p></div>
      <LinkRow link={shownUrl(state.code)} onCopy={() => copyUrl(state.code)} />
    </div>
  ) : null), [justYou, cc, state.code]);
  const alone = others.length === 0 && !open && !justYou && !waiting.length && !(organizer && team.isPending) && (
    <div className="ic-spill"><Icon name="link" size={15} /><span className="tx2">Nobody else is here yet</span>
      <button type="button" className="sp-btn is-strong" onClick={() => copy(state.code)}>Copy link</button>
    </div>
  );
  const soundPill = roomView.audioBlocked && (
    <div className="ic-spill"><Icon name="speakerOff" size={15} /><span className="tx2">Your browser is holding back the call’s sound</span>
      <button type="button" className="sp-btn is-strong" onClick={playSound}>Play sound</button>
    </div>
  );
  // Hidden by this person's own choice, remembered in this browser: said while anyone else is here, or everyone just seems
  // to have their camera off. On a narrow screen it's the icon and the button, the words kept for screen readers.
  const camsPill = m.receiveVideo === 'off' && others.length > 0 && (
    <div className="ic-spill is-cams"><Icon name="videoOff" size={15} /><span className="tx2">Cameras are hidden for you</span>
      <button type="button" className="sp-btn is-strong" onClick={() => media.setReceiveVideo('auto')}>Show cameras</button>
    </div>
  );
  /* While someone stands in for the organizer, everyone sees who; whoever it is can bring everyone back from the rooms. */
  const hostPill = state.host.standIn && live && <HostSpill state={state} onBringBack={open && hosting ? () => { session.closeRooms(); toast('Everyone is coming back to the main room', { icon: 'door' }); } : undefined} />;
  // Built only from what's there, so with nothing to say over the call there's no empty band above it.
  const bar = open
    ? (organizer ? (soundPill || camsPill ? <>{soundPill}{camsPill}</> : null)
      : [soundPill, camsPill, hostPill, roomBar, sharePill].some(Boolean) ? <>{soundPill}{camsPill}{hostPill}{roomBar}{sharePill}</> : null)
    : (m.screen || spotlight || alone || soundPill || movingBar || camsPill || hostPill) ? (
      <>
        {soundPill}
        {movingBar}
        {camsPill}
        {hostPill}
        {alone}
        {sharePill}
        {spotlight && (
          <div className="ic-spill"><Icon name="spotlight" size={15} /><span className="tx2">{spotName ? <><b>{spotName}</b> is spotlighted for everyone</> : <><b>You’re</b> spotlighted for everyone</>}</span>
            {hosting && <button type="button" className="sp-btn is-strong" onClick={() => setSpot(null)}>Stop spotlight</button>}
          </div>
        )}
      </>
    ) : null;

  /* While rooms are open, everyone but the organizer sees only their own room (or the main room). */
  const onStage = unit && !organizer ? stagePeople.filter((p) => unit.includes(p.id)) : stagePeople;
  const roomsHere = organizer && (others.length > 0 || !!open);
  /* Breakout rooms in a panel go with the last person who could be sent to one. */
  const arrange = layout.arrange;
  const roomsGone = !roomsHere && showing.includes('rooms');
  useEffect(() => {
    if (roomsGone) arrange((p) => { const g = p.groups.find((x) => x.active === 'rooms'); return g ? closeGroup(p, g.id) : p; });
  }, [roomsGone, arrange]);
  /* Your own notes are your account's: a panel left on them from another call doesn't open in one you joined as a guest. */
  const yoursGone = !own.enabled && showing.includes('yours');
  useEffect(() => {
    if (yoursGone) arrange((p) => { const g = p.groups.find((x) => x.open && x.active === 'yours'); return g ? closeGroup(p, g.id) : p; });
  }, [yoursGone, arrange]);

  /*
   * ---------- the panels: where everything goes (panels.ts) ----------
   * The stage's own room comes first, since it says how much a stage holding the shares has for them; then what's shown
   * big says what else needs a place.
   */
  const callArea = useCallArea();
  const size = callArea.size;
  const dockBar = useRef<HTMLElement>(null);
  const horizon = useHorizon(callArea.ref, dockBar, size);
  const hostHandle = useRef<PanelHostHandle>(null);
  const reduce = useReducedMotion();
  const [resizing, setResizing] = useState(false);
  const [front, setFront] = useState<Leaf | null>(null);
  const setApart = panels.apart || panels.people !== 'tiles';
  /*
   * Once the call is over for this tab (it ended, or you're leaving), the workspace goes at once: its streams close and it stops
   * saying where you are, while the sheet says what happened.
   */
  const callOver = ended !== null || leaving;
  // Overseeing rooms, the organizer sees the rooms: the main room's board waits behind them, as it is.
  const surfaces = { ws: work.open && !callOver, board: board.shown && !callOver && !stageRooms };
  const zenBox = zenOn ? zenRoom(size, horizon) : null;
  const noFacts: PanelFacts = { ...surfaces, shown: [], front, phone, zen: zenBox, rooms: !!stageRooms, top: 0, bottom: 0, absent: own.enabled ? [] : ['yours'] };
  const stageW = solve(panels, size, noFacts).rects.stage?.w ?? size.w;
  // A stage that holds the shares has its own width to fit them in; panels of their own find their room with `adapt`.
  const stageHolds = !surfaces.ws && !surfaces.board && !(setApart && shares.length > 0);
  const staged = useStagePlan({
    people: onStage, waiting, shares, spotlight, view: layout, part: crypto.place, paused: mode === 'paused', narrow: phone || (stageHolds && stageW > 0 && stageW < 760), hold: surfaces.ws || surfaces.board, turns: phone, apart: setApart && !stageRooms,
    board: board.hidden && board.open !== null && board.open.role !== null && board.doc !== null && !callOver
  });
  const seats = staged.shareSeats;
  // The stage's speaker is never you: it says who to make room for. The end of the transcript says who's talking.
  const talking = onStage.find((p) => p.id === staged.speaker) ?? onStage.find((p) => p.isMe && p.speaking);
  const { live: liveCall, put } = useLiveCall(session, talking?.person ?? null, {
    // A list over the page goes, or it would cover what the panel opens beside.
    notes: controls.notes, ask: controls.ask, beside: (v) => { setPop(null); work.act.setPeek(false); layout.arrange((p) => showView(p, v)); },
    reveal: () => { work.act.reveal(); if (phone) layout.arrange(closeAll); }, covered: () => phone && showing.length > 0
  });
  const bigKey = [...seats].map(([id, s]) => `${id}=${s}`).join(' ');
  const chosenKey = layout.layout.shares.filter((c) => c.show === 'big').map((c) => c.id).join(' ');
  const chosenBig = new Set(chosenKey ? chosenKey.split(' ') : []);
  const wasBig = useRef(new Set(seats.keys()));
  useEffect(() => {
    const here = new Set(shareKey ? shareKey.split(' ') : []);
    const big = new Map(bigKey ? bigKey.split(' ').flatMap((kv): [string, ShareLeaf][] => { const [id, s] = kv.split('='); return id && (s === 'share:1' || s === 'share:2') ? [[id, s]] : []; }) : []);
    for (const [id, close] of offers.current) if (big.has(id) || !here.has(id)) { close(); offers.current.delete(id); }
    // With the workspace open, a share you brought in is the one you asked to see when things take turns. One a phone seats by
    // itself waits behind what you're looking at, for the switcher.
    if (surfaces.ws) for (const [id, seat] of big) if (!wasBig.current.has(id) && chosenBig.has(id)) setFront(seat);
    wasBig.current = new Set(big.keys());
  }, [bigKey, shareKey, surfaces.ws, chosenKey]);
  const roomy = surfaces.ws || surfaces.board || seats.size > 0;
  const seatsKey = [...seats].map(([id, s]) => `${id}=${s}`).join(' ');
  const top = bar ? 46 : 0;
  const bottom = capNode ? (stageW < 700 ? 150 : 124) : 0;
  const facts: PanelFacts = { ...noFacts, shown: [...seats.values()], top, bottom };
  /*
   * The board beside a share shown big, for your view only. With nothing arranged by hand, it takes the main space, and the share
   * goes to the top of the column with everyone under it: the panels' board preset, given back as the board goes. Pressing the
   * share swaps them, so the share is big and the board a live tile over the faces; pressing the board swaps them back.
   */
  const besideShare = surfaces.board && seats.size > 0;
  const boardCompact = besideShare && boardOverPeople(panels.tree);
  const beforeBoard = useRef<CallPanels | null>(null);
  const swappedWith = useRef<ShareLeaf | null>(null);
  const swapBoard = (seat: ShareLeaf) => { swappedWith.current = seat; layout.arrange((p) => moveLeaf(p, 'board', seat, 'swap', size, facts)); };
  const boardBack = () => {
    const seat = swappedWith.current ?? 'share:1';
    swappedWith.current = null;
    layout.arrange((p) => (boardOverPeople(p.tree) ? moveLeaf(p, 'board', seat, 'swap', size, facts) : p));
  };
  useEffect(() => {
    if (besideShare && presetOf(panels) === 'beside') {
      beforeBoard.current = panels;
      layout.arrange((p) => layoutPreset(p, 'board'));
    } else if (!surfaces.board && beforeBoard.current) {
      const was = beforeBoard.current;
      beforeBoard.current = null;
      swappedWith.current = null;
      layout.arrange((p) => ({ ...p, tree: was.tree, apart: was.apart }));
    }
    // A share that stops while the board is a tile over the faces leaves nothing big: the board comes back.
    if (surfaces.board && seats.size === 0 && swappedWith.current) boardBack();
  }, [besideShare, surfaces.board, seats.size]);
  /* Put on the board: a picture of a share as this browser shows it, into the board's own files, and whoever shares it is told. */
  const putShot = (s: StageShare) => {
    const open = board.open;
    if (!open?.workspaceId || !open.documentId || open.role !== 'edit') return;
    const { workspaceId, documentId } = open;
    const whose = s.mine ? callName(me?.person ?? SOMEONE) : callName(s.presenter);
    const caption = `${whose}’s screen, ${hm(new Date())}`;
    const look = s.mine ? null : staged.looks.look(s.id);
    keepShot({ workspaceId, documentId, pass: session.ticket.pass }, s.id, look?.getSnapshot().held?.ready ? look.heldBitmap() : null, caption).then((media) => {
      if (!media) { toast(`There’s no picture of ${s.mine ? 'your screen' : `${whose}’s screen`} yet. Try again in a moment.`, { icon: 'image' }); return; }
      if (!board.handle.current?.addShot({ media, caption })) return;
      if (s.mine) { toast('A picture of your screen is on the board.', { icon: 'image' }); return; }
      if (s.point) room.send(BOARD_SHOT_TOPIC, shotNotice(s.point.sid), { reliable: true });
      toast(`A picture of ${whose}’s screen is on the board. ${whose} can see that.`, { icon: 'image' });
    }).catch(failed);
  };
  const zenKey = zenBox ? `${zenBox.x} ${zenBox.y} ${zenBox.w} ${zenBox.h}` : '';
  const solved = useMemo(() => solve(panels, size, facts), [panels, size, surfaces.ws, surfaces.board, seatsKey, front, phone, !!stageRooms, top, bottom, zenKey]);
  useLayoutEffect(() => {
    const now = crowdedOut(panels, solved);
    setCrowded((was) => (was.join() === now.join() ? was : now));
  }, [panels, solved]);
  // Who has a place however little room there is, as Speaker view counts talking: if every word did, the few places would keep changing hands.
  const loudKey = solved.A.apart ? onStage.filter((p) => p.hand || p.id === staged.speaker).map((p) => p.id).join(' ') : '';
  const frame = useMemo((): StageFrame => {
    const { A, rects } = solved;
    const shown = new Map([...seats].flatMap(([id, s]) => { const r = rects[s]; return r ? [[id, r] as const] : []; }));
    return {
      box: A.apart ? zenBox ?? { x: 0, y: 0, w: size.w, h: size.h } : rects.stage ?? solved.box, top, bottom, ratio: layout.prefs.ratio, split: layout.layout.split,
      panels: A.apart ? { shares: shown, people: rects.people ?? null, mode: A.people, horizon, loud: new Set(loudKey.split(' ')), small: A.phone, sharesLast: surfaces.ws } : null
    };
  }, [solved, size, seatsKey, top, bottom, layout.prefs.ratio, layout.layout.split, horizon, loudKey, zenKey, surfaces.ws]);
  const clear = mainRoom(solved);
  /** The workspace is open and in sight. What's clear starts at its left, so its list has the bottom left of it. */
  const wsInSight = work.open && !!solved.rects.ws;
  /** What a panel is called, on its handle and for the keyboard. */
  const panelName = (leaf: Leaf): string => {
    if (leaf === 'people') return 'People';
    if (leaf === 'ws') return 'Workspace';
    if (leaf === 'board') return 'Board';
    if (leaf === 'stage') return 'Stage';
    if (isShareLeaf(leaf)) return shares.find((s) => seats.get(s.id) === leaf)?.name ?? 'Shared screen';
    const g = panels.groups.find((x) => x.id === groupOfLeaf(leaf));
    return !g ? 'Panel' : g.active === 'rooms' ? 'Breakout rooms' : tabName(g.active);
  };
  /* When there isn't room for all of it, what's shown big takes turns, and the top bar says which is showing. */
  const turns = solved.A.tabs ? [...(facts.ws ? [{ id: 'ws' as const, name: 'Document' }] : []), ...(facts.board ? [{ id: 'board' as const, name: 'Board' }] : []),
    ...[...seats].map(([id, s]) => ({ id: s, name: shares.find((x) => x.id === id)?.name ?? 'Shared screen' }))] : [];
  /* On a phone an open panel covers what's taking turns, so choosing one puts the panel away. */
  const covered = phone && panel !== null;
  const swap = turns.length > 1 && (
    <div className="ic-swap" role="group" aria-label="What’s showing">
      {turns.map((t) => <button key={t.id} type="button" aria-pressed={!covered && solved.A.front === t.id} onClick={() => { setFront(t.id); if (covered) layout.arrange(closeAll); }}>{t.name}</button>)}
    </div>
  );
  const ALL_TABS = CallPanelTabSchema.options;
  const roomsPanel = () => (open && me && activity
    ? <RoomsLive open={open} elapsed={state.elapsed} members={open.rooms.map((r) => r.members.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; }))}
      people={byId} activity={activity} me={me.person} onJoin={visit} onRename={renameRoom} onMove={moveTo} onMessage={(t) => session.messageRooms(t)} onClose={() => session.closeRooms()} />
    : <RoomsSetup people={candidates} guests={guestsHere} boardName={state.board.open?.name ?? null} onOpen={openRooms} />);
  const panelBody = (v: PanelView) => {
    switch (v) {
      case 'notes': return <NotesView state={state} getting={getting} problems={[uploadError, heardProblem, frameProblem].filter((x): x is string => !!x)} put={put}
        onPage={() => { work.act.reveal(); work.act.go({ kind: 'live', page: 'notes' }); }}
        controls={controls} carried={carried && <FromLastTime s={carried} me={account.data?.user.email} open={!state.liveNotes.notes} />} onSeek={cu.open} onTick={(id, done) => { tickEverywhere(session, id, done).catch(failed); }} onTranscript={() => openPanel('transcript')} />;
      case 'yours': return <YoursView own={own} state={state} me={me?.person.email} onOpen={cu.open} />;
      case 'transcript': return cu.moment
        ? <MomentView moment={cu.moment} startedAt={state.startedAt} me={me?.person.email} onLive={cu.backToLive} />
        : <TranscriptView state={state} me={me?.person.email} onMark={own.enabled ? own.mark : undefined} put={put} />;
      case 'ask': return <AskView asks={cu.asks} ready={state.notes.everOn && state.transcript.length > 0 && capHere.mode !== 'paused'} paused={capHere.mode === 'paused'} startedAt={state.startedAt} range={cu.range} window={cu.window}
        catching={cu.catching} draft={drafts.current.ask} earlier={earlierNotes.length ? earlierNotes : null} scope={cu.scope} onScope={cu.setScope} onRange={cu.setRange} onWindow={cu.refreshWindow} onAsk={cu.ask}
        onAskEarlier={(question) => cu.askEarlier(question, earlierNotes)} onCatchUp={() => cu.catchUp(cu.range)} onOpen={cu.open} onLive={cu.backToLive} keeping={own.enabled ? own : undefined} />;
      case 'chat': return <ChatView chat={crypto.chat} missed={crypto.missedChat} ready={crypto.status === 'in'} moving={crypto.status === 'moving'}
        here={open ? roomName ?? 'the main room' : null} placeName={placeName} who={personOf} place={crypto.place} me={session.ticket.identity} draft={drafts.current.chat} onSend={(t) => session.sendChat(t)} onReact={(id, r, on) => session.react(id, r, on)} />;
      case 'people': return <PeopleView here={panelPeople} invited={invited} asking={hosting ? state.waiting : []} invites={organizer} ringing={rung} host={host} foot={privacyLine} volumes={volumes} together={together}
        canRing={(p) => team.data?.members.some((x) => x.onAlcove && sameEmail(x.person, p)) ?? false} onRing={organizer && live ? ring : undefined} onStopRing={organizer && live ? stopRing : undefined}
        notesAsks={organizer && !on && state.capture.requests.length > 0 ? <NotesAsks state={state} controls={controls} decline={(id) => session.declineNotes(id)} after={state.waiting.length > 0} /> : undefined} />;
      case 'rooms': return roomsPanel();
    }
  };
  const sidePanel = (g: CallPanelGroup) => (
    <SidePanel view={g.active} tabs={(phone ? [...ALL_TABS] : g.tabs).filter((t) => own.enabled || t !== 'yours')} roomsTitle={open ? 'Rooms are open' : 'Breakout rooms'}
      onView={(v) => { cu.settle(); openPanel(v); }} onClose={() => { cu.settle(); layout.arrange((p) => (phone ? closeAll(p) : closeGroup(p, g.id))); }}>
      {panelBody(g.active)}
    </SidePanel>
  );
  const pickLayout = (l: PanelPreset) => { if (!roomsHold()) { layout.arrange((p) => layoutPreset(p, l)); onCustom(); } };
  /* The list's button: a list that gave way for want of room comes over the page for now. One you put away comes back. */
  const listGaveWay = panels.list && !solved.A.list;
  const turnList = () => {
    if (listGaveWay) { work.act.setPeek((on) => !on); return; }
    work.act.setPeek(false);
    layout.arrange((p) => setList(p, !p.list));
    onCustom();
  };
  const listTurn = useRef(turnList);
  listTurn.current = turnList;
  const toggleList = useCallback(() => { listTurn.current(); }, []);
  /*
   * What needs the list, such as naming a folder, shows it and never hides it: one that gave way comes over the page, and one
   * you put away comes back, or over the page in a window with no room for it.
   */
  const showList = () => {
    if (solved.A.list) return;
    if (panels.list) { work.act.setPeek(true); return; }
    const back = setList(panels, true);
    layout.arrange((p) => setList(p, true));
    onCustom();
    if (!solve(back, size, facts).A.list) work.act.setPeek(true);
  };
  const listShow = useRef(showList);
  listShow.current = showList;
  const onShowList = useCallback(() => { listShow.current(); }, []);

  /* ---------- the board, as the panels, the stage and the dock show it ---------- */
  const boardOpen = board.open;
  const boardWhere = boardOpen?.workspaceId ? spaceName(boardOpen.workspaceId) : null;
  const viewOnly = boardOpen?.role === 'read';
  /** A room's own board: only the people in the room see it, until rooms close. On the board every room shares, you're on the main board. */
  const roomsOwn = boardOpen !== null && roomName !== null && boardOpen.frame === null;
  const sealed = boardOpen?.seal ?? 'Sealed';
  /*
   * How the board stands, in its page's words (features/board/standing.ts): its seal, what that says on hover and pressed, and
   * Reconnecting and Couldn't save in its pill, with Try again. While all's well, the seal says what's true of it in this call.
   */
  const boardChanges = useChangesSinceSaved(board.doc, boardStatus);
  const boardStanding = standingOf({
    status: boardStatus, offline: boardStatus !== null && (boardStatus.status === 'offline' || (!online && boardStatus.status !== 'failed')), readOnly: viewOnly,
    changes: boardChanges, tryAgain: board.tryAgain, kept: boardWhere ? { icon: 'lock', text: `Saved in ${boardWhere}.` } : null,
    sealed: {
      seal: sealed, title: `${sealed}. Alcove can’t read this board.`,
      rows: roomsOwn ? [
        { icon: 'lock', text: `Only the people in ${roomName} can see this board.` },
        { icon: 'door', text: 'When rooms close it comes back to the main room, and everyone in the call sees it.' },
        { icon: 'sealed', text: 'Alcove can’t read it, then or later.' }
      ] : [
        ...(boardOpen?.everyone ? [{ icon: 'lock' as const, text: boardWhere ? `Everyone in this call can add to it. Saved in ${boardWhere}.` : 'Everyone in this call can add to it.' }]
          : boardWhere ? [{ icon: 'lock' as const, text: `Saved in ${boardWhere}.` }] : []),
        ...(on ? [{ icon: 'notes' as const, text: 'The notes read it in confidential compute.' }] : []),
        UNREAD
      ]
    }
  });
  /** Where a board is kept: the workspace everyone's viewing comes up in the call, and any other opens in a tab of its own. */
  const openSaved = (workspaceId: string) => {
    if (workspaceId === space.id) { work.act.setZen(false); work.act.wantList(); return; }
    window.open(`/drive/${encodeURIComponent(workspaceId)}`, '_blank', 'noopener');
  };
  /*
   * Something the board links to opens as its workspace does: in the call when everyone's viewing that workspace, and in a tab of
   * its own for an account anywhere else. A guest has nowhere else to open it.
   */
  const linkedIn = boardOpen?.workspaceId ?? null;
  const linkHere = linkedIn !== null && linkedIn === space.id;
  const linkOpens = linkedIn !== null && (linkHere || state.role !== 'guest');
  const openLinked = useMemo(() => (linkedIn && linkOpens ? (item: string) => {
    if (linkHere) { work.act.setZen(false); work.act.openAt({ kind: 'document', id: item }); return; }
    window.open(`/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(item)}`, '_blank', 'noopener');
  } : undefined), [linkedIn, linkOpens, linkHere, work.act]);
  /** The board's own address, which opens it for whoever can open it. */
  const boardLink = linkedIn && boardOpen?.documentId ? `${location.origin}/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(boardOpen.documentId)}` : undefined;
  const boardNames: BoardNameMenu = (() => {
    if (!boardOpen?.workspaceId || !boardOpen.documentId) return {};
    const { workspaceId, documentId } = boardOpen;
    return {
      rename: boardOpen.role === 'edit' ? (name: string) => renameBoard.mutateAsync({ workspaceId, id: documentId, name }).catch((e: unknown) => { failed(e); throw e; }) : undefined,
      saved: boardWhere ? { name: boardWhere, onOpen: () => openSaved(workspaceId) } : undefined,
      // As the call says now, and as the workspace has it: someone the board's become read-only to has no Share.
      share: boardOpen.role === 'edit' && boardItem && boardItem.id === documentId && boardItem.role === 'edit' && boardItem.trashedAt === null
        ? () => <ShareSheetFor workspaceId={workspaceId} item={{ ...boardItem, name: boardOpen.name ?? boardItem.name }} say={work.act.say} pass={session.ticket.pass} />
        : undefined,
      // The keys go to the dock's Board button, before the board sinks away from under them: on a phone, to More, where Board is.
      close: boardOpen.canClose ? () => {
        const dock = dockBar.current;
        (dock?.querySelector<HTMLElement>('.d-board') ?? dock?.querySelector<HTMLElement>('button[aria-label^="More"]'))?.focus({ preventScroll: true });
        session.closeBoard().catch(failed);
      } : undefined
    };
  })();
  const openerName = board.opener ? callName(board.opener) : null;
  const boardOwner = { person: board.opener ?? me?.person ?? SOMEONE, name: boardOpen?.openedBy === meId ? 'Your board' : openerName ? `${openerName}’s board` : boardOpen?.name ?? 'The board' };
  /** Asking whoever brought a board you can't open to let you in: in the call's chat, where they'll see it, as you'd ask them yourself. */
  const askBoard = openerName && boardOpen?.openedBy !== meId ? () => {
    session.sendChat(`${openerName}, could you let me into the board?`).then(() => toast(`Asked ${openerName} in the chat.`, { icon: 'chat' }), failed);
  } : undefined;
  /** What the board says to you, with its own icon: what you were typing in going, a trash can. Following says its own, with an eye. */
  const sayBoard = (text: string, icon: IconName) => { toast(text, { icon }); };
  /*
   * Presenting: what's presented where you are, drawn over your own page or worked on beside it (presenting.ts), or, for the
   * board open here, on the board itself, a frame at a time (boardPresenting.ts).
   */
  const presenting = usePresenting({
    session, present: space.present, participants: state.participants, open: work.open, inSight: wsInSight,
    show: work.act.show, hide: work.act.hide, go: work.act.go, say: work.act.say, failed: work.act.failed
  });
  const boardPresented = useBoardPresenting({
    session, presenting, board, account: (account.data?.ownerId ?? null) !== null, failed, notesFailed: (message) => work.act.say(wsToast.failed(message)),
    refuse: (text) => toast(text, { icon: 'x' })
  });
  /** On a board being presented, the frame is everyone's: nobody goes to or follows anyone on it until they look around. */
  const boardOnFrame = boardPresented.present !== null && (boardPresented.present.mine || boardPresented.present.watching);
  const stageBoard: StageBoard | null = boardOpen && !callOver ? {
    tile: board.hidden && board.doc ? (w, h) => <BoardTileOnStage board={board} width={w} height={h} theme={theme} owner={boardOwner} onOpen={board.show} /> : null,
    find: (p) => (board.shown && !boardCompact && !boardOnFrame && !p.isMe && board.onBoard.has(p.id)
      ? { goTo: () => board.goTo(p.id), follow: { on: board.following === p.id, toggle: () => board.follow(board.following === p.id ? null : p.id) } } : undefined),
    swap: besideShare && !boardCompact ? boardPresented.hold ?? swapBoard : null,
    put: boardOpen.role === 'edit' && board.doc ? putShot : null
  } : null;

  /* A video played for everyone: the call's one player, until the call ends here (PlayTogether.tsx). */
  const player = useSharedVideo(session, !ended, work.act.failed);
  const startPlaying = useCallback((documentId: string, mediaId: string) => { session.startPlaying(documentId, mediaId, 0).catch(work.act.failed); }, [session, work.act]);
  const playing = useWorkspacePlaying(player, startPlaying);

  if (moving.moved) {
    const leaveFor = (to: 'join' | 'home') => {
      sessions.call = null;
      void navigate(to === 'home' ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
    };
    return <Moved to={moving.moved.to} problem={moving.moved.problem} signedIn={session.ticket.role !== 'guest'} onAgain={() => leaveFor('join')} onHome={() => leaveFor('home')} />;
  }

  return (
    <div className="stage ac-stage">
      <div className={cn('ic-call', ended && 'is-ended', zenOn && 'is-zen')}>
        <TopBar title={state.title} elapsed={state.elapsed} custom={custom} people={stagePeople.map((p) => p.person)}
          sign={<CaptureButton state={state} role={session.ticket.role} getting={getting} controls={controls} pausing={pausing} onOpenNotes={() => openPanel('notes')} />}
          asking={hosting ? state.waiting.length : 0} reconnecting={down || (crypto.status === 'joining' && !leaving)} peopleOpen={showing.includes('people')} screens={state.capture.screen.mode !== 'off'}
          swap={!phone && swap}
          view={(
            <ViewMenu mode={layout.prefs.mode} preset={presetNow(layout.prefs, layout.layout)} self={layout.prefs.self} custom={custom} layout={presetOf(panels)} people={panels.people} list={facts.ws ? panels.list : null}
              roomy={roomy} phone={phone} onMode={(m) => { if (!roomsHold()) layout.setMode(m); }} onSelf={(where) => { if (!roomsHold()) setSelf(where); }} onReset={resetView} onPreset={applyPreset}
              onLayout={pickLayout} onPeople={setPeopleMode} onList={(on) => layout.arrange((p) => setList(p, on))} onZen={zenOffered ? toggleZen : undefined} />
          )}
          onReset={resetView} onCatchUp={catchUp} onPeople={() => flip('people')} />
        <PanelHost area={callArea.ref} size={size} panels={panels} solved={solved} facts={facts} arrange={layout.arrange} arrangeLive={layout.arrangeLive} onLive={setResizing} onArranged={onCustom}
          label={panelName} group={sidePanel} swap={phone && swap} handle={hostHandle}
          board={board.drawn && !callOver ? (r) => (
            <BoardLeaf board={board} compact={boardCompact} width={r.w} height={r.h} seal={boardStanding} menu={boardNames} run={boardRun} theme={theme}
              pills={{ ...roomsPill, standing: boardStanding.pill && <StandingPill pill={boardStanding.pill} /> }} onPill={setBoardPill}
              phone={phone} openLinked={openLinked} link={boardLink}
              owner={boardOwner} opener={board.drawn?.openedBy !== meId ? openerName : null} onAsk={askBoard} onBack={boardBack} onSay={sayBoard} landing={landing}
              present={boardPresented.present} onPresent={boardPresented.start} />
          ) : undefined}
          ws={work.mounted && !callOver ? () => (
            <WorkspacePanel workspace={space} organizer={organizer} pass={session.ticket.pass} at={work.at} settled={work.settled} showing={wsInSight} finding={work.finding} zen={zenOffered ? zenOn : null} people={spacePeople} invited={spaceInvited} reach={work.reach}
              listOff={!solved.A.list} listPeek={work.peek} listWanted={work.listWanted} live={liveCall} act={work.act} presenting={presenting} playing={playing} foot={wsInSight ? aloneCard : null} onToggleList={toggleList} onShowList={onShowList} onToggleZen={toggleZen} />
          ) : undefined}
          tiles={(
            <>
              <Stage staged={staged} frame={frame} live={resizing} phone={phone} people={onStage} waiting={waiting} shares={shares} marks={marks} me={me?.person ?? SOMEONE} whoIs={personOf} spotlight={spotlight} view={layout} organizer={hosting}
                together={together}
                bar={bar} caption={capNode} rooms={stageRooms} onSpotlight={setSpot} onPin={setPin} onSelf={setSelf} onCustom={onCustom} volumes={volumes}
                onShareStarted={shareStarted} onShareStopped={shareStopped} onPeopleMode={setPeopleMode} onPickUp={(leaf) => hostHandle.current?.pickUp(leaf)}
                onGrowShare={facts.ws || facts.board ? (seat) => layout.arrange((p) => growShare(p, seat)) : null} onMorePeople={() => openPanel('people')} board={stageBoard} />
              <motion.div className="ic-frame" initial={false} animate={{ left: clear.x, top: clear.y, width: clear.w, height: clear.h }} transition={reduce || resizing ? { duration: 0 } : GLIDE}>
                {hosting && !showing.includes('people') && state.waiting.length > 0 && (
                  <div className="rg-knocks">
                    <AnimatePresence initial={false}>
                      {state.waiting.slice(0, 2).map((w) => (
                        <KnockCard key={w.id} person={w.person} title={`${w.person.name} asks to join`} busy={answering === w.id}
                          detail={w.person.email ? <>{w.person.email}{organizer && <><br />Gets the notes once let in</>}</> : 'Guest, by name only'}
                          onLetIn={() => answerAsk(w, (id) => session.admit(id))} onNotNow={() => answerAsk(w, (id) => session.deny(id))} />
                      ))}
                    </AnimatePresence>
                    {state.waiting.length > 2 && <button type="button" className="rg-more" onClick={() => openPanel('people')}><Icon name="people" size={15} />{state.waiting.length - 2} more asking</button>}
                  </div>
                )}
                {!wsInSight && aloneCard}
              </motion.div>
            </>
          )} />
        <PlayTogetherBar player={player} />
        <footer ref={dockBar} className="ic-dockbar">
          <CallDock tucked={zenOn}>
            <DockSplit className="keep">
              <DockButton icon={m.mic ? 'mic' : 'micOff'} label={m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : m.mic ? 'Mute' : 'Unmute'} off={!m.mic} alert={!!m.access.mic.problem} onClick={pressMic}
                tip={m.access.mic.problem ? `${stateOf('mic', m.access.mic.problem)}. Press to see how to fix it` : `${m.mic ? 'Mute' : 'Unmute'}${micLabel ? ` · ${micLabel}` : ''}`} />
              <MicMenu media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)}
                onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
            </DockSplit>
            <DockSplit className="keep">
              <DockButton icon={m.cam ? 'video' : 'videoOff'} label={m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} alert={!!m.access.cam.problem} onClick={pressCam}
                tip={m.access.cam.problem ? `${stateOf('cam', m.access.cam.problem)}. Press to see how to fix it` : `${m.cam ? 'Turn camera off' : 'Turn camera on'}${devices.cam.find((d) => d.id === m.camId)?.label ? ` · ${devices.cam.find((d) => d.id === m.camId)?.label ?? ''}` : ''}`} />
              <CamMenu media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)}
                onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
            </DockSplit>
            {!short && (
              <>
                <DockButton icon="screen" label={m.screen ? 'Change what you share' : full ? `${MAX_SHARES} people are sharing` : 'Share a tab, window or screen'}
                  tip={m.screen ? 'Change what you share' : full ? `${MAX_SHARES} people are sharing. You can share once one of them stops.` : 'Share a tab, window or screen'} on={!!m.screen} className="d-share" onClick={() => pickShare()} />
                <BoardButton session={session} board={board} brought={space.documents} spaceName={spaceName} canStart={canStartBoard} inRoom={boardInRoom} open={boardMenu}
                  onOpenChange={(o) => { setBoardMenu(o); if (o) loadBoard(); }} onToggle={pressBoard} failed={failed} />
                <DockButton icon="hand" label={handLabel} tip={me?.hand ? 'Lower your hand' : roomName && !organizer ? `Raise your hand to ask ${roomsOnBoards && organizerPerson ? callName(organizerPerson) : 'the organizer'} for help` : 'Raise your hand'}
                  on={!!me?.hand} onClick={() => setHand(!me?.hand)} />
                <DockSplit>
                  <DockButton icon="captions" label={cc ? 'Turn off captions' : 'Turn on captions'} tip={`${cc ? 'Turn off captions' : 'Turn on captions'} · the call is still transcribed for notes`} on={cc} onClick={flipCaptions} />
                  <Popover open={pop === 'cc'} onOpenChange={(o) => setPop(o ? 'cc' : null)} side="top" align="start" label="Caption language" className="ic-dmenu"
                    anchor={<DockChevron label="Caption language" on={pop === 'cc'} />}>{langMenu}</Popover>
                </DockSplit>
                <DockSeparator />
                {roomsHere && <DockButton icon="door" label="Breakout rooms" tip="Breakout rooms" on={showing.includes('rooms') || !!open} onClick={() => flip('rooms')} />}
                {own.enabled && <DockButton icon="bookmark" label="Mark this moment, for you alone" tip="Mark this moment · only you · B" onClick={() => own.mark()} />}
              </>
            )}
            <DockButton icon="folderOpen" label={!work.open && broughtHere > 0 ? `Workspace, ${broughtHere} in this call` : 'Workspace'} tip="Workspace · W" aria-keyshortcuts="W" on={work.open} badge={work.open ? 0 : broughtHere} onClick={work.act.toggle} />
            {!short && (
              <>
                <DockButton icon="notesPen" label="Notes" tip="Notes" on={notesShowing} onClick={flipNotes} />
                <DockButton icon="chat" label={unread ? `Chat, ${unread} new` : 'Chat'} tip="Chat" on={showing.includes('chat')} badge={unread} onClick={() => flip('chat')} />
              </>
            )}
            <Popover open={pop === 'more' || pop === 'devices' || pop === 'quality' || pop === 'board'} onOpenChange={(o) => setPop(o ? 'more' : null)} side="top" align="end" label={pop === 'board' ? 'Open a board' : 'More'}
              className={pop === 'devices' ? 'ic-dmenu ic-devices' : pop === 'quality' ? 'ic-dmenu' : pop === 'board' ? 'bl' : 'ic-menu'}
              anchor={<DockButton icon="more" label={short ? (unread ? `More: ${unread} new in Chat, notes, settings` : 'More: chat, notes, settings') : 'More: catch up, settings'}
                on={pop === 'more' || pop === 'devices' || pop === 'quality' || pop === 'board'} badge={short ? unread : 0} />}>
              {pop === 'devices' ? (
                <>
                  <MicOptions media={media} m={m} devices={devices} live onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
                  <div className="ic-msep" />
                  <CamOptions media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} preview={false} onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
                </>
              ) : pop === 'quality' ? (
                <VideoQuality media={media} m={m} />
              ) : pop === 'board' ? (
                <BoardMoreView session={session} board={board} brought={space.documents} spaceName={spaceName} inRoom={boardInRoom} onDone={() => setPop(null)} failed={failed} />
              ) : (
                <>
                  {short && (
                    <>
                      <button type="button" className="mi" aria-pressed={showing.includes('chat')} onClick={() => { setPop(null); flip('chat'); }}><Icon name="chat" size={17} /><span className="t">{unread ? `Chat, ${unread} new` : 'Chat'}</span></button>
                      <button type="button" className="mi" aria-pressed={notesShowing} onClick={() => { setPop(null); flipNotes(); }}><Icon name="notesPen" size={17} /><span className="t">Notes</span></button>
                      <button type="button" className="mi" aria-pressed={!!me?.hand} onClick={() => { setPop(null); setHand(!me?.hand); }}><Icon name="hand" size={17} /><span className="t">{handLabel}</span></button>
                      <button type="button" className="mi" aria-pressed={cc} onClick={() => { setPop(null); flipCaptions(); }}><Icon name="captions" size={17} /><span className="t">{cc ? 'Turn off captions' : 'Turn on captions'}</span></button>
                      <button type="button" className="mi" disabled={!m.screen && full} onClick={() => { setPop(null); pickShare(); }}><Icon name="screen" size={17} /><span className="t">{m.screen ? 'Change what you share' : full ? `${MAX_SHARES} people are sharing` : 'Share a tab, window or screen'}</span></button>
                      {board.open ? <button type="button" className="mi" aria-pressed={!board.hidden} onClick={() => { setPop(null); pressBoard(); }}><Icon name="presentation" size={17} /><span className="t">{board.hidden ? 'Show the board' : 'Hide the board'}</span><Scope>Only you</Scope></button>
                        : canStartBoard && <button type="button" className="mi" onClick={pressBoard}><Icon name="presentation" size={17} /><span className="t">Open a board</span></button>}
                      {roomsHere && <button type="button" className="mi" aria-pressed={showing.includes('rooms') || !!open} onClick={() => { setPop(null); flip('rooms'); }}><Icon name="door" size={17} /><span className="t">Breakout rooms</span></button>}
                      {own.enabled && <button type="button" className="mi" onClick={() => { setPop(null); own.mark(); }}><Icon name="bookmark" size={17} /><span className="t">Mark this moment</span><Scope>Only you</Scope></button>}
                      <div className="ic-msep" />
                    </>
                  )}
                  <button type="button" className="mi" onClick={() => { setPop(null); catchUp(); }}><Icon name="history" size={17} /><span className="t">Catch up on what you missed</span></button>
                  <button type="button" className="mi" onClick={() => setPop('devices')}><Icon name="speaker" size={17} /><span className="t">Audio and video settings</span></button>
                  <button type="button" className="mi" onClick={() => setPop('quality')}><Icon name="sliders" size={17} /><span className="t">Video quality</span></button>
                  <button type="button" className="mi" onClick={() => { setPop(null); moving.show(); }}><Icon name="phone" size={17} /><span className="t">Move to another device</span></button>
                </>
              )}
            </Popover>
            <DockSeparator />
            {zenOn && <DockWords icon="shrink" className="keep" onClick={toggleZen}>Show everything</DockWords>}
            <DockLeave className="keep" disabled={leaving || !!ended} onClick={() => setLeaveOpen(true)}>Leave</DockLeave>
          </CallDock>
        </footer>
      </div>
      <WorkspaceKnock session={session} workspace={space} at={work.at} act={work.act}
        onChoose={() => { work.act.wantList(); setFront('ws'); if (phone) setPanel(null); onShowList(); }} />
      <SharePicker open={sharePick} onOpenChange={(o) => { setSharePick(o); if (!o) setShareTrouble(null); }} sharing={!!m.screen}
        others={sharing.map((s) => s.presenter)} trouble={shareTrouble} read={sharingInRoom ? undefined : screenRead(state.capture.screen.mode)} onShare={share} />
      <MoveSheet open={moving.open} onOpenChange={(o) => { if (!o) moving.hide(); }} move={moving.move} media={{ mic: m.mic, cam: m.cam }} account={state.role !== 'guest'}
        sharing={!!m.screen} onStopSharing={stopShare} onMove={() => void moving.go()} onAgain={moving.again} />
      <LeaveSheet open={leaveOpen || !!ended} onOpenChange={(o) => { setLeaveOpen(o); if (!o) guard.stay(); }} title={state.title} elapsed={state.elapsed}
        hosting={hosting} organizer={organizer} standingInFor={state.host.standIn && hosting ? state.host.organizer.name : null} next={nextHosts}
        notes={state.notes.everOn} locked={state.locked} others={others.length}
        getting={invited} leaving={leaving} ended={ended} onEnd={() => void end()} onHandOff={(to) => void handOff(to)} onRead={(id) => void away({ noteId: id })} onHome={() => void away(null)} />
    </div>
  );
}

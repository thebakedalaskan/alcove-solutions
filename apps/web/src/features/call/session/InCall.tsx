import { useBreakoutRooms } from '../rooms/useBreakoutRooms';
import { CallCaption, CaptionLanguageMenu, captionLanguageName } from '../notes/CallCaptions';
import { useCallShortcuts, type CallKey } from './useCallShortcuts';
import { useCallRoom } from '../media/useCallRoom';
import { useSpeaking } from '../media/useSpeaking';
import { useWidth } from '../layout/useWidth';
import { useNotesCapture } from '../notes/useNotesCapture';
import { useScreenCapture } from '../notes/useScreenCapture';
import { useCallControls } from './useCallControls';
import { useFloatingWindow } from './floatingWindow';
import { FloatingCallPortal } from './FloatingCallPortal';
import { asShown, SOMEONE } from './participants';
import {
  BOARD_SHOT_LIMITS, CALL_LAYOUT_MAX, CAPTION_LANGUAGES, MAIN_PLACE, errorCode, errorMessage, firstName, notesAreOn, type CallAsker, type CallPeopleMode, type CallSession, type CallState, type CaptionLanguage,
  type CaptureMode, type Person, type SelfView
} from '@alcove/api';
import {
  AttentionButton, CallTimerButton, Notice, CallSignal, Avatar, BoardPicker, CallDock, CallMoreGrid, CallMoreTile, DockButton, DockLeave, DockSeparator, DockSplit, DockWords, Dots, Icon, IconButton, Kbd, KnockCard, LinkRow, Popover, RingAgain, RingReply, Scope,
  Tooltip, WaitTile, buttonClass, cn, useRaisedToasts, useTheme, useToast, volumeTag, wsToast, type IconName, type PresentAskProps, type WsToastData
} from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stateOf } from '~/features/call/media/access';
import { accessAsk, bringAndPresent, presentingWhy, useBoardPicker } from '~/features/call/boards/BoardPicker';
import type { BoardPager } from '~/features/board/CallBoard';
import { StandingPill, roomPills, type PillKind } from '~/features/board/pills';
import { UNREAD, standingOf, useChangesSinceSaved } from '~/features/board/standing';
import { BoardLeaf, BoardMenuRows, BoardMine, BoardMini, loadBoard } from '~/features/call/boards/BoardStage';
import { useBoardRun } from '~/features/call/boards/boardRun';
import { BOARD_SHOT_TOPIC, keepShot, shotHeard, shotNotice, useCallBoard, type SavedBoard } from '~/features/call/boards/callBoard';
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
import { Yours, useOwnInCall } from '~/features/call/notes/Yours';
import { useShareMarkCount } from '~/features/call/screen-sharing/SharePointing';
import { MyShareMenuRows, ShareInFrame, ShareMenuRows, ShareWindows, useFocusBack, usePointing, usePopOut, useShareLooks } from '~/features/call/screen-sharing/ShareInFrame';
import { LocalMedia, type ShareChoice } from '~/features/call/media/media';
import { ChatView, NotesTabs, NotesView, PeopleView, SideBody, SideHead, TranscriptView, type HostControls, type PanelPerson } from '~/features/call/layout/Panel';
import { PanelHost, useCallArea, useHorizon, type HostSide } from '~/features/call/layout/PanelHost';
import { BoardPagerFoot, Frame, FrameBox, type FrameBar } from '~/features/call/layout/frame';
import { holding, useLandKeys } from '~/features/call/layout/landKeys';
import { isScreen, screenOf, sharerOf, useOnStage, type Presented, type ThingId } from '~/features/call/layout/onStage';
import { KeysSheet } from '~/features/call/layout/KeysSheet';
import { STAGE_BESIDE_SIDE, sideWidth, useSide, type NotesTab, type SidePlace, type SideView } from '~/features/call/layout/side';
import { PlayTogetherBar, useSharedVideo, useWorkspacePlaying } from '~/features/call/playback/PlayTogether';
import { useBoardPresenting } from '~/features/call/boards/boardPresenting';
import { useWorkspacePresenting } from '~/features/call/workspace/presenting';
import { GAP, PHONE_W, focusRoom, placeMain } from '~/features/call/layout/panels';
import { CaptureButton, NotesAsks, askedTag, organizerName, useCaptureAlerts } from '~/features/call/notes/Capture';
import { useChatMentionNotifications, useNotesAskedNotifications } from '~/features/shell/notify';
import { unreadChatMentions, useCallAttention } from './attention';
import { captureHere } from '~/lib/capture';
import { RoomsLive, RoomsSetup } from '~/features/call/rooms/Rooms';
import { MAX_SHARES, SHARE_PROBLEMS, canShareScreen } from '~/features/call/screen-sharing/share';
import { ShareMenu, type ShareStep, type ShareTrouble } from '~/features/call/layout/ShareMenu';
import { keepSeen, seenNotices } from '~/features/call/session/seen';
import { VideoQuality } from '~/features/call/media/VideoQuality';
import { GLIDE, Stage, useStagePlan, type StageParticipant, type StagePresented, type StageShare, type StageTogether, type StageWaiter } from '~/features/call/layout/Stage';
import type { Box, StageFrame } from '~/features/call/layout/stageLayout';
import { useAttentionSignals } from '~/features/call/layout/useAttentionSignals';
import { AttentionView, signalChoice, type AttentionTab, type QuestionDraft } from '~/features/call/layout/Attention';
import { CallSoundControls } from '~/features/settings/Sounds';
import { useCallSounds } from '~/features/call/media/sounds';
import { PresenterTimerPanel } from '~/features/call/layout/PresenterTimer';
import { usePresenterTimer } from '~/features/call/layout/usePresenterTimer';
import { TopBar } from '~/features/call/layout/TopBar';
import { FeedVideo, type Feed } from '~/features/call/media/Video';
import { isCustom, useCallView, type ViewSnapshot } from '~/features/call/layout/view';
import { ViewChoices, ViewMenu } from '~/features/call/layout/ViewMenu';
import { canSetVolume, volumesFor } from '~/features/call/media/volume';
import { useLiveCall } from '~/features/call/notes/liveCall';
import { WorkspaceKnock } from '~/features/call/workspace/WorkspaceAsks';
import { WorkspaceMenuRows, WorkspacePanel, useWorkspacePanel } from '~/features/call/workspace/WorkspacePanel';
import { ShareSheetFor } from '~/features/workspace/Sheets';
import { ringable, rungWords, waitingOnStage } from '~/features/calls/ringing/RingWords';
import { Moved } from '~/features/move/Moved';
import { MoveSheet } from '~/features/move/MoveSheet';
import { useMoveOut } from '~/features/move/useMoveOut';
import { selfIn, sessions, useClosingWithPage, useLeaveGuard, useLive, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { q, qk, useCallSeries, useRenameBoard } from '~/lib/queries';
import { hm } from '~/lib/time';

const clog = log.child({ component: 'call' });
/**
 * What's open over the call: a device's menu, the captions' language, More and what it leads to (on a phone, the board picker and
 * View), and Share's steps.
 */
type Pop = 'mic' | 'cam' | 'cap' | 'more' | 'devices' | 'sounds' | 'quality' | 'board' | 'view' | ShareStep | null;
/** Time left in the rooms, as the rooms show it: 4:12. */
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
/** Whether what someone starts sharing is read for the notes: now, once notes resume, or not. */
const screenRead = (mode: CaptureMode): 'on' | 'paused' | undefined => (mode === 'on' || mode === 'paused' ? mode : undefined);
/** Takes away the toast that said why this tab left the call: it isn't true any more once the tab joins again. */
let leftToast: (() => void) | null = null;

/** What More holds, as its button says. */
const MORE_SAYS = 'More: captions, catch up, rooms, devices';
/** Notes' tabs, as places your side can be. */
const isNotesTab = (p: SidePlace): p is NotesTab => p === 'notes' || p === 'transcript' || p === 'ask';
/** Nobody's anywhere in the workspace, as far as the people list says while it's put away. */
const NOWHERE: Readonly<Record<string, string>> = {};

export function InCall({ session }: { session: CallSession }) {
  useClosingWithPage(session);
  const told = useLive(session);
  const crypto = useLive(session.crypto);
  const attentionSignals = useAttentionSignals(told.attention);
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
  // One breakpoint for the layout and the dock: under it, it's a phone.
  const phone = width < PHONE_W;
  const [pop, setPop] = useState<Pop>(null);
  /** Focus: what's in the frame fills your window, and everything else tucks away (⌘⇧F, Show everything, Esc). */
  const [focus, setFocus] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  /** Share › Your screen: why the last try didn't start, if it didn't. */
  const [shareTrouble, setShareTrouble] = useState<ShareTrouble | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveInFloating, setLeaveInFloating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [cc, setCc] = useState(false);
  const [lang, setLang] = useState<CaptionLanguage | null>(null);
  // Your own view of the call (never sent anywhere): how you like calls, remembered for your account, and how you
  // arranged this one, kept in this tab until you leave it.
  const account = useQuery(q.session());
  const owner = account.data ? account.data.ownerId : account.isPending ? undefined : null;
  const layout = useCallView(state.callId, owner);
  // Whose pictures can show behind the camera: a guest's none.
  useEffect(() => { if (owner !== undefined) media.setAccount(owner); }, [media, owner]);
  const forgetLayout = layout.forget;
  const panels = layout.panels;
  // The call's state changes all the time; what it says about the workspace rarely does, and the workspace draws a lot. A
  // video playing tells the server's time on every read, which only its player uses, and it reads the call itself.
  const spaceKey = JSON.stringify(told.workspace, (k, v: unknown) => (k === 'nowMs' ? undefined : v));
  const space = useMemo(() => told.workspace, [spaceKey]);
  // What's been brought to this call, as the list will show it: what's in the workspace the call uses now.
  const broughtHere = space.documents.filter((d) => d.workspaceId === space.id).length;
  /*
   * ---------- your side: one view at a time, at the right, and a sheet on a phone (side.ts) ----------
   * Notes has its tabs; where your side is, to the tab, is what catching up returns to.
   */
  const side = useSide({ phone });
  const [attentionTab, setAttentionTab] = useState<AttentionTab>('hands');
  const [notesTab, setNotesTab] = useState<NotesTab>('notes');
  const place: SidePlace | null = side.view === 'notes' ? notesTab : side.view;
  const goTo = (p: SidePlace | null) => {
    if (p === null) { side.close(); return; }
    if (isNotesTab(p)) { setNotesTab(p); side.open('notes'); return; }
    side.open(p);
  };
  // A reload finds your side as it was. A call you've just joined opens Notes beside the stage, on a wide screen, while notes are on.
  const keptSide = useRef(layout.layout.side);
  useEffect(() => {
    if (innerWidth < PHONE_W) return;
    const kept = keptSide.current;
    if (kept) side.open(kept);
    else if (kept === undefined && on && innerWidth >= 1100) side.open('notes');
    // Once, as the call opens.
  }, []);
  const sideKept = side.view === 'notes' || side.view === 'chat' || side.view === 'people' ? side.view : null;
  const sideMoved = useRef(false);
  useEffect(() => {
    if (sideMoved.current) layout.keepSide(sideKept);
    sideMoved.current = true;
    // `keepSide` writes through the layout's own updater, which never changes.
  }, [sideKept]);
  /* What's typed in Chat and Ask: moving your side to another view and back keeps it. */
  const drafts = useRef({ chat: { text: '' }, ask: { text: '' } });
  const questionDrafts = useRef(new Map<string, QuestionDraft>());
  const questionDraft = questionDrafts.current.get(crypto.place) ?? { text: '', submission: null };
  questionDrafts.current.set(crypto.place, questionDraft);
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
  const theirChat = crypto.chat.filter((c) => !c.isMe && c.place === crypto.place).length;
  const [seenChat, setSeenChat] = useState({ part: crypto.place, count: theirChat });
  if (seenChat.part !== crypto.place) setSeenChat({ part: crypto.place, count: theirChat });
  const unreadChat = Math.max(0, theirChat - (seenChat.part === crypto.place ? seenChat.count : theirChat));
  const unreadMentions = useMemo(() => unreadChatMentions(state, crypto, self), [state, crypto, self]);
  const unread = Math.max(unreadChat, unreadMentions.length);
  const attentionAllowed = useCallAttention(state, crypto, unreadMentions, !leaving && ended === null);
  useChatMentionNotifications(state, attentionAllowed ? unreadMentions : []);
  const readingMentions = useRef(new Set<string>());
  const readMentions = useCallback((ids: readonly string[]) => {
    const fresh = ids.filter((id) => !readingMentions.current.has(id));
    for (let at = 0; at < fresh.length; at += 200) {
      const batch = fresh.slice(at, at + 200);
      for (const id of batch) readingMentions.current.add(id);
      void session.readChat(batch).catch((e: unknown) => clog.warn('chat read state not saved', { code: errorCode(e) }))
        .finally(() => { for (const id of batch) readingMentions.current.delete(id); });
    }
  }, [session]);

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
    const feedback = crypto.status === 'in' && state.attention.place === crypto.place ? attentionSignals.find((s) => s.participantId === p.id) : undefined;
    const signal = feedback ? signalChoice(feedback.kind) : undefined;
    return { signal: signal ? <CallSignal className="ac-tile-signal" icon={signal.icon} label={signal.label} /> : undefined, id: p.id, seat: p.seat, person: p.person, isMe: p.isMe, hand: p.hand, mic: p.isMe ? m.mic : r?.mic ?? false, speaking: p.isMe ? speaking : r?.speaking ?? false, video, volume: p.isMe || !canVolume ? null : levels[p.id] ?? 1, connecting };
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
    open, left, roomName, placeName, inARoom, unit, unitKey, activity, organizerPerson, message, roomsOnBoards, roomsView, roomsBoard, myRoomId,
    candidates, guestsHere, visit, renameRoom, moveTo, openRooms, landing, cameBack
  } = useBreakoutRooms({ session, state, room, roomView, invited, openSide: side.open });

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
  const connected = roomView.connection === 'connected';
  const sharing = shares.filter((s) => !s.mine);
  // At most MAX_SHARES going at once in your part of the call, yours counted; changing what you share is always fine.
  const full = !m.screen && sharing.length >= MAX_SHARES;

  /*
   * Something that starts once you're settled in is told; something that stops, too. Not while the room connects or
   * reconnects, when shares come and go with the connection.
   */
  const settledAt = useRef<number | null>(null);
  // Starts again whenever the connection or your part of the call changes: shares come and go with either. A call that
  // ends empties the call (its state, or the room's disconnect, whichever comes first) in the render that says so, as a
  // reconnect does: `live` and `connected` cover those.
  useEffect(() => { settledAt.current = connected ? Date.now() : null; }, [connected, unitKey]);
  const settled = () => live && connected && settledAt.current !== null && Date.now() - settledAt.current > 4000;
  /** A toast in the workspace's words. `topic`: what it's about, so a newer one about the same thing takes its place. */
  const sayIt = useCallback((t: WsToastData, topic?: string) => toast(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms, topic }), [toast]);
  /** What's said about something on your stage, or presented here, is about it: each says the latest of it. */
  const about = (id: ThingId) => `stage:${id}`;

  /*
   * ---------- what's presented here, and what's on your stage (onStage.ts) ----------
   * Screens, as many as four, and one board or the workspace. A presentation that starts takes the stage of everyone who
   * isn't watching another; anything presented that isn't on your stage is a tile with the people.
   */
  const presentNow = space.present;
  const presenterIn = presentNow ? state.participants.find((p) => p.seat === presentNow.by.seat) ?? null : null;
  const presented: Presented[] = [
    ...shares.map((s): Presented => ({ id: screenOf(s.id), key: `screen:${s.id}`, by: s.presenter, seat: null, first: s.mine ? 'You' : callName(s.presenter), mine: s.mine, name: s.name })),
    ...(presentNow && presentNow.kind !== null ? [{
      id: presentNow.kind === 'workspace' ? 'ws' as const : 'board' as const, key: presentNow.key, by: presenterIn?.person ?? { ...SOMEONE, name: presentNow.by.name }, seat: presentNow.by.seat,
      first: firstName(presentNow.by.name), mine: presentNow.mine, name: presentNow.kind === 'workspace' ? space.name ?? 'the workspace' : presentNow.name ?? 'the board'
    }] : [])
  ];
  /* What a toast offers (Show it) goes once it's been taken up some other way, or what it's about stops. */
  const offers = useRef(new Map<string, () => void>());
  /** A presentation or share you ended, yours or (as the organizer) someone else's: you've been told, so its end isn't said twice. */
  const stoppedByMe = useRef<string | null>(null);
  const stage = useOnStage({
    presented, ended: space.ended, place: myRoomId ?? MAIN_PLACE, settled, kept: layout.layout.workspace.open,
    told: {
      started: (p, following, show) => {
        const what = isScreen(p.id) ? 'their screen' : p.id === 'ws' ? 'the workspace' : p.name;
        if (!following) { offers.current.get(p.key)?.(); offers.current.set(p.key, sayIt(wsToast.presentingToo(p.by, p.first, what, show), about(p.id))); return; }
        sayIt(isScreen(p.id) ? wsToast.presentingScreen(p.first) : p.id === 'ws' ? wsToast.followingWorkspace(p.first) : wsToast.followingBoard(p.first, p.name), about(p.id));
      },
      ended: (p, was) => {
        if (stoppedByMe.current === p.key) { stoppedByMe.current = null; return; }
        const what = p.id === 'ws' ? 'the workspace' : p.name;
        // Yours, closed for everyone, and not by you: only the organizer can, and you're told it was them, as a stopped share is.
        if (p.mine) { if (was.closed && !isScreen(p.id)) sayIt(wsToast.closedByOrganizer(organizerFirst(state), what), about(p.id)); return; }
        if (isScreen(p.id)) { if (was.onStage && settled()) sayIt(wsToast.stoppedSharing(p.first), about(p.id)); return; }
        // The call said it ended, and its presenter is gone from it: they left, which is why.
        if (was.said && !was.closed && p.seat !== null && !state.participants.some((x) => x.seat === p.seat)) { sayIt(wsToast.presenterLeft(p.first), about(p.id)); return; }
        // In a room, the board every room shares closes for that room alone, and stays the call's.
        const roomOnly = myRoomId !== null && (p.id === 'ws' || state.board.open !== null);
        sayIt(was.closed && was.onStage ? wsToast.closedEverywhere(what, roomOnly) : wsToast.stoppedPresentingIt(p.id === 'ws' ? 'folderOpen' : 'presentation', p.first, what), about(p.id));
      }
    }
  });
  const { open: stageOpen, close: stageClose } = stage;
  const tileKey = stage.tiles.map((t) => t.key).join(' ');
  useEffect(() => {
    for (const [key, close] of offers.current) if (!tileKey.split(' ').includes(key)) { close(); offers.current.delete(key); }
  }, [tileKey]);
  const setWsOpen = useCallback((o: boolean) => { if (o) stageOpen('ws'); else stageClose('ws'); }, [stageOpen, stageClose]);
  const work = useWorkspacePanel(session, space, layout, { open: stage.on.includes('ws'), setOpen: setWsOpen });

  /*
   * ---------- the board: the board in your part of the call, or a saved one just for you, on your stage (callBoard.ts) ----------
   * With none open, nothing here is drawn or loaded, and the call is as it always is.
   */
  const { resolved: theme } = useTheme();
  /** The board picker is open under Board, at the top right. */
  const [picking, setPicking] = useState(false);
  /** A saved board you opened just for you, while it's on your stage. */
  const [saved, setSaved] = useState<SavedBoard | null>(null);
  const savedOn = stage.on.includes('saved');
  useEffect(() => { if (!savedOn && saved) setSaved(null); }, [savedOn, saved]);
  // Your workspaces, to name a board's and know whether you're in it: read only once a board is open or the board picker opens,
  // so a call that never has one never lists them.
  const drive = useQuery({ ...q.workspaces(), enabled: state.role !== 'guest' && (state.board.open !== null || saved !== null || picking || pop === 'board' || pop === 'shareBoard') }).data;
  const spaceName = (id: string): string | null => drive?.find((w) => w.id === id)?.name ?? (space.id === id ? space.name : null);
  const board = useCallBoard({
    stage: savedOn && saved ? 'saved' : stage.on.includes('board') ? 'call' : null, saved: savedOn ? saved : null,
    place: myRoomId ?? MAIN_PLACE, cameBack, spaceName,
    session, state, me: meId, owner: account.data?.ownerId ?? null, talking: stagePeople.flatMap((p) => (p.speaking ? [p.id] : [])),
    say: (text, icon, action) => { toast(text, { icon, action }); }
  });
  /*
   * A breakout room's board, and the board the rooms come back to, open on everyone's stage there; the board rooms share opens on
   * the stage of whoever oversees them.
   */
  const boardArrived = board.arrived;
  useEffect(() => { if (boardArrived > 0) stageOpen('board'); }, [boardArrived, stageOpen]);
  /*
   * Overseeing open rooms, the organizer's stage shows them, and what's open stands beside them (panels.ts). A board the rooms are
   * worked on takes their place while it's on the organizer's stage: the one every room shares, or the board of the room they're
   * visiting.
   */
  const stageRooms = roomsView && !(roomsBoard && stage.on.includes('board')) ? roomsView : null;
  /* The board in the call, closed (and done sinking), leaves your stage. */
  const boardGone = state.board.open === null && !board.sinking && stage.on.includes('board');
  useEffect(() => { if (boardGone) stageClose('board'); }, [boardGone, stageClose]);
  /*
   * Someone else making a new board changes the board in the call, but never what's on your stage: the one you had stays open,
   * just for you, as a saved board.
   */
  const callBoardDoc = state.board.open?.documentId ?? null;
  const lastCallBoard = useRef(state.board.open);
  useEffect(() => {
    const was = lastCallBoard.current;
    lastCallBoard.current = state.board.open;
    if (!was?.documentId || !was.workspaceId || !callBoardDoc || was.documentId === callBoardDoc || !stage.on.includes('board') || state.board.open?.openedBy === meId || was.role === null) return;
    setSaved({ workspaceId: was.workspaceId, documentId: was.documentId, name: was.name ?? 'Untitled board' });
    stageOpen('saved');
  }, [callBoardDoc]);
  const boardStatus = board.status;
  const boardRun = useBoardRun(session, state, m.speakerId);
  /*
   * Your role on the open board changed, by Share in this call or anywhere else: the board's own document hears it first, so the
   * call is read again then, and the board turns read-only, or back, in a moment rather than at the next read.
   */
  const docRole = boardStatus?.role ?? null;
  useEffect(() => {
    const said = board.open?.role ?? null;
    if (board.savedDrawn || docRole === null || said === null || docRole === said) return;
    session.refresh({ call: true, log: false }).catch((e: unknown) => clog.info('call not read again for a board’s role', { code: errorCode(e) }));
  }, [docRole]);
  const renameBoard = useRenameBoard(board.savedDrawn ? undefined : session.ticket.pass);
  /* Who can add to it: the board's own Share, as its workspace has it, for someone in that workspace who can edit it there. */
  const boardSpace = board.drawn?.workspaceId ?? null;
  // The call says your place in the workspace it views; any other is in your Drive.
  const boardMember = boardSpace !== null && ((space.id === boardSpace && space.role !== null) || (drive ?? []).some((w) => w.id === boardSpace && w.role !== null));
  const boardItem = useQuery({ ...q.workspaceItem(boardSpace ?? '', board.drawn?.documentId ?? ''), enabled: boardMember && !!board.drawn?.documentId }).data;
  /* Someone put a picture of your screen on the board: you're told, so nothing of your screen goes there without you knowing. */
  useEffect(() => room.receive(BOARD_SHOT_TOPIC, (payload, from) => {
    const share = shotHeard(payload);
    if (share && share === myShare) toast(`${callName(personOf(from))} put a picture of your screen on the board.`, { icon: 'image' });
  }, BOARD_SHOT_LIMITS), [room, myShare]);

  /* ---------- actions ---------- */
  const callControls = useCallControls({
    session, media,
    enabled: () => live && !leaving && !ended && !over.current,
    problem: (kind) => setPop(kind),
    failed: (message) => toast(message, { icon: 'x' }),
    micChanged: (enabled) => callSounds.confirmMic(enabled),
    handChanged: (up) => toast(!up ? 'Your hand is lowered' : roomName && !organizer ? `Your hand is raised. The organizer sees that ${roomName} wants help.` : 'Your hand is raised. Everyone in this room can see it.', { icon: 'hand' })
  });
  const fullText = `${MAX_SHARES} people are sharing. You can share once one of them stops.`;
  const share = (c: ShareChoice) => {
    setPop(null);
    setShareTrouble(null);
    // Others may have started while the picker was open: checked again here, at the click.
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    // The browser's picker needs this click: nothing is awaited before it opens.
    void media.shareScreen(c, () => sayIt(wsToast.screenOff())).then((r) => {
      if (!r.ok) {
        if (r.problem === 'unsupported') toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 });
        else if (r.problem !== 'cancelled') reopen.current(r.problem);
        return;
      }
      sayIt(wsToast.screenOn(r.surface === 'browser' ? 'tab' : r.surface === 'window' ? 'window' : 'screen'));
      // The sound asked for didn't come (only asked where the browser can share it): its picker's switch was off, or
      // the computer wouldn't share it.
      if (r.sound !== 'left-out') return;
      toast(r.surface === 'browser' ? 'The tab’s sound isn’t shared. Change what you share and turn on Also share tab audio.' : 'Your computer’s sound isn’t shared here. A tab can share its sound.',
        { icon: 'speakerOff', ms: 9000, action: { label: 'Change', onClick: () => reopen.current() } });
    });
  };
  /** Opens Share › Your screen (saying why the last try didn't start, if it didn't), unless this browser can't share or four already are. */
  const pickShare = (trouble: ShareTrouble | null = null) => {
    if (!canShareScreen()) { toast(SHARE_PROBLEMS.unsupported, { icon: 'screen', ms: 8000 }); return; }
    if (full) { toast(fullText, { icon: 'screen' }); return; }
    setShareTrouble(trouble);
    setPop('shareScreen');
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
  const stopShare = () => { media.stopScreen(); sayIt(wsToast.screenOff()); };
  /* The organizer stopped your share for everyone: this browser lets it go too, and the call's notice says who did it. */
  const stoppedBy = roomView.shareStopped;
  const stoppedSeen = useRef(stoppedBy);
  useEffect(() => {
    if (stoppedBy <= stoppedSeen.current) return;
    stoppedSeen.current = stoppedBy;
    if (media.getSnapshot().screen) media.stopScreen();
  }, [stoppedBy, media]);
  const setHand = (up: boolean) => {
    callControls.hand(up);
  };
  const setSpot = (id: string | null) => {
    const name = id ? (id === meId ? 'You’re' : `${callName(byId.get(id) ?? SOMEONE)} is`) : '';
    session.setSpotlight(id);
    toast(id ? `${name} spotlighted for everyone` : 'Spotlight stopped for everyone', { icon: 'spotlight' });
  };
  /* ---------- your view: pins, where you see yourself and reset, each with a way back ---------- */
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
  const undoable = (text: string, icon: 'reset', was: ViewSnapshot) => toast(text, { icon, action: { label: 'Undo', onClick: () => layout.restore(was) } });
  const setSelf = (where: SelfView) => {
    layout.setSelf(where);
    toast(where === 'hidden' ? 'You’re hidden from your own view. Everyone else still sees you.' : where === 'corner' ? 'You see yourself in a corner' : 'You see yourself in the grid',
      { icon: where === 'hidden' ? 'eyeOff' : 'eye' });
  };
  // You've changed your view from the call's own: View offers Reset my view.
  const custom = isCustom(layout.prefs, layout.layout, panels);
  /** While rooms are open the organizer's stage shows every room; their own view comes back after. */
  const roomsHold = () => { if (open && organizer) { toast('Your view comes back when the rooms close', { icon: 'door' }); return true; } return false; };
  const resetView = () => { if (!roomsHold()) undoable('Your view is back to the call’s layout', 'reset', layout.reset()); };
  const hinted = useRef(false);
  const onCustom = () => { if (!hinted.current) { hinted.current = true; toast('Only your view changes. You can reset it from View.', { icon: 'eye' }); } };
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
  // A board asked for as the call started (Start a call here) opens on your stage, just for you, once the call's under way here.
  const openAsked = useCallback((b: { workspaceId: string; documentId: string; name: string }) => {
    setSaved({ workspaceId: b.workspaceId, documentId: b.documentId, name: b.name || 'Untitled board' });
    stageOpen('saved');
  }, [stageOpen]);
  useOpenWhenStarted(state.code, state.phase === 'in-call', openAsked);
  const controls = capture.controls({
    failed,
    notesEnabled: () => { if (!side.view && innerWidth >= 1100) side.open('notes'); },
    notesAsked: (up) => toast(up ? `You asked ${organizerName(state)} for notes` : 'You took back your ask', { icon: 'hand' })
  });
  useCaptureAlerts(state, controls);
  useNotesAskedNotifications(state);
  // Whatever brings your side up gives everything back: nothing else has a place while what's open fills your window.
  const openSide = (p: SidePlace) => { setPop(null); setFocus(false); goTo(p); };
  const flipSide = (v: SideView) => { setPop(null); setFocus(false); side.toggle(v); };
  /** Puts your side away. Focus that was in it goes back to the button that brings it up again, or More on a phone. */
  const closeSide = () => {
    const at = document.activeElement;
    if (at instanceof HTMLElement && at.closest('.ic-side')) {
      (document.querySelector<HTMLElement>(`.ic-top [data-side="${side.view ?? ''}"]`) ?? dockBar.current?.querySelector<HTMLElement>('[data-more]'))?.focus({ preventScroll: true });
    }
    side.close();
  };

  /* ---------- catching up and asking: for you alone, with the moments behind each answer, and a way back to live ---------- */
  const cu = useCatchingUp(session, { place, setPlace: (p) => { setPop(null); goTo(p); }, narrow: phone, everOn: state.notes.everOn, room: roomName });
  const catchUp = () => { setPop(null); cu.catchUp(); };
  // Showing the notes is what keeps them up to date, for everyone in this part of the call.
  const watchingNotes = notesAreOn(capHere.mode) && live && place === 'notes';
  useEffect(() => (watchingNotes ? session.watchNotes() : undefined), [session, watchingNotes]);
  /* Your own notes, at the foot of the notes: for someone with an account in the call, and for nobody else's eyes. */
  const [yoursShown, setYoursShown] = useState(0);
  const own = useOwnInCall(session, {
    role: state.role, noteId: state.notes.noteId, showing: place === 'notes', line: state.transcript.at(-1)?.id, place: state.capture.room?.id ?? null,
    onOpen: () => { cu.settle(); openSide('notes'); setYoursShown((n) => n + 1); }
  });
  // What carries over is your account's, not the call's: a guest has none, and everyone else reads only their own.
  // It's read while it's on screen, in the notes and Ask.
  const carried = useCallSeries(state.code, Boolean(account.data) && (place === 'notes' || place === 'ask'));
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
  const pressMic = () => callControls.mic();
  const handLabel = me?.hand ? 'Lower your hand' : roomName && !organizer && !roomsOnBoards ? 'Ask for help' : 'Raise your hand';
  const flipCaptions = () => {
    const v = !cc;
    setCc(v);
    toast(v ? `Captions on${lang ? `, in ${CAPTION_LANGUAGES.find((x) => x.code === lang)?.english ?? lang}` : ''}` : 'Captions off. The call is still transcribed for notes.', { icon: 'captions' });
  };
  const pressCam = () => callControls.cam();

  /* ---------- keys ---------- */
  // Escape unpins only when you can see a pin: someone pinned who's here.
  const pinnedHere = layout.layout.pins.some((seat) => seatKey.split(' ').includes(seat));
  /** How the people sit beside what's open, as View says, or hidden and back, as ⇧P does. It only ever changes your screen. */
  const setPeopleMode = (m: CallPeopleMode) => {
    if (roomsHold()) return;
    setFocus(false);
    layout.arrange((p) => ({ ...p, people: m }));
    if (m !== 'tiles' && !stage.on.length) toast('People stay on the stage until something is open on it', { icon: 'eye' });
    else onCustom();
  };
  const togglePeople = () => setPeopleMode(panels.people === 'hidden' ? 'tiles' : 'hidden');
  /* `@` in the workspace: who's here and who's invited. The call changes all the time and these rarely do, and the workspace draws a lot. */
  const spacePeopleKey = JSON.stringify(told.participants.map((p) => [p.id, p.seat, p.person, p.isMe]));
  const spacePeople = useMemo(() => told.participants.map((p) => ({ id: p.id, seat: p.seat, person: p.person, isMe: p.isMe })), [spacePeopleKey]);
  const spaceInvitedKey = JSON.stringify(invited);
  const spaceInvited = useMemo(() => invited, [spaceInvitedKey]);
  // Where people are in the workspace is for the people list and their cards while it's on your stage; put away, only the
  // presented workspace's tile says where its presenter is (presenting.ts).
  const wsShown = stage.on.includes('ws');
  const together: StageTogether = {
    ...work.together, where: wsShown ? work.together.where : NOWHERE, lit: work.lit, onFollow: work.act.follow, onStop: work.act.stopFollowing, onGo: work.act.goTo, onTag: work.act.tagIn, canTag: work.act.canTag
  };
  /* Focus fills your window with what's on your stage: not on a phone, where it fills the screen already, nor with nothing open. */
  const focusOffered = !phone && !stageRooms && stage.on.length > 0;
  const focusOn = focusOffered && focus;
  const latestFocus = useRef(focusOn);
  latestFocus.current = focusOn;
  const toggleFocus = useCallback(() => { setFocus(!latestFocus.current); }, []);

  /*
   * ---------- presenting: the workspace (presenting.ts) and the board (boardPresenting.ts) ----------
   * Following whoever presents is the stage's to keep (onStage.ts); these keep the workspace with them, and the board's pager.
   */
  /** The call's board is one you can't open, brought by someone here: a presentation you can't open asks them for it (`askBoard`). */
  const boardAccess = useRef<{ who: string; onAsk: () => void } | null>(null);
  const wsPresenting = useWorkspacePresenting({
    session, present: space.present, ended: space.ended, participants: state.participants, onStage: stage.on.includes('ws') && ended === null && !leaving, following: stage.following('ws'), together: work.together, at: work.at,
    act: { follow: work.act.follow, stopFollowing: work.act.stopFollowing, go: work.act.go }, say: work.act.say, failed: work.act.failed, onOwn: () => stage.setFollow('ws', false),
    access: () => boardAccess.current
  });
  const toggleMine = useCallback(() => side.toggle('mine'), [side]);
  const boardPresenting = useBoardPresenting({
    session, present: space.present, board, account: (account.data?.ownerId ?? null) !== null, following: stage.following('board'), onFollow: (on) => stage.setFollow('board', on),
    notesOpen: side.view === 'mine', onNotes: toggleMine, failed, notesFailed: (message) => work.act.say(wsToast.failed(message))
  });
  /* Your notes beside the board go with presenting it. */
  const presentingBoard = boardPresenting.mine;
  useEffect(() => { if (!presentingBoard && side.view === 'mine') side.close(); }, [presentingBoard, side.view]);

  /* ---------- closing: for you, or (your presentation) for you or for everyone ---------- */
  /**
   * Where the keys go as what's on your stage changes under them (landKeys.ts): to the tile of what you closed while someone
   * still presents it, else to what opens it again; into a frame opened from its tile; to the pager as you present a board.
   */
  const land = useLandKeys(phone);
  /** Close's question, while you present a board or the workspace: which frame it's open on. */
  const [asking, setAsking] = useState<ThingId | null>(null);
  /**
   * Close, on a frame's bar, or the lit Board or Workspace: on your own presentation it asks, on its frame, in front, and so it
   * does on the call's board nobody presents, for whoever may take it out of the call (`boardClosable`).
   */
  const closeThing = (id: ThingId) => {
    const p = stage.presentedOf(id);
    if (p?.mine && isScreen(id)) { land({ to: 'opener', id }, holding()); stopShare(); return; }
    if (p?.mine || (id === 'board' && !p && boardClosable)) { setFront(id); setAsking(id); return; }
    closeForMe(id);
  };
  /** It closes on your stage alone: someone else's presentation becomes its tile, and anything else closes. */
  const closeForMe = (id: ThingId) => {
    const p = stage.presentedOf(id);
    setAsking(null);
    if (stage.on.length <= 1) setFocus(false);
    land(p ? { to: 'tile', id } : { to: 'opener', id }, holding());
    stageClose(id);
    if (p) sayIt(wsToast.closedWhile(p.first), about(id));
  };
  /** The call's board leaves the call for everyone, as whoever opened it or the organizer: the board says so as it goes (callBoard.ts). */
  const closeBoardForAll = () => {
    setAsking(null);
    land({ to: 'opener', id: 'board' }, holding());
    session.closeBoard().catch(failed);
  };
  /** Your presentation of a board or the workspace ends, for you or for everyone: from Close's question, or Share's. */
  const closeFor = (id: ThingId, everyone: boolean) => {
    setAsking(null);
    const stop = id === 'ws' ? wsPresenting.stop : boardPresenting.stop;
    const was = stage.on;
    stoppedByMe.current = stage.presentedOf(id)?.key ?? null;
    stop(everyone).then(() => {
      if (was.includes(id) && was.length <= 1) setFocus(false);
      land({ to: 'opener', id }, holding());
      stageClose(id);
      if (side.view === 'mine') side.close();
      sayIt(everyone ? wsToast.closedForAll(forRoomOnly(id)) : wsToast.closedForYou(), about(id));
    }, () => { stoppedByMe.current = null; });
  };

  /* ---------- opening: Board's picker, Workspace, and Share's steps ---------- */
  /** You may start a board: invited, not a guest. In a room it's the room's alone, and the picker says so. */
  const canStartBoard = state.role !== 'guest' && live;
  const boardInRoom = myRoomId !== null;
  const boardOnStage: ThingId | null = stage.on.includes('board') ? 'board' : stage.on.includes('saved') ? 'saved' : null;
  /** Board, at the top right (in More on a phone), and O: the picker, or, with a board on your stage, Close. */
  const pressBoard = () => {
    if (boardOnStage) { setPop(null); setPicking(false); closeThing(boardOnStage); return; }
    loadBoard();
    if (phone) setPop((p) => (p === 'board' ? null : 'board'));
    else setPicking((o) => !o);
  };
  /** Workspace, at the top right (in More on a phone), and W: opens it on your stage where you left it, or Close. */
  const pressWorkspace = () => {
    setPop(null);
    if (stage.on.includes('ws')) closeThing('ws');
    else stageOpen('ws');
  };
  /**
   * Someone else presents a board or the workspace where you are. There's one at a time, so neither is presented by anyone
   * else until they stop: Present isn't offered, and Share's A board and The workspace say who's presenting.
   */
  const othersWhy = presentNow && !presentNow.mine ? presentingWhy(presentNow) : null;
  const someoneElse = othersWhy !== null;
  /* Nobody makes or brings in a board while someone else presents one here (the server's rule), and a guest starts none. */
  const boardBy = presentNow?.kind === 'board' && !presentNow.mine ? firstName(presentNow.by.name) : null;
  const boardBlocked = state.role === 'guest' ? 'Guests can’t start a board here.' : boardBy ? `${boardBy} is presenting a board. You can start one once they stop.` : undefined;
  const callBoardOpen = state.board.open;
  /**
   * Whoever opened the call's board, or the organizer, may take it out of the call while nobody presents it: Close asks them for
   * whom. While rooms share it, only the organizer may, as someone in a room may be presenting it there, where nobody else can
   * see, and the call would refuse.
   */
  const boardClosable = callBoardOpen !== null && (organizer || (callBoardOpen.canClose && open?.board !== 'shared'));
  const callBoardRow = callBoardOpen && callBoardOpen.role !== null ? {
    name: callBoardOpen.name ?? 'Untitled board',
    by: presentNow?.kind === 'board' && presentNow.id === callBoardOpen.documentId ? (presentNow.mine ? 'You’re presenting it' : `${firstName(presentNow.by.name)} is presenting it`)
      : board.opener ? `${callName(board.opener)} · brought it` : 'In this call'
  } : null;
  const pickerOpen = picking && !phone;
  const picked = { onOpenCall: () => stageOpen('board'), onOpenSaved: (b: SavedBoard) => { setSaved(b); stageOpen('saved'); }, onMade: () => stageOpen('board'), onPresented: (name: string) => { stageOpen('board'); sayIt(wsToast.boardOn(name)); }, failed };
  const openPicker = useBoardPicker({
    session, board, mode: 'open', inRoom: boardInRoom, account: state.role !== 'guest', brought: space.documents, spaceName, showing: pickerOpen || pop === 'board', blocked: boardBlocked, inCall: callBoardRow,
    onDone: () => { setPicking(false); setPop(null); }, ...picked
  });
  const sharePicker = useBoardPicker({
    session, board, mode: 'present', inRoom: boardInRoom, account: state.role !== 'guest', brought: space.documents, spaceName, showing: pop === 'shareBoard', blocked: othersWhy ?? boardBlocked,
    inCall: callBoardRow, onDone: () => setPop(null), ...picked
  });
  /** Present, on a saved board just for you: brought into the call first, asking first if some people here can't open it. */
  const [presentAsk, setPresentAsk] = useState<PresentAskProps | null>(null);
  const [presentBusy, setPresentBusy] = useState(false);
  const presentSaved = (b: SavedBoard) => {
    setPresentBusy(true);
    const go = (letIn: boolean, says: string | null) => {
      setPresentAsk(null);
      setPresentBusy(true);
      bringAndPresent(session, board, { workspaceId: b.workspaceId, documentId: b.documentId, letIn }, says)
        .then(() => { land({ to: 'pager' }, holding()); stageOpen('board'); sayIt(wsToast.boardOn(b.name)); }, failed).finally(() => setPresentBusy(false));
    };
    session.boardCheck(b.workspaceId, b.documentId).then((check) => {
      setPresentBusy(false);
      if (!check.cannot.length) { go(false, null); return; }
      const ask = accessAsk(check, { workspaceId: b.workspaceId, id: b.documentId, name: b.name, where: spaceName(b.workspaceId) }, (letIn, says) => go(letIn, says));
      setPresentAsk({ open: true, onOpenChange: (o) => { if (!o) setPresentAsk(null); }, names: ask.names, board: ask.board, where: ask.where, onLetIn: ask.onLetIn, onWithout: ask.onWithout, phone });
    }, (e: unknown) => { setPresentBusy(false); failed(e); });
  };
  const presentBoardNow = () => {
    if (board.savedDrawn && saved) { presentSaved(saved); return; }
    const name = state.board.open?.name ?? 'the board';
    setPresentBusy(true);
    boardPresenting.start().then(() => { land({ to: 'pager' }, holding()); sayIt(wsToast.boardOn(name)); }, () => undefined).finally(() => setPresentBusy(false));
  };
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
    side: side.view !== null, pinned: pinnedHere, unpinAll, closeSide, chat: () => flipSide('chat'), pressMic, pressCam, togglePeople, canMark: own.enabled, mark: own.mark, focusOffered, focused: focusOn, leaveFocus: () => setFocus(false), pressBoard
  }, shortcutWorkspace, toggleFocus);

  /*
   * The connection: this browser offline, or the call's media finding its way back. It's said at the top of the call while it
   * lasts, and once it's back, in the workspace's place for what it says, so a document saying its edits are saved says so instead.
   */
  const online = useOnline();
  const down = !online || roomView.connection === 'reconnecting';
  const attentionReady = crypto.status === 'in' && state.attention.place === crypto.place && live;
  const presenterTimer = usePresenterTimer(state, attentionReady && online && roomView.connection === 'connected', m.speakerId);
  const callSounds = useCallSounds({ call: session, state, speakerId: m.speakerId, presenting: shares.some((s) => s.mine) || Boolean(presentNow?.mine), connected: attentionReady && online && roomView.connection === 'connected' });
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
      callControls.setError(errorMessage(e));
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
      callControls.setError(errorMessage(e));
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
  /* On the way to another part of the call: nothing is heard or sent until this browser holds the new part's keys. */
  const movingBar = crypto.status === 'moving' && (
    <div className="ic-spill" role="status"><Dots /><span className="tx2">{roomName ? <>Moving you to <b>{roomName}</b></> : <>Moving you back to the <b>main room</b></>}</span></div>
  );
  /*
   * The rooms' time on the board, in its one pill: the room you're in, or how many rooms share the main board, and how long is
   * left. While that's the pill the board on the stage shows, it's said there, and the rooms line above says nothing more. While
   * the board's pill says something more pressing (how it stands, a vote, following, the timer), the line says it: the board
   * hands up which kind it shows (`BoardPills`).
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
      : [soundPill, camsPill, hostPill, roomBar].some(Boolean) ? <>{soundPill}{camsPill}{hostPill}{roomBar}</> : null)
    : (spotlight || alone || soundPill || movingBar || camsPill || hostPill) ? (
      <>
        {soundPill}
        {movingBar}
        {camsPill}
        {hostPill}
        {alone}
        {spotlight && (
          <div className="ic-spill"><Icon name="spotlight" size={15} /><span className="tx2">{spotName ? <><b>{spotName}</b> is spotlighted for everyone</> : <><b>You’re</b> spotlighted for everyone</>}</span>
            {hosting && <button type="button" className="sp-btn is-strong" onClick={() => setSpot(null)}>Stop spotlight</button>}
          </div>
        )}
      </>
    ) : null;

  const roomsHere = organizer && (others.length > 0 || !!open);
  /* Breakout rooms in your side go with the last person who could be sent to one. */
  const roomsGone = !roomsHere && side.view === 'rooms';
  const putAway = side.close;
  useEffect(() => { if (roomsGone) putAway(); }, [roomsGone, putAway]);

  /*
   * ---------- the main area (panels.ts): what's on your stage, each in its frame, and the people beside it ----------
   * Your side takes its width at the right, and the main area makes room for it; in a narrow window it sits over the stage.
   */
  const callArea = useCallArea();
  const size = callArea.size;
  const dockBar = useRef<HTMLElement>(null);
  const horizon = useHorizon(callArea.ref, dockBar, size);
  const reduce = useReducedMotion();
  /*
   * Once the call is over for this tab (it ended, or you're leaving), the workspace goes at once: its streams close and it stops
   * saying where you are, while the sheet says what happened.
   */
  const callOver = ended !== null || leaving;
  /*
   * Your side, beside the main area: not on a phone, where it's a sheet over the call, nor where the stage beside it would be too
   * narrow, where it sits over the stage at the right rather than squeeze it, nor in focus. While it's over what's on your stage,
   * choosing something there (or the call showing you something there) puts it away.
   */
  const sideW = sideWidth(width);
  const sideOver = !phone && size.w - (sideW + GAP) < STAGE_BESIDE_SIDE;
  const sideRoom = side.view !== null && !phone && !sideOver && !focusOn ? sideW + GAP : 0;
  const sideCovers = side.view !== null && (phone || (sideOver && !focusOn));
  const mainW = Math.max(0, size.w - sideRoom);
  /* What your side over the stage leaves clear, at its left: someone asking to join is answered there, never under your side. */
  const clearW = sideOver && side.view !== null && !focusOn ? Math.max(0, mainW - (sideW + GAP)) : mainW;
  const top = bar ? 46 : 0;
  const bottom = capNode ? (mainW < 700 ? 150 : 124) : 0;
  const shownThings = callOver ? [] : stage.on;
  /** Two on your stage with no room for both take turns: the one you brought to the front. */
  const [front, setFront] = useState<ThingId | null>(null);
  const focusedRoom = focusOn ? focusRoom(size, horizon) : null;
  // The shared timer and Attention own a strip above the focused frame, clear of its title and controls.
  const focusToolbarHeight = focusOn && (presenterTimer.sequence || hosting) ? 52 : 0;
  const focusBox = focusedRoom ? { ...focusedRoom, y: focusedRoom.y + focusToolbarHeight, h: Math.max(0, focusedRoom.h - focusToolbarHeight) } : null;
  const placed = placeMain({ w: mainW, h: size.h }, { frames: shownThings.length, people: panels.people, phone, focus: focusBox, rooms: !!stageRooms, top, bottom });
  /** The organizer's rooms are in sight: on the whole stage, or beside what's open, rather than under it. */
  const roomsShown = placed.rooms !== null;
  /* While rooms are open, you see the people in your own room (or the main room), and the organizer overseeing them sees every room. */
  const onStage = unit && !roomsShown ? stagePeople.filter((p) => unit.includes(p.id)) : stagePeople;
  const frontId = placed.turns ? (front && shownThings.includes(front) ? front : shownThings[0] ?? null) : null;
  const boxOf = (id: ThingId): Box | null => {
    const i = shownThings.indexOf(id);
    if (i < 0) return null;
    if (placed.turns) return id === frontId ? placed.frames[0] ?? null : null;
    return placed.frames[i] ?? null;
  };
  const staged = useStagePlan({
    people: onStage, waiting, tiles: stage.tiles.map((t) => t.id), spotlight, view: layout, hold: placed.frames.length > 0,
    narrow: phone || (placed.frames.length === 0 && mainW > 0 && mainW < 760)
  });
  // The stage's speaker is never you: it says who to make room for. The end of the transcript says who's talking.
  const talking = onStage.find((p) => p.id === staged.speaker) ?? onStage.find((p) => p.isMe && p.speaking);
  const { live: liveCall, put } = useLiveCall(session, talking?.person ?? null, {
    // A list over the page goes, or it would cover what the panel opens beside.
    notes: controls.notes, ask: controls.ask, beside: (v) => { setPop(null); work.act.setPeek(false); goTo(v); },
    reveal: () => { work.act.reveal(); if (sideCovers) side.close(); }, covered: () => sideCovers
  });
  // Who has a place however little room there is, as Speaker view counts talking: if every word did, the few places would keep changing hands.
  const loudKey = placed.frames.length ? onStage.filter((p) => p.hand || p.id === staged.speaker).map((p) => p.id).join(' ') : '';
  const placedKey = JSON.stringify([placed.people, placed.mode, placed.frames.length, placed.rooms]);
  const frame = useMemo((): StageFrame => ({
    box: placed.rooms ?? { x: 0, y: 0, w: mainW, h: size.h }, top, bottom,
    panels: placed.frames.length && !roomsShown ? { people: placed.people, mode: placed.mode, horizon, loud: new Set(loudKey.split(' ')), small: phone } : null
  }), [mainW, size.h, top, bottom, placedKey, horizon, loudKey, phone]);
  /** The workspace is on your stage and in sight: what's clear starts at its left, so its list has the bottom left of it. */
  const wsInSight = boxOf('ws') !== null;
  /* When there isn't room for two side by side, they take turns, and the top bar says which is showing. */
  const thingName = (id: ThingId) => (id === 'ws' ? 'Workspace' : id === 'board' || id === 'saved' ? 'Board' : shares.find((x) => screenOf(x.id) === id)?.name ?? 'Shared screen');
  /* Where your side covers what's taking turns, choosing one puts it away. */
  const swap = placed.turns && shownThings.length > 1 && (
    <div className="ic-swap" role="group" aria-label="What’s showing">
      {shownThings.map((id) => <button key={id} type="button" aria-pressed={!sideCovers && frontId === id} onClick={() => { setFront(id); if (sideCovers) side.close(); }}>{thingName(id)}</button>)}
    </div>
  );

  /* ---------- screens on your stage: how you look at each, pointing, its own window (ShareInFrame.tsx) ---------- */
  const screensShown = shownThings.flatMap((id) => { const sh = sharerOf(id); return sh ? [sh] : []; });
  const looks = useShareLooks({ shares, part: crypto.place, paused: mode === 'paused', kept: screensShown });
  useFocusBack(looks);
  const pointing = usePointing(shares, (id) => screensShown.includes(id), looks.popped);
  const popOut = usePopOut(looks.looks);
  const floating = useFloatingWindow(looks.looks, live && ended === null && !outOfGroup && !over.current && roomView.connection !== 'ended',
    media.micTrack()?.readyState === 'live' || media.camSource()?.readyState === 'live');
  useEffect(() => { if (floating.error) toast(floating.error, { icon: 'pip' }); }, [floating.error, toast]);
  // Selecting Chat in the main call does not read it while that tab is hidden, unfocused or covered by focus view.
  useEffect(() => {
    if (floating.mainVisible && side.view === 'chat' && !focusOn && !leaveOpen && !ended && !moving.open && !keysOpen && pop === null && seenChat.count !== theirChat) setSeenChat({ part: crypto.place, count: theirChat });
  }, [floating.mainVisible, side.view, focusOn, leaveOpen, ended, moving.open, keysOpen, pop, crypto.place, theirChat, seenChat.count]);
  useEffect(() => {
    if (floating.target || !leaveInFloating) return;
    setLeaveInFloating(false);
    if (!leaving) { setLeaveOpen(false); guardRef.current.stay(); }
  }, [floating.target, leaveInFloating, leaving]);
  const returnToCall = () => { floating.owner.returnToCall(); };
  const floatShare = (frontId ? shares.find((s) => screenOf(s.id) === frontId) : undefined)
    ?? shares.find((s) => screensShown.includes(s.id));
  const floatPeople = onStage.filter((p) => p.isMe || crypto.members.includes(p.id));
  const floatPerson = floatPeople.find((p) => p.id === staged.speaker) ?? floatPeople.find((p) => !p.isMe) ?? floatPeople.find((p) => p.isMe);
  const floatFeed = crypto.status === 'in' ? floatShare?.feed ?? floatPerson?.video ?? null : null;
  const floatAttention = {
    hands: attentionReady ? state.attention.hands.length : 0,
    questions: attentionReady ? state.attention.questions.filter((q) => q.status === 'open').length : 0,
    waiting: hosting ? state.waiting.length : 0,
    chat: unread
  };
  /*
   * Put on the board: a picture of someone else's share as this browser shows it, into the board's own files, and whoever shares
   * it is told. It's on their share's name menu only: your own screen has none.
   */
  const putShot = (s: StageShare) => {
    const open = board.open;
    if (!open?.workspaceId || !open.documentId || open.role !== 'edit') return;
    const { workspaceId, documentId } = open;
    const whose = callName(s.presenter);
    const caption = `${whose}’s screen, ${hm(new Date())}`;
    const look = looks.looks.look(s.id);
    keepShot({ workspaceId, documentId, pass: session.ticket.pass }, s.id, look.getSnapshot().held?.ready ? look.heldBitmap() : null, caption).then((media) => {
      if (!media) { toast(`There’s no picture of ${whose}’s screen yet. Try again in a moment.`, { icon: 'image' }); return; }
      if (!board.handle.current?.addShot({ media, caption })) { toast('Open the board in the call to put a picture on it.', { icon: 'image' }); return; }
      if (s.point) room.send(BOARD_SHOT_TOPIC, shotNotice(s.point.sid), { reliable: true });
      toast(`A picture of ${whose}’s screen is on the board. ${whose} can see that.`, { icon: 'image' });
    }).catch(failed);
  };
  const roomsBody = () => (open && me && activity
    ? <RoomsLive open={open} elapsed={state.elapsed} members={open.rooms.map((r) => r.members.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; }))}
      people={byId} activity={activity} me={me.person} onJoin={visit} onRename={renameRoom} onMove={moveTo} onMessage={(t) => session.messageRooms(t)} onClose={() => session.closeRooms()} />
    : <RoomsSetup people={candidates} guests={guestsHere} boardName={state.board.open?.name ?? null} onOpen={openRooms} />);
  /* Notes: its tabs, and your own notes at the foot of the notes. */
  const notesTabBody = (t: NotesTab) => {
    switch (t) {
      case 'notes': return <NotesView session={session} state={state} getting={getting} problems={[uploadError, heardProblem, frameProblem].filter((x): x is string => !!x)} put={put}
        controls={controls} carried={carried && <FromLastTime s={carried} me={account.data?.user.email} open={!state.liveNotes.notes} />} onSeek={cu.open}
        yours={own.enabled ? <Yours own={own} state={state} me={me?.person.email} shown={yoursShown} onOpen={cu.open} /> : undefined} />;
      case 'transcript': return cu.moment
        ? <MomentView moment={cu.moment} startedAt={state.startedAt} me={me?.person.email} onLive={cu.backToLive} />
        : <TranscriptView state={state} me={me?.person.email} onMark={own.enabled ? own.mark : undefined} put={put} />;
      case 'ask': return <AskView asks={cu.asks} ready={state.notes.everOn && state.transcript.length > 0 && capHere.mode !== 'paused'} paused={capHere.mode === 'paused'} startedAt={state.startedAt} range={cu.range} window={cu.window}
        catching={cu.catching} draft={drafts.current.ask} earlier={earlierNotes.length ? earlierNotes : null} scope={cu.scope} onScope={cu.setScope} onRange={cu.setRange} onWindow={cu.refreshWindow} onAsk={cu.ask}
        onAskEarlier={(question) => cu.askEarlier(question, earlierNotes)} onCatchUp={() => cu.catchUp(cu.range)} onOpen={cu.open} onLive={cu.backToLive} keeping={own.enabled ? own : undefined} />;
    }
  };
  /** Opens the workspace on these notes, just for you, and puts your side away. */
  const openNotesPage = () => { cu.settle(); side.close(); stageOpen('ws', { own: true }); work.act.go({ kind: 'live', page: 'notes' }); };
  const sideClose = () => { cu.settle(); closeSide(); };
  const sideBody = (v: SideView) => {
    switch (v) {
      case 'notes': return (
        <>
          <SideHead title="Notes" sub="This call, in the workspace" onClose={sideClose}>
            <Tooltip label="Open the workspace on these notes, just for you" side="bottom">
              <button type="button" className={buttonClass({ variant: 'secondary', size: 'xs' })} aria-label="Open the workspace on these notes" onClick={openNotesPage}><Icon name="folderOpen" size={15} />Open</button>
            </Tooltip>
            {own.enabled && <IconButton icon="bookmark" label="Mark this moment, only you" title="Mark this moment · B" aria-keyshortcuts="B" onClick={() => own.mark()} />}
          </SideHead>
          <NotesTabs tab={notesTab} onTab={(t) => { cu.settle(); setNotesTab(t); }} />
          <SideBody view={notesTab}>{notesTabBody(notesTab)}</SideBody>
        </>
      );
      case 'chat': return (
        <>
          <SideHead title="Chat" onClose={sideClose} />
          <SideBody view="chat">
            <ChatView chat={crypto.chat} missed={crypto.missedChat} ready={crypto.status === 'in'} moving={crypto.status === 'moving'} here={open ? roomName ?? 'the main room' : null} placeName={placeName}
              who={personOf} place={crypto.place} me={session.ticket.identity} draft={drafts.current.chat}
              mentionPeople={state.participants.filter((person) => crypto.members.includes(person.id)).map((person) => ({ identity: person.id, person: person.person }))}
              unreadMentionIds={unreadMentions} onReadMentions={readMentions}
              onSend={(t, mentions) => session.sendChat(t, mentions)} onReact={(id, r, on) => session.react(id, r, on)} />
          </SideBody>
        </>
      );
      case 'timer': return <><SideHead title="Timer" sub="Same countdown for everyone" onClose={sideClose} /><PresenterTimerPanel session={session} state={state} timer={presenterTimer} ready={attentionReady && !down} /></>;
      case 'attention': return (
        <>
          <SideHead title="Attention" onClose={sideClose} />
          <AttentionView key={state.attention.place} session={session} state={state} ready={attentionReady} signals={attentionSignals} presenter={!!m.screen || state.workspace.present?.mine === true} draft={questionDraft} tab={attentionTab} onTab={setAttentionTab}
            waiting={<PeopleView here={panelPeople} invited={[]} asking={hosting ? state.waiting : []} invites={false} ringing={[]} host={host} foot={privacyLine} volumes={volumes} together={together} canRing={() => false} />} />
        </>
      );
      case 'people': return (
        <>
          <SideHead title="People" onClose={sideClose} />
          <SideBody view="people">
            <PeopleView here={panelPeople} invited={invited} asking={hosting ? state.waiting : []} invites={organizer} ringing={rung} host={host} foot={privacyLine} volumes={volumes} together={together}
              canRing={(p) => team.data?.members.some((x) => x.onAlcove && sameEmail(x.person, p)) ?? false} onRing={organizer && live ? ring : undefined} onStopRing={organizer && live ? stopRing : undefined}
              notesAsks={organizer && !on && state.capture.requests.length > 0 ? <NotesAsks state={state} controls={controls} decline={(id) => session.declineNotes(id)} after={state.waiting.length > 0} /> : undefined}
              rooms={roomsHere ? { open: !!open, onOpen: () => side.open('rooms') } : undefined} />
          </SideBody>
        </>
      );
      case 'rooms': return (
        <>
          <SideHead title={open ? 'Rooms are open' : 'Breakout rooms'} onClose={sideClose} />
          <SideBody view="rooms">{roomsBody()}</SideBody>
        </>
      );
      // Whoever presents the board has their notes beside each frame here.
      case 'mine': return (
        <>
          <SideHead title="Your notes" onClose={sideClose} />
          <SideBody view="mine">
            <div className="ic-scroll ic-pad">
              <BoardMine board={board} section={boardPresenting.section} notes={boardPresenting.notes} onNote={boardPresenting.setNote} theme={theme} />
            </div>
          </SideBody>
        </>
      );
    }
  };
  const sideNames: Record<SideView, string> = { notes: 'Notes', chat: 'Chat', people: 'People', rooms: open ? 'Rooms are open' : 'Breakout rooms', mine: 'Your notes', attention: 'Attention', timer: 'Timer' };
  const hostSide: HostSide | null = side.view === null || focusOn ? null
    : { view: side.view, label: sideNames[side.view], width: sideW, phone, over: sideOver, theme, onClose: sideClose, children: sideBody(side.view) };
  /* The workspace's list: beside the page where its frame has the room, and otherwise over the page for now. */
  const wsBox = boxOf('ws');
  const listFits = wsBox !== null && wsBox.w >= 760 && !phone;
  const listShown = panels.list && listFits;
  /* The list's button: a list that gave way for want of room comes over the page for now. One you put away comes back. */
  const turnList = () => {
    if (panels.list && !listFits) { work.act.setPeek((on) => !on); return; }
    work.act.setPeek(false);
    layout.arrange((p) => ({ ...p, list: !p.list }));
    onCustom();
  };
  const listTurn = useRef(turnList);
  listTurn.current = turnList;
  const toggleList = useCallback(() => { listTurn.current(); }, []);
  /*
   * What needs the list, such as naming a folder, shows it and never hides it: one that gave way comes over the page, and one
   * you put away comes back, or over the page in a frame with no room for it.
   */
  const showList = () => {
    if (listShown) return;
    if (!panels.list) { layout.arrange((p) => ({ ...p, list: true })); onCustom(); }
    if (!listFits) work.act.setPeek(true);
  };
  const listShow = useRef(showList);
  listShow.current = showList;
  const onShowList = useCallback(() => { listShow.current(); }, []);

  /* ---------- the board on your stage: the call's, or a saved one just for you ---------- */
  const boardOpen = board.drawn;
  const boardWhere = boardOpen?.workspaceId ? spaceName(boardOpen.workspaceId) : null;
  const viewOnly = boardOpen?.role === 'read';
  /** A room's own board: only the people in the room see it, until rooms close. On the board every room shares, you're on the main board. */
  const roomsOwn = boardOpen !== null && !board.savedDrawn && roomName !== null && boardOpen.frame === null;
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
      ] : board.savedDrawn ? [
        { icon: 'lock', text: boardWhere ? `Open just for you. Saved in ${boardWhere}.` : 'Open just for you.' },
        UNREAD
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
    if (workspaceId === space.id) { work.act.wantList(); return; }
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
    if (linkHere) { work.act.openAt({ kind: 'document', id: item }); return; }
    window.open(`/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(item)}`, '_blank', 'noopener');
  } : undefined), [linkedIn, linkOpens, linkHere, work.act]);
  /** The board's own address, which opens it for whoever can open it. */
  const boardLink = linkedIn && boardOpen?.documentId ? `${location.origin}/drive/${encodeURIComponent(linkedIn)}/${encodeURIComponent(boardOpen.documentId)}` : undefined;
  /** Rename, in the board's frame's name menu: its name becomes a field on the board's bar. */
  const [renameAsk, setRenameAsk] = useState(0);
  const boardRename = boardOpen?.workspaceId && boardOpen.documentId && boardOpen.role === 'edit' ? (() => {
    const { workspaceId, documentId } = boardOpen;
    return (name: string) => renameBoard.mutateAsync({ workspaceId, id: documentId, name }).catch((e: unknown) => { failed(e); throw e; });
  })() : undefined;
  /** Who can add to it: the board's own Share, as its workspace has it, in place of the name menu's rows. */
  const boardShare = boardOpen?.workspaceId && boardOpen.documentId && boardOpen.role === 'edit' && boardItem && boardItem.id === boardOpen.documentId && boardItem.role === 'edit' && boardItem.trashedAt === null
    ? <ShareSheetFor workspaceId={boardOpen.workspaceId} item={{ ...boardItem, name: boardOpen.name ?? boardItem.name }} say={work.act.say} pass={board.savedDrawn ? undefined : session.ticket.pass} />
    : null;
  const openerName = board.opener ? callName(board.opener) : null;
  /** Asking whoever brought a board you can't open to let you in: in the call's chat, where they'll see it, as you'd ask them yourself. */
  const askBoard = openerName && boardOpen?.openedBy !== meId ? () => {
    session.sendChat(`${openerName}, could you let me into the board?`).then(() => toast(`Asked ${openerName} in the chat.`, { icon: 'chat' }), failed);
  } : undefined;
  boardAccess.current = state.board.open?.role === null && askBoard && openerName ? { who: openerName, onAsk: askBoard } : null;
  /** What the board says to you, with its own icon: what you were typing in going, a trash can. Following says its own, with an eye. */
  const sayBoard = (text: string, icon: IconName) => { toast(text, { icon }); };
  /** Where whoever presents the board is, for the pager at its frame's foot. */
  const [pager, setPager] = useState<BoardPager | null>(null);
  /** On a board being presented, the frame is everyone's: nobody goes to or follows anyone on it until they unfollow. */
  const boardOnFrame = boardPresenting.present !== null && (boardPresenting.present.mine || boardPresenting.present.watching);
  const stageBoard = boardOpen && board.shown && !callOver ? {
    find: (p: StageParticipant) => (!boardOnFrame && !p.isMe && board.onBoard.has(p.id)
      ? { goTo: () => board.goTo(p.id), follow: { on: board.following === p.id, toggle: () => board.follow(board.following === p.id ? null : p.id) } } : undefined)
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

  /* ---------- what's on your stage, each in its frame (frame.tsx) ---------- */
  /** Everyone else in your part of the call follows what you present. */
  const followers = Math.max(0, onStage.length - 1);
  // Focus is on offer only where it can fill your window: not on a phone, nor while the rooms hold the stage beside it.
  const focusFor = focusOffered ? { on: focusOn, onToggle: toggleFocus } : null;
  const askFor = (id: ThingId) => ({ open: asking === id, onOpenChange: (o: boolean) => setAsking(o ? id : null), onMe: () => closeFor(id, false), onEveryone: () => closeFor(id, true), everyone: closesFor(id), phone });
  /**
   * What your presentation's For everyone closes: in a room, it's that room's, unless it's the board every room shares and you
   * opened it or you're the organizer, when the board leaves the call. Anywhere else, it's everyone's in the call.
   */
  const forRoomOnly = (id: ThingId) => myRoomId !== null && !(id === 'board' && open?.board === 'shared' && (organizer || callBoardOpen?.canClose === true));
  const closesFor = (id: ThingId): string | undefined => (forRoomOnly(id) ? 'It closes for everyone in this room.' : myRoomId !== null ? 'It closes for everyone in the call, every room too.' : undefined);
  /** The call's board nobody presents, for whoever may take it out of the call: for you, it stays in the call; for everyone, it leaves it. */
  const boardAsk = {
    open: asking === 'board', onOpenChange: (o: boolean) => setAsking(o ? 'board' : null), onMe: () => closeForMe('board'), onEveryone: closeBoardForAll, phone,
    me: 'It stays in the call, and Board opens it again.', everyone: boardWhere ? `It leaves the call for everyone, and stays saved in ${boardWhere}.` : 'It leaves the call for everyone, and stays saved.'
  };
  const byOf = (p: Presented | null) => (p ? { person: p.by, first: p.first, mine: p.mine } : null);
  /** Another presented thing to put beside what's on your stage, while it holds one. */
  const besideFor = (id: ThingId) => (phone || stage.on.length !== 1 ? [] : stage.tiles.filter((t) => t.id !== id).map((t) => ({ name: t.name, onPick: () => stage.beside(t.id) })));
  /** The organizer's: anyone's share stops for everyone, and they're told who stopped it. */
  const stopTheirShare = (s: StageShare) => {
    const seat = state.participants.find((p) => p.id === s.id)?.seat;
    if (!seat) return;
    stoppedByMe.current = `screen:${s.id}`;
    session.stopShare(seat).then(() => sayIt(wsToast.stoppedTheirShare(callName(s.presenter))), (e: unknown) => { stoppedByMe.current = null; failed(e); });
  };
  /** The organizer's, on someone else's board or workspace: it closes for everyone. */
  const closeTheirs = () => {
    stoppedByMe.current = presentNow?.key ?? null;
    session.stopPresenting(true).then(() => sayIt(wsToast.closedForAll()), (e: unknown) => { stoppedByMe.current = null; failed(e); });
  };
  /* Your own screen, as its bar says it goes out: what kind of thing, and its sound. */
  const surfaceWords = m.screenSurface === 'browser' ? 'a tab' : m.screenSurface === 'window' ? 'a window' : m.screenSurface === 'monitor' ? 'your whole screen' : 'your screen';
  /** What you share is read for the notes: your bar says so, as its menu does. */
  const myShareRead = published && screensOn && !sharingInRoom;
  const myShareMeta = published ? `You’re presenting · ${surfaceWords}${withSound ? ' with sound' : ''}${myShareRead ? ' · Read for the notes' : ''}` : 'Starting to share…';
  const copyLinkOf = (link: string | undefined) => (link ? () => { void navigator.clipboard.writeText(link).then(() => sayIt(wsToast.linkCopied()), failed); } : undefined);
  const wsLink = space.id ? `${location.origin}/drive/${encodeURIComponent(space.id)}` : undefined;
  // Anyone who can open the workspace presents it: before anyone's opened it, the call hasn't said which it is yet.
  const canPresentWs = state.role !== 'guest' && (space.id === null || space.role !== null) && live;
  /* Where the workspace was last, so it stays there, out of sight, while it isn't on your stage. */
  const lastWsBox = useRef<Box | null>(null);
  const wsAt = boxOf('ws');
  if (wsAt) lastWsBox.current = wsAt;
  const frames = callOver ? null : (
    <>
      {shownThings.map((id) => {
        const box = boxOf(id);
        if (!box) return null;
        if (isScreen(id)) {
          const s = shares.find((x) => screenOf(x.id) === id);
          if (!s) return null;
          const look = s.mine || !('room' in s.feed) ? null : looks.looks.look(s.id);
          const isPopped = looks.popped === s.id;
          const pop = !s.mine && popOut ? (isPopped ? () => looks.looks.popIn(true) : () => popOut(s)) : null;
          const bar: FrameBar = {
            icon: 'screen', name: s.mine ? 'Your screen' : s.name, by: { person: s.presenter, first: s.mine ? 'You' : callName(s.presenter), mine: s.mine },
            followers, follow: null, present: null, focus: focusFor, phone, onClose: () => closeThing(id), ask: null,
            rows: (close) => (s.mine
              ? <MyShareMenuRows read={myShareRead} othersPoint={state.pointing ? othersPoint : null} marksOn={marksOnMine} onOthersPoint={flipOthersPoint}
                onClear={() => { if (myShare) marks?.clear(myShare); }} onChange={() => pickShare()} onDone={close} />
              : <ShareMenuRows share={s} look={look} pointing={pointing} popped={isPopped} onPopOut={pop} onPut={board.handle.current && board.open?.role === 'edit' && !board.savedDrawn ? () => putShot(s) : undefined}
                onBeside={besideFor(id)} onDone={close} />),
            stop: !s.mine && organizer ? { label: 'Stop it for everyone', onPick: () => stopTheirShare(s) } : null
          };
          return (
            <FrameBox key={id} id={id} box={box} shown focused={focusOn}>
              <Frame bar={bar} meta={s.mine ? myShareMeta : undefined} onStop={s.mine ? () => closeThing(id) : undefined}>
                <ShareInFrame share={s} look={look} looks={looks.looks} popped={isPopped} marks={marks} me={me?.person ?? SOMEONE} whoIs={personOf} pointing={pointing} onPopOut={pop} />
              </Frame>
            </FrameBox>
          );
        }
        if (id === 'board' || id === 'saved') {
          const p = id === 'board' ? stage.presentedOf('board') : null;
          const canPresent = p === null && !phone && canStartBoard && boardOpen?.role === 'edit' && !someoneElse && !board.sinking;
          const where = boardOpen?.workspaceId && boardWhere ? { name: boardWhere, onOpen: () => openSaved(boardOpen.workspaceId ?? '') } : null;
          const bar: FrameBar = {
            icon: 'presentation', name: boardOpen?.name ?? 'Board', by: byOf(p), followers, phone, focus: focusFor,
            follow: p && !p.mine ? { on: stage.following('board'), where: pager?.part || 'the board', onToggle: () => stage.setFollow('board', !stage.following('board')) } : null,
            present: canPresent ? { onPress: presentBoardNow, busy: presentBusy, ask: presentAsk ?? undefined } : null,
            onClose: () => closeThing(id), ask: p?.mine ? askFor(id) : id === 'board' && !p && boardClosable ? boardAsk : null,
            rows: (close) => {
              // What the board itself has to offer, read as the menu opens: there's none until it's drawn here. Night board changes
              // it for everyone, so it's for whoever can change it.
              const h = board.handle.current;
              return (
                <BoardMenuRows rename={boardRename ? () => setRenameAsk((n) => n + 1) : undefined} where={where} share={boardShare} link={copyLinkOf(boardLink)}
                  image={h ? () => h.saveImage() : undefined} pdf={h ? () => h.savePdf() : undefined} night={h && boardOpen?.role === 'edit' ? { on: h.night(), onToggle: () => h.setNight(!h.night()) } : undefined} onDone={close} />
              );
            },
            stop: p && !p.mine && organizer ? { label: 'Close it for everyone', onPick: closeTheirs } : null
          };
          const mine = p?.mine === true && pager !== null && boardPresenting.present !== null;
          return (
            <FrameBox key={id} id={id} box={box} shown focused={focusOn}>
              <Frame bar={bar} foot={mine && pager ? (
                <BoardPagerFoot pager={pager} onBack={() => boardPresenting.present?.onMove(pager.at - 2)} onNext={() => boardPresenting.present?.onMove(pager.at)}
                  notes={boardPresenting.present?.notes ?? null} />
              ) : undefined}>
                <BoardLeaf board={board} seal={boardStanding} rename={boardRename} renameAsk={renameAsk} run={boardRun} theme={theme}
                  pills={{ ...roomsPill, standing: boardStanding.pill && <StandingPill pill={boardStanding.pill} /> }} onPill={setBoardPill}
                  phone={phone} openLinked={openLinked} link={boardLink} opener={board.drawn?.openedBy !== meId ? openerName : null} onAsk={askBoard} onSay={sayBoard} landing={landing}
                  present={boardPresenting.present} onPager={setPager} />
              </Frame>
            </FrameBox>
          );
        }
        return null;
      })}
      {work.mounted && (wsAt ?? lastWsBox.current) && (() => {
        const p = stage.presentedOf('ws');
        const shown = wsAt !== null;
        const bar: FrameBar = {
          icon: 'folderOpen', name: space.name ?? 'Workspace', by: byOf(p), followers, phone, focus: focusFor,
          follow: p && !p.mine ? { on: stage.following('ws'), where: wsPresenting.where ?? 'the workspace', onToggle: () => stage.setFollow('ws', !stage.following('ws')) } : null,
          present: p === null && canPresentWs && !someoneElse ? { onPress: () => { void wsPresenting.start().then(() => land({ to: 'frame', id: 'ws' }, holding()), () => undefined); }, busy: false } : null,
          onClose: () => closeThing('ws'), ask: p?.mine ? askFor('ws') : null,
          rows: (close) => <WorkspaceMenuRows workspace={space} organizer={organizer} act={work.act} onFind={() => work.act.find()} onCopy={copyLinkOf(wsLink)} onDone={close} />,
          stop: p && !p.mine && organizer ? { label: 'Close it for everyone', onPick: closeTheirs } : null
        };
        return (
          <FrameBox key="ws" id="ws" box={wsAt ?? lastWsBox.current ?? { x: 0, y: 0, w: mainW, h: size.h }} shown={shown} focused={focusOn && shown}>
            <Frame bar={bar}>
              <WorkspacePanel workspace={space} organizer={organizer} pass={session.ticket.pass} at={work.at} settled={work.settled} showing={wsInSight} finding={work.finding} people={spacePeople} invited={spaceInvited} reach={work.reach}
                listOff={!listShown} listPeek={work.peek} listWanted={work.listWanted} live={liveCall} act={work.act} presenter={p && !p.mine ? wsPresenting.connection : null} playing={playing}
                foot={wsInSight ? aloneCard : null} onToggleList={toggleList} onShowList={onShowList} />
            </Frame>
          </FrameBox>
        );
      })()}
    </>
  );
  /* What's presented and isn't on your stage: a tile with the people, which takes you back to it. */
  const presentedTiles: StagePresented[] = callOver || roomsShown ? [] : stage.tiles.map((t) => {
    const s = isScreen(t.id) ? shares.find((x) => screenOf(x.id) === t.id) : undefined;
    return {
      id: t.id, name: t.name, icon: isScreen(t.id) ? 'screen' : t.id === 'ws' ? 'folderOpen' : 'presentation', sub: t.mine ? 'You’re presenting' : `${t.first} is presenting`,
      by: t.by, go: t.mine ? 'Open' : 'Join', label: `${t.mine ? 'Go back to' : 'Join'} ${t.name}`, where: t.id === 'ws' ? wsPresenting.where ?? undefined : undefined,
      mini: s ? () => <FeedVideo feed={s.feed} className="screen" /> : t.id === 'board' && !board.savedDrawn ? (w, h) => <BoardMini board={board} width={w} height={h} theme={theme} /> : null,
      onJoin: () => { setFocus(false); land(t.mine && t.id === 'board' ? { to: 'pager' } : { to: 'frame', id: t.id }, holding()); stageOpen(t.id); },
      beside: !phone && stage.on.length === 1 ? () => stage.beside(t.id) : null,
      sound: s?.sound ?? null,
      fresh: stage.fresh(t.key)
    };
  });

  /* ---------- the dock, Share and More: what you do in the call, and everything else ---------- */
  const moreOpen = pop === 'more' || pop === 'sounds' || pop === 'devices' || pop === 'quality' || pop === 'board' || pop === 'view';
  /** What you present, if anything: Share says so, and its first step offers Stop sharing. */
  const myThing = stage.presented.find((p) => p.mine) ?? null;
  const shareStep = pop === 'share' || pop === 'shareScreen' || pop === 'shareBoard' || pop === 'shareStop' ? pop : null;
  const moreRow = (icon: IconName, label: string, act: () => void, o: { scope?: string | undefined; kb?: string | undefined; pressed?: boolean | undefined } = {}) => (
    <button type="button" className="mi" aria-pressed={o.pressed} onClick={act}>
      <Icon name={icon} size={17} /><span className="t">{label}</span>{o.scope && <Scope>{o.scope}</Scope>}{o.kb && <Kbd>{o.kb}</Kbd>}
    </button>
  );
  const viewChoices = {
    mode: layout.prefs.mode, people: panels.people, self: layout.prefs.self, custom, phone,
    onMode: (m: typeof layout.prefs.mode) => { if (!roomsHold()) layout.setMode(m); }, onPeople: setPeopleMode, onSelf: (where: SelfView) => { if (!roomsHold()) setSelf(where); }, onReset: resetView,
    floating: (close: () => void) => <div className="ic-vfloat">
      <button type="button" className="mi" disabled={!floating.supported || floating.pending || !live || !!ended} aria-busy={floating.pending} onClick={() => { void floating.owner.open(); close(); }}>
        <Icon name="pip" size={17} /><span className="t">{floating.pending ? 'Opening floating call…' : floating.target ? 'Return to floating call' : 'Open floating call'}</span>
      </button>
      {floating.error && <p role="alert">{floating.error}</p>}
    </div>
  };
  const leaveQuestion = (
    <LeaveSheet inline={leaveInFloating && floating.target !== null} open={leaveOpen || !!ended} onOpenChange={(o) => { setLeaveOpen(o); if (!o) guard.stay(); }} title={state.title} elapsed={state.elapsed}
        hosting={hosting} organizer={organizer} standingInFor={state.host.standIn && hosting ? state.host.organizer.name : null} next={nextHosts}
        notes={state.notes.everOn} locked={state.locked} others={others.length}
        getting={invited} leaving={leaving} ended={ended} onEnd={() => void end()} onHandOff={(to) => void handOff(to)} onRead={(id) => void away({ noteId: id })} onHome={() => void away(null)} />
  );

  const moreBody = pop === 'devices' ? (
    <>
      <MicOptions media={media} m={m} devices={devices} live onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
      <div className="ic-msep" />
      <CamOptions media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} preview={false} onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
    </>
  ) : pop === 'sounds' ? (
    <><div className="ic-attention-sound-head"><button type="button" onClick={() => setPop('more')}><Icon name="left" size={15} />More</button><b>Sounds</b></div><CallSoundControls speakerId={m.speakerId} /></>
  ) : pop === 'quality' ? (
    <VideoQuality media={media} m={m} />
  ) : pop === 'board' ? (
    <BoardPicker {...openPicker.picker} />
  ) : pop === 'view' ? (
    <ViewChoices {...viewChoices} onReset={() => { setPop(null); resetView(); }} onDone={() => setPop(null)} />
  ) : (
    <>
      {phone && (
        <>
          <CallMoreGrid>
            <CallMoreTile icon="presentation" word="Board" aria-pressed={boardOnStage !== null} onClick={pressBoard} />
            <CallMoreTile icon="folderOpen" word="Workspace" label={!stage.on.includes('ws') && broughtHere > 0 ? `Workspace, ${broughtHere} in this call` : 'Workspace'} aria-pressed={stage.on.includes('ws')} badge={stage.on.includes('ws') ? 0 : broughtHere}
              onClick={pressWorkspace} />
            <CallMoreTile icon="notesPen" word="Notes" onClick={() => openSide('notes')} />
            <CallMoreTile icon="chat" word="Chat" label={unread ? `Chat, ${unread} new` : 'Chat'} badge={unread} onClick={() => openSide('chat')} />
            <CallMoreTile icon="people" word="People" label={hosting && state.waiting.length ? `People in this call. ${state.waiting.length} asking to join` : 'People in this call'} badge={hosting ? state.waiting.length : 0} onClick={() => openSide('people')} />
          </CallMoreGrid>
          <div className="ic-msep" />
          {moreRow('hand', handLabel, () => { setPop(null); setHand(!me?.hand); }, { pressed: !!me?.hand })}
          {moreRow('viewAuto', 'Your view', () => setPop('view'))}
        </>
      )}
      {moreRow('captions', cc ? 'Turn off captions' : 'Turn on captions', () => { setPop(null); flipCaptions(); }, { pressed: cc })}
      {own.enabled && moreRow('bookmark', 'Mark this moment', () => { setPop(null); own.mark(); }, { scope: 'Only you', kb: 'B' })}
      {moreRow('history', 'Catch up on what you missed', () => { setPop(null); catchUp(); })}
      {roomsHere && moreRow('door', 'Breakout rooms', () => openSide('rooms'), { pressed: side.view === 'rooms' })}
      <div className="ic-msep" />
      {moreRow('speaker', 'Audio and video settings', () => setPop('devices'))}
      {moreRow('bell', 'Sounds', () => setPop('sounds'))}
      {moreRow('sliders', 'Video quality', () => setPop('quality'))}
      {moreRow('phone', 'Move to another device', () => { setPop(null); moving.show(); })}
      {moreRow('keyboard', 'Keyboard shortcuts', () => { setPop(null); setKeysOpen(true); })}
    </>
  );

  /** Keyboard shortcuts lists only the keys you have here. */
  const keysWithout: CallKey['id'][] = [];
  if (!own.enabled) keysWithout.push('mark');
  if (phone || stageRooms) keysWithout.push('focus');

  return (
    <div className="stage ac-stage">
      <div className={cn('ic-call', ended && 'is-ended', focusOn && 'is-focus')}>
        {focusOn && (presenterTimer.sequence || hosting) && <CallTimerButton className="ic-timer-focus" time={presenterTimer.time} label={presenterTimer.mine && presenterTimer.overtime ? 'Your time is up' : presenterTimer.mine && presenterTimer.warning ? 'Your turn is nearly over' : presenterTimer.segment?.label ?? 'Plan this call'} status={presenterTimer.status} tone={presenterTimer.tone} on={side.view === 'timer'} onClick={() => { if (focusOn) toggleFocus(); openSide('timer'); }} />}
        {presenterTimer.mine && (presenterTimer.warning || presenterTimer.overtime) && !focusOn && side.view !== 'timer' && <Notice className="ic-timer-warning" icon="alert"><strong>{presenterTimer.overtime ? 'Your time is up' : 'Your turn has 30 seconds or less left'}</strong></Notice>}
        <span className="sr-only" role="status" aria-live="polite">{presenterTimer.mine && presenterTimer.overtime ? 'Your time is up. The timer is counting over time.' : presenterTimer.mine && presenterTimer.warning ? 'Your turn has 30 seconds or less left.' : presenterTimer.status}</span>
        {focusOn && <AttentionButton className="ic-attention-focus" hands={attentionReady ? state.attention.hands.length : 0} questions={attentionReady ? state.attention.questions.filter((q) => q.status === 'open').length : 0} waiting={hosting ? state.waiting.length : 0} on={side.view === 'attention'} onClick={() => openSide('attention')} />}
        <span className="sr-only" role="status" aria-live="polite">{attentionReady ? `${state.attention.hands.length} hands raised. ${state.attention.questions.filter((q) => q.status === 'open').length} open questions.${hosting ? ` ${state.waiting.length} waiting to join.` : ''}` : 'Connecting to this room.'}</span>
        <TopBar title={state.title} elapsed={state.elapsed} people={stagePeople.map((p) => p.person)} phone={phone}
          timer={presenterTimer.sequence || hosting ? <CallTimerButton time={presenterTimer.time} label={presenterTimer.segment?.label ?? 'Plan this call'} status={presenterTimer.status} tone={presenterTimer.tone} compact={phone} on={side.view === 'timer'} onClick={() => flipSide('timer')} /> : null}
          sign={<CaptureButton state={state} role={session.ticket.role} getting={getting} controls={controls} pausing={pausing} onOpenNotes={() => openSide('notes')} />}
          asking={hosting ? state.waiting.length : 0} reconnecting={down || (crypto.status === 'joining' && !leaving)} screens={state.capture.screen.mode !== 'off'}
          swap={!phone && swap}
          view={<ViewMenu {...viewChoices} />}
          board={{
            on: boardOnStage !== null || pickerOpen, onPress: pressBoard,
            menu: { open: pickerOpen, onClose: () => { openPicker.reset(); setPicking(false); }, content: openPicker.picker, reach: () => { if (!boardInRoom && state.role !== 'guest') void qc.prefetchQuery(q.workspaces()); } }
          }}
          workspace={{ on: stage.on.includes('ws'), count: broughtHere, onPress: pressWorkspace }}
          attention={{ hands: attentionReady ? state.attention.hands.length : 0, questions: attentionReady ? state.attention.questions.filter((q) => q.status === 'open').length : 0, onPress: () => flipSide('attention') }}
          side={{ view: side.view, toggle: flipSide, unread }} />
        <PanelHost area={callArea.ref} size={size} side={hostSide} swap={phone && swap} frames={frames}
          tiles={(
            <>
              <Stage staged={staged} frame={frame} phone={phone} people={onStage} waiting={waiting} presented={presentedTiles} spotlight={spotlight} view={layout} organizer={hosting}
                together={together} bar={bar} caption={capNode} rooms={roomsShown ? stageRooms : null} onSpotlight={setSpot} onPin={setPin} onSelf={setSelf} onCustom={onCustom} volumes={volumes}
                onPeopleMode={setPeopleMode} onMorePeople={() => openSide('people')} board={stageBoard} />
              <motion.div className="ic-frame" initial={false} animate={{ left: 0, top: 0, width: clearW, height: size.h }} transition={reduce ? { duration: 0 } : GLIDE}>
                {hosting && side.view !== 'people' && side.view !== 'attention' && state.waiting.length > 0 && (
                  <div className="rg-knocks">
                    <AnimatePresence initial={false}>
                      {state.waiting.slice(0, 2).map((w) => (
                        <KnockCard key={w.id} person={w.person} title={`${w.person.name} asks to join`} busy={answering === w.id}
                          detail={w.person.email ? <>{w.person.email}{organizer && <><br />Gets the notes once let in</>}</> : 'Guest, by name only'}
                          onLetIn={() => answerAsk(w, (id) => session.admit(id))} onNotNow={() => answerAsk(w, (id) => session.deny(id))} />
                      ))}
                    </AnimatePresence>
                    {state.waiting.length > 2 && <button type="button" className="rg-more" onClick={() => openSide('people')}><Icon name="people" size={15} />{state.waiting.length - 2} more asking</button>}
                  </div>
                )}
                {!wsInSight && aloneCard}
              </motion.div>
            </>
          )} />
        <PlayTogetherBar player={player} />
        <footer ref={dockBar} className="ic-dockbar">
          <CallDock tucked={focusOn}>
            <DockSplit className="keep">
              <DockButton icon={m.mic ? 'mic' : 'micOff'} label={m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : m.mic ? 'Mute' : 'Unmute'} off={!m.mic} alert={!!m.access.mic.problem} disabled={callControls.pending.mic || leaving || !!ended} aria-busy={callControls.pending.mic} onClick={pressMic}
                tip={m.access.mic.problem ? `${stateOf('mic', m.access.mic.problem)}. Press to see how to fix it` : `${m.mic ? 'Mute' : 'Unmute'}${micLabel ? ` · ${micLabel}` : ''}`} />
              <MicMenu media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)}
                onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
            </DockSplit>
            <DockSplit className="keep">
              <DockButton icon={m.cam ? 'video' : 'videoOff'} label={m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} alert={!!m.access.cam.problem} disabled={callControls.pending.cam || leaving || !!ended} aria-busy={callControls.pending.cam} onClick={pressCam}
                tip={m.access.cam.problem ? `${stateOf('cam', m.access.cam.problem)}. Press to see how to fix it` : `${m.cam ? 'Turn camera off' : 'Turn camera on'}${devices.cam.find((d) => d.id === m.camId)?.label ? ` · ${devices.cam.find((d) => d.id === m.camId)?.label ?? ''}` : ''}`} />
              <CamMenu media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)}
                onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
            </DockSplit>
            {!phone && <DockSeparator />}
            <ShareMenu step={shareStep} onStep={setPop} phone={phone}
              presenting={myThing ? {
                what: isScreen(myThing.id) ? 'your screen' : myThing.id === 'ws' ? 'the workspace' : myThing.name, asks: !isScreen(myThing.id), everyone: closesFor(myThing.id),
                onStop: (everyone) => { setPop(null); if (isScreen(myThing.id)) stopShare(); else closeFor(myThing.id, everyone); }
              } : null}
              screen={{
                full: full ? fullText : null, onPick: () => pickShare(), read: sharingInRoom ? null : screenRead(state.capture.screen.mode) ?? null, trouble: shareTrouble,
                changing: !!m.screen, onShare: share, onBack: () => { setShareTrouble(null); setPop('share'); }
              }}
              board={!canStartBoard ? { why: 'Guests can’t start a board here.' } : othersWhy ? { why: othersWhy } : { picker: sharePicker.picker, onPick: loadBoard }}
              workspace={!canPresentWs ? { why: 'You can’t open this call’s workspace.' } : othersWhy ? { why: othersWhy } : { onPress: presentWorkspace }} />
            {!phone && (
              <DockButton icon="hand" label={handLabel} tip={me?.hand ? 'Lower your hand' : roomName && !organizer ? `Raise your hand to ask ${roomsOnBoards && organizerPerson ? callName(organizerPerson) : 'the organizer'} for help` : 'Raise your hand'}
                on={!!me?.hand} disabled={callControls.pending.hand || !attentionReady || leaving || !!ended} aria-busy={callControls.pending.hand} onClick={() => setHand(!me?.hand)} />
            )}
            <Popover open={moreOpen} onOpenChange={(o) => setPop(o ? 'more' : null)} side="top" align="center" label={pop === 'board' ? 'Open a board' : pop === 'sounds' ? 'Sounds' : pop === 'view' ? 'Your view' : 'More'}
              onCloseFocus={() => { const current = floating.owner.getSnapshot(); return current.pending || current.target !== null; }}
              tip={phone ? undefined : MORE_SAYS}
              className={cn(pop === 'devices' ? 'ic-dmenu ic-devices' : pop === 'sounds' ? 'ic-dmenu ic-sounds' : pop === 'quality' ? 'ic-dmenu' : pop === 'board' ? 'bl' : 'ic-menu ic-morepop', phone && 'is-sheet')}
              anchor={<DockButton icon="more" label={!phone ? MORE_SAYS : unread ? `More: ${unread} new in Chat` : 'More: board, workspace, notes, chat, people'} title={undefined} data-more="" on={moreOpen} badge={phone ? unread : 0} />}>
              {moreBody}
            </Popover>
            {!phone && <DockSeparator />}
            {focusOn && <DockWords icon="shrink" className="keep" onClick={toggleFocus}>Show everything</DockWords>}
            <DockLeave className="keep" disabled={leaving || !!ended} onClick={() => setLeaveOpen(true)}>Leave</DockLeave>
          </CallDock>
        </footer>
      </div>
      <ShareWindows shares={shares} looks={looks} marks={marks} me={me?.person ?? SOMEONE} whoIs={personOf} />
      <WorkspaceKnock session={session} workspace={space} at={work.at} act={work.act}
        onChoose={() => { work.act.wantList(); setFront('ws'); if (sideCovers) side.close(); onShowList(); }} />
      <MoveSheet open={moving.open} onOpenChange={(o) => { if (!o) moving.hide(); }} move={moving.move} media={{ mic: m.mic, cam: m.cam }} account={state.role !== 'guest'}
        sharing={!!m.screen} onStopSharing={stopShare} onMove={() => void moving.go()} onAgain={moving.again} />
      <KeysSheet open={keysOpen} onOpenChange={setKeysOpen} without={keysWithout} backTo={() => dockBar.current?.querySelector<HTMLElement>('[data-more]') ?? null} />
      {!(leaveInFloating && floating.target) && leaveQuestion}
      <FloatingCallPortal target={floating.target} view={{
        title: state.title,
        timer: presenterTimer.sequence ? <CallTimerButton time={presenterTimer.time} label={presenterTimer.mine && presenterTimer.overtime ? 'Your time is up' : presenterTimer.segment?.label ?? 'Timer'} status={presenterTimer.status} tone={presenterTimer.tone} on={false} onClick={() => { returnToCall(); if (focusOn) toggleFocus(); openSide('timer'); }} /> : null,
        picture: floatFeed ? <FeedVideo feed={floatFeed} className={!floatShare && floatPerson?.isMe ? 'is-self' : undefined} /> : null,
        person: floatShare?.presenter ?? floatPerson?.person ?? null,
        label: crypto.status === 'moving' ? 'Moving between rooms…' : crypto.status !== 'in' ? 'Connecting securely…' : floatShare?.label ?? (floatPerson ? `${callName(floatPerson.person)}${floatPerson.video ? '' : ' · camera off'}` : 'Waiting for someone to join'),
        connection: roomView.connection,
        mic: { on: m.mic, pending: callControls.pending.mic, problem: m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : null },
        cam: { on: m.cam, pending: callControls.pending.cam, problem: m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : null },
        hand: !!me?.hand, handPending: callControls.pending.hand, busy: leaving || !!ended,
        attention: floatAttention, error: crypto.status === 'failed' ? 'This device lost the call’s encryption keys. Return to the call to reload.' : callControls.error, soundBlocked: roomView.audioBlocked, onSound: playSound,
        onMic: () => callControls.mic('floating'), onCam: () => callControls.cam('floating'), onHand: () => callControls.hand(!me?.hand, 'floating'),
        onLeave: () => { callControls.setError(null); setLeaveInFloating(true); setLeaveOpen(true); },
        onReturn: returnToCall,
        onAttention: (kind) => { returnToCall(); if (kind === 'chat') openSide('chat'); else { setAttentionTab(kind); openSide('attention'); } },
        children: leaveInFloating && leaveOpen ? leaveQuestion : null
      }} />
    </div>
  );
}

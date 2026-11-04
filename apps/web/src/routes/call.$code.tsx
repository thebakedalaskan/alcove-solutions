import { CALL_LAYOUT_MAX, CAPTION_LANGUAGES, MAIN_PLACE, errorMessage, notesAreOn, type CallSession, type CallState, type CaptionLanguage, type CaptureMode, type Person, type SelfView } from '@alcove/api';
import {
  Avatar, Caption, CallDock, DockButton, DockChevron, DockLeave, DockSeparator, DockSplit, Dots, Icon, Popover, RecDot, Tooltip, cn, useRaisedToasts, useToast
} from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { stateOf } from '~/features/call/access';
import { useCaptions } from '~/features/call/captions';
import { CamMenu, CamOptions, MicMenu, MicOptions } from '~/features/call/DevicePickers';
import { useDevices } from '~/features/call/devices';
import { ScreenFrames } from '~/features/call/frames';
import { LeaveSheet, type Ended } from '~/features/call/LeaveSheet';
import { useCopyLink } from '~/features/call/links';
import type { CallRoom, RoomView } from '~/features/call/livekit';
import { AskView, MomentView } from '~/features/call/CatchUp';
import { useCatchingUp } from '~/features/call/catchingUp';
import { useLiveNotes } from '~/features/call/liveNotes';
import { ShareMarks } from '~/features/call/marks';
import { useShareMarkCount } from '~/features/call/SharePointing';
import { LocalMedia, NotesRecorder, type ShareChoice } from '~/features/call/media';
import { ChatView, NotesView, PeopleView, SidePanel, TranscriptView, type HostControls, type PanelPerson, type PanelView } from '~/features/call/Panel';
import { CaptureButton, NotesAsks, askedTag, organizerName, useCaptureAlerts, type CaptureControls } from '~/features/call/Capture';
import { captureHere } from '~/lib/capture';
import { RoomsLive, RoomsSetup, type RoomActivity, type RoomCandidate } from '~/features/call/Rooms';
import { MAX_SHARES, SHARE_PROBLEMS, canShareScreen, type ShareProblem } from '~/features/call/share';
import { keepSeen, seenNotices } from '~/features/call/seen';
import { SharePicker } from '~/features/call/SharePicker';
import { VideoQuality } from '~/features/call/VideoQuality';
import { CallEars, canListen } from '~/features/call/speech';
import { Stage, type StageParticipant, type StageRooms, type StageShare } from '~/features/call/Stage';
import { TopBar } from '~/features/call/TopBar';
import type { Feed } from '~/features/call/Video';
import { isCustom, presetNow, useCallView, type Preset, type ViewSnapshot } from '~/features/call/view';
import { ViewMenu } from '~/features/call/ViewMenu';
import { canSetVolume, volumesFor } from '~/features/call/volume';
import { volumeTag } from '~/features/call/VolumeControl';
import { Moved } from '~/features/move/Moved';
import { MoveSheet } from '~/features/move/MoveSheet';
import { useMoveOut } from '~/features/move/useMoveOut';
import { selfIn, sessions, useClosingWithPage, useLeaveGuard, useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { q, qk } from '~/lib/queries';

/* Guests have no account: being in the call (its pass) is what lets them in. */
export const Route = createFileRoute('/call/$code')({ component: Call });

const clog = log.child({ component: 'call' });
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable]');
type Pop = 'mic' | 'cam' | 'cc' | 'cap' | 'more' | 'devices' | 'quality' | null;
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;
/** Time left in the rooms, as the rooms show it: 4:12. */
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const SOMEONE: Person = { id: 'someone', name: 'Someone', email: '' };
/** Whether what someone starts sharing is read for the notes: now, once notes resume, or not. */
const screenRead = (mode: CaptureMode): 'on' | 'paused' | undefined => (mode === 'on' || mode === 'paused' ? mode : undefined);
/** Before the room has connected: nobody's media yet. */
const NO_VIEW: RoomView = { connection: 'connecting', endReason: null, people: {}, hostMuted: 0, audioBlocked: false, screenFailed: null };
const NO_ROOM: CallRoom = {
  getSnapshot: () => NO_VIEW, subscribe: () => () => undefined, attach: () => () => undefined, heard: () => [], playOnly: () => undefined, startAudio: async () => undefined,
  muteShare: () => undefined, send: () => undefined, receive: () => () => undefined, leave: async () => undefined
};
/**
 * One room connection per call session. React may mount the screen twice (StrictMode in dev); a second
 * connection under the same identity would push the first out of the room, so remounts share this one,
 * and it's left only once no screen uses it.
 */
const connections = new WeakMap<CallSession, { room: Promise<CallRoom>; users: number }>();

function Call() {
  const { code } = Route.useParams();
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall session={active.session} />;
}

/**
 * The call as shown: everyone the server says is in it, and anyone else in its MLS group (anyone who can
 * hear it) as "Someone". Nobody who holds the call's keys is ever left off the screen.
 */
function asShown(state: CallState, members: string[], self: string): CallState {
  const here = new Set(state.participants.map((p) => p.id));
  const leaving = new Map(state.leaving.map((l) => [l.id, l]));
  // A connection on its way out of the group shows as whose it is, and not at all once that person is here again on another.
  const unknown = members.filter((id) => { const l = leaving.get(id); return !here.has(id) && !(l?.now && here.has(l.now)); });
  if (!unknown.length) return state;
  return { ...state, participants: [...state.participants, ...unknown.map((id) => ({ id, seat: leaving.get(id)?.seat ?? id, person: leaving.get(id)?.person ?? { ...SOMEONE, id }, isMe: id === self, isOrganizer: false, hand: false, othersPoint: true }))] };
}

/** Whether you're talking now, from the real microphone level. */
function useSpeaking(media: LocalMedia, on: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!on) { setSpeaking(false); return; }
    const t = setInterval(() => setSpeaking(media.level() > 0.09), 160);
    return () => clearInterval(t);
  }, [media, on]);
  return speaking;
}

/** How wide the panel is, and whether it covers the stage (phones) instead of sitting beside it. */
function useWidth() {
  const [w, setW] = useState(() => innerWidth);
  useEffect(() => { const on = () => setW(innerWidth); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  return w;
}

function InCall({ session }: { session: CallSession }) {
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
  const copy = useCopyLink();
  const reduce = useReducedMotion();
  useRaisedToasts();
  const me = selfIn(state);
  const meId = me?.id ?? self;
  const organizer = state.isOrganizer;
  // What the call captures now, the same for everyone: notes on (unavailable while the organizer's browser can't
  // capture anything), paused by the organizer, or off. The recording follows it.
  const mode = state.capture.mode;
  const on = notesAreOn(mode);
  // What's captured where you are: in a breakout room, the room's, which the organizer can pause on its own. Captions,
  // catching up and asking follow it, and the live transcript is heard only while it says on.
  const capHere = captureHere(state.capture);
  const hearing = capHere.transcript.mode === 'on';
  const width = useWidth();
  const narrow = width < 760;
  const sideW = narrow ? width : width < 1100 ? 360 : 400;
  const [panel, setPanel] = useState<PanelView | null>(() => (on && innerWidth >= 1100 ? 'notes' : null));
  const [pop, setPop] = useState<Pop>(null);
  const [sharePick, setSharePick] = useState(false);
  /** Why the last share didn't start: the picker opens again and says what to do. */
  const [shareTrouble, setShareTrouble] = useState<Exclude<ShareProblem, 'cancelled' | 'unsupported'> | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [cc, setCc] = useState(false);
  const [lang, setLang] = useState<CaptionLanguage | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  // The organizer's browser: a recorder that couldn't start or failed, no way to listen, and its own pause on its way.
  const [cantRecord, setCantRecord] = useState(false);
  const [cantListen, setCantListen] = useState(() => !canListen());
  const [pausing, setPausing] = useState(false);
  const [frameProblem, setFrameProblem] = useState<string | null>(null);
  // Your own view of the call (never sent anywhere): how you like calls, remembered for your account, and how you
  // arranged this one, kept in this tab until you leave it.
  const account = useQuery(q.session());
  const layout = useCallView(state.callId, account.data ? account.data.ownerId : account.isPending ? undefined : null);
  const forgetLayout = layout.forget;
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
  if (panel === 'chat') seenChat.current = theirChat;
  const unread = Math.max(0, theirChat - seenChat.current);

  /* Media comes from pre-join; it starts here if the call page was opened directly. */
  const first = useRef({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam });
  useEffect(() => {
    sessions.media = media;
    // In the call nothing turns the microphone or camera on by itself: only their buttons do.
    media.setInCall(true);
    if (!media.started) void media.start(first.current);
  }, [media]);

  /* The call's media goes through its LiveKit room (loaded only here); leaving the screen leaves the room. */
  const [room, setRoom] = useState<CallRoom>(NO_ROOM);
  const roomView = useLive(room);
  useEffect(() => {
    let gone = false;
    let entry = connections.get(session);
    if (!entry) {
      entry = { room: import('~/features/call/livekit').then(({ openRoom }) => openRoom(session, media)), users: 0 };
      connections.set(session, entry);
    }
    const e = entry;
    e.users++;
    e.room.then((r) => { if (!gone) setRoom(r); }, (err: unknown) => {
      connections.delete(session);
      if (gone) return;
      clog.error('could not join the call’s room', { err });
      toast(errorMessage(err), { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guardRef.current.release(); location.reload(); } } });
    });
    return () => {
      gone = true;
      e.users--;
      // A remount comes straight back; only a screen that's really gone leaves the room.
      setTimeout(() => {
        if (e.users > 0 || connections.get(session) !== e) return;
        connections.delete(session);
        void e.room.then((r) => r.leave(), () => undefined);
      }, 0);
    };
  }, [session, media, toast]);
  /* Pointers and marks on what's shared: kept in this browser only, sent and taken through the room, encrypted end to end. */
  const [marks, setMarks] = useState<ShareMarks | null>(null);
  useEffect(() => {
    if (room === NO_ROOM) return;
    const m = new ShareMarks(room, self);
    setMarks(m);
    return () => { m.dispose(); setMarks(null); };
  }, [room, self]);

  /*
   * The call's notes, in the organizer's browser, from what it hears: its own microphone and the people in its part of
   * the call, as their tracks arrived (nobody's volume here, nor the speaker, changes that). The recorder mixes them into
   * one recording, so playing the notes back sounds like the call; the live transcript hears each on its own, under their
   * own name. While the organizer visits a breakout room the recording is silent (hush, below), and the room's lines
   * are live only: the call's notes have the main room's talk. Both run while notes are on; paused or off, they stop
   * and drop whatever wasn't sent: the server refuses it anyway.
   */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), setUploadError, setCantRecord);
  const ears = useRef<CallEars | null>(null);
  if (!ears.current) ears.current = new CallEars((c, speaker) => session.transcribe(c, speaker), setHeardProblem, setCantListen);
  const micTrack = media.micTrack();
  const segment = state.notes.recording.segment;
  const live = state.phase === 'in-call';
  // Who's heard changes as people come and go, mute, switch microphones, or move between rooms.
  const heardKey = room.heard().map((h) => `${h.identity}:${h.track.id}`).join(' ');
  // Once the organizer is ending the call or turning notes off, the last audio and speech are on their way: nothing
  // starts recording or listening again meanwhile, as people drop out of the room or anyone mutes.
  const capturing = organizer && on && live && !leaving && !ended && !turningOff;
  useEffect(() => {
    const r = recorder.current;
    if (!r) return;
    // In a breakout room it records silence (hush, below): the call's recording has the main room's talk.
    if (capturing) r.start([...(micTrack ? [{ identity: self, track: micTrack }] : []), ...room.heard()], segment);
    else if (!on || !organizer) r.discard();
  }, [capturing, organizer, on, segment, micTrack, room, self, heardKey]);
  // Nothing is heard while this browser is between two parts of the call: it holds neither part's keys.
  const settledHere = crypto.status === 'in';
  // Nobody is heard in a breakout room the organizer paused: what was held is dropped, and the segment carries on.
  const roomHeld = state.capture.room?.mode === 'paused';
  // Everyone else is heard whether or not the organizer has a microphone of their own.
  useEffect(() => {
    const e = ears.current;
    if (!e) return;
    if (capturing && !roomHeld) e.follow(segment, settledHere ? [...(micTrack ? [{ identity: self, track: micTrack, own: true }] : []), ...room.heard().map((h) => ({ ...h, own: false }))] : []);
    else if (!on || !organizer) e.stop();
    else if (roomHeld) e.quiet();
  }, [capturing, organizer, on, segment, micTrack, room, self, heardKey, settledHere, roomHeld]);
  useEffect(() => () => ears.current?.stop(), []);
  /*
   * What this browser can't capture while notes are on, which everyone is told: the recording when the recorder
   * couldn't start or failed (without a microphone of the organizer's own it still records everyone else), the
   * transcript without a way to listen. It's said again whenever it changes, and after every change to notes, which
   * forgets it.
   */
  const cant = (['recording', 'transcript'] as const).filter((p) => (p === 'recording' ? cantRecord : cantListen));
  const cantKey = cant.join(' ');
  const toldKey = (['recording', 'transcript'] as const).filter((p) => state.capture[p].mode === 'unavailable').join(' ');
  useEffect(() => {
    if (!organizer || !live || !on || cantKey === toldKey) return;
    clog.info('saying what this browser can’t capture', { parts: cantKey || 'none' });
    session.setUnavailable(cant).catch((e: unknown) => clog.warn('could not say what this browser can’t capture', { err: e, parts: cantKey || 'none' }));
  }, [organizer, live, on, cantKey, toldKey, session]);
  /*
   * The organizer moving to another part of the call ends every clip in progress (the server places each where its
   * speaker was when it began, so none may span two parts), and the recording that goes into the notes hears nothing
   * while it's in a breakout room: the call's notes have the main room's talk.
   */
  useEffect(() => {
    ears.current?.mark();
    recorder.current?.hush(crypto.place !== MAIN_PLACE);
  }, [crypto.place]);

  /*
   * Your own shared screen, while screen notes are on: this browser looks at it and sends what changes to the notes
   * (features/call/frames.ts). Paused, off, or in a breakout room, it stops at once and drops what wasn't sent; a share
   * that ends says so, so its last frame stops there in the notes.
   */
  const frames = useRef<ScreenFrames | null>(null);
  if (!frames.current) frames.current = new ScreenFrames((f) => session.shareFrame(f), (share) => session.shareEnded(share), setFrameProblem);
  const myShare = roomView.people[self]?.screenSid ?? null;
  const screensOn = state.capture.screen.mode === 'on';
  const sharingInRoom = !!state.breakouts.open?.rooms.some((r) => r.members.includes(self));
  useEffect(() => {
    const f = frames.current;
    if (!f) return;
    if (m.screen && myShare && screensOn && live && !sharingInRoom) f.start(m.screen, myShare);
    else f.stop();
  }, [m.screen, myShare, screensOn, live, sharingInRoom]);
  const lastShare = useRef<string | null>(null);
  useEffect(() => {
    const was = lastShare.current;
    lastShare.current = myShare;
    if (was && was !== myShare) frames.current?.end(was);
  }, [myShare]);
  useEffect(() => () => frames.current?.stop(), []);

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
   * Someone asking to join: the organizer hears about it once. A guest can be let in from the toast; letting in someone
   * signed in gives them the notes, so their toast opens People, where their address is. The toast goes as soon as the
   * ask is answered, wherever that happens (let in or turned away in People, or on another device), when the asker
   * takes it back or goes, and with the call. A press that still comes too late lets nobody in, and says why.
   */
  const asked = useRef(new Set<string>());
  const askToasts = useRef(new Map<string, () => void>());
  useEffect(() => {
    if (!organizer) return;
    const asking = new Set(state.waiting.map((w) => w.id));
    for (const [id, close] of askToasts.current) if (!asking.has(id)) { close(); askToasts.current.delete(id); }
    for (const w of state.waiting) {
      if (asked.current.has(w.id)) continue;
      asked.current.add(w.id);
      const letIn = () => {
        const now = session.getSnapshot();
        if (now.waiting.some((x) => x.id === w.id)) { void session.admit(w.id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); return; }
        toast(now.participants.some((p) => p.id === w.id) ? `${w.person.name} is already in the call.` : `${w.person.name} isn’t asking to join any more.`, { icon: 'people' });
      };
      const action = w.person.email ? { label: 'Review', onClick: () => setPanel('people') } : { label: 'Let in', onClick: letIn };
      askToasts.current.set(w.id, toast(`${w.person.name} is asking to join`, { icon: 'people', ms: 12_000, action }));
    }
  }, [state.waiting, organizer, session, toast]);
  useEffect(() => {
    const open = askToasts.current;
    return () => { for (const close of open.values()) close(); };
  }, []);
  /* Letting someone signed in in from the link adds them to the invite: the organizer reads who's invited again when someone with an account is here and not on it yet. */
  const uninvited = organizer && told.participants.some((p) => !p.isOrganizer && p.person.email && !(meeting?.guests ?? []).some((g) => sameEmail(g, p.person)));
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
   * The organizer ended the call, or removed you, or the call went on from another tab or device: you're told,
   * and go back to the call's page. The organizer is only ever removed by joining from another device; this
   * screen then lets go of the call. A connection that dropped for good asks for a reload.
   */
  const hosting = session.ticket.role === 'host';
  const outOfGroup = crypto.status === 'removed';
  const over = useRef(false);
  useEffect(() => {
    if (leaving || ended || over.current) return;
    if (roomView.connection === 'ended' && roomView.endReason === 'error') {
      over.current = true;
      toast('The call’s connection dropped. Reload to join again.', { icon: 'x', ms: 120_000, action: { label: 'Reload', onClick: () => { guardRef.current.release(); location.reload(); } } });
      return;
    }
    const gone = roomView.connection === 'ended' && (roomView.endReason === 'removed' || (!hosting && roomView.endReason === 'ended-by-host'));
    if (!gone && !outOfGroup) return;
    over.current = true;
    // The call went on without this tab (for the organizer, on their other tab or device, which records from now): what
    // the recorder and the voices hadn't sent is dropped rather than sent where it's refused.
    if (recorder.current?.running) clog.info('notes recording stopped here: the call went on elsewhere');
    recorder.current?.discard();
    ears.current?.stop();
    session.close();
    void room.leave();
    guardRef.current.release();
    sessions.call = null;
    forgetLayout();
    media.stop();
    volumes.clear();
    sessions.media = null;
    void qc.invalidateQueries();
    toast(hosting ? 'You joined this call from another device.'
      : roomView.endReason === 'ended-by-host' ? 'The organizer ended the call.'
        : roomView.endReason === 'removed' ? 'The organizer removed you from the call.'
          : 'You’re no longer in this call here. You can join again.', { icon: 'leave' });
    void navigate(hosting ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
  }, [roomView.connection, roomView.endReason, outOfGroup, leaving, ended, hosting, state.code, forgetLayout, media, volumes, navigate, toast, session, room, qc]);

  /*
   * Moving to another device. Letting go here comes first: what the notes heard so far is sent, then the microphone
   * and camera stop and this device leaves the room. Only then is the new device let in.
   */
  const moving = useMoveOut(session, () => ({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam }), async () => {
    over.current = true;
    if (organizer) await Promise.all([recorder.current?.flush(), ears.current?.flush()]);
    recorder.current?.stop();
    ears.current?.stop();
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

  /* ---------- breakout rooms: who is in which comes from the call, and each browser plays only its own room ---------- */
  const open = state.breakouts.open;
  const left = open ? Math.max(0, open.until - state.elapsed) : 0;
  // The room you're in (for the organizer, the one they're visiting), or -1 for the main room.
  const myRoom = open ? open.rooms.findIndex((r) => r.members.includes(meId)) : -1;
  const roomName = open && myRoom >= 0 ? open.rooms[myRoom]?.name ?? 'a room' : null;
  /** A part of the call by its ID, as chat names it: "Design", "the main room". */
  const placeName = (place: string) => place === MAIN_PLACE ? 'the main room'
    : [...(open?.rooms ?? []), ...state.breakouts.held.flatMap((h) => h.rooms)].find((r) => r.id === place)?.name ?? 'a room';
  const inARoom = (id: string) => !!open && open.rooms.some((r) => r.members.includes(id));
  const mainIds = open ? state.participants.filter((p) => !inARoom(p.id)).map((p) => p.id) : [];
  const unit = open ? (myRoom >= 0 ? open.rooms[myRoom]?.members ?? [] : mainIds) : null;
  const unitKey = unit ? [...unit].sort().join(' ') : null;
  useEffect(() => {
    if (unitKey === null) { room.playOnly(null); return; }
    const here = new Set(unitKey.split(' '));
    room.playOnly((id) => here.has(id));
  }, [room, unitKey]);
  /* A raised hand in a room is that room asking for help; who's talking in each comes from the room's media. */
  const helps = open ? open.rooms.map((r) => r.members.find((id) => id !== meId && state.participants.some((p) => p.id === id && p.hand)) ?? null) : [];
  const activity: RoomActivity | null = open ? {
    talking: open.rooms.map((r) => r.members.find((id) => id !== meId && roomView.people[id]?.speaking) ?? null),
    help: helps, joined: myRoom >= 0 ? myRoom : null
  } : null;
  const organizerPerson = state.participants.find((p) => p.isOrganizer)?.person;
  const message = open?.message && state.elapsed - open.message.at < 10 ? open.message : null;
  const stageRooms: StageRooms | null = open && organizer ? {
    // Each room's notes: paused while the whole call is, or while the organizer has paused that room.
    rooms: open.rooms.map((r, k) => ({ name: r.name, ids: r.members.filter((id) => byId.has(id)), help: helps[k] ?? null, notes: mode === 'paused' || (on && r.paused) ? 'paused' : on ? 'on' : 'off' })),
    main: mainIds, joined: myRoom >= 0 ? myRoom : null, left,
    message: message && me ? { from: me.person, text: message.text } : null
  } : null;
  const visit = (k: number | null) => {
    const r = k === null ? null : open?.rooms[k] ?? null;
    session.visitRoom(r ? r.id : null);
    toast(r ? `You joined ${r.name}. Everyone in it can see and hear you.` : 'You’re back in the main room', { icon: r ? 'door' : 'left' });
  };
  const visitRef = useRef(visit);
  visitRef.current = visit;

  const warned = useRef(false);
  const closing = useRef(false);
  useEffect(() => {
    if (!open) { warned.current = false; closing.current = false; return; }
    if (left <= 30 && !warned.current) { warned.current = true; toast('Rooms close in 30 seconds', { icon: 'timer' }); }
    if (left <= 0 && !closing.current && organizer) { closing.current = true; session.closeRooms(); }
  }, [open, left, organizer, session, toast]);
  const wasOpen = useRef(!!open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      if (on) { if (innerWidth >= 1100) setPanel('notes'); toast('Everyone is back in the main room, where notes are on. The notes say who was in which room, not what was said there.', { icon: 'notesPen' }); }
      else toast('Everyone is back from the rooms', { icon: 'door' });
    } else if (!wasOpen.current && open && !organizer) {
      const minutes = Math.max(1, Math.round((open.until - open.from) / 60));
      toast(roomName ? `You’re in ${roomName} for ${minutes} min` : `Rooms are open for ${minutes} min. You’re in the main room.`, { icon: 'door', ms: 5000 });
    }
    wasOpen.current = !!open;
  }, [open, on, organizer, roomName, toast]);
  /* Sent to another room (or back) while the rooms are open: you're told where you are now. Your keys move with you. */
  const myRoomId = open && myRoom >= 0 ? open.rooms[myRoom]?.id ?? null : null;
  const lastRoomId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const was = lastRoomId.current;
    lastRoomId.current = open ? myRoomId : undefined;
    if (organizer || !open || was === undefined || was === myRoomId) return;
    toast(roomName ? `The organizer moved you to ${roomName}` : `The organizer moved you back to the main room${on ? ', where notes are on' : ''}`, { icon: 'door' });
  }, [open, myRoomId, roomName, organizer, on, toast]);
  /* Everyone else hears when the organizer comes into their part of the call, or goes: who can hear them changes. */
  const organizerId = state.participants.find((p) => p.isOrganizer)?.id ?? null;
  const organizerRoom = open && organizerId ? open.rooms.findIndex((r) => r.members.includes(organizerId)) : null;
  const lastOrganizerRoom = useRef<number | null>(null);
  useEffect(() => {
    const was = lastOrganizerRoom.current;
    lastOrganizerRoom.current = organizerRoom;
    if (organizer || was === null || organizerRoom === null || was === organizerRoom) return;
    const who = organizerPerson ? callName(organizerPerson) : 'The organizer';
    // Coming into a room whose notes are on starts what's said there being transcribed: they're told so.
    const heardHere = myRoom >= 0 && notesAreOn(capHere.mode) ? '. What’s said here is transcribed while they’re here' : '';
    if (organizerRoom === myRoom) toast(myRoom >= 0 ? `${who} joined your room${heardHere}` : `${who} is back in the main room`, { icon: 'door' });
    else if (was === myRoom) toast(myRoom >= 0 ? `${who} left your room` : `${who} went to ${state.breakouts.open?.rooms[organizerRoom]?.name ?? 'a room'}`, { icon: 'door' });
  }, [organizerRoom, myRoom, organizer, organizerPerson, state.breakouts.open, capHere.mode, toast]);
  /* The organizer hears once when a room asks for help, and can go straight there. */
  const helped = useRef(new Set<string>());
  const helpKey = open ? open.rooms.map((r, k) => `${r.id}:${helps[k] ?? ''}`).join(' ') : '';
  useEffect(() => {
    if (!organizer || !helpKey) { helped.current.clear(); return; }
    for (const entry of helpKey.split(' ')) {
      const [roomId, who] = entry.split(':');
      if (!who || helped.current.has(entry)) continue;
      helped.current.add(entry);
      const k = state.breakouts.open?.rooms.findIndex((r) => r.id === roomId) ?? -1;
      const r = state.breakouts.open?.rooms[k];
      if (!r || k === myRoom) continue;
      toast(`${r.name} asked for help`, { icon: 'hand', ms: 8000, action: { label: 'Join', onClick: () => visitRef.current(k) } });
    }
  }, [helpKey, organizer, myRoom, state.breakouts.open, toast]);
  /* Rooms for the organizer to fill: invited people in the call, once each, by their email address. */
  const invitedEmails = new Set(invited.map((g) => g.email.toLowerCase()));
  const candidates: RoomCandidate[] = [];
  for (const p of state.participants) {
    const email = p.person.email.toLowerCase();
    if (p.isMe || p.isOrganizer || !email || !invitedEmails.has(email) || candidates.some((c) => c.id === email)) continue;
    candidates.push({ id: email, person: p.person });
  }
  const guestsHere = others.filter((p) => !candidates.some((c) => sameEmail(c.person, p.person))).length;
  const renameRoom = (k: number, name: string) => {
    const r = open?.rooms[k];
    if (r) session.renameRoom(r.id, name);
  };
  const moveTo = (email: string, k: number | null) => {
    const r = k === null ? null : open?.rooms[k] ?? null;
    session.moveToRoom(email, r ? r.id : null);
    const who = candidates.find((c) => c.id === email.toLowerCase())?.person ?? open?.rooms.flatMap((x) => x.people).find((p) => sameEmail(p, { email }));
    toast(`${who ? callName(who) : 'They'} ${r ? `will be in ${r.name}` : 'will be back in the main room'}. Their keys move with them.`, { icon: 'door' });
  };
  const openRooms = (rooms: { name: string; ids: string[] }[], minutes: number) => {
    session.openRooms({ rooms: rooms.map((r) => ({ name: r.name, emails: r.ids })), minutes });
    toast(`${rooms.length} rooms are open for ${minutes} min`, { icon: 'door' });
  };

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
   * A share that starts once you're settled in and isn't big for you is told, with a way to see it; one you were
   * watching that stops, too. Not while the room connects or reconnects, when shares come and go with the connection.
   */
  const settledAt = useRef<number | null>(null);
  // Starts again whenever the connection or your part of the call changes: shares come and go with either. A call that
  // ends empties the call (its state, or the room's disconnect, whichever comes first) in the render that says so, as a
  // reconnect does: `live` and `connected` cover those.
  useEffect(() => { settledAt.current = connected ? Date.now() : null; }, [connected, unitKey]);
  const settled = () => live && connected && settledAt.current !== null && Date.now() - settledAt.current > 4000;
  const shareStarted = (s: StageShare, big: boolean, show: () => void) => {
    if (!big && settled()) toast(`${callName(s.presenter)} started sharing`, { icon: 'screen', ms: 6000, action: { label: 'Show it', onClick: show } });
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
  const custom = isCustom(layout.prefs, layout.layout);
  /** While rooms are open the organizer's stage shows every room; their own view comes back after. */
  const roomsHold = () => { if (open && organizer) { toast('Your view comes back when the rooms close', { icon: 'door' }); return true; } return false; };
  const resetView = () => { if (!roomsHold()) undoable('Your view is back to Auto', 'reset', layout.reset()); };
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
  /*
   * Turning notes off keeps everything said while they were on and nothing after, like ending the call: capture stops
   * at once, what was recorded and heard until then is sent first, and nothing starts again while the server turns
   * them off. If it can't, the same recorder carries on, so its pieces stay in order in the same segment.
   */
  const switchNotes = async (v: boolean) => {
    const r = recorder.current;
    if (!v && on) {
      setTurningOff(true);
      await Promise.all([r?.pause(), ears.current?.flush()]);
    }
    try {
      await session.setNotes(v);
    } catch (e) {
      if (!v) r?.release();
      failed(e);
      return;
    } finally {
      setTurningOff(false);
    }
    if (!v) r?.discard();
    if (v && !panel && innerWidth >= 1100) setPanel('notes');
  };
  /*
   * Pausing stops everything at once: nothing more is recorded or heard, and nothing held is sent. Once the server has
   * paused, what was held is dropped, and the server refuses anything that arrives after it; if it couldn't, notes
   * are still on, so the same recorder and voices carry on and send it. Resuming is only ever the organizer's
   * choice. Anyone else asks.
   */
  const controls: CaptureControls = {
    notes: (v) => void switchNotes(v),
    pause: () => {
      const r = recorder.current;
      const e = ears.current;
      r?.hold();
      e?.hold();
      setPausing(true);
      session.pause().then(() => { r?.discard(); e?.stop(); }, (err: unknown) => {
        clog.warn('pausing notes failed; capture carries on', { err });
        r?.release();
        e?.release();
        failed(err);
      }).finally(() => setPausing(false));
    },
    resume: () => { session.resume().catch(failed); },
    screens: (v) => { session.setScreens(v).catch(failed); },
    // One breakout room: the voices there hold still while the pause is on its way, and what they held is dropped
    // once the server has paused the room. The recording and the call's notes carry on.
    room: (paused) => {
      const id = state.capture.room?.id;
      if (!id) return;
      const e = ears.current;
      if (paused) { e?.hold(); setPausing(true); }
      session.pauseRoom(id, paused).then(() => { if (paused) e?.quiet(); }, (err: unknown) => {
        if (paused) { clog.warn('pausing notes in the room failed; capture carries on', { err }); e?.release(); }
        failed(err);
      }).finally(() => { if (paused) setPausing(false); });
    },
    ask: (up) => {
      session.requestNotes(up).then(() => toast(up ? `You asked ${organizerName(state)} for notes` : 'You took back your ask', { icon: 'hand' }), failed);
    }
  };
  useCaptureAlerts(state, controls);
  const openPanel = (v: PanelView) => { setPop(null); setPanel(v); };
  const flip = (v: PanelView) => setPanel((x) => (x === v ? null : v));

  /* ---------- catching up and asking: for you alone, with the moments behind each answer, and a way back to live ---------- */
  const cu = useCatchingUp(session, { panel, setPanel: (v) => { setPop(null); setPanel(v); }, narrow, everOn: state.notes.everOn, room: roomName });
  const catchUp = () => { setPop(null); cu.catchUp(); };
  const liveNotes = useLiveNotes(session, state.transcript.at(-1)?.id, on && live, panel === 'notes');

  /* ---------- captions: the live transcript's newest line, in your language if you chose one ---------- */
  const caption = useCaptions(session, state.transcript, lang, cc && live);
  const langName = (l: CaptionLanguage | null) => (l ? CAPTION_LANGUAGES.find((x) => x.code === l)?.name ?? l : 'As spoken');
  const langMenu = (
    <>
      <div className="ac-eyebrow">Captions in</div>
      {[null, ...CAPTION_LANGUAGES.map((l) => l.code)].map((code) => {
        const info = CAPTION_LANGUAGES.find((x) => x.code === code);
        return (
          <button key={code ?? 'spoken'} type="button" className="ic-opt" role="menuitemradio" aria-checked={lang === code}
            onClick={() => { setLang(code); setPop(null); toast(code ? `Captions in ${info?.english ?? code} for you` : 'Captions as they’re spoken', { icon: 'translate' }); }}>
            <span className="nm">{info ? info.name : 'As spoken'}{info && info.name !== info.english && <span className="sub"> · {info.english}</span>}</span><Icon name="check" size={16} className="tick" />
          </button>
        );
      })}
      <p className="hint">Translated in confidential compute. Everyone picks their own language. The call is still transcribed for notes when captions are off.</p>
    </>
  );
  const capButton = (
    <Popover open={pop === 'cap'} onOpenChange={(o) => setPop(o ? 'cap' : null)} side="top" align="end" label="Caption language" className="ic-dmenu"
      anchor={<button type="button" className="ic-capbtn" aria-label="Choose the caption language"><Icon name="translate" size={14} />{langName(lang)}</button>}>{langMenu}</Popover>
  );
  // Captions are the lines of the part of the call you're in: what's said in one room is never shown in another. While
  // notes are paused or off nothing new is said in them, so the last line isn't left up as if it were live.
  const capNode = !cc ? null : caption && hearing ? (
    <Caption who={<>{caption.line.speaker?.person && <Avatar person={caption.line.speaker.person} size={18} />}<span className="name">{caption.line.speaker ? callName(caption.line.speaker.person ?? { name: caption.line.speaker.name, email: '' }) : ''}</span>{caption.translated && lang && <span className="lang">→ {lang.toUpperCase()}</span>}{capButton}</>}
      original={caption.translated ? caption.line.text : undefined}>{caption.text}</Caption>
  ) : (
    <Caption who={<><Icon name="captions" size={15} /><span className="name">Captions</span>{capButton}</>}>
      <span className="ic-cap-wait">{hearing ? 'What’s said appears here as people talk.' : notesAreOn(capHere.mode) ? 'Nothing is transcribed for captions right now: the organizer’s browser can’t listen.' : capHere.mode === 'paused' ? 'Notes are paused, so nothing is transcribed for captions.' : 'Notes are off, so nothing is being transcribed for captions.'}</span>
    </Caption>
  );

  /* Turning on a device that isn't working opens its menu, which says what's wrong and how to fix it. */
  const pressMic = () => { void media.setMic(!media.getSnapshot().mic).then((ok) => { if (!ok) setPop('mic'); }); };
  const pressCam = () => { void media.setCam(!media.getSnapshot().cam).then((ok) => { if (!ok) setPop('cam'); }); };

  /* ---------- keys ---------- */
  // Escape unpins only when you can see a pin: someone pinned who's here.
  const pinnedHere = layout.layout.pins.some((seat) => seatKey.split(' ').includes(seat));
  const keys = useRef({ panel, pinned: pinnedHere, unpinAll, setPanel, pressMic, pressCam });
  keys.current = { panel, pinned: pinnedHere, unpinAll, setPanel, pressMic, pressCam };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // Popovers and sheets close themselves first; then Escape unpins everyone you pinned (Undo puts them back), then closes the panel.
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        if (keys.current.pinned) keys.current.unpinAll();
        else if (keys.current.panel) keys.current.setPanel(null);
        return;
      }
      if (k !== 'm' && k !== 'v' && k !== 'c') return;
      // The key is a shortcut here, not a character for whatever gets focus next.
      e.preventDefault();
      if (k === 'm') keys.current.pressMic();
      if (k === 'v') keys.current.pressCam();
      if (k === 'c') keys.current.setPanel(keys.current.panel === 'chat' ? null : 'chat');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  /* ---------- leaving: the organizer ends the call for everyone; anyone else just leaves ---------- */
  /*
   * The organizer's last audio and speech go before the call ends: the server refuses them after. The recorder is paused,
   * not stopped, until it has: if ending fails, the same recorder carries on, so its pieces stay in order in the same
   * segment (a new one would number its pieces from the start again, and the server keeps the first of each).
   */
  const end = async () => {
    setLeaving(true);
    const rec = organizer ? recorder.current : null;
    try {
      if (organizer) await Promise.all([rec?.pause(), ears.current?.flush()]);
      const r = await session.leave();
      rec?.discard();
      over.current = true;
      guard.release();
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
        await navigate({ to: '/join/$code', params: { code: state.code }, replace: true });
        toast('You left the call', { icon: 'leave' });
      }
    } catch (e) {
      rec?.release();
      clog.error('leaving the call failed', { err: e });
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
      tags: [!open && state.spotlight === p.id ? 'Spotlight · everyone' : '', layout.layout.pins.includes(p.seat) ? 'Pinned for you' : '', p.hand ? (inARoom(p.id) ? `Asked for help in ${where ?? 'a room'}` : 'Hand raised') : '', volumeTag(sp?.volume ?? 1) ?? '', askedTag(state, p.id)].filter(Boolean)
    };
  });
  const host: HostControls | undefined = organizer ? {
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
    on ? `While notes are on, ${state.capture.screen.mode === 'on' ? 'what everyone says and what anyone shares on screen go' : 'what everyone says also goes'} to the notes, written in confidential compute.${open ? ' What’s said or shared in a room stays out of them.' : ''}`
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
  /* In a room (or the main room while rooms are open): where you are, how long for, and the organizer's message to every room. */
  const roomBar = open && !organizer && (movingBar || (message ? (
    <div className="ic-banner">{organizerPerson && <Avatar person={organizerPerson} size={24} />}<span><b>{organizerPerson ? callName(organizerPerson) : 'The organizer'}</b> to all rooms: {message.text}</span></div>
  ) : (
    <div className="ic-spill"><Icon name={left <= 30 ? 'timer' : 'door'} size={15} />
      <span className="tx2">{left <= 30 ? <>Rooms close in <b>{mmss(left)}</b>. Everyone comes back to the main room.</> : <>You’re in <b>{roomName ?? 'the main room'}</b> · everyone comes back in {mmss(left)}</>}</span>
    </div>
  )));
  const alone = others.length === 0 && !open && (
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
  const bar = open
    ? (organizer ? (soundPill || camsPill ? <>{soundPill}{camsPill}</> : null) : <>{soundPill}{camsPill}{roomBar}{sharePill}</>)
    : (m.screen || spotlight || alone || soundPill || movingBar || camsPill) ? (
      <>
        {soundPill}
        {movingBar}
        {camsPill}
        {alone}
        {sharePill}
        {spotlight && (
          <div className="ic-spill"><Icon name="spotlight" size={15} /><span className="tx2">{spotName ? <><b>{spotName}</b> is spotlighted for everyone</> : <><b>You’re</b> spotlighted for everyone</>}</span>
            {organizer && <button type="button" className="sp-btn is-strong" onClick={() => setSpot(null)}>Stop spotlight</button>}
          </div>
        )}
      </>
    ) : null;

  /* While rooms are open, everyone but the organizer sees only their own room (or the main room). */
  const onStage = unit && !organizer ? stagePeople.filter((p) => unit.includes(p.id)) : stagePeople;
  const roomsHere = organizer && (others.length > 0 || !!open);
  const shownPanel = panel === 'rooms' && !roomsHere ? null : panel;
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainW, setMainW] = useState(0);
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainW(el.clientWidth));
    ro.observe(el);
    setMainW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const stageW = shownPanel && !narrow ? Math.max(0, mainW - sideW - 16) : mainW;

  if (moving.moved) {
    const leaveFor = (to: 'join' | 'home') => {
      sessions.call = null;
      void navigate(to === 'home' ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
    };
    return <Moved to={moving.moved.to} problem={moving.moved.problem} signedIn={session.ticket.role !== 'guest'} onAgain={() => leaveFor('join')} onHome={() => leaveFor('home')} />;
  }

  return (
    <div className="stage ac-stage">
      <div className={cn('ic-call', ended && 'is-ended')}>
        <TopBar title={state.title} elapsed={state.elapsed} custom={custom} people={stagePeople.map((p) => p.person)}
          sign={<CaptureButton state={state} role={session.ticket.role} getting={getting} controls={controls} pausing={pausing} onOpenNotes={() => openPanel('notes')} />}
          asking={organizer ? state.waiting.length : 0} reconnecting={roomView.connection === 'reconnecting' || (crypto.status === 'joining' && !leaving)} peopleOpen={shownPanel === 'people'} screens={state.capture.screen.mode !== 'off'}
          view={(
            <ViewMenu mode={layout.prefs.mode} preset={presetNow(layout.prefs, layout.layout)} self={layout.prefs.self} custom={custom}
              onMode={(m) => { if (!roomsHold()) layout.setMode(m); }} onSelf={(where) => { if (!roomsHold()) setSelf(where); }} onReset={resetView} onPreset={applyPreset} />
          )}
          onReset={resetView} onCatchUp={catchUp} onPeople={() => flip('people')} />
        <div ref={mainRef} className="ic-main">
          <motion.div className="ic-stage-box" initial={false} animate={{ width: stageW || '100%' }} transition={reduce ? { duration: 0 } : SLIDE}>
            <Stage people={onStage} shares={shares} marks={marks} me={me?.person ?? SOMEONE} whoIs={personOf} spotlight={spotlight} view={layout} organizer={organizer}
              bar={bar} caption={capNode} rooms={stageRooms} place={crypto.place} paused={mode === 'paused'} onSpotlight={setSpot} onPin={setPin} onSelf={setSelf} onCustom={onCustom} volumes={volumes}
              onShareStarted={shareStarted} onShareStopped={shareStopped} />
          </motion.div>
          <AnimatePresence>
            {shownPanel && (
              <motion.aside key="side" className="ic-side" aria-label="Call panel" style={{ width: sideW }}
                initial={reduce ? { opacity: 0 } : { x: sideW + 40 }} animate={{ x: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: sideW + 40 }} transition={reduce ? { duration: 0 } : SLIDE}>
                <SidePanel view={shownPanel} onView={(v) => { cu.settle(); openPanel(v); }} onClose={() => { cu.settle(); setPanel(null); }} roomsTitle={open ? 'Rooms are open' : 'Breakout rooms'}>
                  {shownPanel === 'notes' && <NotesView state={state} live={liveNotes} getting={getting} problems={[uploadError, heardProblem, frameProblem].filter((x): x is string => !!x)}
                    controls={controls} onSeek={cu.open} onTranscript={() => openPanel('transcript')} />}
                  {shownPanel === 'transcript' && (cu.moment
                    ? <MomentView moment={cu.moment} startedAt={state.startedAt} me={me?.person.email} onLive={cu.backToLive} />
                    : <TranscriptView state={state} me={me?.person.email} />)}
                  {shownPanel === 'ask' && <AskView asks={cu.asks} ready={state.notes.everOn && state.transcript.length > 0 && capHere.mode !== 'paused'} paused={capHere.mode === 'paused'} startedAt={state.startedAt} range={cu.range} window={cu.window}
                    catching={cu.catching} onRange={cu.setRange} onWindow={cu.refreshWindow} onAsk={cu.ask} onCatchUp={() => cu.catchUp(cu.range)} onOpen={cu.open} onLive={cu.backToLive} />}
                  {shownPanel === 'chat' && <ChatView chat={crypto.chat} missed={crypto.missedChat} ready={crypto.status === 'in'} moving={crypto.status === 'moving'}
                    here={open ? roomName ?? 'the main room' : null} placeName={placeName} who={personOf} onSend={(t) => session.sendChat(t)} />}
                  {shownPanel === 'people' && <PeopleView here={panelPeople} invited={invited} asking={organizer ? state.waiting : []} host={host} foot={privacyLine} volumes={volumes}
                    notesAsks={organizer && !on && state.capture.requests.length > 0 ? <NotesAsks state={state} controls={controls} decline={(id) => session.declineNotes(id)} after={state.waiting.length > 0} /> : undefined} />}
                  {shownPanel === 'rooms' && (open && me && activity
                    ? <RoomsLive open={open} elapsed={state.elapsed} members={open.rooms.map((r) => r.members.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; }))}
                      people={byId} activity={activity} me={me.person} onJoin={visit} onRename={renameRoom} onMove={moveTo} onMessage={(t) => session.messageRooms(t)} onClose={() => session.closeRooms()} />
                    : <RoomsSetup people={candidates} guests={guestsHere} onOpen={openRooms} />)}
                </SidePanel>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
        <footer className="ic-dockbar">
          <CallDock>
            <DockSplit>
              <DockButton icon={m.mic ? 'mic' : 'micOff'} label={m.access.mic.problem ? stateOf('mic', m.access.mic.problem) : m.mic ? 'Mute' : 'Unmute'} off={!m.mic} alert={!!m.access.mic.problem} onClick={pressMic}
                tip={m.access.mic.problem ? `${stateOf('mic', m.access.mic.problem)}. Press to see how to fix it` : `${m.mic ? 'Mute' : 'Unmute'}${micLabel ? ` · ${micLabel}` : ''}`} />
              <MicMenu media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)}
                onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
            </DockSplit>
            <DockSplit>
              <DockButton icon={m.cam ? 'video' : 'videoOff'} label={m.access.cam.problem ? stateOf('cam', m.access.cam.problem) : m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} alert={!!m.access.cam.problem} onClick={pressCam}
                tip={m.access.cam.problem ? `${stateOf('cam', m.access.cam.problem)}. Press to see how to fix it` : `${m.cam ? 'Turn camera off' : 'Turn camera on'}${devices.cam.find((d) => d.id === m.camId)?.label ? ` · ${devices.cam.find((d) => d.id === m.camId)?.label ?? ''}` : ''}`} />
              <CamMenu media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)}
                onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
            </DockSplit>
            <DockButton icon="screen" label={m.screen ? 'Change what you share' : full ? `${MAX_SHARES} people are sharing` : 'Share a tab, window or screen'}
              tip={m.screen ? 'Change what you share' : full ? `${MAX_SHARES} people are sharing. You can share once one of them stops.` : 'Share a tab, window or screen'} on={!!m.screen} onClick={() => pickShare()} />
            <DockButton icon="hand" label={me?.hand ? 'Lower your hand' : roomName && !organizer ? 'Ask for help' : 'Raise your hand'} tip={me?.hand ? 'Lower your hand' : roomName && !organizer ? 'Raise your hand to ask the organizer for help' : 'Raise your hand'}
              on={!!me?.hand} onClick={() => setHand(!me?.hand)} />
            <DockSplit>
              <DockButton icon="captions" label={cc ? 'Turn off captions' : 'Turn on captions'} tip={`${cc ? 'Turn off captions' : 'Turn on captions'} · the call is still transcribed for notes`} on={cc}
                onClick={() => { const v = !cc; setCc(v); if (!v && pop === 'cc') setPop(null); toast(v ? `Captions on${lang ? `, in ${CAPTION_LANGUAGES.find((x) => x.code === lang)?.english ?? lang}` : ''}` : 'Captions off. The call is still transcribed for notes.', { icon: 'captions' }); }} />
              <Popover open={pop === 'cc'} onOpenChange={(o) => setPop(o ? 'cc' : null)} side="top" align="start" label="Caption language" className="ic-dmenu"
                anchor={<DockChevron label="Caption language" on={pop === 'cc'} />}>{langMenu}</Popover>
            </DockSplit>
            <DockSeparator />
            {roomsHere && <DockButton icon="door" label="Breakout rooms" tip="Breakout rooms" on={shownPanel === 'rooms' || !!open} className="d-rooms" onClick={() => flip('rooms')} />}
            <DockButton icon="notesPen" label="Notes" tip="Notes" on={shownPanel === 'notes' || shownPanel === 'transcript' || shownPanel === 'ask'} onClick={() => setPanel((x) => (x === 'notes' || x === 'transcript' || x === 'ask' ? null : 'notes'))} />
            <DockButton icon="chat" label={unread ? `Chat, ${unread} new` : 'Chat'} tip="Chat" on={shownPanel === 'chat'} badge={unread} onClick={() => flip('chat')} />
            <Popover open={pop === 'more' || pop === 'devices' || pop === 'quality'} onOpenChange={(o) => setPop(o ? 'more' : null)} side="top" align="end" label="More"
              className={pop === 'devices' ? 'ic-dmenu ic-devices' : pop === 'quality' ? 'ic-dmenu' : 'ic-menu'}
              anchor={<DockButton icon="more" label="More: catch up, settings" on={pop === 'more' || pop === 'devices' || pop === 'quality'} />}>
              {pop === 'devices' ? (
                <>
                  <MicOptions media={media} m={m} devices={devices} live onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
                  <div className="ic-msep" />
                  <CamOptions media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} preview={false} onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
                </>
              ) : pop === 'quality' ? (
                <VideoQuality media={media} m={m} />
              ) : (
                <>
                  <button type="button" className="mi" onClick={() => { setPop(null); catchUp(); }}><Icon name="history" size={17} /><span className="t">Catch up on what you missed</span></button>
                  <button type="button" className="mi" onClick={() => setPop('devices')}><Icon name="speaker" size={17} /><span className="t">Audio and video settings</span></button>
                  <button type="button" className="mi" onClick={() => setPop('quality')}><Icon name="sliders" size={17} /><span className="t">Video quality</span></button>
                  <button type="button" className="mi" onClick={() => { setPop(null); moving.show(); }}><Icon name="phone" size={17} /><span className="t">Move to another device</span></button>
                  {roomsHere && <button type="button" className="mi only-narrow" onClick={() => { setPop(null); flip('rooms'); }}><Icon name="door" size={17} /><span className="t">Breakout rooms</span></button>}
                </>
              )}
            </Popover>
            <DockSeparator />
            <DockLeave disabled={leaving || !!ended} onClick={() => setLeaveOpen(true)}>Leave</DockLeave>
          </CallDock>
        </footer>
      </div>
      <SharePicker open={sharePick} onOpenChange={(o) => { setSharePick(o); if (!o) setShareTrouble(null); }} sharing={!!m.screen}
        others={sharing.map((s) => s.presenter)} trouble={shareTrouble} read={sharingInRoom ? undefined : screenRead(state.capture.screen.mode)} onShare={share} />
      <MoveSheet open={moving.open} onOpenChange={(o) => { if (!o) moving.hide(); }} move={moving.move} media={{ mic: m.mic, cam: m.cam }} account={state.role !== 'guest'}
        sharing={!!m.screen} onStopSharing={stopShare} onMove={() => void moving.go()} onAgain={moving.again} />
      <LeaveSheet open={leaveOpen || !!ended} onOpenChange={(o) => { setLeaveOpen(o); if (!o) guard.stay(); }} title={state.title} elapsed={state.elapsed}
        organizer={organizer} notes={state.notes.everOn} locked={state.locked} others={others.length}
        getting={invited} leaving={leaving} ended={ended} onEnd={() => void end()} onRead={(id) => void away({ noteId: id })} onHome={() => void away(null)} />
    </div>
  );
}

import { CAPTION_LANGUAGES, errorMessage, type CallSession, type CaptionLanguage, type Person } from '@alcove/api';
import {
  Avatar, Caption, CallDock, DockButton, DockChevron, DockLeave, DockSeparator, DockSplit, Icon, Popover, cn, useRaisedToasts, useToast
} from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCaptions } from '~/features/call/captions';
import { CamMenu, CamOptions, MicMenu, MicOptions } from '~/features/call/DevicePickers';
import { useDevices } from '~/features/call/devices';
import { LeaveSheet, type Ended } from '~/features/call/LeaveSheet';
import { useLiveNotes } from '~/features/call/liveNotes';
import { LocalMedia, NotesRecorder, type ShareChoice } from '~/features/call/media';
import { MultipartyPreview, isPreviewId, previewEnabled } from '~/features/call/multiparty-preview';
import { AskView, ChatView, NotesView, PeopleView, SidePanel, TranscriptView, type Asked, type PanelPerson, type PanelView } from '~/features/call/Panel';
import { RoomsLive, RoomsSetup, type RoomActivity } from '~/features/call/Rooms';
import { SharePicker } from '~/features/call/SharePicker';
import { SpeechClips } from '~/features/call/speech';
import { Stage, type StageParticipant, type StageRooms } from '~/features/call/Stage';
import { TopBar } from '~/features/call/TopBar';
import { isCustom, useCallView } from '~/features/call/view';
import { requireAccount } from '~/lib/guards';
import { selfIn, sessions, useLeaveGuard, useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/call/$code')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: Call
});

const clog = log.child({ component: 'call' });
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, [contenteditable]');
type Pop = 'mic' | 'cam' | 'cc' | 'cap' | 'more' | 'devices' | null;
const SLIDE = { duration: 0.38, ease: [0.45, 0, 0.2, 1] } as const;

function Call() {
  const { code } = Route.useParams();
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall session={active.session} />;
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
  const state = useLive(session);
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const meeting = useQuery(q.byCode(state.code)).data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const reduce = useReducedMotion();
  useRaisedToasts();
  const me = selfIn(state);
  const meId = me?.id ?? 'me';
  const on = state.notes.status === 'on';
  const width = useWidth();
  const narrow = width < 760;
  const sideW = narrow ? width : width < 1100 ? 360 : 400;
  const [panel, setPanel] = useState<PanelView | null>(() => (on && innerWidth >= 1100 ? 'notes' : null));
  const [pop, setPop] = useState<Pop>(null);
  const [sharePick, setSharePick] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [cc, setCc] = useState(false);
  const [lang, setLang] = useState<CaptionLanguage | null>(null);
  const [asks, setAsks] = useState<Asked[]>([]);
  const [hit, setHit] = useState<{ at: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  const view = useCallView(meId);
  const devices = useDevices(m.camera);
  const speaking = useSpeaking(media, m.mic);
  const guard = useLeaveGuard(() => setLeaveOpen(true));
  const seenChat = useRef(state.chat.length);
  if (panel === 'chat') seenChat.current = state.chat.length;
  const unread = Math.max(0, state.chat.length - seenChat.current);

  // TODO(multi-party): replace with LiveKit participants
  const [preview] = useState(() => new MultipartyPreview());
  useEffect(() => { if (previewEnabled()) preview.start(); return () => preview.stop(); }, [preview]);
  const pv = useLive(preview);

  /* Media comes from pre-join; it starts here if the call page was opened directly. */
  const first = useRef({ mic: me?.mic ?? true, cam: me?.cam ?? true });
  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start(first.current);
  }, [media]);

  /* The recorder and the live transcript follow the call's notes: everyone in the call sees the same sign. */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), setUploadError);
  const speech = useRef<SpeechClips | null>(null);
  if (!speech.current) speech.current = new SpeechClips((c) => session.transcribe(c), setHeardProblem);
  const micTrack = media.micTrack();
  const segment = state.notes.recording.segment;
  const live = state.phase === 'in-call';
  useEffect(() => {
    const r = recorder.current;
    const s = speech.current;
    if (!r || !s) return;
    if (on && live && micTrack) { r.start(micTrack, segment); s.start(micTrack, segment); }
    else if (!on) { r.stop(); s.stop(); }
  }, [on, live, segment, micTrack]);
  useEffect(() => () => speech.current?.stop(), []);

  /* What the call says happened ("Notes are on…") arrives once, as a toast. */
  const shown = useRef(new Set<string>());
  useEffect(() => {
    for (const n of state.notices) {
      if (shown.current.has(n.id)) continue;
      shown.current.add(n.id);
      toast(n.text, { icon: n.kind === 'notes' ? 'notesPen' : n.kind === 'people' ? 'people' : 'screen', ms: 3200 });
      session.dismissNotice(n.id);
    }
  }, [state.notices, session, toast]);

  /* ---------- who is on the stage ---------- */
  const stagePeople: StageParticipant[] = [
    ...state.participants.map((p) => ({
      id: p.id, person: p.person, isMe: p.isMe, mic: p.isMe ? m.mic : p.mic, hand: p.hand, speaking: p.isMe ? speaking : false,
      video: p.isMe && m.cam && m.camera ? m.camera : null
    })),
    // TODO(multi-party): replace with LiveKit participants
    ...pv.people.map((p) => ({ id: p.id, person: p.person, isMe: false, mic: p.mic, hand: p.hand, speaking: pv.speaking === p.id, video: null }))
  ];
  const byId = new Map(stagePeople.map((p) => [p.id, p.person]));
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const others = stagePeople.filter((p) => !p.isMe);
  // TODO(multi-party): replace with LiveKit participants (the server's spotlight will cover everyone)
  const spotlight = state.spotlight ?? pv.spotlight;
  const invited = meeting?.guests ?? [];
  const getting: Person[] = [...(me ? [me.person] : []), ...invited.filter((g) => !me || !sameEmail(g, me.person))];

  /* ---------- actions ---------- */
  const setMic = (v: boolean) => { media.setMic(v); session.setMic(v); };
  const setCam = (v: boolean) => { void media.setCam(v); session.setCam(v); };
  const share = (c: ShareChoice) => {
    setSharePick(false);
    // The browser's picker needs this click: nothing is awaited before it opens.
    void media.shareScreen(c, () => { session.setSharing(false); toast('You stopped sharing', { icon: 'stopShare' }); }).then((label) => {
      if (label) session.setSharing(true, label);
    });
  };
  const stopShare = () => { media.stopScreen(); session.setSharing(false); toast('You stopped sharing', { icon: 'stopShare' }); };
  const setHand = (up: boolean) => { session.setHand(up); toast(up ? 'Your hand is raised. Everyone can see it.' : 'Your hand is lowered', { icon: 'hand' }); };
  const setSpot = (id: string | null) => {
    const name = id ? (id === meId ? 'You’re' : `${callName(byId.get(id) ?? { name: 'Someone', email: '' })} is`) : '';
    // TODO(multi-party): replace with LiveKit participants (spotlight anyone through the server)
    if (id && isPreviewId(id)) { preview.setSpotlight(id); if (state.spotlight) session.setSpotlight(null); }
    else { preview.setSpotlight(null); session.setSpotlight(id); }
    toast(id ? `${name} spotlighted for everyone` : 'Spotlight stopped for everyone', { icon: 'spotlight' });
  };
  const setPin = (id: string | null) => {
    const was = view.view.pinned;
    view.setPinned(id);
    const who = (x: string) => callName(byId.get(x) ?? { name: 'Someone', email: '' });
    if (id) toast(`${who(id)} is pinned for you. Only your view changes.`, { icon: 'pin' });
    else if (was) toast(`${who(was)} is unpinned`, { icon: 'pinOff' });
  };
  const hinted = useRef(false);
  const onCustom = () => { if (!hinted.current) { hinted.current = true; toast('Only your view changes. Reset it from the top bar.', { icon: 'eye' }); } };

  /* Turning notes off keeps everything said while they were on: the last audio and speech are sent first. */
  const switchNotes = async (v: boolean) => {
    if (!v) await Promise.all([recorder.current?.flush(), speech.current?.flush()]);
    session.setNotes(v);
    if (v && !panel && innerWidth >= 1100) setPanel('notes');
  };
  const openPanel = (v: PanelView) => { setPop(null); setPanel(v); };
  const flip = (v: PanelView) => setPanel((x) => (x === v ? null : v));

  /* ---------- asking ---------- */
  const askId = useRef(0);
  const askQuestion = (question: string) => {
    const id = ++askId.current;
    setAsks((a) => [...a, { id, kind: 'question', q: question, parts: null, error: null }]);
    session.askSoFar(question).then(
      (parts) => setAsks((a) => a.map((x) => (x.id === id && x.kind === 'question' ? { ...x, parts } : x))),
      (e: unknown) => { clog.warn('question during a call failed', { err: e }); setAsks((a) => a.map((x) => (x.id === id ? { ...x, error: errorMessage(e) } : x))); }
    );
  };
  const catchUp = () => {
    openPanel('ask');
    const id = ++askId.current;
    setAsks((a) => [...a, { id, kind: 'catch-up', c: null, error: null }]);
    session.catchUp(5).then(
      (c) => setAsks((a) => a.map((x) => (x.id === id && x.kind === 'catch-up' ? { ...x, c } : x))),
      (e: unknown) => { clog.warn('catch-up failed', { err: e }); setAsks((a) => a.map((x) => (x.id === id ? { ...x, error: errorMessage(e) } : x))); }
    );
  };
  const seek = (at: number) => { setPanel('transcript'); setHit({ at }); };
  const liveNotes = useLiveNotes(session, state.transcript.length, on && live, panel === 'notes');

  /* ---------- captions ---------- */
  const caption = useCaptions(session, state.transcript, lang, cc && live);
  const realAt = useRef(0);
  const previewAt = useRef(0);
  const lastReal = useRef<string | null>(null);
  const lastPreview = useRef<string | null>(null);
  if (caption && caption.line.id !== lastReal.current) { lastReal.current = caption.line.id; realAt.current = Date.now(); }
  if (pv.caption && pv.caption.id !== lastPreview.current) { lastPreview.current = pv.caption.id; previewAt.current = Date.now(); }
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
  // TODO(multi-party): replace with LiveKit participants (each person's own captions)
  const showPreview = !!pv.caption && previewAt.current >= realAt.current;
  const capNode = !cc || state.breakouts.open ? null : showPreview && pv.caption ? (() => {
    const c = pv.caption;
    const who = byId.get(c.who);
    const text = (lang ? c.text[lang] : undefined) ?? c.text[c.lang] ?? '';
    const translated = !!lang && lang !== c.lang && !!c.text[lang];
    return (
      <Caption who={<>{who && <Avatar person={who} size={18} />}<span className="name">{who ? callName(who) : ''}</span>{translated && lang && <span className="lang">{c.lang.toUpperCase()} → {lang.toUpperCase()}</span>}{capButton}</>}
        original={translated ? c.text[c.lang] : undefined}>{text}</Caption>
    );
  })() : caption ? (
    <Caption who={<>{caption.line.speaker?.person && <Avatar person={caption.line.speaker.person} size={18} />}<span className="name">{caption.line.speaker ? callName(caption.line.speaker.person ?? { name: caption.line.speaker.name, email: '' }) : ''}</span>{caption.translated && lang && <span className="lang">→ {lang.toUpperCase()}</span>}{capButton}</>}
      original={caption.translated ? caption.line.text : undefined}>{caption.text}</Caption>
  ) : (
    <Caption who={<><Icon name="captions" size={15} /><span className="name">Captions</span>{capButton}</>}>
      <span className="ic-cap-wait">{on ? 'What’s said appears here as people talk.' : 'Notes are off, so nothing is being transcribed for captions.'}</span>
    </Caption>
  );

  /* ---------- breakout rooms ---------- */
  const open = state.breakouts.open;
  const left = open ? Math.max(0, open.until - state.elapsed) : 0;
  const warned = useRef(false);
  const closing = useRef(false);
  useEffect(() => {
    if (!open) { warned.current = false; closing.current = false; return; }
    if (left <= 30 && !warned.current) { warned.current = true; toast('Rooms close in 30 seconds', { icon: 'timer' }); }
    if (left <= 0 && !closing.current && state.isOrganizer) { closing.current = true; session.closeRooms(); }
  }, [open, left, state.isOrganizer, session, toast]);
  const wasOpen = useRef(!!open);
  // TODO(multi-party): replace with LiveKit participants (the server's rooms will list everyone who was in them)
  const heldPreview = useRef(new Map<number, Person[][]>());
  useEffect(() => {
    if (wasOpen.current && !open) {
      const held = state.breakouts.held.at(-1);
      const assign = preview.getSnapshot().rooms?.assign;
      if (held && assign) heldPreview.current.set(held.from, assign.map((ids) => ids.flatMap((id) => { const p = byIdRef.current.get(id); return p ? [p] : []; })));
      preview.closeRooms();
      if (on) { setPanel('notes'); toast('Everyone is back. The rooms go into the call’s notes.', { icon: 'notesPen' }); }
      else toast('Everyone is back from the rooms', { icon: 'door' });
    }
    wasOpen.current = !!open;
  }, [open, on, preview, toast, state.breakouts.held]);
  const openRooms = (rooms: { name: string; ids: string[] }[], minutes: number) => {
    const email = (id: string) => byId.get(id)?.email ?? '';
    // Only people invited to the call go to the server; the preview's people stay in this browser.
    session.openRooms({ rooms: rooms.map((r) => ({ name: r.name, emails: r.ids.filter((id) => !isPreviewId(id)).map(email).filter(Boolean) })), minutes });
    // TODO(multi-party): replace with LiveKit participants
    preview.openRooms(rooms.map((r) => r.ids.filter(isPreviewId)));
    if (view.view.pinned) view.setPinned(null);
    toast(`${rooms.length} rooms are open for ${minutes} min`, { icon: 'door' });
  };
  // TODO(multi-party): replace with LiveKit participants (who is in which room comes from the call)
  const roomIds = open ? open.rooms.map((r, k) => [...(pv.rooms?.assign[k] ?? []), ...stagePeople.filter((p) => !p.isMe && !isPreviewId(p.id) && r.people.some((x) => sameEmail(x, p.person))).map((p) => p.id)]) : [];
  const activity: RoomActivity | null = pv.rooms ? { talking: pv.rooms.talking, notes: pv.rooms.notes, help: pv.rooms.help, joined: pv.rooms.joined } : open ? { talking: [], notes: [], help: null, joined: null } : null;
  const stageRooms: StageRooms | null = open && me ? {
    rooms: open.rooms.map((r, k) => ({ name: r.name, ids: roomIds[k] ?? [], talking: activity?.talking[k] ?? null, help: activity?.help?.room === k ? activity.help.id : null })),
    joined: activity?.joined ?? null, left,
    message: open.message && state.elapsed - open.message.at < 6 ? { from: me.person, text: open.message.text } : null, notesOn: on
  } : null;

  /* ---------- keys ---------- */
  const keys = useRef({ panel, pinned: view.view.pinned, setPin, setPanel });
  keys.current = { panel, pinned: view.view.pinned, setPin, setPanel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = media.getSnapshot();
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // Popovers and sheets close themselves first; then Escape unpins, then closes the panel.
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        if (keys.current.pinned) keys.current.setPin(null);
        else if (keys.current.panel) keys.current.setPanel(null);
        return;
      }
      if (k !== 'm' && k !== 'v' && k !== 'c') return;
      e.preventDefault();
      if (k === 'm') { media.setMic(!s.mic); session.setMic(!s.mic); }
      if (k === 'v') { void media.setCam(!s.cam); session.setCam(!s.cam); }
      if (k === 'c') keys.current.setPanel(keys.current.panel === 'chat' ? null : 'chat');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [media, session]);

  /* ---------- leaving ---------- */
  const end = async () => {
    setLeaving(true);
    try {
      await Promise.all([recorder.current?.flush(), speech.current?.flush()]);
      const r = await session.leave();
      guard.release();
      media.stop();
      preview.stop();
      sessions.media = null;
      void qc.invalidateQueries();
      setEnded({ noteId: r.pendingNoteId, duration: r.duration });
    } catch (e) {
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
  const panelPeople: PanelPerson[] = stagePeople.map((p) => ({
    id: p.id, person: p.person, isMe: p.isMe, organizer: p.isMe && state.isOrganizer, mic: p.mic, hand: p.hand, speaking: p.speaking,
    detail: p.isMe ? [state.isOrganizer ? 'Organizer' : 'Invited', micLabel, m.screen ? 'sharing' : '', !m.cam ? 'camera off' : ''].filter(Boolean).join(' · ') : 'In the call',
    tags: [spotlight === p.id ? 'Spotlight · everyone' : '', view.view.pinned === p.id ? 'Pinned for you' : '', p.hand ? 'Hand raised' : ''].filter(Boolean)
  }));

  /* ---------- the status bar ---------- */
  const spotName = spotlight ? (spotlight === meId ? null : callName(byId.get(spotlight) ?? { name: 'Someone', email: '' })) : null;
  const bar = (m.screen || spotlight) && !open ? (
    <>
      {m.screen && (
        <div className="ic-spill"><Icon name="screen" size={15} /><span className="tx2">You’re sharing <b>{m.screenLabel ?? 'your screen'}</b></span>
          <button type="button" className="sp-btn" onClick={() => setSharePick(true)}>Change</button>
          <button type="button" className="sp-btn is-strong" onClick={stopShare}>Stop sharing</button>
        </div>
      )}
      {spotlight && (
        <div className="ic-spill"><Icon name="spotlight" size={15} /><span className="tx2">{spotName ? <><b>{spotName}</b> is spotlighted for everyone</> : <><b>You’re</b> spotlighted for everyone</>}</span>
          {state.isOrganizer && <button type="button" className="sp-btn is-strong" onClick={() => setSpot(null)}>Stop spotlight</button>}
        </div>
      )}
    </>
  ) : null;

  const shownPanel = panel === 'rooms' && others.length === 0 ? null : panel;
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

  return (
    <div className="stage ac-stage">
      <div className={cn('ic-call', ended && 'is-ended')}>
        <TopBar title={state.title} elapsed={state.elapsed} notesOn={on} mode={view.view.mode} custom={isCustom(view.view)} people={stagePeople.map((p) => p.person)} peopleOpen={shownPanel === 'people'}
          onNotes={() => openPanel('notes')} onMode={(mode) => { if (open) toast('Your view comes back when the rooms close', { icon: 'door' }); else view.setMode(mode); }}
          onReset={() => { view.reset(); toast('Your view is back to Auto', { icon: 'reset' }); }} onCatchUp={catchUp} onPeople={() => flip('people')} />
        <div ref={mainRef} className="ic-main">
          <motion.div className="ic-stage-box" initial={false} animate={{ width: stageW || '100%' }} transition={reduce ? { duration: 0 } : SLIDE}>
            <Stage people={stagePeople} spotlight={spotlight} view={view} organizer={state.isOrganizer}
              screen={m.screen ? { stream: m.screen, label: m.screenLabel ?? 'your screen' } : null}
              bar={bar} caption={capNode} rooms={stageRooms} onSpotlight={setSpot} onCustom={onCustom} />
          </motion.div>
          <AnimatePresence>
            {shownPanel && (
              <motion.aside key="side" className="ic-side" aria-label="Call panel" style={{ width: sideW }}
                initial={reduce ? { opacity: 0 } : { x: sideW + 40 }} animate={{ x: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: sideW + 40 }} transition={reduce ? { duration: 0 } : SLIDE}>
                <SidePanel view={shownPanel} onView={openPanel} onClose={() => setPanel(null)} roomsTitle={open ? 'Rooms are open' : 'Breakout rooms'}>
                  {shownPanel === 'notes' && <NotesView state={state} live={liveNotes} getting={getting} roomPeople={(from, k, invited) => [...invited, ...(heldPreview.current.get(from)?.[k] ?? [])]} problems={[uploadError, heardProblem].filter((x): x is string => !!x)}
                    onNotes={(v) => void switchNotes(v)} onSeek={seek} onTranscript={() => openPanel('transcript')} />}
                  {shownPanel === 'transcript' && <TranscriptView state={state} me={me?.person.email} hit={hit} />}
                  {shownPanel === 'ask' && <AskView asks={asks} ready={state.notes.everOn && state.transcript.length > 0} onAsk={askQuestion} onCatchUp={catchUp} onSeek={seek} />}
                  {shownPanel === 'chat' && <ChatView state={state} onSend={(t) => session.sendChat(t)} />}
                  {shownPanel === 'people' && <PeopleView here={panelPeople} invited={invited} organizer={meeting?.organizer} />}
                  {shownPanel === 'rooms' && (open && me
                    ? <RoomsLive open={open} elapsed={state.elapsed} members={roomIds.map((ids, k) => [...(open.rooms[k]?.people ?? []).filter((x) => !ids.some((id) => sameEmail(byId.get(id) ?? x, x))), ...ids.flatMap((id) => { const p = byId.get(id); return p ? [p] : []; })])}
                      people={byId} activity={activity} me={me.person}
                      // TODO(multi-party): replace with LiveKit participants (joining a room moves your media to it)
                      onJoin={(k) => { preview.joinRoom(k); toast(k === null ? 'You’re back in the main room' : `You joined ${open.rooms[k]?.name ?? 'a room'}`, { icon: k === null ? 'left' : 'door' }); }}
                      onMessage={(t) => session.messageRooms(t)} onClose={() => session.closeRooms()} />
                    : <RoomsSetup people={others.map((p) => ({ id: p.id, person: p.person }))} onOpen={openRooms} />)}
                </SidePanel>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
        <footer className="ic-dockbar">
          <CallDock>
            <DockSplit>
              <DockButton icon={m.mic ? 'mic' : 'micOff'} label={m.mic ? 'Mute' : 'Unmute'} tip={`${m.mic ? 'Mute' : 'Unmute'}${micLabel ? ` · ${micLabel}` : ''}`} off={!m.mic} onClick={() => setMic(!m.mic)} />
              <MicMenu media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)}
                onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
            </DockSplit>
            <DockSplit>
              <DockButton icon={m.cam ? 'video' : 'videoOff'} label={m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} onClick={() => setCam(!m.cam)}
                tip={`${m.cam ? 'Turn camera off' : 'Turn camera on'}${devices.cam.find((d) => d.id === m.camId)?.label ? ` · ${devices.cam.find((d) => d.id === m.camId)?.label ?? ''}` : ''}`} />
              <CamMenu media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)}
                onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
            </DockSplit>
            <DockButton icon="screen" label={m.screen ? 'Change what you share' : 'Share a tab, window or screen'} tip={m.screen ? 'Change what you share' : 'Share a tab, window or screen'} on={!!m.screen} onClick={() => setSharePick(true)} />
            <DockButton icon="hand" label={me?.hand ? 'Lower your hand' : 'Raise your hand'} tip={me?.hand ? 'Lower your hand' : 'Raise your hand'} on={!!me?.hand} onClick={() => setHand(!me?.hand)} />
            <DockSplit>
              <DockButton icon="captions" label={cc ? 'Turn off captions' : 'Turn on captions'} tip={`${cc ? 'Turn off captions' : 'Turn on captions'} · the call is still transcribed for notes`} on={cc}
                onClick={() => { const v = !cc; setCc(v); if (!v && pop === 'cc') setPop(null); toast(v ? `Captions on${lang ? `, in ${CAPTION_LANGUAGES.find((x) => x.code === lang)?.english ?? lang}` : ''}` : 'Captions off. The call is still transcribed for notes.', { icon: 'captions' }); }} />
              <Popover open={pop === 'cc'} onOpenChange={(o) => setPop(o ? 'cc' : null)} side="top" align="start" label="Caption language" className="ic-dmenu"
                anchor={<DockChevron label="Caption language" on={pop === 'cc'} />}>{langMenu}</Popover>
            </DockSplit>
            <DockSeparator />
            {others.length > 0 && <DockButton icon="door" label="Breakout rooms" tip="Breakout rooms" on={shownPanel === 'rooms' || !!open} className="d-rooms" onClick={() => flip('rooms')} />}
            <DockButton icon="notesPen" label="Notes" tip="Notes" on={shownPanel === 'notes' || shownPanel === 'transcript' || shownPanel === 'ask'} onClick={() => setPanel((x) => (x === 'notes' || x === 'transcript' || x === 'ask' ? null : 'notes'))} />
            <DockButton icon="chat" label="Chat" tip="Chat" on={shownPanel === 'chat'} badge={unread} onClick={() => flip('chat')} />
            <Popover open={pop === 'more' || pop === 'devices'} onOpenChange={(o) => setPop(o ? 'more' : null)} side="top" align="end" label="More" className={pop === 'devices' ? 'ic-dmenu ic-devices' : 'ic-menu'}
              anchor={<DockButton icon="more" label="More: catch up, settings" on={pop === 'more' || pop === 'devices'} />}>
              {pop === 'devices' ? (
                <>
                  <MicOptions media={media} m={m} devices={devices} live onSwitched={(what, label) => toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' })} />
                  <div className="ic-msep" />
                  <CamOptions media={media} m={m} devices={devices} me={me?.person ?? { name: 'You' }} preview={false} onSwitched={(label) => toast(`Switched to ${label}`, { icon: 'video' })} />
                </>
              ) : (
                <>
                  <button type="button" className="mi" onClick={() => { setPop(null); catchUp(); }}><Icon name="history" size={17} /><span className="t">Catch up on the last few minutes</span></button>
                  <button type="button" className="mi" onClick={() => setPop('devices')}><Icon name="speaker" size={17} /><span className="t">Audio and video settings</span></button>
                  {others.length > 0 && <button type="button" className="mi only-narrow" onClick={() => { setPop(null); flip('rooms'); }}><Icon name="door" size={17} /><span className="t">Breakout rooms</span></button>}
                </>
              )}
            </Popover>
            <DockSeparator />
            <DockLeave disabled={leaving || !!ended} onClick={() => setLeaveOpen(true)}>Leave</DockLeave>
          </CallDock>
        </footer>
      </div>
      <SharePicker open={sharePick} onOpenChange={setSharePick} sharing={!!m.screen} onShare={share} />
      <LeaveSheet open={leaveOpen || !!ended} onOpenChange={(o) => { setLeaveOpen(o); if (!o) guard.stay(); }} title={state.title} elapsed={state.elapsed} others={others.length}
        getting={invited} leaving={leaving} ended={ended} onEnd={() => void end()} onRead={(id) => void away({ noteId: id })} onHome={() => void away(null)} />
    </div>
  );
}

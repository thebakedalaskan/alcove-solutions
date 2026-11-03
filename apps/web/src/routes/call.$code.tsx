import { clock, errorMessage, minutesLabel, type CallSession, type CallState, type Person } from '@alcove/api';
import { Avatar, Faces, Icon, Popover, cn, useRaisedToasts, useToast, type IconName } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { CallRoom, RoomView } from '~/features/call/livekit';
import { CatchUpView } from '~/features/call/CatchUp';
import { DeviceMenu } from '~/features/call/DevicePickers';
import { useDevices } from '~/features/call/devices';
import { CallLines } from '~/features/call/LiveLines';
import { useCopyLink } from '~/features/call/links';
import { Video, useLevels } from '~/features/call/Video';
import { LocalMedia, NotesRecorder, type MediaSnapshot } from '~/features/call/media';
import { SpeechClips } from '~/features/call/speech';
import { PROMISE_MANY } from '~/features/notes/NoteCard';
import { selfIn, sessions, useLeaveGuard, useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { listNames, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

/* Guests have no account: being in the call (its pass) is what lets them in. */
export const Route = createFileRoute('/call/$code')({ component: Call });

const clog = log.child({ component: 'call' });
/** Before the room has connected: nobody's media yet. */
const NO_VIEW: RoomView = { connection: 'connecting', endReason: null, people: {} };
const NO_ROOM: CallRoom = { getSnapshot: () => NO_VIEW, subscribe: () => () => undefined, attach: () => () => undefined, leave: async () => undefined };
/**
 * One room connection per call session. React may mount the screen twice (StrictMode in dev); a second
 * connection under the same identity would push the first out of the room, so remounts share this one,
 * and it's left only once no screen uses it.
 */
const rooms = new WeakMap<CallSession, { room: Promise<CallRoom>; users: number }>();
type Panel = 'notes' | 'chat' | 'people';
const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea');

function Call() {
  const { code } = Route.useParams();
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall session={active.session} />;
}

function InCall({ session }: { session: CallSession }) {
  const state = useLive(session);
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const m = useLive(media);
  const meeting = useQuery({ ...q.byCode(state.code), enabled: state.isOrganizer }).data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const copy = useCopyLink();
  useRaisedToasts();
  const on = state.notes.status === 'on';
  const [panel, setPanel] = useState<Panel | null>(() => (on && innerWidth >= 1100 ? 'notes' : null));
  const [pop, setPop] = useState<'pill' | 'leave' | 'mic' | 'cam' | null>(null);
  const devices = useDevices(m.camera);
  const [leaving, setLeaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  /** Turning notes off waits for the last audio and speech to be sent; the sign says so meanwhile. */
  const [stopping, setStopping] = useState(false);
  /* Back, or anywhere else, asks to end the call first: the recorder can't pick up where it left off. */
  const guard = useLeaveGuard(() => setPop('leave'));
  const seenChat = useRef(state.chat.length);
  if (panel === 'chat') seenChat.current = state.chat.length;
  const unread = Math.max(0, state.chat.length - seenChat.current);

  /* Media comes from pre-join; it starts here if the call page was opened directly. */
  const first = useRef({ mic: media.getSnapshot().mic, cam: media.getSnapshot().cam });
  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start(first.current);
  }, [media]);

  /* The call's media goes through its LiveKit room (loaded only here); leaving the screen leaves the room. */
  const [room, setRoom] = useState<CallRoom>(NO_ROOM);
  const view = useLive(room);
  useEffect(() => {
    let gone = false;
    let entry = rooms.get(session);
    if (!entry) {
      entry = { room: import('~/features/call/livekit').then(({ openRoom }) => openRoom(session, media)), users: 0 };
      rooms.set(session, entry);
    }
    const e = entry;
    e.users++;
    e.room.then((r) => { if (!gone) setRoom(r); }, (err: unknown) => {
      rooms.delete(session);
      if (gone) return;
      clog.error('could not join the call’s room', { err });
      toast(errorMessage(err), { icon: 'x' });
    });
    return () => {
      gone = true;
      e.users--;
      // A remount comes straight back; only a screen that's really gone leaves the room.
      setTimeout(() => {
        if (e.users > 0 || rooms.get(session) !== e) return;
        rooms.delete(session);
        void e.room.then((r) => r.leave(), () => undefined);
      }, 0);
    };
  }, [session, media, toast]);

  /* The recorder and the live transcript follow the call's notes, from the organizer's microphone only. */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), setUploadError);
  const speech = useRef<SpeechClips | null>(null);
  if (!speech.current) speech.current = new SpeechClips((c) => session.transcribe(c), setHeardProblem);
  const micTrack = media.micTrack();
  const segment = state.notes.recording.segment;
  useEffect(() => {
    const r = recorder.current;
    const s = speech.current;
    if (!r || !s) return;
    if (state.isOrganizer && on && micTrack) { r.start(micTrack, segment); s.start(micTrack, segment); }
    else if (!on || !state.isOrganizer) { r.stop(); s.stop(); }
  }, [state.isOrganizer, on, segment, micTrack]);
  useEffect(() => () => speech.current?.stop(), []);
  useEffect(() => { if (!on) setStopping(false); }, [on]);

  /* What the call says happened ("Notes are on…") arrives once, as a toast. */
  const shown = useRef(new Set<string>());
  useEffect(() => {
    for (const n of state.notices) {
      if (shown.current.has(n.id)) continue;
      shown.current.add(n.id);
      toast(n.text, { icon: n.kind === 'notes' ? 'pen' : n.kind === 'people' ? 'people' : 'screen', ms: 3000 });
      session.dismissNotice(n.id);
    }
  }, [state.notices, session, toast]);

  const setMic = (v: boolean) => { media.setMic(v); };
  const setCam = (v: boolean) => { void media.setCam(v); };
  /* One screen at a time: while someone else presents, sharing waits until they stop. */
  const someoneElsePresents = state.participants.some((p) => !p.isMe && view.people[p.id]?.screenSid);
  const share = async () => {
    if (media.getSnapshot().screen) { media.stopScreen(); return; }
    if (someoneElsePresents) { toast('Someone else is presenting. You can share once they stop.', { icon: 'screen' }); return; }
    await media.shareScreen(() => undefined);
  };
  const flip = (p: Panel) => setPanel((x) => (x === p ? null : p));
  /* Turning notes off keeps everything said while they were on: the last audio and speech are sent first. */
  const switchNotes = async (v: boolean) => {
    if (!v) {
      setStopping(true);
      await Promise.all([recorder.current?.flush(), speech.current?.flush()]);
      // If the call keeps notes on after all, the sign goes back to saying so.
      setTimeout(() => setStopping(false), 6000);
    }
    session.setNotes(v);
    if (v && !panel && innerWidth >= 1100) setPanel('notes');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = media.getSnapshot();
      const k = e.key.toLowerCase();
      if (k !== 'm' && k !== 'v' && k !== 'c') return;
      // The key is a shortcut here, not a character for whatever gets focus next.
      e.preventDefault();
      if (k === 'm') media.setMic(!s.mic);
      if (k === 'v') void media.setCam(!s.cam);
      if (k === 'c') setPanel((x) => (x === 'chat' ? null : 'chat'));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [media, session]);

  const end = async () => {
    setPop(null);
    setLeaving(true);
    try {
      await Promise.all([recorder.current?.flush(), speech.current?.flush()]);
      const r = await session.leave();
      guard.release();
      sessions.call = null;
      media.stop();
      sessions.media = null;
      void qc.invalidateQueries();
      if (!r) await navigate({ to: '/join/$code', params: { code: state.code }, replace: true });
      else if (r.pendingNoteId) await navigate({ to: '/notes/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
      else {
        await navigate({ to: '/home', replace: true });
        toast(`Call ended after ${minutesLabel(r.duration)}. There are no notes from it.`, { icon: 'check' });
      }
    } catch (e) {
      clog.error('leaving the call failed', { err: e });
      toast(errorMessage(e), { icon: 'x' });
      setLeaving(false);
    }
  };

  /*
   * The organizer ended the call, or removed you: everyone else is told, and goes back to the call's page.
   * The organizer is only ever removed by joining from another device; this screen then lets go of the call.
   */
  const hosting = session.ticket.role === 'host';
  useEffect(() => {
    if (view.connection !== 'ended' || leaving) return;
    if (view.endReason !== 'removed' && (hosting || view.endReason !== 'ended-by-host')) return;
    recorder.current?.stop();
    speech.current?.stop();
    guard.release();
    sessions.call = null;
    media.stop();
    sessions.media = null;
    toast(hosting ? 'You joined this call from another device.' : view.endReason === 'removed' ? 'The host removed you from the call.' : 'The host ended the call.', { icon: 'leave' });
    void navigate(hosting ? { to: '/home', replace: true } : { to: '/join/$code', params: { code: state.code }, replace: true });
  }, [view.connection, view.endReason, leaving, hosting, state.code, guard, media, navigate, toast]);

  const invited = meeting?.guests ?? [];
  const everyone = [...state.participants.map((p) => p.person)];
  return (
    <div className="stage">
      <div className={cn('stg call', leaving && 'ending')}>
        <header className="stg-top">
          <div className="cl-title"><b>{state.title}</b><span className="mono">{clock(state.elapsed)}</span></div>
          <div className="stg-mid">
            <NotesPill state={state} invited={invited} stopping={stopping} open={pop === 'pill'} onOpenChange={(o) => setPop(o ? 'pill' : null)}
              onSet={(v) => { setPop(null); void switchNotes(v); }} />
          </div>
          <div className="stg-right">{view.connection === 'reconnecting' && <span className="mono">Reconnecting…</span>}<Faces people={everyone} size={28} /></div>
        </header>
        <div className="cl">
          <div className="cl-main">
            <Tiles state={state} media={m} room={room} view={view} onCopy={() => copy(state.code)} />
          </div>
          {panel && (
            <aside className="cl-panel" aria-label={panel === 'notes' ? 'Notes' : panel === 'chat' ? 'Chat' : 'People'}>
              {panel === 'notes' && <NotesPanel session={session} state={state} media={media} live={m.mic} uploadError={uploadError} heardProblem={heardProblem} onTurnOn={() => void switchNotes(true)} />}
              {panel === 'chat' && <ChatPanel state={state} onSend={(t) => session.sendChat(t)} />}
              {panel === 'people' && <PeoplePanel state={state} invited={invited} view={view} session={session} />}
            </aside>
          )}
        </div>
        <div className="cl-bar">
          <span className="rb-split">
            <Round icon={m.mic ? 'mic' : 'micOff'} label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} off={!m.mic} onClick={() => setMic(!m.mic)} />
            <DeviceMenu kind="mic" media={media} m={m} devices={devices} open={pop === 'mic'} onOpenChange={(o) => setPop(o ? 'mic' : null)} />
          </span>
          <span className="rb-split">
            <Round icon={m.cam ? 'video' : 'videoOff'} label={m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} onClick={() => setCam(!m.cam)} />
            <DeviceMenu kind="cam" media={media} m={m} devices={devices} open={pop === 'cam'} onOpenChange={(o) => setPop(o ? 'cam' : null)} />
          </span>
          <Round icon="screen" label={m.screen ? 'Stop presenting' : someoneElsePresents ? 'Someone else is presenting' : 'Share your screen'} on={!!m.screen} off={someoneElsePresents && !m.screen} onClick={() => void share()} />
          <span className="sep" />
          <Round icon="notes" label="Notes" on={panel === 'notes'} onClick={() => flip('notes')} />
          <Round icon="chat" label="Chat" on={panel === 'chat'} onClick={() => flip('chat')} badge={unread} />
          <Round icon="people" label="People" on={panel === 'people'} onClick={() => flip('people')} />
          <span className="sep" />
          <Popover open={pop === 'leave'} onOpenChange={(o) => { setPop(o ? 'leave' : null); if (!o) guard.stay(); }} side="top" align="end" dark label="End the call" className="lv-pop"
            anchor={<button type="button" className="leave" disabled={leaving}><Icon name="leave" size={22} /><span>End</span></button>}>
            <button type="button" className="pop-item danger" onClick={() => void end()}>
              <Icon name="leave" size={18} />
              {state.isOrganizer
                ? <span><b>End call</b><small>{state.notes.everOn ? 'Notes go to everyone invited as soon as it ends.' : 'No notes were taken.'}</small></span>
                : <span><b>Leave call</b><small>The call goes on without you.</small></span>}
            </button>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function Round({ icon, label, onClick, off = false, on = false, badge = 0 }: { icon: IconName; label: string; onClick: () => void; off?: boolean; on?: boolean; badge?: number }) {
  return (
    <button type="button" className={cn('rb', off && 'off', on && 'on')} aria-label={label} title={label} aria-pressed={off ? false : on || undefined} onClick={onClick}>
      <Icon name={icon} size={21} />
      {badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );
}

/* The notes sign, top centre, the same for everyone. Only the organizer can switch it. */
function NotesPill({ state, invited, stopping, open, onOpenChange, onSet }: { state: CallState; invited: Person[]; stopping: boolean; open: boolean; onOpenChange: (o: boolean) => void; onSet: (on: boolean) => void }) {
  const on = state.notes.status === 'on';
  const getting = [...state.participants.map((p) => p.person), ...invited.filter((g) => !state.participants.some((p) => sameEmail(p.person, g)))];
  return (
    <Popover open={open} onOpenChange={onOpenChange} align="center" dark label={on ? 'Notes are on' : 'No notes'} className="pill-pop"
      anchor={on
        ? <button type="button" className="npill" aria-label="Notes are on"><i /><span>{stopping ? 'Turning off…' : 'Notes on'}</span></button>
        : <button type="button" className="npill off" aria-label="No notes"><span>No notes</span><Icon name="down" size={14} /></button>}>
      {on ? (
        <>
          <div className="pp-h"><b>Notes are on</b><p>{state.isOrganizer ? 'Everyone here can see it.' : 'The organizer turned them on. Everyone here can see it.'}</p></div>
          <div className="pp-who"><Faces people={getting} size={24} max={5} /><span>They go to everyone invited</span></div>
          <div className="pp-promise"><Icon name="lock" size={14} /><span>{PROMISE_MANY}</span></div>
          {state.isOrganizer && (
            <>
              <div className="pop-sep" />
              <button type="button" className="pop-item" onClick={() => onSet(false)}><Icon name="x" size={18} /><span><b>Turn off notes</b><small>What’s written so far is kept.</small></span></button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="pp-h"><b>No notes for this call</b><p>{state.isOrganizer ? 'Nothing is being recorded.' : 'Only the organizer can turn them on.'}</p></div>
          {state.isOrganizer && (
            <>
              <div className="pop-sep" />
              <button type="button" className="pop-item" onClick={() => onSet(true)}><Icon name="pen" size={18} /><span><b>Turn on notes</b><small>Everyone here sees it, and everyone invited gets them.</small></span></button>
            </>
          )}
        </>
      )}
    </Popover>
  );
}

/** Someone else's camera or screen, from the call's room. */
function RoomVideo({ room, sid, className }: { room: CallRoom; sid: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const el = ref.current; return el ? room.attach(sid, el) : undefined; }, [room, sid]);
  return <video ref={ref} autoPlay playsInline muted className={className} />;
}

function Tiles({ state, media, room, view, onCopy }: { state: CallState; media: MediaSnapshot; room: CallRoom; view: RoomView; onCopy: () => void }) {
  const others = state.participants.filter((p) => !p.isMe);
  const presenter = others.find((p) => view.people[p.id]?.screenSid);
  const presenting = presenter ? view.people[presenter.id]?.screenSid : undefined;
  const me = selfIn(state);
  const self = me && (
    <div className="tile self">
      {media.cam && media.camera ? <Video stream={media.camera} /> : <div className="feed-off"><Avatar person={me.person} size={56} /></div>}
      <span className="nm">{!media.mic && <Icon name="micOff" size={14} />}You</span>
    </div>
  );
  const faces = others.map((p) => (
    <div key={p.id} className="tile">
      {view.people[p.id]?.camSid ? <RoomVideo room={room} sid={view.people[p.id]?.camSid ?? ''} /> : <div className="feed-off"><Avatar person={p.person} size={96} /></div>}
      <span className="nm">{!view.people[p.id]?.mic && <Icon name="micOff" size={14} />}{p.person.name.split(' ')[0] ?? p.person.name}</span>
    </div>
  ));
  /* A shared screen takes the stage; everyone's cameras stay alongside it. */
  if (media.screen || (presenter && presenting)) {
    return (
      <div className={cn('tiles', others.length ? 'sharing' : 'one')}>
        {media.screen
          ? <div className="tile"><Video stream={media.screen} className="screen" /><span className="nm"><Icon name="screen" size={14} />Your screen</span></div>
          : <div className="tile"><RoomVideo room={room} sid={presenting ?? ''} className="screen" /><span className="nm"><Icon name="screen" size={14} />{presenter?.person.name.split(' ')[0] ?? presenter?.person.name}’s screen</span></div>}
        {others.length > 0 && <div className="tiles-strip">{faces}</div>}
        {self}
      </div>
    );
  }
  if (!others.length) {
    return (
      <div className="tiles one">
        <div className="tile wait">
          <div className="wait-in">
            <Icon name="link" size={22} />
            <b>Waiting for others</b>
            <p>People you invited appear here when they join.</p>
            <button type="button" className="btn btn-secondary" onClick={onCopy}><Icon name="copy" size={16} />Copy link</button>
          </div>
        </div>
        {self}
      </div>
    );
  }
  return (
    <div className={cn('tiles grid', (others.length + 1) % 2 === 1 && 'odd')}>
      {faces}
      {self}
    </div>
  );
}

const wave = (l: number, i: number) => Math.max(8, Math.min(100, 10 + l * 90 * (0.55 + Math.abs(Math.sin(i * 1.7 + Date.now() / 260)) * 0.6)));

/*
 * While notes are on: what's being said, a few seconds behind. The notes themselves are written
 * after the call. Catching up reads the transcript so far, for you alone.
 */
function NotesPanel({ session, state, media, live, uploadError, heardProblem, onTurnOn }: {
  session: CallSession; state: CallState; media: LocalMedia; live: boolean; uploadError: string | null; heardProblem: string | null; onTurnOn: () => void;
}) {
  const on = state.notes.status === 'on';
  const lines = state.transcript;
  const [catching, setCatching] = useState(false);
  const bars = useLevels(media, 28, on && live && !lines.length && !catching, wave);
  if (catching) {
    return (
      <>
        <div className="cp-head"><b>Catch up</b>{on ? <span className="live"><i />Recording</span> : <span className="cnt">Notes off</span>}</div>
        <CatchUpView session={session} elapsed={state.elapsed} onBack={() => setCatching(false)} />
      </>
    );
  }
  if (!on) {
    return (
      <>
        <div className="cp-head"><b>Notes</b></div>
        <div className="cp-off">
          <span className="cpo-ic"><Icon name="pen" size={22} /></span>
          <b>{state.notes.everOn ? 'Notes are off' : 'No notes for this call'}</b>
          <p>{state.isOrganizer ? 'Turn them on and everyone here sees it. Everyone invited gets them afterwards.' : 'Only the organizer can turn them on.'}</p>
          {state.isOrganizer && <button type="button" className="btn c-ok" onClick={onTurnOn}>Turn on notes</button>}
          {state.notes.everOn && lines.length > 0 && <button type="button" className="cp-catch" onClick={() => setCatching(true)}><Icon name="ask" size={14} />Catch up on what was said</button>}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="cp-head">
        <b>Notes</b>
        <span className="cp-head-r">
          {lines.length > 0 && <button type="button" className="cp-catch" onClick={() => setCatching(true)}><Icon name="ask" size={14} />Catch up</button>}
          <span className="live"><i />Recording</span>
        </span>
      </div>
      <div className="cp-kept"><b>{clock(state.notes.recording.seconds)}</b><span>kept, encrypted</span></div>
      {lines.length ? <CallLines lines={lines} me={selfIn(state)?.person.email} /> : (
        <div className="cp-listen">
          <div className="wavebars" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
          {live ? <><b>Listening</b><p>What’s said appears here a few seconds later.</p></>
            : <><b>Your microphone is off</b><p>Turn it on, and what you say appears here a few seconds later.</p></>}
          <small>The summary, decisions and follow-ups are written when the call ends.</small>
        </div>
      )}
      {(uploadError || heardProblem) && (
        <div className="cp-problems">
          {uploadError && <p className="bad"><Icon name="x" size={14} />{uploadError}</p>}
          {heardProblem && <p><Icon name="clock" size={14} />{heardProblem}</p>}
        </div>
      )}
      <div className="cp-foot"><Icon name="lock" size={14} /><span>Written privately. They go to everyone invited.</span></div>
    </>
  );
}

function ChatPanel({ state, onSend }: { state: CallState; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const toast = useToast();
  /* A message that isn't saved isn't sent: say so, and give the text back. */
  const send = (t: string) => {
    setText('');
    void onSend(t).catch((e: unknown) => { toast(errorMessage(e), { icon: 'x' }); setText((now) => now || t); });
  };
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.chat.length]);
  return (
    <>
      <div className="cp-head"><b>Chat</b></div>
      <div className="cp-body chat-body">
        {state.chat.length ? state.chat.map((c) => (
          <div key={c.id} className={cn('msg', c.isMe && 'mine')}>
            {!c.isMe && <Avatar person={c.from} size={26} />}
            <div><b>{c.isMe ? 'You' : (c.from.name.split(' ')[0] ?? c.from.name)}</b><p>{c.text}</p></div>
          </div>
        )) : <p className="py-2 text-[13.5px] text-[rgb(236_235_248/0.5)]">Messages here are seen by everyone in the call.</p>}
        <div ref={end} />
      </div>
      <form className="cp-input" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) send(t); }}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" autoComplete="off" aria-label="Message everyone" />
        <button type="submit" className="rb sm" aria-label="Send"><Icon name="send" size={17} /></button>
      </form>
    </>
  );
}

function PeoplePanel({ state, invited, view, session }: { state: CallState; invited: Person[]; view: RoomView; session: CallSession }) {
  const toast = useToast();
  /* The organizer's host controls: mute (they unmute themselves), remove (they can come back unless it's locked), lock. */
  const control = (fn: () => Promise<void>) => { void fn().catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })); };
  const away = invited.filter((g) => !state.participants.some((p) => sameEmail(p.person, g)));
  const on = state.notes.everOn;
  return (
    <>
      <div className="cp-head"><b>People</b><span className="cnt">{state.participants.length} here</span>
        {state.isOrganizer && <button type="button" className="cp-catch" onClick={() => control(() => session.lock(!state.locked))}><Icon name="lock" size={14} />{state.locked ? 'Unlock call' : 'Lock call'}</button>}
      </div>
      <div className="cp-body">
        {state.participants.map((p) => (
          <div key={p.id} className="person">
            <Avatar person={p.person} size={32} />
            <span className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{p.isOrganizer ? 'Organizer' : p.person.email ? 'Invited' : 'Guest'}</small></span>
            {state.isOrganizer && !p.isMe ? (
              <span className="flex gap-1">
                {view.people[p.id]?.mic && <button type="button" className="cp-catch" aria-label={`Mute ${p.person.name}`} onClick={() => control(() => session.mute(p.id, view.people[p.id]?.micSid ?? ''))}><Icon name="micOff" size={14} /></button>}
                <button type="button" className="cp-catch" aria-label={`Remove ${p.person.name}`} onClick={() => control(() => session.remove(p.id))}><Icon name="x" size={14} /></button>
              </span>
            ) : <Icon name={view.people[p.id]?.mic ? 'mic' : 'micOff'} size={16} />}
          </div>
        ))}
        {away.length > 0 && (
          <>
            <div className="cp-sub">Invited, not here</div>
            {away.map((g) => (
              <div key={g.email} className="person away">
                <Avatar person={g} size={32} />
                <span className="min-w-0"><b>{g.name}</b><small>{on ? 'Gets the notes' : 'Invited'}</small></span>
                <span />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="cp-foot"><Icon name={on ? 'send' : 'people'} size={14} /><span>{on ? `Notes go to ${away.length ? `everyone invited, including ${listNames(away)}` : 'everyone invited'}` : 'Everyone invited can see who’s here'}</span></div>
    </>
  );
}

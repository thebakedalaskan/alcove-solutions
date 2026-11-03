import { clock, errorMessage, minutesLabel, type CallSession, type CallState, type Person } from '@alcove/api';
import { Avatar, Faces, Icon, Popover, cn, useRaisedToasts, useToast, type IconName } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCopyLink } from '~/features/call/links';
import { Video, useLevels } from '~/features/call/Video';
import { LocalMedia, NotesRecorder, type MediaSnapshot } from '~/features/call/media';
import { PROMISE_MANY } from '~/features/notes/NoteCard';
import { requireAccount } from '~/lib/guards';
import { selfIn, sessions, useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { listNames, sameEmail } from '~/lib/people';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/call/$code')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: Call
});

const clog = log.child({ component: 'call' });
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
  const meeting = useQuery(q.byCode(state.code)).data;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const copy = useCopyLink();
  useRaisedToasts();
  const me = selfIn(state);
  const on = state.notes.status === 'on';
  const [panel, setPanel] = useState<Panel | null>(() => (on && innerWidth >= 1100 ? 'notes' : null));
  const [pop, setPop] = useState<'pill' | 'leave' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const seenChat = useRef(state.chat.length);
  if (panel === 'chat') seenChat.current = state.chat.length;
  const unread = Math.max(0, state.chat.length - seenChat.current);

  /* Media comes from pre-join; it starts here if the call page was opened directly. */
  const first = useRef({ mic: me?.mic ?? true, cam: me?.cam ?? true });
  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start(first.current);
  }, [media]);

  /* The recorder follows the call's notes: everyone in the call sees the same sign. */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), setUploadError);
  const micTrack = media.micTrack();
  useEffect(() => {
    const r = recorder.current;
    if (!r) return;
    if (on && micTrack) r.start(micTrack, state.notes.recording.segment);
    else if (!on) r.stop();
  }, [on, state.notes.recording.segment, micTrack]);

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

  const setMic = (v: boolean) => { media.setMic(v); session.setMic(v); };
  const setCam = (v: boolean) => { void media.setCam(v); session.setCam(v); };
  const share = async () => {
    if (media.getSnapshot().screen) { media.stopScreen(); session.setSharing(false); return; }
    const title = await media.shareScreen(() => session.setSharing(false));
    if (title) session.setSharing(true, title);
  };
  const flip = (p: Panel) => setPanel((x) => (x === p ? null : p));
  /* Turning notes off keeps everything said while they were on: the last piece is uploaded first. */
  const switchNotes = async (v: boolean) => {
    if (!v) await recorder.current?.flush();
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
      if (k === 'm') { media.setMic(!s.mic); session.setMic(!s.mic); }
      if (k === 'v') { void media.setCam(!s.cam); session.setCam(!s.cam); }
      if (k === 'c') setPanel((x) => (x === 'chat' ? null : 'chat'));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [media, session]);

  const end = async () => {
    setPop(null);
    setLeaving(true);
    try {
      await recorder.current?.flush();
      const r = await session.leave();
      sessions.call = null;
      media.stop();
      sessions.media = null;
      void qc.invalidateQueries();
      if (r.pendingNoteId) await navigate({ to: '/notes/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
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

  const invited = meeting?.guests ?? [];
  const everyone = [...state.participants.map((p) => p.person)];
  return (
    <div className="stage">
      <div className={cn('stg call', leaving && 'ending')}>
        <header className="stg-top">
          <div className="cl-title"><b>{state.title}</b><span className="mono">{clock(state.elapsed)}</span></div>
          <div className="stg-mid">
            <NotesPill state={state} invited={invited} open={pop === 'pill'} onOpenChange={(o) => setPop(o ? 'pill' : null)}
              onSet={(v) => { setPop(null); void switchNotes(v); }} />
          </div>
          <div className="stg-right"><Faces people={everyone} size={28} /></div>
        </header>
        <div className="cl">
          <div className="cl-main">
            <Tiles state={state} media={m} onCopy={() => copy(state.code)} />
          </div>
          {panel && (
            <aside className="cl-panel" aria-label={panel === 'notes' ? 'Notes' : panel === 'chat' ? 'Chat' : 'People'}>
              {panel === 'notes' && <NotesPanel state={state} media={media} live={m.mic} uploadError={uploadError} onTurnOn={() => void switchNotes(true)} />}
              {panel === 'chat' && <ChatPanel state={state} onSend={(t) => session.sendChat(t)} />}
              {panel === 'people' && <PeoplePanel state={state} invited={invited} />}
            </aside>
          )}
        </div>
        <div className="cl-bar">
          <Round icon={m.mic ? 'mic' : 'micOff'} label={m.mic ? 'Turn microphone off' : 'Turn microphone on'} off={!m.mic} onClick={() => setMic(!m.mic)} />
          <Round icon={m.cam ? 'video' : 'videoOff'} label={m.cam ? 'Turn camera off' : 'Turn camera on'} off={!m.cam} onClick={() => setCam(!m.cam)} />
          <Round icon="screen" label={m.screen ? 'Stop presenting' : 'Share your screen'} on={!!m.screen} onClick={() => void share()} />
          <span className="sep" />
          <Round icon="notes" label="Notes" on={panel === 'notes'} onClick={() => flip('notes')} />
          <Round icon="chat" label="Chat" on={panel === 'chat'} onClick={() => flip('chat')} badge={unread} />
          <Round icon="people" label="People" on={panel === 'people'} onClick={() => flip('people')} />
          <span className="sep" />
          <Popover open={pop === 'leave'} onOpenChange={(o) => setPop(o ? 'leave' : null)} side="top" align="end" dark label="End the call" className="lv-pop"
            anchor={<button type="button" className="leave" disabled={leaving}><Icon name="leave" size={22} /><span>End</span></button>}>
            <button type="button" className="pop-item danger" onClick={() => void end()}>
              <Icon name="leave" size={18} />
              <span><b>End call</b><small>{state.notes.everOn ? 'Notes go to everyone invited as soon as it ends.' : 'No notes were taken.'}</small></span>
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
function NotesPill({ state, invited, open, onOpenChange, onSet }: { state: CallState; invited: Person[]; open: boolean; onOpenChange: (o: boolean) => void; onSet: (on: boolean) => void }) {
  const on = state.notes.status === 'on';
  const getting = [...state.participants.map((p) => p.person), ...invited.filter((g) => !state.participants.some((p) => sameEmail(p.person, g)))];
  return (
    <Popover open={open} onOpenChange={onOpenChange} align="center" dark label={on ? 'Notes are on' : 'No notes'} className="pill-pop"
      anchor={on
        ? <button type="button" className="npill" aria-label="Notes are on"><i /><span>Notes on</span></button>
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

function Tiles({ state, media, onCopy }: { state: CallState; media: MediaSnapshot; onCopy: () => void }) {
  const others = state.participants.filter((p) => !p.isMe);
  const me = selfIn(state);
  const self = me && (
    <div className="tile self">
      {media.cam && media.camera ? <Video stream={media.camera} /> : <div className="feed-off"><Avatar person={me.person} size={56} /></div>}
      <span className="nm">{!media.mic && <Icon name="micOff" size={14} />}You</span>
    </div>
  );
  if (media.screen) {
    return (
      <div className="tiles one">
        <div className="tile"><Video stream={media.screen} className="screen" /><span className="nm"><Icon name="screen" size={14} />Your screen</span></div>
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
      {others.map((p) => (
        <div key={p.id} className={cn('tile', p.hand && 'hand-up')}>
          <div className="feed-off"><Avatar person={p.person} size={96} /></div>
          <span className="nm">{!p.mic && <Icon name="micOff" size={14} />}{p.person.name.split(' ')[0] ?? p.person.name}</span>
        </div>
      ))}
      {self}
    </div>
  );
}

const wave = (l: number, i: number) => Math.max(8, Math.min(100, 10 + l * 90 * (0.55 + Math.abs(Math.sin(i * 1.7 + Date.now() / 260)) * 0.6)));

/* While notes are on: what's been kept so far. The writing itself happens after the call. */
function NotesPanel({ state, media, live, uploadError, onTurnOn }: { state: CallState; media: LocalMedia; live: boolean; uploadError: string | null; onTurnOn: () => void }) {
  const on = state.notes.status === 'on';
  const bars = useLevels(media, 28, on && live, wave);
  if (!on) {
    return (
      <>
        <div className="cp-head"><b>Notes</b></div>
        <div className="cp-off">
          <span className="cpo-ic"><Icon name="pen" size={22} /></span>
          <b>{state.notes.everOn ? 'Notes are off' : 'No notes for this call'}</b>
          <p>{state.isOrganizer ? 'Turn them on and everyone here sees it. Everyone invited gets them afterwards.' : 'Only the organizer can turn them on.'}</p>
          {state.isOrganizer && <button type="button" className="btn c-ok" onClick={onTurnOn}>Turn on notes</button>}
        </div>
      </>
    );
  }
  const r = state.notes.recording;
  return (
    <>
      <div className="cp-head"><b>Notes</b><span className="live"><i />Recording</span></div>
      <div className="cp-body">
        <div className="cp-rec">
          <div className="stat"><b>{clock(r.seconds)}</b><span>kept so far, encrypted</span></div>
          <div className="wavebars" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
          <p>The summary, decisions and follow-ups are written when the call ends.</p>
          {uploadError && <p className="text-[#FFB3B5]">{uploadError}</p>}
        </div>
      </div>
      <div className="cp-foot"><Icon name="lock" size={14} /><span>Written privately. They go to everyone invited.</span></div>
    </>
  );
}

function ChatPanel({ state, onSend }: { state: CallState; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
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
      <form className="cp-input" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText(''); } }}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" autoComplete="off" aria-label="Message everyone" />
        <button type="submit" className="rb sm" aria-label="Send"><Icon name="send" size={17} /></button>
      </form>
    </>
  );
}

function PeoplePanel({ state, invited }: { state: CallState; invited: Person[] }) {
  const away = invited.filter((g) => !state.participants.some((p) => sameEmail(p.person, g)));
  const on = state.notes.everOn;
  return (
    <>
      <div className="cp-head"><b>People</b><span className="cnt">{state.participants.length} here</span></div>
      <div className="cp-body">
        {state.participants.map((p) => (
          <div key={p.id} className="person">
            <Avatar person={p.person} size={32} />
            <span className="min-w-0"><b>{p.person.name}{p.isMe ? ' (you)' : ''}</b><small>{p.isOrganizer ? 'Organizer' : 'Invited'}</small></span>
            <Icon name={p.mic ? 'mic' : 'micOff'} size={16} />
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

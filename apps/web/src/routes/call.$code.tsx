import { clock } from '@alcove/api';
import { Chip, Icon, RecDot } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { CallSession } from '@alcove/api';
import { Navigate, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Controls } from '~/features/call/Controls';
import { Notices, ReadyCard } from '~/features/call/Overlays';
import { ChatPanel, NotesPanel, PeoplePanel, type Panel } from '~/features/call/SidePanel';
import { Stage } from '~/features/call/Stage';
import { selfIn, sessions, useLive } from '~/lib/live';

export const Route = createFileRoute('/call/$code')({
  beforeLoad: ({ params }) => {
    // A call can only be entered through pre-join, which creates the live session.
    if (sessions.call?.code !== params.code) throw redirect({ to: '/join/$code', params });
  },
  component: Call
});

function Call() {
  const { code } = Route.useParams();
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall session={active.session} />;
}

function InCall({ session }: { session: CallSession }) {
  const state = useLive(session);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = selfIn(state);
  const [panel, setPanel] = useState<Panel | null>(state.notes.status !== 'off' ? 'notes' : null);
  const [ready, setReady] = useState(state.participants.length === 1);
  const [leaving, setLeaving] = useState(false);
  const seenChat = useRef(state.chat.length);
  if (panel === 'chat') seenChat.current = state.chat.length;
  const unread = Math.max(0, state.chat.length - seenChat.current);

  useEffect(() => { if (state.participants.length > 1) setReady(false); }, [state.participants.length]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest('input,textarea')) || e.metaKey || e.ctrlKey || !me) return;
      const k = e.key.toLowerCase();
      if (k === 'm') session.setMic(!me.mic);
      if (k === 'v') session.setCam(!me.cam);
      if (k === 'c') setPanel((p) => (p === 'chat' ? null : 'chat'));
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [session, me]);

  const leave = async () => {
    setLeaving(true);
    const r = await session.leave();
    sessions.call = null;
    void qc.invalidateQueries();
    if (r.pendingNoteId) await navigate({ to: '/writing/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
    else await navigate({ to: '/ended', search: { title: state.title, minutes: Math.max(1, Math.round(r.duration / 60)), code: state.code, guest: me?.isGuest || undefined }, replace: true });
  };

  const st = state.notes.status;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
      className="dark fixed inset-0 z-20 grid grid-rows-[auto_1fr_auto] bg-stage text-stage-ink [color-scheme:dark] [--avatar-ring:#161411]">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <b className="text-[15px] font-semibold">{state.title}</b>
        <span className="font-mono text-[13.5px] text-stage-mute tabular">{clock(state.elapsed)}</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-live"><Icon name="lock" className="size-3.5" />Encrypted</span>
        <div className="flex-1" />
        {st !== 'off' && <Chip tone="stage-rec">{st === 'paused' ? <><Icon name="pause" className="size-3.5" />Notes paused</> : <><RecDot />{state.notes.mode === 'full' ? 'Transcribing' : 'Taking notes'}</>}</Chip>}
        {me?.hand && <Chip tone="stage" icon="hand">Hand raised</Chip>}
        <Chip tone="stage" icon="users">{state.participants.length}</Chip>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-3.5 px-3.5">
        <Stage state={state} onStopShare={() => session.setSharing(false)} />
        <AnimatePresence mode="wait">
          {panel === 'notes' && <NotesPanel key="n" state={state} onClose={() => setPanel(null)} onStart={() => session.startNotes('full')} />}
          {panel === 'people' && <PeoplePanel key="p" state={state} onClose={() => setPanel(null)} />}
          {panel === 'chat' && <ChatPanel key="c" state={state} session={session} onClose={() => setPanel(null)} />}
        </AnimatePresence>
      </div>
      <Controls state={state} session={session} panel={panel} setPanel={setPanel} unread={unread} onLeave={leave} leaving={leaving} />
      <Notices state={state} session={session} />
      <AnimatePresence>{ready && <ReadyCard state={state} session={session} name={me?.person.name ?? 'You'} onClose={() => setReady(false)} />}</AnimatePresence>
    </motion.div>
  );
}

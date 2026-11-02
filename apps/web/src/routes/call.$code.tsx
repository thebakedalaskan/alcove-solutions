import { clock, type CallSession } from '@alcove/api';
import { Chip, Icon, RecDot, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Controls } from '~/features/call/Controls';
import { useMedia } from '~/features/call/DevicePreview';
import { LocalMedia, NotesRecorder } from '~/features/call/media';
import { Notices, ReadyCard } from '~/features/call/Overlays';
import { ChatPanel, NotesPanel, PeoplePanel, type Panel } from '~/features/call/SidePanel';
import { Stage } from '~/features/call/Stage';
import { selfIn, sessions, useLive } from '~/lib/live';

export const Route = createFileRoute('/call/$code')({ component: Call });

function Call() {
  const { code } = Route.useParams();
  const active = sessions.call;
  if (!active || active.code !== code) return <Navigate to="/join/$code" params={{ code }} replace />;
  return <InCall session={active.session} media={sessions.media ?? new LocalMedia()} />;
}

function InCall({ session, media }: { session: CallSession; media: LocalMedia }) {
  const state = useLive(session);
  const m = useMedia(media);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = selfIn(state);
  const [panel, setPanel] = useState<Panel | null>(state.notes.status !== 'off' ? 'notes' : null);
  const [ready, setReady] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const seenChat = useRef(state.chat.length);
  if (panel === 'chat') seenChat.current = state.chat.length;
  const unread = Math.max(0, state.chat.length - seenChat.current);

  /* Media comes from pre-join; start it here if the page was opened directly. */
  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start({ mic: me?.mic ?? true, cam: me?.cam ?? true });
  }, [media, me?.mic, me?.cam]);

  /* The recorder follows the server's notes state. */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), (msg) => setUploadError(msg));
  const micTrack = m.camera?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const r = recorder.current;
    if (!r) return;
    if (state.notes.status === 'on' && micTrack) r.start(micTrack, state.notes.recording.segment);
    else if (state.notes.status === 'paused') r.pause();
    else if (state.notes.status === 'off') r.stop();
  }, [state.notes.status, state.notes.recording.segment, micTrack]);

  const share = async () => {
    if (media.getSnapshot().screen) { media.stopScreen(); session.setSharing(false); return; }
    const title = await media.shareScreen(() => session.setSharing(false));
    if (title) session.setSharing(true, title);
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest('input,textarea')) || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const s = media.getSnapshot();
      if (k === 'm') { media.setMic(!s.mic); session.setMic(!s.mic); }
      if (k === 'v') { void media.setCam(!s.cam); session.setCam(!s.cam); }
      if (k === 'c') setPanel((p) => (p === 'chat' ? null : 'chat'));
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [session, media]);

  const leave = async () => {
    setLeaving(true);
    try {
      await recorder.current?.flush();
      const r = await session.leave();
      sessions.call = null;
      media.stop(); sessions.media = null;
      void qc.invalidateQueries();
      if (r.pendingNoteId) await navigate({ to: '/writing/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
      else await navigate({ to: '/ended', search: { title: state.title, minutes: Math.max(1, Math.round(r.duration / 60)), code: state.code }, replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t leave the call cleanly. Try again.', 'x');
      setLeaving(false);
    }
  };

  const st = state.notes.status;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
      className="dark fixed inset-0 z-20 grid grid-rows-[auto_1fr_auto] bg-stage text-stage-ink [color-scheme:dark] [--avatar-ring:#161411]">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <b className="text-[15px] font-semibold">{state.title}</b>
        <span className="font-mono text-[13.5px] text-stage-mute tabular">{clock(state.elapsed)}</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-live"><Icon name="lock" className="size-3.5" />Private</span>
        <div className="flex-1" />
        {st !== 'off' && <Chip tone="stage-rec">{st === 'paused' ? <><Icon name="pause" className="size-3.5" />Notes paused</> : <><RecDot />Recording for notes</>}</Chip>}
        {me?.hand && <Chip tone="stage" icon="hand">Hand raised</Chip>}
        <Chip tone="stage" icon="users">{state.participants.length}</Chip>
      </div>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-3.5 px-3.5">
        <Stage state={state} media={media} onStopShare={() => { media.stopScreen(); session.setSharing(false); }} />
        <AnimatePresence mode="wait">
          {panel === 'notes' && <NotesPanel key="n" state={state} media={media} uploadError={uploadError} onClose={() => setPanel(null)} onStart={() => session.startNotes('full')} />}
          {panel === 'people' && <PeoplePanel key="p" state={state} onClose={() => setPanel(null)} />}
          {panel === 'chat' && <ChatPanel key="c" state={state} session={session} onClose={() => setPanel(null)} />}
        </AnimatePresence>
      </div>
      <Controls state={state} session={session} media={media} panel={panel} setPanel={setPanel} unread={unread} onLeave={leave} leaving={leaving} onShare={() => void share()} />
      <Notices state={state} session={session} />
      <AnimatePresence>{ready && !m.screen && <ReadyCard state={state} name={me?.person.name ?? 'You'} onClose={() => setReady(false)} />}</AnimatePresence>
      {m.error && <p className="pointer-events-none fixed bottom-24 right-6 z-[6] m-0 max-w-[320px] rounded-xl bg-[#1E1B17] px-3.5 py-2.5 text-[13px] text-rec-ink shadow-float">{m.error}</p>}
    </motion.div>
  );
}

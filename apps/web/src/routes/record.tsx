import { clock, errorMessage, type RoomRecording } from '@alcove/api';
import { Button, Chip, Icon, IconButton, RecDot, Spinner, cn, useTheme, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useMedia } from '~/features/call/DevicePreview';
import { LocalMedia, NotesRecorder } from '~/features/call/media';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { sessions, useLive } from '~/lib/live';

export const Route = createFileRoute('/record')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: RecordPage
});

function RecordPage() {
  const [media] = useState(() => new LocalMedia());
  const [rec, setRec] = useState<RoomRecording | null>(sessions.recording);
  const toast = useToast();
  useEffect(() => {
    void media.start({ mic: true, cam: false });
    if (sessions.recording) return () => media.stop();
    let cancelled = false;
    void api.recordings.start('Untitled recording').then((r) => {
      if (cancelled) { void r.discard(); return; }
      sessions.recording = r; setRec(r);
    }, (e: unknown) => toast(errorMessage(e), 'x'));
    return () => { cancelled = true; media.stop(); };
  }, [media, toast]);
  if (!rec) return <main className="grid min-h-screen place-items-center"><Spinner /></main>;
  return <Recorder rec={rec} media={media} />;
}

const BARS = 56;
function Recorder({ rec, media }: { rec: RoomRecording; media: LocalMedia }) {
  const s = useLive(rec);
  const m = useMedia(media);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { resolved, toggle } = useTheme();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [bars, setBars] = useState<number[]>(Array(BARS).fill(0.06));
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => rec.appendAudio(p), (msg) => toast(msg, 'x'));

  /* Live waveform from the real microphone level. */
  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 90) {
        last = t;
        const l = s.status === 'recording' ? media.level() : 0;
        setBars((prev) => [...prev.slice(1), Math.max(0.06, Math.min(1, l * 1.6))]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, s.status]);

  const mic = m.camera?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const r = recorder.current;
    if (!r || !mic) return;
    if (s.status === 'recording') r.start(mic, 0);
    if (s.status === 'paused') r.pause();
  }, [s.status, mic]);

  const stop = async () => {
    setBusy(true);
    try {
      await recorder.current?.flush();
      const r = await rec.stop(); sessions.recording = null; void qc.invalidateQueries();
      await navigate({ to: '/writing/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
    } catch (e) { toast(errorMessage(e), 'x'); setBusy(false); }
  };
  const discard = async () => { recorder.current?.stop(); await rec.discard(); sessions.recording = null; await navigate({ to: '/home' }); };
  const paused = s.status === 'paused';
  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-20 grid grid-cols-[minmax(0,1fr)_400px] bg-canvas max-[900px]:grid-cols-1">
      <div className="relative flex flex-col items-center justify-center gap-[22px] p-6">
        <div className="absolute inset-x-5 top-4 flex items-center"><Button variant="ghost" size="sm" icon="x" onClick={discard}>Discard</Button><div className="flex-1" /><IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} /></div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => rec.rename(title)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Recording title"
          className="w-[min(560px,100%)] rounded-[10px] border-0 bg-transparent px-2.5 py-1 text-center font-display text-[32px] font-bold tracking-[-.03em] outline-none hover:bg-well focus:bg-well" />
        <Chip tone="rec">{paused ? <><Icon name="pause" className="size-3.5" />Paused</> : <><RecDot />Recording in the room</>}</Chip>
        <div className="flex h-40 w-[min(560px,100%)] items-center gap-1" aria-hidden>
          {bars.map((v, i) => <i key={i} className={cn('h-full flex-1 rounded transition-[transform,background-color] duration-100 ease-linear', paused ? 'bg-hair-2' : 'bg-ink')} style={{ transform: `scaleY(${v})` }} />)}
        </div>
        <div className="font-mono text-[56px] font-semibold leading-none tracking-[-.03em] tabular">{clock(s.elapsed)}</div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" icon={paused ? 'play' : 'pause'} onClick={() => (paused ? rec.resume() : rec.pause())}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="lg" icon="notes" loading={busy} onClick={stop}>Stop and save</Button>
        </div>
        {m.error && <p className="m-0 text-[13px] text-bad">{m.error}</p>}
        <p className="m-0 flex max-w-[46ch] items-start gap-2 text-center text-[13px] text-ink-3"><Icon name="lock" className="mt-0.5 size-[15px]" />Audio is recorded in 5-second pieces, each encrypted with this recording’s own key before it’s stored. Only you can play it back.</p>
      </div>
      <aside className="flex min-h-0 flex-col gap-4 bg-card p-[22px] shadow-[inset_1px_0_0_var(--hair)] max-[900px]:hidden">
        <div className="flex items-center justify-between"><b className="text-base">This recording</b><Chip icon="lock">Only you</Chip></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]"><b className="block font-mono text-2xl font-semibold tabular">{clock(s.recording.seconds)}</b><span className="text-[13px] text-ink-3">saved</span></div>
          <div className="rounded-2xl bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]"><b className="block font-mono text-2xl font-semibold tabular">{s.recording.pieces}</b><span className="text-[13px] text-ink-3">encrypted pieces</span></div>
        </div>
        <p className="m-0 text-sm text-ink-2">When you stop, the recording is queued for the notes service. It isn’t connected in this build yet, so you’ll be able to play the recording back from your notes.</p>
      </aside>
    </motion.main>
  );
}

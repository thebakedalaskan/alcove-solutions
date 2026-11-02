import { clock, type RoomRecording } from '@alcove/api';
import { Button, Chip, Icon, IconButton, RecDot, Spinner, cn, useTheme } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { sessions, useLive } from '~/lib/live';

export const Route = createFileRoute('/record')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: RecordPage
});

function RecordPage() {
  const [rec, setRec] = useState<RoomRecording | null>(sessions.recording);
  useEffect(() => {
    if (sessions.recording) return;
    let cancelled = false;
    void api.recordings.start('Untitled recording').then((r) => { if (cancelled) { void r.discard(); return; } sessions.recording = r; setRec(r); });
    return () => { cancelled = true; };
  }, []);
  if (!rec) return <main className="grid min-h-screen place-items-center"><Spinner /></main>;
  return <Recorder rec={rec} />;
}

const BARS = 56;
function Recorder({ rec }: { rec: RoomRecording }) {
  const s = useLive(rec);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { resolved, toggle } = useTheme();
  const [busy, setBusy] = useState(false);
  const phase = useRef(0);
  const [bars, setBars] = useState<number[]>(Array(BARS).fill(0.06));
  useEffect(() => {
    phase.current += 0.35;
    setBars((prev) => prev.map((_, i) => {
      if (s.status !== 'recording') return 0.06;
      const env = Math.sin((i / BARS) * Math.PI);
      return Math.max(0.06, env * s.level * (0.4 + 0.6 * Math.abs(Math.sin(phase.current + i * 0.45))));
    }));
  }, [s.level, s.status]);
  const lines = useRef<HTMLDivElement>(null);
  useEffect(() => { lines.current?.scrollTo({ top: lines.current.scrollHeight, behavior: 'smooth' }); }, [s.transcript.length]);
  const stop = async () => {
    setBusy(true);
    const r = await rec.stop(); sessions.recording = null; void qc.invalidateQueries();
    await navigate({ to: '/writing/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
  };
  const discard = async () => { await rec.discard(); sessions.recording = null; await navigate({ to: '/home' }); };
  const paused = s.status === 'paused';
  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-20 grid grid-cols-[minmax(0,1fr)_420px] bg-canvas max-[900px]:grid-cols-1">
      <div className="relative flex flex-col items-center justify-center gap-[22px] p-6">
        <div className="absolute inset-x-5 top-4 flex items-center"><Button variant="ghost" size="sm" icon="x" onClick={discard}>Discard</Button><div className="flex-1" /><IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} /></div>
        <input value={s.title} onChange={(e) => rec.rename(e.target.value)} aria-label="Recording title"
          className="w-[min(560px,100%)] rounded-[10px] border-0 bg-transparent px-2.5 py-1 text-center font-display text-[32px] font-bold tracking-[-.03em] outline-none hover:bg-well focus:bg-well" />
        <Chip tone="rec">{paused ? <><Icon name="pause" className="size-3.5" />Paused</> : <><RecDot />Recording in the room</>}</Chip>
        <div className="flex h-40 w-[min(560px,100%)] items-center gap-1" aria-hidden>
          {bars.map((v, i) => <i key={i} className={cn('h-full flex-1 rounded transition-[transform,background-color] duration-100 ease-linear', paused ? 'bg-hair-2' : 'bg-ink')} style={{ transform: `scaleY(${v})` }} />)}
        </div>
        <div className="font-mono text-[56px] font-semibold leading-none tracking-[-.03em] tabular">{clock(s.elapsed)}</div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" icon={paused ? 'play' : 'pause'} onClick={() => (paused ? rec.resume() : rec.pause())}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="lg" icon="notes" loading={busy} onClick={stop}>Stop and write notes</Button>
        </div>
        <p className="m-0 flex max-w-[46ch] items-start gap-2 text-center text-[13px] text-ink-3"><Icon name="lock" className="mt-0.5 size-[15px]" />Audio is encrypted on this device in 5-second pieces and transcribed inside the sealed server. Only you can read the result.</p>
      </div>
      <aside className="flex min-h-0 flex-col bg-card shadow-[inset_1px_0_0_var(--hair)] max-[900px]:hidden">
        <div className="flex items-center justify-between px-[22px] pb-2 pt-5"><b className="text-base">Transcript</b><Chip icon="lock">Only you</Chip></div>
        <div ref={lines} className="flex flex-1 flex-col gap-3.5 overflow-auto px-[22px] pb-[22px] pt-2">
          {s.transcript.length === 0 && <span className="flex items-center gap-2.5 text-[13.5px] text-ink-3"><Icon name="wave" className="size-4 animate-recpulse" />Listening…</span>}
          {s.transcript.map((l) => (
            <motion.div key={l.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <b className="text-[12.5px] font-semibold text-ink-3">{l.speaker.name}<small className="ml-1.5 font-mono">{clock(l.at)}</small></b>
              <p className="m-0 mt-0.5 text-[14.5px] leading-[1.45]">{l.text}</p>
            </motion.div>
          ))}
        </div>
      </aside>
    </motion.main>
  );
}

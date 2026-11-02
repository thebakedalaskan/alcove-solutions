import type { NoteProgress } from '@alcove/api';
import { CheckDraw, Mark, cn } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';

export const Route = createFileRoute('/writing/$noteId')({ component: Writing });

function Writing() {
  const { noteId } = Route.useParams();
  const [p, setP] = useState<NoteProgress | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    let live = true;
    void (async () => {
      for await (const step of api.notes.progress(noteId)) {
        if (!live) return;
        setP(step);
        if (step.ready) {
          await qc.invalidateQueries({ queryKey: ['notes'] });
          setTimeout(() => { if (live) void navigate({ to: '/notes/$noteId', params: { noteId }, replace: true }); }, 900);
        }
      }
    })();
    return () => { live = false; };
  }, [noteId, navigate, qc]);
  const done = p?.steps.filter((s) => s.done).length ?? 0;
  const total = p?.steps.length ?? 5;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex w-full max-w-[520px] flex-col items-center gap-4 text-center">
        <Mark size={48} className="[&_.mark-flame]:animate-[recpulse_2.4s_ease-in-out_infinite]" />
        <h1 className="text-[40px]">Writing your notes</h1>
        <p className="m-0 text-ink-3">{p?.title ?? ' '}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-sm bg-well"><motion.i className="block h-full rounded-sm bg-ink" animate={{ width: `${(done / total) * 100}%` }} transition={{ duration: 0.5 }} /></div>
        <div className="flex w-full flex-col gap-2.5 rounded-[18px] bg-card p-4 text-left shadow-[inset_0_0_0_1px_var(--hair)]">
          {(p?.steps ?? []).map((s) => (
            <div key={s.label} className={cn('flex items-center gap-2.5 text-[14.5px] transition-colors duration-300', s.done ? 'text-ink' : 'text-ink-3')}>
              <span className={cn('grid size-5 place-items-center rounded-full text-white transition-[background-color,box-shadow] duration-300', s.done ? 'bg-ok' : 'shadow-[inset_0_0_0_1.5px_var(--hair-2)]')}><CheckDraw done={s.done} className="size-3" /></span>{s.label}
            </div>
          ))}
        </div>
        <p className="m-0 text-[13px] text-ink-3">You can leave this page. The notes will be waiting on your home screen.</p>
      </motion.div>
    </main>
  );
}

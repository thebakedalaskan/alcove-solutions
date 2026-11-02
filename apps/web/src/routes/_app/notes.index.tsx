import type { NoteKind } from '@alcove/api';
import { AvatarStack, Button, Card, Chip, EmptyNotesArt, EmptyState, Icon, Segmented, cn } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useDeferredValue, useState } from 'react';
import { useStartInstant } from '~/features/shell/NewCallMenu';
import { q } from '~/lib/queries';
import { dayLabel, hm } from '~/lib/time';

export const Route = createFileRoute('/_app/notes/')({
  loader: ({ context: { queryClient: qc } }) => qc.ensureQueryData(q.notes()),
  component: Library
});

function Library() {
  const [kind, setKind] = useState<'all' | NoteKind>('all');
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const { data: all = [] } = useQuery(q.notes());
  const { data: notes = [] } = useQuery(q.notes(kind === 'all' ? undefined : kind, deferred || undefined));
  const start = useStartInstant();
  const navigate = useNavigate();
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 pb-6 pt-1.5">
        <h1 className="mr-auto text-[44px] leading-none">Notes</h1>
        <label className="flex h-[42px] w-[320px] items-center gap-2 rounded-xl bg-card px-3.5 shadow-[inset_0_0_0_1px_var(--hair-2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink)]">
          <Icon name="search" className="text-ink-3" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search notes and transcripts" aria-label="Search notes" className="flex-1 border-0 bg-transparent text-[14.5px] outline-none" />
        </label>
        <Segmented label="Filter" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'call', label: 'Calls' }, { value: 'room', label: 'In the room' }]} />
      </header>
      {all.length === 0 ? (
        <Card className="py-16">
          <EmptyState art={<EmptyNotesArt />} title="Your notes will live here"
            actions={<><Button icon="cam" onClick={() => void start()}>Start a call</Button><Button variant="secondary" icon="room" onClick={() => navigate({ to: '/record' })}>Record in the room</Button></>}>
            Turn notes on in a call, or record a conversation in the room. Each one gets a summary, decisions, action items and, if you keep it, the transcript.
          </EmptyState>
        </Card>
      ) : notes.length === 0 ? (
        <EmptyState art={<EmptyNotesArt />} title="No notes match">Try another word, or clear the filter.</EmptyState>
      ) : (
        <div className="mb-7 grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {notes.map((n, i) => {
            const big = i === 0 && !deferred && kind === 'all';
            return (
              <motion.div key={n.id} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: i * 0.05, ease: [0.22, 0.8, 0.24, 1] }} className={cn(big && 'col-span-2 max-[960px]:col-span-1')}>
                <Link to="/notes/$noteId" params={{ noteId: n.id }}
                  className={cn('flex h-full min-h-[220px] flex-col gap-2.5 rounded-[22px] p-5 transition-[transform,box-shadow] duration-300 ease-soft hover:-translate-y-[3px]',
                    big ? 'bg-ink text-canvas shadow-lift [--avatar-ring:var(--ink)]' : 'bg-card shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)] hover:shadow-[inset_0_0_0_1px_var(--hair-2),var(--sh-lift)]')}>
                  <span className="flex items-center justify-between">
                    <Chip icon={n.kind === 'room' ? 'room' : 'cam'} className={big ? 'bg-canvas/15 text-canvas' : ''}>{n.kind === 'room' ? 'In the room' : 'Call'}</Chip>
                    <span className={cn('text-[13px]', big ? 'text-canvas/70' : 'text-ink-3')}>{dayLabel(n.startedAt)} · {hm(n.startedAt)}</span>
                  </span>
                  <b className={cn('font-display font-bold leading-[1.15] tracking-[-.02em]', big ? 'text-[30px]' : 'text-[21px]')}>{n.title}</b>
                  <p className={cn('m-0 flex-1 text-[14.5px]', big ? 'text-canvas/70' : 'text-ink-2')}>{n.excerpt}</p>
                  <span className="flex items-center gap-2.5 text-[13px]"><AvatarStack people={n.people} size={24} /><span>{n.openActions} of {n.totalActions} actions open</span><span className="flex-1" /><span className={big ? 'text-canvas/70' : 'text-ink-3'}>{n.keep === 'full' ? 'Transcript kept' : 'Notes only'}</span></span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
      <p className="flex items-center justify-center gap-1.5 text-[13px] text-ink-3"><Icon name="lock" className="size-3.5" />Search runs inside the sealed server. Alcove can’t see what you search for.</p>
    </>
  );
}

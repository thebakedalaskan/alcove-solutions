import { clock, type Note } from '@alcove/api';
import { Avatar, AvatarStack, Button, CheckDraw, Chip, Icon, cn, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { AskBar } from '~/features/notes/AskBar';
import { api } from '~/lib/api';
import { q, useActionDone } from '~/lib/queries';
import { fullDate, hm, minutesLabel } from '~/lib/time';

export const Route = createFileRoute('/_app/notes/$noteId')({
  loader: ({ context: { queryClient: qc }, params }) => qc.ensureQueryData(q.note(params.noteId)),
  component: NotePage,
  errorComponent: () => <p className="py-20 text-center text-ink-2">Those notes don’t exist, or you don’t have access. <Link to="/notes" className="font-semibold underline">All notes</Link></p>
});

const reveal = { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-40px' }, transition: { duration: 0.5, ease: [0.22, 0.8, 0.24, 1] as const } };
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <motion.section id={id} {...reveal} className="scroll-mt-6"><h2 className="mb-3 text-[22px] tracking-[-.02em]">{title}</h2>{children}</motion.section>;
}

function NotePage() {
  const { noteId } = Route.useParams();
  const { data: n } = useQuery(q.note(noteId));
  const [hl, setHl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const lines = useRef<Record<string, HTMLDivElement | null>>({});
  if (!n) return null;
  const cite = (at: number) => {
    if (!n.transcript) { toast('The transcript wasn’t kept for this call', 'trash'); return; }
    const line = [...n.transcript].reverse().find((l) => l.at <= at) ?? n.transcript[0];
    if (!line) return;
    lines.current[line.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHl(line.id); setTimeout(() => setHl(null), 2400);
  };
  const toc: { id: string; label: string }[] = n.status !== 'ready' ? [] : [{ id: 'sum', label: 'Summary' }, { id: 'dec', label: 'Decisions' }, { id: 'act', label: 'Action items' }, { id: 'chap', label: 'Chapters' }, ...(n.screens.length ? [{ id: 'scr', label: 'On screen' }] : []), { id: 'tr', label: 'Transcript' }];
  return (
    <>
      <div className="flex items-center gap-2.5">
        <Link to="/notes" className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-semibold text-ink-2 hover:bg-well hover:text-ink"><Icon name="left" className="size-4" />All notes</Link>
        <div className="flex-1" />

      </div>
      <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-10 pb-[170px] max-[960px]:grid-cols-1">
        <nav aria-label="Sections" className="sticky top-5 flex flex-col gap-0.5 self-start pt-[110px] max-[960px]:hidden">
          {toc.map(({ id, label }) => <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })} className="rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-ink-3 hover:bg-well hover:text-ink">{label}</button>)}
        </nav>
        <article className="flex max-w-[720px] flex-col gap-7">
          <motion.header {...reveal} className="flex flex-col gap-3.5 pt-10">
            <div className="flex flex-wrap gap-2"><Chip icon={n.kind === 'room' ? 'room' : 'cam'}>{n.kind === 'room' ? 'Recorded in the room' : 'Call'}</Chip><Chip icon="notes">{n.keep === 'full' ? 'Notes + transcript' : 'Notes only'}</Chip></div>
            <h1 className="text-[clamp(36px,4.4vw,52px)] leading-[1.02]">{n.title}</h1>
            <div className="flex flex-wrap items-center gap-3.5 text-sm text-ink-2">
              <span>{fullDate(n.startedAt)} · {hm(n.startedAt)}</span><i className="size-[3px] rounded-full bg-ink-3" /><span>{minutesLabel(n.duration)}</span><i className="size-[3px] rounded-full bg-ink-3" />
              <AvatarStack people={n.people} size={26} /><span>{n.kind === 'room' || n.audience === 'host' ? 'Only you can read these' : 'For everyone in the call'}</span>
            </div>
          </motion.header>
          {n.status !== 'ready' && (
            <motion.section {...reveal} className="flex flex-col gap-4 rounded-[22px] bg-card px-6 py-[22px] shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)]">
              <div className="flex items-start gap-3"><Icon name="clock" className="mt-0.5 text-lamp-ink" /><div><b className="block text-[16px]">{n.status === 'recording' ? 'Still recording' : 'Waiting for the notes service'}</b><span className="text-[14.5px] text-ink-2">The recording is saved and encrypted. The summary, decisions and action items will appear here once the notes service is connected.</span></div></div>
              {n.audio.length > 0 && (
                <div className="flex flex-col gap-2.5 border-t border-hair pt-4">
                  {n.audio.map((a) => (
                    <div key={a.index} className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-semibold text-ink-3">{n.audio.length > 1 ? `Part ${a.index + 1} · ` : ''}{clock(a.seconds)} · {a.pieces} encrypted {a.pieces === 1 ? 'piece' : 'pieces'}</span>
                      <audio controls preload="none" src={api.notes.audioUrl(n.id, a.index)} className="w-full" />
                    </div>
                  ))}
                </div>
              )}
              {n.audio.length === 0 && <span className="text-[13.5px] text-ink-3">No audio was recorded.</span>}
            </motion.section>
          )}
          {n.summary && <motion.section id="sum" {...reveal} className="scroll-mt-6 rounded-[22px] bg-card px-6 py-[22px] text-[17px] leading-[1.6] shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)]"><p className="m-0">{n.summary}</p></motion.section>}
          {n.status === 'ready' && <>
          <Section id="dec" title="Decisions">{n.decisions.map((d) => <div key={d} className="flex gap-3 border-b border-hair py-3 text-[15.5px]"><Icon name="okCircle" className="mt-0.5 size-[19px] text-ok" /><span>{d}</span></div>)}</Section>
          <Section id="act" title="Action items"><Actions note={n} /></Section>
          <Section id="chap" title="Chapters">
            {n.chapters.map((c) => (
              <button key={c.at} type="button" onClick={() => cite(c.at)} className="grid w-full grid-cols-[64px_1fr] gap-3.5 border-b border-hair py-3 text-left transition-colors hover:bg-raised">
                <span className="pt-0.5 font-mono text-[13px] text-ink-3">{clock(c.at)}</span><span><b className="block text-[15.5px]">{c.title}</b><span className="text-sm text-ink-2">{c.summary}</span></span>
              </button>
            ))}
          </Section>
          {n.screens.length > 0 && (
            <Section id="scr" title="On screen">
              {n.screens.map((s) => (
                <div key={s.at} className="grid grid-cols-[160px_1fr] items-center gap-4 rounded-[18px] bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--hair)]">
                  <div className="flex aspect-[16/10] flex-col gap-1.5 rounded-[10px] bg-[#F7F4EE] p-3 shadow-[inset_0_0_0_1px_var(--hair)]">
                    <small className="text-[9px] font-bold text-[#6F675D]">{s.title}</small>
                    {[[30, 0], [60, 25], [22, 72]].map(([w, ml]) => <i key={w} className="h-1.5 rounded-sm bg-lamp" style={{ width: `${w}%`, marginLeft: `${ml}%` }} />)}
                  </div>
                  <div><b>{s.title}</b><p className="m-0 mt-1 text-sm text-ink-3">Shared by {s.by} at <button type="button" onClick={() => cite(s.at)} className="font-mono underline">{clock(s.at)}</button></p><p className="m-0 mt-1 text-[14.5px]">{s.text}</p></div>
                </div>
              ))}
            </Section>
          )}
          <Section id="tr" title="Transcript">
            {n.transcript ? n.transcript.map((l) => (
              <div key={l.id} ref={(el) => { lines.current[l.id] = el; }} className={cn('-ml-2.5 grid grid-cols-[64px_1fr] gap-3.5 rounded-xl py-2.5 pl-2.5 transition-colors duration-[1500ms]', hl === l.id && 'bg-lamp-soft duration-200')}>
                <span className="pt-[3px] font-mono text-[13px] text-ink-3">{clock(l.at)}</span>
                <div className="flex gap-2.5">{l.speaker.person && <Avatar person={l.speaker.person} size={24} ring={false} className="mt-0.5" />}<div><b className="text-[13px]">{l.speaker.name}</b><p className="m-0 mt-0.5 text-[15.5px] leading-[1.55]">{l.text}</p></div></div>
              </div>
            )) : (
              <div className="flex gap-3 rounded-2xl bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]">
                <Icon name="trash" className="mt-0.5 text-ink-3" />
                <div><b className="block">Not kept for this call</b><span className="text-sm text-ink-2">The transcript was deleted inside the sealed server as soon as these notes were written. Times above still point to when things were said.</span></div>
              </div>
            )}
          </Section>
          </>}
          <div className="flex justify-end pt-2"><Button size="sm" variant="danger-ghost" icon="trash" onClick={async () => { if (!confirmDelete) { setConfirmDelete(true); return; } await api.notes.delete(n.id); await qc.invalidateQueries({ queryKey: ['notes'] }); await navigate({ to: '/notes' }); toast('Notes and recording deleted', 'trash'); }}>{confirmDelete ? 'Delete for good' : 'Delete notes and recording'}</Button></div>
        </article>
      </div>
      {n.status === 'ready' && <AskBar note={n} onCite={cite} />}
    </>
  );
}

function Actions({ note }: { note: Note }) {
  const done = useActionDone();
  const [local, setLocal] = useState<Record<string, boolean>>(() => Object.fromEntries(note.actions.map((a) => [a.id, a.done])));
  return (
    <>
      {note.actions.map((a) => {
        const d = !!local[a.id];
        return (
          <button key={a.id} type="button" aria-pressed={d} onClick={() => { setLocal((s) => ({ ...s, [a.id]: !d })); done.mutate({ noteId: note.id, actionId: a.id, done: !d }); }}
            className="grid w-full grid-cols-[22px_1fr_auto] items-center gap-3 border-b border-hair px-1 py-3 text-left text-[15.5px]">
            <span className={cn('grid size-5 place-items-center rounded-md text-white transition-[background-color,box-shadow] duration-200', d ? 'bg-ok' : 'shadow-[inset_0_0_0_1.6px_var(--hair-2)]')}><CheckDraw done={d} /></span>
            <span className={cn('transition-colors', d && 'text-ink-3 line-through')}>{a.text}</span>
            <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[13px] text-ink-3">{a.owner.person && <Avatar person={a.owner.person} size={22} ring={false} />}{a.owner.name.split(' ')[0]}{a.due && ` · ${a.due}`}</span>
          </button>
        );
      })}
    </>
  );
}

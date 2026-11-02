import { clock, firstName, type Meeting, type NoteSummary, type OpenAction, type SetupStep, type WeekStats } from '@alcove/api';
import {
  AvatarStack, Button, Card, CardHeader, CallArt, Chip, CountUp, EmptyCalendarArt, EmptyNotesArt, EmptyState, FeatureCard, Icon,
  InviteArt, Ring, RoomArt, Stagger, StaggerItem, cn, useToast, CheckDraw
} from '@alcove/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { NotesChip } from '~/features/meetings/NotesChip';
import { useDialogs } from '~/features/shell/dialogs';
import { useStartInstant } from '~/features/shell/NewCallMenu';
import { useActionDone } from '~/lib/queries';
import { dayLabel, hm, isToday, minutesLabel } from '~/lib/time';

export const Bento = ({ children }: { children: ReactNode }) => <Stagger className="mt-7 grid grid-cols-12 gap-4">{children}</Stagger>;
export const Cell = ({ span, children }: { span: 4 | 5 | 6 | 7 | 12; children: ReactNode }) => (
  <StaggerItem className={cn({ 4: 'col-span-4 max-[1180px]:col-span-6', 5: 'col-span-5 max-[1180px]:col-span-12', 6: 'col-span-6', 7: 'col-span-7 max-[1180px]:col-span-12', 12: 'col-span-12' }[span], 'max-[720px]:col-span-12 [&>*]:h-full')}>{children}</StaggerItem>
);

/* ---------- the next call ---------- */
function useCountdown(iso: string) {
  const [s, setS] = useState(() => Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  useEffect(() => { const id = setInterval(() => setS(Math.round((new Date(iso).getTime() - Date.now()) / 1000)), 1000); return () => clearInterval(id); }, [iso]);
  return s;
}
export function NextCallCard({ meeting }: { meeting: Meeting }) {
  const secs = useCountdown(meeting.startsAt);
  const soon = secs > 0 && secs < 3600;
  const navigate = useNavigate();
  const toast = useToast();
  const going = meeting.guests.filter((g) => g.rsvp === 'yes');
  return (
    <FeatureCard>
      <div className="flex items-start justify-between">
        <Chip tone="stage" className="bg-white/10 text-[#F5F1EA]">{secs <= 0 ? 'Happening now' : isToday(meeting.startsAt) ? 'Up next' : dayLabel(meeting.startsAt)}</Chip>
        <span className="text-right">
          <span className="block font-mono text-[34px] font-semibold leading-none tracking-[-.03em] tabular">{secs <= 0 ? 'Now' : soon ? clock(secs) : hm(meeting.startsAt)}</span>
          {soon && <small className="text-xs text-[#A8A096]">until it starts</small>}
        </span>
      </div>
      <h2 className="mt-[18px] text-[40px] tracking-[-.035em]">{meeting.title}</h2>
      <p className="m-0 text-[15px] text-[#BEB5A9]">{hm(meeting.startsAt)} – {hm(meeting.endsAt)} · {meeting.isHost ? 'You’re hosting' : `Hosted by ${meeting.host.name}`}</p>
      <div className="mt-1 flex items-center gap-2.5 text-sm text-[#BEB5A9]">{going.length > 0 && <AvatarStack people={going.map((g) => g.person ?? { name: g.email })} size={34} />}<span>{going.length} going</span></div>
      <div className="mt-auto flex items-center gap-2.5 pt-[18px]">
        <NotesChip notes={meeting.notes} className={meeting.notes === 'full' || meeting.notes === 'notes' ? 'text-live' : 'text-[#BEB5A9]'} />
        <div className="flex-1" />
        <Button variant="glass" icon="link" onClick={async () => { try { await navigator.clipboard.writeText(`https://alcove.app/${meeting.code}`); } catch { /* blocked */ } toast('Link copied'); }}>Copy link</Button>
        <Button variant="lamp" size="lg" icon="cam" onClick={() => navigate({ to: '/join/$code', params: { code: meeting.code } })}>{meeting.isHost ? 'Start' : 'Join'}</Button>
      </div>
    </FeatureCard>
  );
}

/* ---------- week ---------- */
export function WeekCard({ meetings }: { meetings: Meeting[] }) {
  const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
  const d0 = 8 * 60, span = 11 * 60; let n = 0;
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <Card>
      <CardHeader title="This week" action={<Link to="/meetings" className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-semibold text-ink-2 hover:bg-well hover:text-ink">{meetings.length} calls <Icon name="right" className="size-4" /></Link>} />
      <div className="grid h-[206px] grid-cols-5 gap-2">
        {days.map((d, di) => {
          const evs = meetings.filter((m) => new Date(m.startsAt).toDateString() === d.toDateString());
          return (
            <div key={di} className="flex min-w-0 flex-col gap-2">
              <span className="flex items-center gap-1.5 text-[12.5px]">
                <b className={cn('font-semibold', di === 0 ? 'text-ink' : 'text-ink-2')}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</b>
                <span className={cn('font-mono text-ink-3', di === 0 && 'rounded-md bg-ink px-1.5 text-canvas')}>{d.getDate()}</span>
              </span>
              <div className={cn('relative flex-1 overflow-hidden rounded-xl bg-raised bg-[repeating-linear-gradient(to_bottom,transparent_0_calc(20%-1px),var(--hair)_calc(20%-1px)_20%)]', di === 0 ? 'shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'shadow-[inset_0_0_0_1px_var(--hair)]')}>
                {di === 0 && nowMin > d0 && nowMin < d0 + span && <i className="absolute inset-x-0 z-[2] h-0.5 bg-rec before:absolute before:-left-[3px] before:-top-[3px] before:size-2 before:rounded-full before:bg-rec" style={{ top: `${((nowMin - d0) / span) * 100}%` }} />}
                {evs.map((m) => {
                  const s = new Date(m.startsAt); const mins = s.getHours() * 60 + s.getMinutes(); const len = (new Date(m.endsAt).getTime() - s.getTime()) / 60_000;
                  const on = m.notes === 'full' || m.notes === 'notes'; const past = m.status === 'ended';
                  return (
                    <Link key={m.id} to="/meetings" search={{ id: m.id }} title={`${hm(m.startsAt)} ${m.title}`}
                      className={cn('absolute inset-x-1 min-h-[7px] origin-top rounded-md animate-[growdown_.55s_var(--ease-soft)_both] transition-transform hover:scale-x-[1.04]', on ? 'bg-ink' : 'bg-hair-2', past && 'opacity-30')}
                      style={{ top: `${Math.max(0, ((mins - d0) / span) * 100)}%`, height: `${(len / span) * 100}%`, animationDelay: `${0.25 + n++ * 0.06}s` }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-ink-3"><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-ink" />Notes on</span><span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-hair-2" />No notes</span></div>
    </Card>
  );
}

/* ---------- lists ---------- */
export function LaterToday({ meetings }: { meetings: Meeting[] }) {
  return (
    <Card>
      <CardHeader title="Later today" />
      {meetings.length ? meetings.map((m) => (
        <Link key={m.id} to="/meetings" search={{ id: m.id }} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-well">
          <span className="font-mono text-[13.5px] font-semibold">{hm(m.startsAt)}</span>
          <span className="min-w-0"><b className="mb-0.5 block truncate text-[14.5px] font-semibold">{m.title}</b><NotesChip notes={m.notes} /></span>
          <AvatarStack people={m.guests.map((g) => g.person ?? { name: g.email })} size={22} max={3} />
        </Link>
      )) : <p className="text-sm text-ink-3">Nothing else today.</p>}
    </Card>
  );
}

export function ActionItemsCard({ items }: { items: OpenAction[] }) {
  const done = useActionDone();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const open = items.filter((a) => !local[a.id]).length;
  return (
    <Card>
      <CardHeader title="Your action items" action={<span className="text-[13px] text-ink-3">{open} open</span>} />
      {items.length === 0 && <p className="text-sm text-ink-3">Nothing on your plate. Action items from your notes show up here.</p>}
      {items.map((a) => {
        const isDone = !!local[a.id];
        return (
          <div key={a.id} className="grid grid-cols-[22px_1fr_auto] items-center gap-3 border-b border-hair px-0.5 py-[11px] last:border-0">
            <button type="button" aria-label={isDone ? 'Mark not done' : 'Mark done'} aria-pressed={isDone}
              onClick={() => { const v = !isDone; setLocal((s) => ({ ...s, [a.id]: v })); done.mutate({ noteId: a.noteId, actionId: a.id, done: v }); if (v) toast('Done. Marked off in the notes too.'); }}
              className={cn('grid size-5 place-items-center rounded-md text-white transition-[background-color,box-shadow,transform] duration-200 active:scale-[.85]', isDone ? 'bg-ok' : 'shadow-[inset_0_0_0_1.6px_var(--hair-2)] hover:shadow-[inset_0_0_0_1.6px_var(--ink-3)]')}>
              <CheckDraw done={isDone} />
            </button>
            <span className="flex min-w-0 flex-col">
              <span className={cn('relative w-fit text-[15px] transition-colors duration-300', isDone && 'text-ink-3')}>
                {a.text}<motion.i className="absolute left-0 top-[55%] h-px bg-ink-3" initial={false} animate={{ width: isDone ? '100%' : '0%' }} transition={{ duration: 0.35 }} />
              </span>
              <Link to="/notes/$noteId" params={{ noteId: a.noteId }} className="w-fit text-[12.5px] text-ink-3 hover:text-ink hover:underline">{a.noteTitle}</Link>
            </span>
            <span className="text-[13px] text-ink-3">{a.due}</span>
          </div>
        );
      })}
    </Card>
  );
}

export function TimeInCalls({ stats }: { stats: WeekStats }) {
  const total = stats.minutesByDay.reduce((s, d) => s + d.minutes, 0);
  const max = Math.max(1, ...stats.minutesByDay.map((d) => d.minutes));
  return (
    <Card>
      <CardHeader title="Time in calls" action={<span className="text-[13px] text-ink-3">Last 7 days</span>} />
      <span className="font-mono text-[38px] font-semibold tracking-[-.04em]"><CountUp value={total} format={(v) => `${Math.floor(v / 60)}h ${Math.round(v % 60)}m`} /></span>
      <div className="my-3 flex h-[86px] gap-2">
        {stats.minutesByDay.map((d, i) => (
          <span key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <i title={`${d.minutes} min`} className={cn('w-full origin-bottom rounded-md animate-[growup_.6s_var(--ease-soft)_both]', i === 6 ? 'bg-lamp' : 'bg-hair-2')} style={{ height: `${Math.max(4, (d.minutes / max) * 100)}%`, animationDelay: `${0.3 + i * 0.05}s` }} />
            <em className="text-[11px] font-semibold not-italic text-ink-3">{new Date(d.date).toLocaleDateString('en-US', { weekday: 'narrow' })}</em>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3.5 border-t border-hair pt-3 text-[13px] text-ink-3">
        <span><b className="text-ink">{stats.notes}</b> notes</span><span><b className="text-ink">{stats.actionItems}</b> action items</span><span><b className="text-ink">{stats.roomRecordings}</b> in the room</span>
      </div>
    </Card>
  );
}

export function NoteCard({ n, compact }: { n: NoteSummary; compact?: boolean }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId: n.id }}
      className={cn('flex flex-col gap-2.5 rounded-[20px] bg-card p-[18px] text-left shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)] transition-[transform,box-shadow] duration-300 ease-soft hover:-translate-y-[3px] hover:shadow-[inset_0_0_0_1px_var(--hair-2),var(--sh-lift)]', !compact && 'min-h-[196px]')}>
      <span className="flex items-center justify-between"><Chip icon={n.kind === 'room' ? 'room' : 'cam'}>{n.kind === 'room' ? 'In the room' : 'Call'}</Chip><span className="text-[13px] text-ink-3">{dayLabel(n.startedAt)} · {hm(n.startedAt)}</span></span>
      <b className="font-display text-[19px] font-bold leading-[1.15] tracking-[-.02em]">{n.title}</b>
      <p className="m-0 line-clamp-3 flex-1 text-sm text-ink-2">{n.excerpt}</p>
      {!compact && <span className="flex items-center gap-2.5 text-[13px]"><AvatarStack people={n.people} size={24} /><span>{n.totalActions} action items</span><span className="flex-1" /><span className="text-ink-3">{minutesLabel(n.duration)}</span></span>}
    </Link>
  );
}

/* ---------- first day ---------- */
export function GiftCard({ credits, perMinute }: { credits: number; perMinute: number }) {
  return (
    <FeatureCard>
      <Chip className="self-start bg-[rgba(255,166,43,.18)] text-[#FFC56E]" icon="check">Added to your account</Chip>
      <div className="mt-[22px] font-mono text-[clamp(64px,7vw,96px)] font-semibold leading-none tracking-[-.05em]"><CountUp value={credits} /></div>
      <p className="m-0 max-w-[42ch] text-base text-[#BEB5A9]"><b className="text-[#F5F1EA]">free credits.</b> That’s about {Math.round((credits / perMinute / 60) * 2) / 2} hours of notes. Calls themselves are always free, with or without notes.</p>
    </FeatureCard>
  );
}

export function SetupCard({ steps, onAddPasskey }: { steps: SetupStep[]; onAddPasskey: () => void }) {
  const start = useStartInstant();
  const done = steps.filter((s) => s.done).length;
  return (
    <Card>
      <CardHeader title="Getting set up" action={<Ring value={done / steps.length} label={`${done}/${steps.length}`} />} />
      {steps.map((s, i) => (
        <div key={s.id} className="grid min-h-[46px] grid-cols-[22px_1fr_auto] items-center gap-3 border-t border-hair text-[14.5px]">
          <motion.span initial={false} animate={{ scale: s.done ? [0.8, 1.1, 1] : 1 }} transition={{ delay: 0.2 + i * 0.08 }}
            className={cn('grid size-[22px] place-items-center rounded-full text-white', s.done ? 'bg-ok' : 'shadow-[inset_0_0_0_1.6px_var(--hair-2)]')}><CheckDraw done={s.done} className="size-[13px]" /></motion.span>
          <span className={s.done ? 'text-ink-2' : ''}>{s.label}</span>
          {!s.done && s.id === 'first-call' && <Button size="sm" variant="secondary" onClick={() => void start()}>Start</Button>}
          {!s.done && s.id === 'second-passkey' && <Button size="sm" variant="secondary" onClick={onAddPasskey}>Add</Button>}
          {!s.done && s.id === 'calendar' && <Link to="/account" className="text-sm font-semibold underline">Connect</Link>}
        </div>
      ))}
    </Card>
  );
}

export function StartTiles() {
  const start = useStartInstant();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const tiles = [
    { art: <CallArt />, title: 'Start a call now', body: 'Opens full screen with a link to share', go: () => void start() },
    { art: <InviteArt />, title: 'Schedule a call', body: 'Invites go out from your calendar', go: () => dialogs.open({ kind: 'schedule' }) },
    { art: <RoomArt />, title: 'Record in the room', body: 'Notes from a conversation around you', go: () => void navigate({ to: '/record' }) }
  ];
  return (
    <div className="grid grid-cols-3 gap-3.5 max-[1000px]:grid-cols-1">
      {tiles.map((t) => (
        <button key={t.title} type="button" onClick={t.go} className="group flex flex-col gap-1 rounded-[22px] bg-card px-3.5 pb-[18px] pt-3.5 text-left shadow-[inset_0_0_0_1px_var(--hair),var(--sh-soft)] transition-[transform,box-shadow] duration-300 ease-soft hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_var(--hair-2),var(--sh-lift)]">
          {t.art}<b className="mt-3 px-1 text-base">{t.title}</b><span className="px-1 text-[13.5px] text-ink-3">{t.body}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyToday() {
  const dialogs = useDialogs();
  return <Card><EmptyState art={<EmptyCalendarArt />} title="Nothing scheduled yet" actions={<Button size="sm" variant="secondary" icon="cal" onClick={() => dialogs.open({ kind: 'schedule' })}>Schedule a call</Button>}>Calls you schedule, and calls you’re invited to from your calendar, show up here.</EmptyState></Card>;
}
export function EmptyNotes() {
  const start = useStartInstant();
  return <Card><EmptyState art={<EmptyNotesArt />} title="No notes yet" actions={<Button size="sm" variant="secondary" icon="cam" onClick={() => void start()}>Start a call</Button>}>After a call with notes on, the summary, decisions and action items appear here. Only people in the call can read them.</EmptyState></Card>;
}
export function ComingUp({ meetings }: { meetings: Meeting[] }) {
  return (
    <Card>
      <CardHeader title="Coming up" action={<Link to="/meetings" className="text-[13.5px] font-semibold text-ink-2 hover:text-ink">Meetings</Link>} />
      {meetings.slice(0, 4).map((m) => (
        <Link key={m.id} to="/meetings" search={{ id: m.id }} className="grid animate-pop grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl px-2 py-2.5 hover:bg-well">
          <span className="font-mono text-[13.5px] font-semibold">{hm(m.startsAt)}</span>
          <span className="min-w-0"><b className="block truncate text-[14.5px] font-semibold">{m.title}</b><span className="text-[12.5px] text-ink-3">{dayLabel(m.startsAt)} · {m.guests.length} invited</span></span>
          <NotesChip notes={m.notes} iconOnly />
        </Link>
      ))}
    </Card>
  );
}
export { firstName };

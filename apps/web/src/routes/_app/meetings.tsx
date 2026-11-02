import type { Meeting, MeetingNotesSetting } from '@alcove/api';
import { NOTES_LABEL } from '@alcove/api';
import {
  Avatar, Button, Card, Chip, EmptyCalendarArt, EmptyNotesArt, EmptyState, Icon, OptionCard, Segmented, cn, useToast
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { InvitePreview } from '~/features/meetings/InvitePreview';
import { NOTE_OPTIONS, NotesChip } from '~/features/meetings/NotesChip';
import { useDialogs } from '~/features/shell/dialogs';
import { useStartInstant } from '~/features/shell/NewCallMenu';
import { api } from '~/lib/api';
import { q, useCancelMeeting, useMeetingNotes } from '~/lib/queries';
import { dayLabel, fullDate, hm, isToday, minutesBetween, minutesLabel } from '~/lib/time';

export const Route = createFileRoute('/_app/meetings')({
  validateSearch: (s: Record<string, unknown>): { id?: string | undefined; view?: 'upcoming' | 'past' | undefined } => {
    const id = s['id'];
    return { id: typeof id === 'string' ? id : undefined, view: s['view'] === 'past' ? 'past' : undefined };
  },
  loader: ({ context: { queryClient: qc } }) => Promise.all([qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.past())]),
  component: Meetings
});

function Meetings() {
  const { id, view = 'upcoming' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const dialogs = useDialogs();
  const { data: upcoming = [] } = useQuery(q.upcoming());
  const { data: past = [] } = useQuery(q.past());
  const selected = upcoming.find((m) => m.id === id) ?? upcoming[0];
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 pb-6 pt-1.5">
        <h1 className="text-[44px] leading-none">Meetings</h1>
        <div className="flex-1" />
        <Segmented label="Show" value={view} onChange={(v) => navigate({ search: (s) => ({ ...s, view: v === 'past' ? 'past' : undefined }) })} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
        <Button icon="plus" onClick={() => dialogs.open({ kind: 'schedule' })}>Schedule</Button>
      </header>
      {view === 'past' ? <PastList meetings={past} /> : upcoming.length === 0 ? <NoMeetings /> : (
        <div className="grid grid-cols-[380px_minmax(0,1fr)] items-start gap-7 max-[960px]:grid-cols-1">
          <List meetings={upcoming} selectedId={selected?.id} />
          <AnimatePresence mode="wait">
            {selected && (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
                <Detail meeting={selected} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function List({ meetings, selectedId }: { meetings: Meeting[]; selectedId: string | undefined }) {
  const groups = meetings.reduce<Record<string, Meeting[]>>((g, m) => { (g[dayLabel(m.startsAt)] ??= []).push(m); return g; }, {});
  return (
    <div className="sticky top-4 flex flex-col gap-1">
      {Object.entries(groups).map(([day, ms], gi) => (
        <div key={day}>
          <p className={cn('mx-2 mb-1.5 flex justify-between text-[13px] font-bold', gi ? 'mt-3.5' : 'mt-0')}>{day}<span className="font-medium text-ink-3">{ms[0] ? fullDate(ms[0].startsAt) : ''}</span></p>
          {ms.map((m) => (
            <Link key={m.id} to="/meetings" search={{ id: m.id }}
              className={cn('relative grid grid-cols-[50px_1fr_auto] items-center gap-3 rounded-[14px] p-3 transition-colors', selectedId === m.id ? 'text-ink' : 'hover:bg-well')}>
              {selectedId === m.id && <motion.span layoutId="meeting-sel" className="absolute inset-0 rounded-[14px] bg-card shadow-[inset_0_0_0_1px_var(--hair),var(--sh-lift)]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="relative font-mono text-[13.5px] font-semibold">{hm(m.startsAt)}</span>
              <span className="relative min-w-0"><b className="block truncate text-[14.5px] font-semibold">{m.title}</b><span className="text-[12.5px] text-ink-3">{m.isHost ? 'You’re hosting' : `Hosted by ${m.host.name.split(' ')[0]}`} · {m.guests.length} {m.guests.length === 1 ? 'guest' : 'guests'}</span></span>
              <NotesChip notes={m.notes} iconOnly className="relative" />
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

const RSVP = { yes: ['ok', 'Going'], pending: ['neutral', 'Invited'], no: ['bad', 'Declined'] } as const;

function Detail({ meeting: m }: { meeting: Meeting }) {
  const [confirm, setConfirm] = useState(false);
  const dialogs = useDialogs();
  const setNotes = useMeetingNotes();
  const cancel = useCancelMeeting();
  const toast = useToast();
  const navigate = useNavigate();
  const mins = minutesBetween(m.startsAt, m.endsAt);
  const going = m.guests.filter((g) => g.rsvp === 'yes').length;
  const change = async (notes: MeetingNotesSetting) => { await setNotes.mutateAsync({ id: m.id, notes }); toast(`Notes set to “${NOTES_LABEL[notes]}”. Guests see it on their invite.`, 'notes'); };
  return (
    <Card className="flex flex-col gap-[22px] rounded-[26px] p-[26px]">
      <div className="flex flex-col gap-2">
        <span className="text-[13.5px] font-semibold text-ink-3">{dayLabel(m.startsAt)} · {fullDate(m.startsAt)}</span>
        <h2 className="text-[34px] tracking-[-.03em]">{m.title}</h2>
        <span className="inline-flex items-center gap-2 text-[14.5px] text-ink-2"><Icon name="clock" className="size-4" />{hm(m.startsAt)} – {hm(m.endsAt)} · {m.isHost ? 'You’re hosting' : `Hosted by ${m.host.name}`}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {isToday(m.startsAt) && <Button icon="cam" onClick={() => navigate({ to: '/join/$code', params: { code: m.code } })}>{m.isHost ? 'Start' : 'Join'}</Button>}
          <Button variant="secondary" icon="link" onClick={async () => { try { await navigator.clipboard.writeText(`https://alcove.app/${m.code}`); } catch { /* blocked */ } toast('Link copied'); }}>Copy link</Button>
          {m.isHost && <><Button variant="secondary" onClick={() => dialogs.open({ kind: 'schedule', meetingId: m.id })}>Edit</Button><Button variant="danger-ghost" onClick={() => setConfirm(true)}>Cancel</Button></>}
        </div>
        <AnimatePresence>
          {confirm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-1 flex flex-wrap items-center gap-2.5 rounded-[14px] bg-bad-soft px-3.5 py-3 text-sm">
                <Icon name="mail" /><span className="min-w-[200px] flex-1">Cancel this call for everyone? Guests get an email and it leaves their calendars.</span>
                <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Keep it</Button>
                <Button size="sm" variant="danger" loading={cancel.isPending} onClick={async () => { await cancel.mutateAsync(m.id); toast(`${m.title} cancelled. ${m.guests.length} ${m.guests.length === 1 ? 'guest was' : 'guests were'} emailed.`, 'mail'); setConfirm(false); }}>Cancel call</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        <div className="rounded-[18px] bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]">
          <h4 className="mb-3 text-[13px] font-bold">Notes</h4>
          {m.isHost ? (
            <>
              <div role="radiogroup" aria-label="Notes" className="mb-2.5 grid grid-cols-2 gap-2">
                {[...NOTE_OPTIONS].sort((a, b) => (a.value === 'ask' ? -1 : b.value === 'ask' ? 1 : 0)).map((o) => <OptionCard key={o.value} selected={m.notes === o.value} onSelect={() => change(o.value)} title={o.title} />)}
              </div>
              <span className="text-[13px] text-ink-3">{m.notes === 'off' ? 'Nothing is recorded. You can still start notes from inside the call.' : m.notes === 'ask' ? 'You’ll pick when you join. Guests see your choice.' : `Up to ${(mins * 25).toLocaleString('en-US')} credits. Guests see this before they join.`}</span>
            </>
          ) : (
            <div className="flex gap-3 rounded-2xl bg-card p-4 shadow-[inset_0_0_0_1px_var(--hair)]"><Icon name="notes" className="text-ink-2" /><div><b className="block text-[14.5px]">{NOTES_LABEL[m.notes]}</b><span className="text-[13.5px] text-ink-3">Set by the host. You’ll get the notes after the call.</span></div></div>
          )}
        </div>
        <div className="rounded-[18px] bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]">
          <h4 className="mb-3 flex justify-between text-[13px] font-bold">Guests <span className="font-medium text-ink-3">{going} of {m.guests.length} going</span></h4>
          {m.guests.map((g) => (
            <div key={g.email} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 border-b border-hair py-2 last:border-0">
              <Avatar person={g.person ?? { name: g.email }} size={30} ring={false} />
              <span className="min-w-0"><b className="block truncate text-sm">{g.person?.name ?? g.email}</b><span className="text-[12.5px] text-ink-3">{g.person ? g.email : 'Guest · no account'}</span></span>
              <Chip tone={RSVP[g.rsvp][0]}>{RSVP[g.rsvp][1]}</Chip>
              {m.isHost && g.rsvp === 'pending' ? <Button size="sm" variant="ghost" onClick={async () => { await api.meetings.resendInvite(m.id, g.email); toast(`Invite sent again to ${g.person?.name ?? g.email}`, 'mail'); }}>Resend</Button> : <span />}
            </div>
          ))}
          {m.isHost && <Button size="sm" variant="ghost" icon="plus" className="mt-1" onClick={() => dialogs.open({ kind: 'schedule', meetingId: m.id })}>Add guests</Button>}
        </div>
      </div>
      <div className="rounded-[18px] bg-raised p-4 shadow-[inset_0_0_0_1px_var(--hair)]">
        <h4 className="mb-3 text-[13px] font-bold">{m.isHost ? 'What guests received' : 'Your invite'}</h4>
        <div className="max-w-[460px]"><InvitePreview title={m.title} when={`${fullDate(m.startsAt)} · ${hm(m.startsAt)} – ${hm(m.endsAt)}`} code={m.code} notes={m.notes} /></div>
      </div>
    </Card>
  );
}

function PastList({ meetings }: { meetings: Meeting[] }) {
  if (!meetings.length) return <Card className="py-16"><EmptyState art={<EmptyNotesArt />} title="No past calls">Calls you’ve had will be listed here, with their notes if notes were on.</EmptyState></Card>;
  return (
    <Card className="p-0">
      {meetings.map((m) => (
        <div key={m.id} className="grid grid-cols-[120px_1fr_190px_120px] items-center gap-4 border-b border-hair px-5 py-4 last:border-0 max-[760px]:grid-cols-[1fr_auto]">
          <span className="font-mono text-[12.5px] leading-normal text-ink-3 max-[760px]:hidden">{dayLabel(m.startsAt)}<br />{hm(m.startsAt)}</span>
          <span><b className="block text-[15.5px]">{m.title}</b><span className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3">{m.guests.length} guests · {minutesLabel(m.duration ?? 0)}</span></span>
          <span className="max-[760px]:hidden"><NotesChip notes={m.noteId ? m.notes : 'off'} /></span>
          {m.noteId ? <Link to="/notes/$noteId" params={{ noteId: m.noteId }} className="inline-flex h-[34px] items-center justify-center rounded-[10px] bg-card px-3 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--hair-2)]">Open notes</Link> : <span />}
        </div>
      ))}
    </Card>
  );
}

function NoMeetings() {
  const dialogs = useDialogs();
  const start = useStartInstant();
  const { data: s } = useQuery(q.session());
  return (
    <Card className="py-16">
      <EmptyState art={<EmptyCalendarArt />} title="No meetings yet"
        actions={<><Button icon="cal" onClick={() => dialogs.open({ kind: 'schedule' })}>Schedule a call</Button><Button variant="secondary" icon="cam" onClick={() => void start()}>Start one now</Button></>}>
        Schedule a call and the invite goes out from {s?.user.email ?? 'your calendar'}. Calls you’re invited to show up here too.
      </EmptyState>
    </Card>
  );
}

/*
 * ⋯ on a call in the list: what you can do with it, by what it is. Your call: Change the time, Copy link, Cancel this call.
 * Your call in a series: Change the time, Skip this one, Copy link, Cancel the series. An invitation: Propose another time,
 * Copy link. A calendar meeting: Open in Google Calendar, and Use Alcove instead for one you run. A call waiting for a guest:
 * Copy the link for them, Cancel this call. A call that happened: Meet again, Share the notes. Change the time, Propose
 * another time and Meet again open the scheduler (which asks, in a series, whether it's this call or this and later ones);
 * cancelling and who to share with ask in the same popover, in place of the items.
 */
import { errorMessage, type CalendarEvent, type Group, type Meeting, type NoteSummary, type Person } from '@alcove/api';
import { Button, RowAsk, RowMenu, useToast, type IconName, type RowMenuItem } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { useOpenScheduling } from '~/features/calls/scheduling/search';
import { cancelNote, cancelledLine, pickerName, restoredLine, shortTime } from '~/features/calls/scheduling/words';
import { useMoveToAlcove } from '~/features/calls/scheduling/moveToAlcove';
import { Picker } from '~/features/team/PeoplePicker';
import { log } from '~/lib/log';
import { callName, listNames, sameEmail } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { useShareNote } from '~/features/notes/sharing/queries';
import type { Ahead } from './ahead';
import { useCancelCall, useScheduleCall } from './queries';
import { othersIn } from './said';

const clog = log.child({ component: 'calls' });

/** What a call's menu asks before it does something. */
type Step = 'cancel' | 'skip' | 'end-series';

/** A row's menu: whether it's open, and the question it's on. Closing it goes back to the items. */
function useMenu<S extends string>() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<S | null>(null);
  return { open, step, setStep, close: () => { setOpen(false); setStep(null); }, onOpenChange: (o: boolean) => { setOpen(o); if (!o) setStep(null); } };
}

/** What's done and who hears, as one line, with Undo while there's one to give. */
function useSay() {
  const toast = useToast();
  return {
    said: (text: string, icon: IconName, undo?: (() => void) | undefined) => toast(text, { icon, ms: 6000, action: undo ? { label: 'Undo', onClick: undo } : undefined }),
    failed: (e: unknown) => toast(errorMessage(e), { icon: 'x' })
  };
}

const minutesOf = (m: Meeting) => Math.max(5, Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000));

/**
 * Cancels one of your calls from its row, once it's been asked. In a series it's this call (Skip this one) or this and every
 * later one (Cancel the series). Undo schedules a single call again as it was, with a new link; one in a series can't rejoin it.
 */
function useCancelHere(m: Meeting) {
  const cancel = useCancelCall();
  const restore = useScheduleCall();
  const { said, failed } = useSay();
  const again = () => restore.mutateAsync({
    title: m.title, startsAt: m.startsAt, durationMinutes: minutesOf(m), guests: m.guests.map((g) => g.email), notes: m.notes, choices: m.choices, joinMuted: m.joinMuted,
    documents: m.documents.flatMap((d) => (d.name === null ? [] : [d.id]))
  }).then((next) => said(restoredLine(next), 'cal'), (e: unknown) => {
    clog.warn('scheduling a cancelled call again failed', { err: e, meetingId: m.id });
    failed(e);
  });
  return {
    pending: cancel.isPending,
    run: async (later: boolean, done: () => void) => {
      const series = !!m.repeat || !!m.seriesId;
      try {
        await cancel.mutateAsync({ id: m.id, code: m.code, scope: series ? (later ? 'following' : 'this') : undefined });
        done();
        said(cancelledLine(m, later), 'trash', !series && !m.offer ? () => void again() : undefined);
      } catch (e) { failed(e); }
    }
  };
}

/** The question before cancelling: what happens, then Keep it, which loses nothing, filled. */
function CancelAsk({ title, note, go, busy, keep, onGo }: { title: string; note: string; go: string; busy: boolean; keep: () => void; onGo: () => void }) {
  return (
    <RowAsk title={title} actions={<><Button variant="primary" size="sm" onClick={keep}>Keep it</Button><Button size="sm" loading={busy} onClick={onGo}>{go}</Button></>}>
      <span>{note}</span>
    </RowAsk>
  );
}

/** ⋯ on a call ahead: one of yours, one you're invited to, or a meeting on your calendar. */
export function AheadMenu({ a, now }: { a: Ahead; now: Date }) {
  return a.kind === 'event' ? <EventMenu e={a.event} /> : <CallMenu m={a.call} now={now} />;
}

/** A meeting on your calendar: open it there, or make one you run an Alcove call. */
function EventMenu({ e }: { e: CalendarEvent }) {
  const menu = useMenu<never>();
  const alcove = useMoveToAlcove();
  const items: RowMenuItem[] = [
    { id: 'google', label: 'Open in Google Calendar', icon: 'external', href: e.calendarUrl },
    ...(e.isOrganizer ? [{ id: 'alcove', label: 'Use Alcove instead', icon: 'video' as const, onSelect: () => { menu.close(); void alcove.move(e); } }] : [])
  ];
  return <RowMenu label={`More for ${e.title}`} open={menu.open} onOpenChange={menu.onOpenChange} items={items} />;
}

function CallMenu({ m, now }: { m: Meeting; now: Date }) {
  const menu = useMenu<Step>();
  const schedule = useOpenScheduling();
  const copy = useCopyLink();
  const cancel = useCancelHere(m);
  const series = !!m.repeat || !!m.seriesId;
  const link: RowMenuItem = { id: 'copy', label: 'Copy link', icon: 'link', onSelect: () => { menu.close(); copy(m.seriesCode ?? m.code); } };
  /* The scheduler moves your call, or asks its organizer to move one you're invited to. */
  const move = () => { menu.close(); schedule({ schedule: 'move', meeting: m.id }); };
  const changeable = m.isOrganizer && m.status === 'scheduled';
  const cancelling: RowMenuItem = { id: 'cancel', label: 'Cancel this call', icon: 'trash', tone: 'caution', separatorBefore: true, onSelect: () => menu.setStep('cancel') };
  const items: RowMenuItem[] = m.offer && m.isOrganizer ? [{ id: 'copy', label: `Copy the link for ${pickerName(m)}`, icon: 'link', onSelect: () => { menu.close(); copy(m.code); } }, cancelling]
    : !m.isOrganizer ? [...(m.offer || m.status !== 'scheduled' ? [] : [{ id: 'propose', label: 'Propose another time', icon: 'cal' as const, onSelect: move }]), link]
      : !changeable ? [link]
        : series ? [
          { id: 'move', label: 'Change the time', icon: 'cal', onSelect: move },
          { id: 'skip', label: 'Skip this one', icon: 'x', onSelect: () => menu.setStep('skip') },
          link,
          { id: 'end', label: 'Cancel the series', icon: 'trash', tone: 'caution', separatorBefore: true, onSelect: () => menu.setStep('end-series') }
        ]
          : [{ id: 'move', label: 'Change the time', icon: 'cal', onSelect: move }, link, cancelling];
  const keep = () => menu.setStep(null);
  const when = shortTime(new Date(m.startsAt), now);
  const steps: Record<Step, ReactNode> = {
    cancel: <CancelAsk title={`Cancel ${m.title}?`} note={cancelNote(m)} go="Cancel the call" busy={cancel.pending} keep={keep} onGo={() => void cancel.run(false, menu.close)} />,
    skip: <CancelAsk title="Skip this one?" note={`${m.title}, ${when}. ${cancelNote(m)}`} go="Skip it" busy={cancel.pending} keep={keep} onGo={() => void cancel.run(false, menu.close)} />,
    'end-series': <CancelAsk title="Cancel the series?" note={`This call, ${when}, and every later one. ${cancelNote(m, true)}`} go="Cancel the series" busy={cancel.pending} keep={keep} onGo={() => void cancel.run(true, menu.close)} />
  };
  return <RowMenu label={`More for ${m.title}`} open={menu.open} onOpenChange={menu.onOpenChange} items={items} step={menu.step ? steps[menu.step] : undefined} />;
}

/** "Product, Lena and Sam" */
const and = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** Sharing a call's notes from its row: people by name or address, or one of your groups. The call's page has links too. */
function ShareAsk({ n, onDone }: { n: NoteSummary; onDone: () => void }) {
  const share = useShareNote();
  const groups = useQuery(accountQueries.prefs()).data?.groups;
  const { said, failed } = useSay();
  const have = n.people.map((p) => p.email);
  const done = (people: Person[], group?: Group) => share.mutate({ id: n.id, emails: people.map((p) => p.email), group }, {
    onSuccess: (after) => {
      onDone();
      const fresh = after.recipients.filter((r) => !have.some((e) => sameEmail(r.person, { email: e }))).map((r) => r.person);
      if (!fresh.length) said('They have these notes already.', 'check');
      else said(`Shared with ${group ? and([group.name, ...people.map(callName)]) : listNames(fresh)}`, 'send');
    },
    onError: failed
  });
  return <Picker title="Share these notes" cta="Share" skip={have} groups={groups} note="They find them in Alcove when they sign in with that email." onDone={done} />;
}

/** ⋯ on a call that happened: Meet again, with the same people and name, and Share the notes. */
export function PastMenu({ n, me }: { n: NoteSummary; me: string | undefined }) {
  const menu = useMenu<'share'>();
  const schedule = useOpenScheduling();
  const others = othersIn(n.people, me);
  const items: RowMenuItem[] = [
    ...(n.kind === 'call' && others.length ? [{ id: 'again', label: 'Meet again', icon: 'cal' as const, onSelect: () => { menu.close(); schedule({ schedule: 'again', note: n.id }); } }] : []),
    ...(n.status === 'recording' ? [] : [{ id: 'share', label: 'Share the notes', icon: 'share' as const, onSelect: () => menu.setStep('share') }])
  ];
  if (!items.length) return null;
  return <RowMenu label={`More for ${n.title}`} open={menu.open} onOpenChange={menu.onOpenChange} items={items} step={menu.step === 'share' ? <ShareAsk n={n} onDone={menu.close} /> : undefined} wide={menu.step === 'share'} />;
}

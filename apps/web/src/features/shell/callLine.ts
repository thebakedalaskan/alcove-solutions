/*
 * One line that describes a call, as New call reads it: who is invited (and which names still need an
 * address), when it is, whether it has notes, and what Enter does with it: start it now, schedule it, or
 * save the changes to a call being changed. New call and Home's first-call card both use it.
 */
import { errorMessage, type Meeting, type NotesSetting, type Person } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { firstOf, isEmail, parseCall } from '~/lib/parse';
import { byEmail, listNames, sameEmail } from '~/lib/people';
import { q, useCancelCall, useScheduleCall, useStartNow, useUpdateCall } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';
import { freshCalls } from './context';

/** What cancelling a call does, said before it's done, and said once it's done. */
export const cancelNote = (m: Meeting) => (m.calendarUrl ? 'It comes off your calendar, and everyone invited is told.' : 'It comes off your calendar.');
export const cancelledLine = (m: Meeting) => (m.calendarUrl && m.guests.length ? 'Call cancelled. Everyone invited is told.' : 'Call cancelled.');

/** Someone on the line: a person (typed in the sentence, or picked), or a name that still needs an address. */
export type LineChip = { k: 'person'; person: Person; typed: boolean } | { k: 'needs'; name: string };

const minutesOf = (m: Meeting) => Math.max(5, Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000));
const invitations = (n: number) => (n > 1 ? 'get invitations' : 'gets an invitation');

export function useCallLine({ text, extra = [], notes = null, editing }: {
  text: string;
  /** People picked outside the sentence. */
  extra?: Person[] | undefined;
  /** Notes chosen outside the sentence; otherwise "no notes" in it, or the default. */
  notes?: NotesSetting | null | undefined;
  /** A scheduled call being changed: it keeps its time and length unless new ones are typed. */
  editing?: Meeting | undefined;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const prefs = useQuery(q.prefs()).data;
  const directory = useQuery(q.people('')).data ?? [];
  const schedule = useScheduleCall();
  const startNow = useStartNow();
  const cancel = useCancelCall();
  const update = useUpdateCall();

  const known = directory.map((s) => s.person);
  const parsed = parseCall(text, new Date(), known);
  const p = editing ? { ...parsed, when: { start: parsed.when?.start ?? new Date(editing.startsAt), minutes: parsed.duration ?? minutesOf(editing) } } : parsed;
  const notesOn: NotesSetting = notes ?? (p.notesOff ? 'off' : prefs?.notesDefault ?? 'on');
  const find = (email: string) => known.find((k) => k.email === email) ?? extra.find((k) => k.email === email) ?? byEmail(email);
  const chips: LineChip[] = [];
  for (const g of p.guests) {
    if (g.kind === 'name') chips.push({ k: 'needs', name: g.name });
    else if (!chips.some((c) => c.k === 'person' && c.person.email === g.email)) chips.push({ k: 'person', person: find(g.email), typed: true });
  }
  for (const e of extra) if (!chips.some((c) => c.k === 'person' && sameEmail(c.person, e))) chips.push({ k: 'person', person: e, typed: false });
  const people = chips.flatMap((c) => (c.k === 'person' ? [c.person] : []));
  const needs = chips.flatMap((c) => (c.k === 'needs' ? [c.name] : []));
  const busy = schedule.isPending || startNow.isPending || update.isPending;

  /* Sentences to try (`text` fills the line; `label` is the shorter way it's shown), with someone you know by name when there is one. */
  const named = known.find((k) => k.name && !isEmail(k.name));
  const review = named ? `Design review with ${firstOf(named.name)} tomorrow 3pm` : 'Design review tomorrow 3pm';
  const tries = [{ label: review, text: `${review} for 45 min` }, { label: 'Intro with jamie@harbourline.co Thursday 2pm', text: 'Intro with jamie@harbourline.co Thursday 2pm' }];

  /**
   * Does what the line says and says so; `done` runs once it has. A name without an address stops it
   * first: the answer names it, so the caller can ask for the address.
   */
  const submit = async (done: () => void): Promise<{ needs: string } | undefined> => {
    if (busy) return undefined;
    const first = needs[0];
    if (first) return { needs: first };
    const guests = people.map((g) => g.email);
    try {
      if (editing) {
        const { start, minutes } = p.when ?? { start: new Date(editing.startsAt), minutes: minutesOf(editing) };
        const m = await update.mutateAsync({ id: editing.id, input: { title: p.title || editing.title, startsAt: start.toISOString(), durationMinutes: minutes, guests, notes: notesOn } });
        done();
        toast(m.calendarUrl && m.guests.length ? `Saved. ${listNames(m.guests)} ${m.guests.length > 1 ? 'get' : 'gets'} the update.` : 'Saved.', { icon: 'cal' });
        return undefined;
      }
      if (!p.when) {
        const r = await startNow.mutateAsync({ ...(p.title ? { title: p.title } : {}), guests, notes: notesOn });
        done();
        await navigate({ to: '/join/$code', params: { code: r.code } });
        return undefined;
      }
      const { start, minutes } = p.when;
      const m = await schedule.mutateAsync({
        title: p.title || (people.length ? `Call with ${listNames(people)}` : 'New call'),
        startsAt: start.toISOString(), durationMinutes: minutes, guests, notes: notesOn
      });
      freshCalls.add(m.id);
      done();
      if (!people.length) void navigator.clipboard?.writeText(`${location.origin}/join/${m.code}`).catch(() => undefined);
      const where = m.calendarUrl ? 'your Google Calendar' : 'your calendar';
      const who = !people.length ? ' Link copied.' : m.calendarUrl ? ` ${listNames(people)} ${invitations(people.length)}.` : ` ${listNames(people)} ${people.length > 1 ? 'are' : 'is'} invited.`;
      toast(`On ${where} for ${shortDay(start)}, ${hm(start)}.${who}`, { icon: 'cal', ms: 4200, action: { label: 'Undo', onClick: () => cancel.mutate(m.id) } });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    }
    return undefined;
  };

  return { p, chips, people, needs, notesOn, busy, tries, submit };
}

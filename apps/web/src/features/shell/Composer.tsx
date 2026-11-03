/*
 * New call: one line. Describe the call ("Design review with Priya tomorrow 3pm for 45 min") and
 * what's understood turns into chips that can each be changed. Enter starts it now, or schedules it
 * when a day or a time was typed. The same line changes a scheduled call: it keeps its time unless a
 * new one is typed.
 */
import { NOTES_LABEL, errorMessage, type Meeting, type NotesSetting, type Person } from '@alcove/api';
import { Avatar, Button, ComposerLine, Icon, Popover, Sheet, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { dropFromSentence, firstOf, parseCall } from '~/lib/parse';
import { byEmail, callName, listNames, sameEmail } from '~/lib/people';
import { q, useCancelCall, useScheduleCall, useStartNow, useUpdateCall } from '~/lib/queries';
import { dayChoice, hm, shortDay } from '~/lib/time';
import { freshCalls } from './context';

export function Composer({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing?: Meeting | undefined }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={editing ? 'Change call' : 'New call'}>
      <Body key={editing?.id ?? 'new'} editing={editing} onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}
const minutesOf = (m: Meeting) => Math.max(5, Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000));
const invitations = (n: number) => (n > 1 ? 'get invitations' : 'gets an invitation');

type Chip =
  | { k: 'person'; person: Person; typed: boolean }
  | { k: 'needs'; name: string };

function Body({ onClose, editing }: { onClose: () => void; editing?: Meeting | undefined }) {
  const navigate = useNavigate();
  const toast = useToast();
  const prefs = useQuery(q.prefs()).data;
  const directory = useQuery(q.people('')).data ?? [];
  const schedule = useScheduleCall();
  const startNow = useStartNow();
  const cancel = useCancelCall();
  const update = useUpdateCall();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(editing?.title ?? '');
  const [extra, setExtra] = useState<Person[]>(editing?.guests ?? []);
  const [notes, setNotes] = useState<NotesSetting | null>(editing?.notes ?? null);
  /** Which popover is open: the invite picker, one for a name that needs an address, or the notes menu. */
  const [pop, setPop] = useState<string | null>(null);

  const known = directory.map((s) => s.person);
  const parsed = parseCall(text, new Date(), known);
  // A call being changed keeps its time and length unless new ones are typed.
  const p = editing ? { ...parsed, when: { start: parsed.when?.start ?? new Date(editing.startsAt), minutes: parsed.duration ?? minutesOf(editing) } } : parsed;
  const notesOn: NotesSetting = notes ?? (p.notesOff ? 'off' : prefs?.notesDefault ?? 'on');
  const find = (email: string) => known.find((k) => k.email === email) ?? extra.find((k) => k.email === email) ?? byEmail(email);
  const chips: Chip[] = [];
  for (const g of p.guests) {
    if (g.kind === 'name') chips.push({ k: 'needs', name: g.name });
    else if (!chips.some((c) => c.k === 'person' && c.person.email === g.email)) chips.push({ k: 'person', person: find(g.email), typed: true });
  }
  for (const e of extra) if (!chips.some((c) => c.k === 'person' && sameEmail(c.person, e))) chips.push({ k: 'person', person: e, typed: false });
  const people = chips.flatMap((c) => (c.k === 'person' ? [c.person] : []));
  const needs = chips.flatMap((c) => (c.k === 'needs' ? [c.name] : []));
  const busy = schedule.isPending || startNow.isPending || update.isPending;
  const focus = () => requestAnimationFrame(() => input.current?.focus());

  /* Take someone off the call: out of the picker's list, or out of the sentence. */
  const drop = (c: Chip) => {
    if (c.k === 'person' && !c.typed) { setExtra((x) => x.filter((e) => !sameEmail(e, c.person))); return; }
    const word = c.k === 'needs' ? c.name : c.person.name !== c.person.email && text.toLowerCase().includes(firstOf(c.person.name).toLowerCase()) ? firstOf(c.person.name) : c.person.email;
    setText((t) => dropFromSentence(t, word));
  };

  const submit = async () => {
    if (busy) return;
    const first = needs[0];
    if (first) { setPop(`needs:${first}`); return; }
    const guests = people.map((g) => g.email);
    try {
      if (editing) {
        const { start, minutes } = p.when ?? { start: new Date(editing.startsAt), minutes: minutesOf(editing) };
        const m = await update.mutateAsync({ id: editing.id, input: { title: p.title || editing.title, startsAt: start.toISOString(), durationMinutes: minutes, guests, notes: notesOn } });
        onClose();
        toast(m.calendarUrl && m.guests.length ? `Saved. ${listNames(m.guests)} ${m.guests.length > 1 ? 'get' : 'gets'} the update.` : 'Saved.', { icon: 'cal' });
        return;
      }
      if (!p.when) {
        const r = await startNow.mutateAsync({ ...(p.title ? { title: p.title } : {}), guests, notes: notesOn });
        onClose();
        await navigate({ to: '/join/$code', params: { code: r.code } });
        return;
      }
      const { start, minutes } = p.when;
      const m = await schedule.mutateAsync({
        title: p.title || (people.length ? `Call with ${listNames(people)}` : 'New call'),
        startsAt: start.toISOString(), durationMinutes: minutes, guests, notes: notesOn
      });
      freshCalls.add(m.id);
      onClose();
      if (!people.length) void navigator.clipboard?.writeText(`${location.origin}/join/${m.code}`).catch(() => undefined);
      const where = m.calendarUrl ? 'your Google Calendar' : 'your calendar';
      const who = !people.length ? ' Link copied.' : m.calendarUrl ? ` ${listNames(people)} ${invitations(people.length)}.` : ` ${listNames(people)} ${people.length > 1 ? 'are' : 'is'} invited.`;
      toast(`On ${where} for ${shortDay(start)}, ${hm(start)}.${who}`, { icon: 'cal', ms: 4200, action: { label: 'Undo', onClick: () => cancel.mutate(m.id) } });
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
    }
  };

  const hint = needs[0] ? { icon: 'mail' as const, text: `Add ${needs[0]}’s email to invite them` }
    : !people.length ? { icon: 'link' as const, text: 'Only you, so far. Add people by name or email.' }
      : notesOn === 'off' ? { icon: 'mail' as const, text: `${listNames(people)} ${people.length > 1 ? 'are' : 'is'} invited` }
        : { icon: 'send' as const, text: `Notes go to you and ${listNames(people)}` };
  const suggestion = known[0] ? firstOf(known[0].name) : null;
  const tries = [
    suggestion ? `Design review with ${suggestion} tomorrow 3pm for 45 min` : 'Design review tomorrow 3pm for 45 min',
    'Intro with jamie@harbourline.co Thursday 2pm'
  ];
  const whenHint = () => { focus(); toast('Type a day or a time, like “Thursday 2pm”.', { icon: 'cal', ms: 2600 }); };

  return (
    <>
      <ComposerLine icon="video" className="cmp-line">
        <input ref={input} className="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the call, or press Enter to start now"
          autoComplete="off" spellCheck={false} aria-label="Describe the call"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
      </ComposerLine>
      <div className="cmp-chips">
        {p.when ? (
          <>
            <button type="button" className="pchip" onClick={whenHint}><Icon name="cal" size={16} />{dayChoice(p.when.start)}</button>
            <button type="button" className="pchip" onClick={whenHint}><Icon name="clock" size={16} />{hm(p.when.start)} – {hm(new Date(p.when.start.getTime() + p.when.minutes * 60_000))}</button>
          </>
        ) : <button type="button" className="pchip soft" onClick={whenHint}><Icon name="video" size={16} />Starts now</button>}
        {chips.map((c) => c.k === 'person' ? (
          <button key={c.person.email} type="button" className="pchip" title={c.person.email} aria-label={`Remove ${c.person.name}`} onClick={() => { drop(c); focus(); }}>
            <Avatar person={c.person} size={20} />{callName(c.person)}
          </button>
        ) : (
          <PeoplePicker key={`needs:${c.name}`} open={pop === `needs:${c.name}`} onOpenChange={(o) => setPop(o ? `needs:${c.name}` : null)}
            anchor={<button type="button" className="pchip needs"><Icon name="mail" size={15} />{c.name}<span className="q">add email</span></button>}
            title={`Who’s ${c.name}?`} cta="Add" query={c.name} skip={people.map((x) => x.email)} note={notesOn === 'on' ? 'They get the notes after the call.' : 'They’re added to the call.'}
            onDone={(picked) => { drop(c); setExtra((x) => [...x, ...picked.filter((n) => !x.some((e) => sameEmail(e, n)))]); focus(); }} />
        ))}
        <PeoplePicker open={pop === 'add'} onOpenChange={(o) => setPop(o ? 'add' : null)}
          anchor={<button type="button" className="pchip add"><Icon name="addUser" size={16} />{people.length ? 'Invite' : 'Invite people'}</button>}
          title="Invite people" cta="Add" skip={people.map((x) => x.email)} note={notesOn === 'on' ? 'They get the notes after the call.' : 'They’re added to the call.'}
          onDone={(picked) => { setExtra((x) => [...x, ...picked.filter((n) => !x.some((e) => sameEmail(e, n)))]); focus(); }} />
        <Popover open={pop === 'notes'} onOpenChange={(o) => setPop(o ? 'notes' : null)} label="Notes for this call" className="w-[330px]"
          anchor={<button type="button" className={cn('pchip', notesOn === 'on' && 'on-notes')}><Icon name={notesOn === 'on' ? 'pen' : 'x'} size={16} />{NOTES_LABEL[notesOn]}<Icon name="down" size={14} /></button>}>
          {([['on', 'pen', 'Notes on', 'Everyone invited gets them afterwards. Alcove can’t read them.'], ['off', 'x', 'No notes', 'Nothing is recorded. You can turn them on during the call.']] as const).map(([v, ic, t, d]) => (
            <button key={v} type="button" className={cn('ac-pop-item', notesOn === v && 'sel')} onClick={() => { setNotes(v); setPop(null); focus(); }}>
              <Icon name={ic} size={18} /><span><b>{t}</b><small>{d}</small></span>
            </button>
          ))}
        </Popover>
        {!editing && !text.trim() && !extra.length && (
          <span className="try">Try {tries.map((t) => <button key={t} type="button" onClick={() => { setText(t); focus(); }}>{t.replace(/ for 45 min$/, '')}</button>)}</span>
        )}
      </div>
      <div className="cmp-foot">
        {editing ? (
          <Popover open={pop === 'cancel'} onOpenChange={(o) => setPop(o ? 'cancel' : null)} label="Cancel this call" side="top" className="w-[300px]"
            anchor={<Button variant="quiet" icon="trash">Cancel call</Button>}>
            <button type="button" className="ac-pop-item is-caution" onClick={() => {
              setPop(null);
              cancel.mutate(editing.id, {
                onSuccess: () => { onClose(); toast(editing.calendarUrl && editing.guests.length ? 'Call cancelled. Everyone invited is told.' : 'Call cancelled.', { icon: 'trash' }); },
                onError: (e) => toast(errorMessage(e), { icon: 'x' })
              });
            }}>
              <Icon name="trash" size={18} /><span><b>Cancel this call</b><small>{editing.calendarUrl ? 'It comes off your calendar, and everyone invited is told.' : 'It comes off your calendar.'}</small></span>
            </button>
          </Popover>
        ) : <Button variant="quiet" icon="room" onClick={() => { onClose(); void navigate({ to: '/record' }); }}>Record in the room</Button>}
        <span className="hint"><Icon name={hint.icon} size={15} /><span>{hint.text}</span></span>
        <Button variant="primary" icon={p.when || editing ? undefined : 'video'} kb="↵" loading={busy} onClick={() => void submit()}>{editing ? 'Save changes' : p.when ? 'Schedule' : 'Start now'}</Button>
      </div>
    </>
  );
}

import { errorMessage, type NotesAudience, type NotesMode } from '@alcove/api';
import { Button, Dialog, Field, Icon, Input, OptionCard, Segmented, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { q, useSaveMeeting } from '~/lib/queries';
import { minutesBetween } from '~/lib/time';
import { NOTE_MODE_OPTIONS } from './NotesChip';

const DAYS = Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
const dayAt = (i: number): Date => DAYS[i] ?? new Date();
const dayName = (d: Date, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }));
const nextSlot = () => { const d = new Date(Date.now() + 3600_000); return `${String(d.getHours()).padStart(2, '0')}:${d.getMinutes() < 30 ? '30' : '00'}`; };

interface Form { title: string; day: number; time: string; dur: number; guests: string[]; draft: string; notes: NotesMode; audience: NotesAudience }

export function ScheduleDialog({ open, meetingId, onClose }: { open: boolean; meetingId?: string | undefined; onClose: () => void }) {
  const editing = useQuery({ ...q.meeting(meetingId ?? ''), enabled: !!meetingId && open });
  const { data: balance } = useQuery(q.balance());
  const { data: prefs } = useQuery(q.prefs());
  const save = useSaveMeeting();
  const toast = useToast();
  const guestInput = useRef<HTMLInputElement>(null);
  const defaultKeep = prefs?.keep ?? 'full';
  const [f, setF] = useState<Form>({ title: '', day: 1, time: '10:30', dur: 30, guests: [], draft: '', notes: defaultKeep, audience: 'everyone' });
  const set = (p: Partial<Form>) => setF((s) => ({ ...s, ...p }));

  useEffect(() => {
    if (!open) return;
    const m = editing.data;
    if (meetingId && m) {
      const start = new Date(m.startsAt); const day = Math.max(0, DAYS.findIndex((d) => d.toDateString() === start.toDateString()));
      setF({ title: m.title, day, time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`, dur: minutesBetween(m.startsAt, m.endsAt), guests: m.guests.map((g) => g.email), draft: '', notes: m.notes === 'ask' ? 'full' : m.notes, audience: m.audience });
    } else if (!meetingId) setF({ title: '', day: 1, time: nextSlot(), dur: 30, guests: [], draft: '', notes: defaultKeep, audience: 'everyone' });
  }, [open, meetingId, editing.data, defaultKeep]);

  const addGuest = () => { const v = f.draft.trim().replace(/,$/, ''); if (v && !f.guests.includes(v)) set({ guests: [...f.guests, v], draft: '' }); else set({ draft: '' }); };

  const submit = async () => {
    const guests = f.draft.trim() ? [...f.guests, f.draft.trim()] : f.guests;
    const [h, m] = f.time.split(':').map(Number);
    const start = new Date(dayAt(f.day)); start.setHours(h ?? 10, m ?? 0, 0, 0);
    try {
      await save.mutateAsync({ id: meetingId, input: { title: f.title, startsAt: start.toISOString(), durationMinutes: f.dur, guests, notes: f.notes, audience: f.audience } });
      toast(meetingId ? 'Changes saved' : `${f.title || 'Untitled call'} · ${dayName(dayAt(f.day), f.day)} at ${f.time}`, 'cal');
      onClose();
    } catch (e) { toast(errorMessage(e), 'x'); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={meetingId ? 'Edit call' : 'Schedule a call'} width={600}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{meetingId ? 'Save changes' : 'Schedule call'}</Button></>}>
      <input autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Call title" aria-label="Call title"
        className="h-[54px] border-0 border-b border-hair bg-transparent p-0 font-display text-[22px] font-bold tracking-[-.02em] outline-none transition-colors placeholder:text-ink-3 focus:border-ink focus-visible:outline-none" />
      <Field label="Day"><Segmented label="Day" value={f.day} onChange={(day) => set({ day })} options={DAYS.map((d, i) => ({ value: i, label: dayName(d, i) }))} /></Field>
      <div className="grid grid-cols-[156px_1fr] gap-3.5">
        <Field label="Start" htmlFor="sched-time"><Input id="sched-time" type="time" className="font-mono" value={f.time} onChange={(e) => set({ time: e.target.value })} /></Field>
        <Field label="Length"><Segmented label="Length" value={f.dur} onChange={(dur) => set({ dur })} options={[15, 30, 45, 60].map((v) => ({ value: v, label: v === 60 ? '1h' : `${v}m` }))} /></Field>
      </div>
      <Field label="Guests" htmlFor="sched-guests" hint="Guests won’t need an account. They’ll join from the link.">
        <div onClick={() => guestInput.current?.focus()} className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl bg-card p-[7px] shadow-[inset_0_0_0_1px_var(--hair-2)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ink)]">
          {f.guests.map((g) => (
            <span key={g} className="inline-flex h-[30px] animate-pop items-center gap-1 rounded-[9px] bg-well pl-2.5 pr-1 text-[13.5px]">{g}
              <button type="button" aria-label={`Remove ${g}`} onClick={() => set({ guests: f.guests.filter((x) => x !== g) })} className="grid size-[22px] place-items-center rounded-md text-ink-3 hover:bg-hair-2 hover:text-ink"><Icon name="x" className="size-[13px]" /></button>
            </span>
          ))}
          <input ref={guestInput} id="sched-guests" value={f.draft} placeholder={f.guests.length ? 'Add another' : 'Email address'}
            onChange={(e) => set({ draft: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(); } if (e.key === 'Backspace' && !f.draft && f.guests.length) set({ guests: f.guests.slice(0, -1) }); }}
            className="h-[30px] min-w-[140px] flex-1 border-0 bg-transparent px-1.5 text-[14.5px] outline-none" />
        </div>
      </Field>
      <Field label="Notes">
        <div role="radiogroup" aria-label="Notes" className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
          {NOTE_MODE_OPTIONS.map((o) => (
            <OptionCard key={o.value} selected={f.notes === o.value} onSelect={() => set({ notes: o.value })} title={o.title} description={o.description} />
          ))}
        </div>
      </Field>
      <div className={cn('flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-ink-2 transition-opacity', f.notes === 'off' && 'pointer-events-none opacity-40')}>
        <span>Send the notes to</span>
        <Segmented label="Send the notes to" value={f.audience} onChange={(audience) => set({ audience })} options={[{ value: 'everyone', label: 'Everyone invited' }, { value: 'host', label: 'Only me' }]} />
      </div>
      <p className="m-0 flex items-start gap-2 text-[13px] text-ink-3"><Icon name="wave" className="mt-0.5 size-[15px]" />
        {f.notes === 'off' ? 'Calls are free. With notes off, no credits are used.' : `Up to ${(f.dur * (balance?.perMinute ?? 25)).toLocaleString('en-US')} credits if notes run the whole call. You have ${(balance?.balance ?? 0).toLocaleString('en-US')}.`}
      </p>
      <div className="flex gap-2.5 rounded-[14px] bg-raised px-3.5 py-3 text-[13.5px] text-ink-2">
        <Icon name="mail" className="mt-px size-[17px]" />
        <span>Guests are saved with the call. Email invites aren’t connected yet, and only you can join calls in this build.</span>
      </div>
    </Dialog>
  );
}

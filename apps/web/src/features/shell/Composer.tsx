/*
 * New call: one line. Describe the call ("Design review with Priya tomorrow 3pm for 45 min") and
 * what's understood turns into chips that can each be changed. Enter starts it now, or schedules it
 * when a day or a time was typed. The same line changes a scheduled call: it keeps its time unless a
 * new one is typed. It can open with a sentence already typed, as Home's first-call line hands one over, or with
 * people already invited, as the Team page's Start a call does.
 */
import { NOTES_LABEL, errorMessage, type NotesSetting, type Person } from '@alcove/api';
import { Avatar, Button, ComposerLine, Icon, Popover, Sheet, cn, useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { PeoplePicker } from '~/features/people/PeoplePicker';
import { dropFromSentence, firstOf } from '~/lib/parse';
import { callName, listNames, sameEmail } from '~/lib/people';
import { useCancelCall } from '~/lib/queries';
import { dayChoice, hm } from '~/lib/time';
import { cancelNote, cancelledLine, useCallLine, type LineChip } from './callLine';
import type { ComposerStart } from './context';

export function Composer({ open, onOpenChange, start }: { open: boolean; onOpenChange: (open: boolean) => void; start: ComposerStart }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={start.meeting ? 'Change call' : 'New call'}>
      <Body key={start.meeting?.id ?? 'new'} start={start} onClose={() => onOpenChange(false)} />
    </Sheet>
  );
}

function Body({ onClose, start }: { onClose: () => void; start: ComposerStart }) {
  const editing = start.meeting;
  const navigate = useNavigate();
  const toast = useToast();
  const cancel = useCancelCall();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(editing?.title ?? start.text ?? '');
  const [extra, setExtra] = useState<Person[]>(editing?.guests ?? start.people ?? []);
  const [notes, setNotes] = useState<NotesSetting | null>(editing?.notes ?? null);
  /** Which popover is open: the invite picker, one for a name that needs an address, or the notes menu. */
  const [pop, setPop] = useState<string | null>(null);
  const { p, chips, people, needs, notesOn, busy, tries, submit: send } = useCallLine({ text, extra, notes, editing });
  const focus = () => requestAnimationFrame(() => input.current?.focus());

  /* Take someone off the call: out of the picker's list, or out of the sentence. */
  const drop = (c: LineChip) => {
    if (c.k === 'person' && !c.typed) { setExtra((x) => x.filter((e) => !sameEmail(e, c.person))); return; }
    const word = c.k === 'needs' ? c.name : c.person.name !== c.person.email && text.toLowerCase().includes(firstOf(c.person.name).toLowerCase()) ? firstOf(c.person.name) : c.person.email;
    setText((t) => dropFromSentence(t, word));
  };

  /* A name without an address opens its picker; otherwise the line does what it says. */
  const submit = async () => {
    const stop = await send(onClose);
    if (stop) setPop(`needs:${stop.needs}`);
  };

  const hint = needs[0] ? { icon: 'mail' as const, text: `Add ${needs[0]}’s email to invite them` }
    : !people.length ? { icon: 'link' as const, text: 'Only you, so far. Add people by name or email.' }
      : notesOn === 'off' ? { icon: 'mail' as const, text: `${listNames(people)} ${people.length > 1 ? 'are' : 'is'} invited` }
        : { icon: 'send' as const, text: `Notes go to you and ${listNames(people)}` };
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
          <span className="try">Try {tries.map((t) => <button key={t.text} type="button" onClick={() => { setText(t.text); focus(); }}>{t.label}</button>)}</span>
        )}
      </div>
      <div className="cmp-foot">
        {editing ? (
          <Popover open={pop === 'cancel'} onOpenChange={(o) => setPop(o ? 'cancel' : null)} label="Cancel this call" side="top" className="w-[300px]"
            anchor={<Button variant="quiet" icon="trash">Cancel call</Button>}>
            <button type="button" className="ac-pop-item is-caution" onClick={() => {
              setPop(null);
              cancel.mutate(editing.id, {
                onSuccess: () => { onClose(); toast(cancelledLine(editing), { icon: 'trash' }); },
                onError: (e) => toast(errorMessage(e), { icon: 'x' })
              });
            }}>
              <Icon name="trash" size={18} /><span><b>Cancel this call</b><small>{cancelNote(editing)}</small></span>
            </button>
          </Popover>
        ) : <Button variant="quiet" icon="room" onClick={() => { onClose(); void navigate({ to: '/record' }); }}>Record in the room</Button>}
        <span className="hint"><Icon name={hint.icon} size={15} /><span>{hint.text}</span></span>
        <Button variant="primary" icon={p.when || editing ? undefined : 'video'} kb="↵" loading={busy} onClick={() => void submit()}>{editing ? 'Save changes' : p.when ? 'Schedule' : 'Start now'}</Button>
      </div>
    </>
  );
}

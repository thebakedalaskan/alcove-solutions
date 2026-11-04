/*
 * A line of a written note's transcript: what the transcript isn't sure of, dotted; who corrected it and when; and, for
 * whoever may, correcting it in place. The organizer corrects any line (its words, who said it, or that it was heard
 * right); anyone else who has the notes, the words of their own lines. No dialog: the line becomes its own editor.
 */
import { firstName, type Change, type LinePatch, type Note, type Person, type Speaker, type TranscriptLine } from '@alcove/api';
import { Avatar, Button, Icon, IconButton, Popover, TranscriptLine as SpokenLine, Tooltip, Unsure, cn } from '@alcove/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sameEmail, spokenName } from '~/lib/people';
import { hm, shortDay } from '~/lib/time';

/** Who may correct what in a note's transcript, and how: the same rule the server keeps. */
export interface Correcting {
  /** Whether this reader can correct this line's words. */
  can(line: TranscriptLine): boolean;
  /** People a line can be said by, for the organizer; null for anyone else, who can't change who said a line. */
  people: Speaker[] | null;
  onCorrect(line: TranscriptLine, patch: LinePatch): void;
}

/** Who the reader may say said a line: everyone the transcript names, then the organizer and everyone invited. */
export function speakersOf(note: Note): Speaker[] {
  const out = new Map<string, Speaker>();
  for (const l of note.transcript ?? []) if (l.speaker?.person && !out.has(l.speaker.person.id)) out.set(l.speaker.person.id, l.speaker);
  for (const r of note.recipients) if (r.role !== 'shared' && !out.has(r.person.id)) out.set(r.person.id, { name: nameOf(r.person), person: r.person });
  return [...out.values()];
}
/** What someone is called, or a name made from their address when that's all there is ("priya.raman@…" is Priya Raman). */
const nameOf = (p: Person) => (p.name && p.name !== p.email ? p.name
  : (p.email.split('@')[0] ?? p.email).split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || p.email);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const byName = (by: Change['by'], me: string | undefined) => (me && sameEmail(by, { email: me }) ? 'you' : firstName(by.name));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** One correction to a line, as a sentence. */
function changeLine(c: Change, me: string | undefined): string {
  const who = cap(byName(c.by, me));
  const when = `${shortDay(new Date(c.at))}, ${hm(new Date(c.at))}`;
  switch (c.what) {
    case 'reworded': return `${who} corrected it from “${clip(c.before ?? '', 60)}”, ${when}`;
    case 'reassigned': return `${c.after ? `${who} said ${firstName(c.after)} said it` : `${who} said nobody can tell who said it`}, ${when}`;
    case 'confirmed': return `${who} said it was heard right, ${when}`;
    default: return `${who} changed it, ${when}`;
  }
}

/**
 * One line of a written transcript. `more`: the same speaker as the line before, so their name isn't said again (a
 * speaker in doubt always is). `mark`: where a link to a moment lands.
 */
export function LineRow({ line, more, mark, time, me, correct }: {
  line: TranscriptLine; more: boolean; mark: { id?: string; className?: string }; time: ReactNode; me: string | undefined; correct?: Correcting | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const pen = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  // Back on the pencil once the editor closes, so the keyboard carries on where it was.
  useEffect(() => { if (!editing && back.current) { back.current = false; pen.current?.focus(); } }, [editing]);
  const close = () => { back.current = true; setEditing(false); };
  const named = !more || !!line.unsure?.speaker;
  const person = line.speaker ? line.speaker.person ?? { name: line.speaker.name } : undefined;
  if (editing && correct) return <LineEditor line={line} me={me} people={correct.people} mark={mark} onDone={close} onSave={(patch) => { correct.onCorrect(line, patch); close(); }} />;
  const name = line.speaker && named ? spokenName(line.speaker, me) : undefined;
  const history = (line.changes ?? []).map((c) => changeLine(c, me));
  return (
    <SpokenLine id={mark.id} className={cn(!named && 'more', mark.className, 'ln')} person={named ? person : undefined}
      name={name && (line.unsure?.speaker ? <Unsure of="speaker">{name}</Unsure> : name)}
      time={(
        <>
          {time}
          {history.length > 0 && (
            <Tooltip label={<span className="ln-hist">{history.slice(-4).map((h) => <span key={h}>{h}</span>)}</span>}>
              <span tabIndex={0} className="ln-fixed"><Icon name="history" size={12} />Corrected<span className="sr-only">: {history.at(-1)}</span></span>
            </Tooltip>
          )}
          {correct?.can(line) && <IconButton ref={pen} icon="pen" label="Correct this line" size={15} className="ln-pen" onClick={() => setEditing(true)} />}
        </>
      )}>
      {line.unsure?.words ? <Unsure of="words">{line.text}</Unsure> : line.text}
    </SpokenLine>
  );
}

/** The line as its own editor: its words, who said it (for the organizer), or that it was heard right. */
function LineEditor({ line, me, people, mark, onSave, onDone }: {
  line: TranscriptLine; me: string | undefined; people: Speaker[] | null; mark: { id?: string; className?: string }; onSave: (patch: LinePatch) => void; onDone: () => void;
}) {
  const [text, setText] = useState(line.text);
  /** Who said it: a person's ID, null for nobody can tell, or undefined while it's unchanged. */
  const [who, setWho] = useState<string | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const speaker = who === undefined ? line.speaker : who === null ? undefined : people?.find((p) => p.person?.id === who);
  const save = () => {
    const t = text.trim();
    const patch: LinePatch = {
      ...(t && t !== line.text ? { text: t } : {}),
      ...(who !== undefined && who !== (line.speaker?.person?.id ?? null) ? { speaker: who } : {})
    };
    if (patch.text === undefined && patch.speaker === undefined) { onDone(); return; }
    onSave(patch);
  };
  const shown = speaker ? spokenName(speaker, me) : 'Not sure who';
  return (
    <div id={mark.id} className={cn('ac-line ln ln-edit', mark.className)}>
      {speaker ? <Avatar person={speaker.person ?? { name: speaker.name }} size={26} /> : <span className="ln-nobody"><Icon name="ask" size={15} /></span>}
      <form className="min-w-0" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {people ? (
          <Popover open={picking} onOpenChange={setPicking} align="start" label="Who said this" className="ln-pop"
            anchor={<button type="button" className="ln-who" aria-label={`Said by ${shown}. Change who said this`}><b>{shown}</b><Icon name="down" size={14} /></button>}>
            <div className="ac-pop-h">Who said this</div>
            {people.map((p) => {
              const on = speaker?.person?.id === p.person?.id;
              return (
                <button key={p.person?.id ?? p.name} type="button" className={cn('ac-pop-item', on && 'sel')} onClick={() => { setWho(p.person?.id ?? null); setPicking(false); }}>
                  <Avatar person={p.person ?? { name: p.name }} size={22} />
                  <span><b>{p.name}{me && p.person && sameEmail(p.person, { email: me }) ? ' (you)' : ''}</b>{p.person && !p.person.email && <small>Joined by link</small>}</span>
                </button>
              );
            })}
            <button type="button" className={cn('ac-pop-item', !speaker && 'sel')} onClick={() => { setWho(null); setPicking(false); }}>
              <Icon name="ask" size={18} /><span><b>Not sure who</b></span>
            </button>
          </Popover>
        ) : line.speaker && <b>{spokenName(line.speaker, me)}</b>}
        <textarea className="ln-input" autoFocus value={text} maxLength={1000} rows={Math.min(6, Math.max(2, Math.ceil(text.length / 64)))} aria-label="What was said"
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); onDone(); }
          }} />
        <div className="ln-acts">
          <Button type="submit" variant="secondary" size="sm" disabled={!text.trim()}>Save</Button>
          {line.unsure && <button type="button" className="lk" onClick={() => onSave({ confirm: true })}>It was heard right</button>}
          <button type="button" className="lk quiet" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/*
 * The page's one job, in the middle of the sky: the line that searches everything said and asks your notes, with who
 * and what to look through under it. It takes ⌘K here, in place of the palette.
 */
import type { Person } from '@alcove/api';
import { Avatar, Button, Icon, IconButton, Kbd, Popover, Tabs, cn, type Choice } from '@alcove/ui';
import { useEffect, useState, type RefObject } from 'react';
import { ariaShortcut, overlayOpen, shortcut, withMod } from '~/lib/keys';
import { callName, fold, sameEmail } from '~/lib/people';
import { plural } from '~/lib/words';
import type { Known } from './parts';

/** What the list shows: everything, calls, recordings in the room, or notes someone shared with you. */
export type Show = 'all' | 'call' | 'room' | 'shared';
const SHOW: Choice<Show>[] = [
  { value: 'all', label: 'All' }, { value: 'call', label: 'Calls' }, { value: 'room', label: 'In the room' }, { value: 'shared', label: 'Shared with you' }
];
/** People offered in the sky; the rest are behind +. */
const PEOPLE = 4;

export function SearchLine({ line, text, asked, asking, onText, onClear, onAsk, onDown }: {
  line: RefObject<HTMLInputElement | null>; text: string;
  /** What's in the line is the question that's been answered, or is being. */
  asked: boolean; asking: boolean;
  onText: (text: string) => void; onClear: () => void; onAsk: () => void; onDown: () => void;
}) {
  /* In the capture phase, so the shell doesn't open the palette as well. With something open over the page, it's the shell's. */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!withMod(e) || e.key.toLowerCase() !== 'k' || overlayOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      line.current?.focus();
      line.current?.select();
    };
    addEventListener('keydown', on, { capture: true });
    return () => removeEventListener('keydown', on, { capture: true });
  }, [line]);
  return (
    <div className="nt-q">
      <Icon name="search" size={20} />
      <input ref={line} type="text" value={text} placeholder="Search everything said, or ask" aria-label="Search everything said, or ask" aria-keyshortcuts={ariaShortcut('K')}
        autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={500} onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); onAsk(); }
          else if (e.key === 'Escape') { onClear(); e.currentTarget.blur(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); onDown(); }
        }} />
      {text ? (
        <>
          <IconButton icon="x" size={16} label="Clear search" className="nt-q-x" onClick={() => { onClear(); line.current?.focus(); }} />
          <Button size="sm" className="nt-q-ask nt-tint" kb="↵" disabled={asked} loading={asking} onClick={onAsk}>Ask</Button>
        </>
      ) : <Kbd className="nt-q-k">{shortcut('K')}</Kbd>}
    </div>
  );
}

/** Under the line: the people you have most notes with and, with + to find anyone else, who the list is narrowed to. */
export function WithPeople({ known, person, add, onPick }: {
  known: Known[]; person: Person | undefined; add: RefObject<HTMLButtonElement | null>; onPick: (email: string | undefined) => void;
}) {
  if (!known.length && !person) return null;
  return (
    <div className="nt-people">
      {person ? (
        <span className="hm-who nt-with">
          <Avatar person={person} size={26} /><span className="ac-clamp-1">{callName(person)}</span>
          <IconButton icon="x" size={14} label="Show notes with anyone" className="nt-with-x" onClick={() => onPick(undefined)} />
        </span>
      ) : known.slice(0, PEOPLE).map((k) => (
        <button key={k.person.email} type="button" className="hm-who" aria-label={`Notes with ${k.person.name}`} title={`Notes with ${k.person.name}`} onClick={() => onPick(k.person.email)}>
          <Avatar person={k.person} size={26} /><span className="ac-clamp-1">{callName(k.person)}</span>
        </button>
      ))}
      <Someone known={known} person={person} add={add} onPick={onPick} />
    </div>
  );
}

/** + : everyone you have notes with, to find one by name or address. */
function Someone({ known, person, add, onPick }: { known: Known[]; person: Person | undefined; add: RefObject<HTMLButtonElement | null>; onPick: (email: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const typed = fold(text.trim());
  const shown = known.filter((k) => !typed || fold(k.person.name).includes(typed) || k.person.email.toLowerCase().includes(typed)).slice(0, 40);
  const go = (email: string | undefined) => { setOpen(false); setText(''); onPick(email); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(''); }} align="center" label="Show notes with someone" className="nt-pop nt-pick"
      anchor={<button ref={add} type="button" className="hm-add" aria-label="Notes with someone else" title="Notes with someone else"><Icon name="plus" size={18} /></button>}>
      <label className="nt-pop-find"><Icon name="search" size={15} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find someone in your notes" aria-label="Find someone in your notes" autoComplete="off" spellCheck={false}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = shown[0]; if (first) go(first.person.email); } }} /></label>
      <div className="nt-pop-list">
        {person && <button type="button" className="nt-pop-row" onClick={() => go(undefined)}><span className="nt-pop-any"><Icon name="people" size={16} /></span><span className="nt-pop-b"><b>Anyone</b><small>All your notes</small></span></button>}
        {shown.map((k) => (
          <button key={k.person.email} type="button" className={cn('nt-pop-row', person && sameEmail(person, k.person) && 'is-on')} onClick={() => go(k.person.email)}>
            <Avatar person={k.person} size={28} />
            <span className="nt-pop-b"><b className="ac-clamp-1">{k.person.name}</b><small>{plural(k.count, 'note')}</small></span>
          </button>
        ))}
        {!shown.length && <p className="nt-pop-none">{known.length ? 'Nobody by that name in your notes.' : 'Only you are in your notes so far.'}</p>}
      </div>
    </Popover>
  );
}

export function ShowTabs({ show, onShow }: { show: Show; onShow: (s: Show) => void }) {
  return <Tabs<Show> value={show} onChange={onShow} options={SHOW} label="Show" className="nt-tabs" />;
}

/*
 * @-references when asking across notes: typing `@` (or pressing @) offers the notes you can open, yours, the ones shared
 * with you and, while you're licensed on a team, the team's, by title. A picked note sits under the line as a chip and is
 * read first; up to five go with the question as `refs`. One you can't open any more is refused, in the server's words.
 */
import { firstName, type AnswerPart, type NoteSummary } from '@alcove/api';
import { Chip, Icon, IconButton, PickList, Popover, cn, type PickRow } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api } from '~/lib/api';
import { q } from '~/lib/queries';
import { noteDay } from '~/lib/time';

/** The most notes a question can refer to. */
export const MAX_REFS = 5;
/** The most notes the picker lists at once. */
const LISTED = 8;

export interface NoteRef { id: string; title: string }

/** Every note you can ask about: yours and the ones shared with you, then your team's while you're licensed on it. */
export function useAskableNotes(): NoteSummary[] {
  const own = useQuery(q.notes()).data;
  const licensed = useQuery(q.plan()).data?.team?.licensed === true;
  const team = useQuery({ ...q.teamNotes(), enabled: licensed }).data;
  return useMemo(() => {
    const mine = own ?? [];
    return [...mine, ...(licensed ? team ?? [] : []).filter((t) => !mine.some((n) => n.id === t.id))];
  }, [own, team, licensed]);
}

/** The notes a question refers to, the picker's state, and asking with them. */
export function useNoteRefs() {
  const [refs, setRefs] = useState<NoteRef[]>([]);
  const [picking, setPicking] = useState(false);
  const ids = refs.map((r) => r.id).join(' ');
  const ask = useCallback((question: string): AsyncIterable<AnswerPart> => api.notes.askAll(question, ids ? ids.split(' ') : undefined), [ids]);
  const add = useCallback((r: NoteRef) => setRefs((all) => (all.some((x) => x.id === r.id) || all.length >= MAX_REFS ? all : [...all, r])), []);
  const remove = useCallback((id: string) => setRefs((all) => all.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setRefs([]), []);
  /**
   * What's typed, as the line keeps it: an `@` just typed at the start of a word opens the picker and doesn't stay on the
   * line. Anything else is kept as typed.
   */
  const typed = useCallback((next: string, prev: string): string => {
    if (next.length !== prev.length + 1 || refs.length >= MAX_REFS) return next;
    let i = 0;
    while (i < prev.length && next[i] === prev[i]) i++;
    if (next[i] !== '@' || (i > 0 && !/\s/.test(next[i - 1] ?? ''))) return next;
    setPicking(true);
    return next.slice(0, i) + next.slice(i + 1);
  }, [refs.length]);
  return { refs, add, remove, clear, picking, setPicking, ask, typed };
}
export type NoteRefs = ReturnType<typeof useNoteRefs>;

/**
 * Under the line: the notes referred to, each with a way to take it off, and @, which opens the picker (as typing `@`
 * does). `onBack` puts focus back on the line once a note is picked or the picker closes.
 */
export function NoteRefsRow({ refs, onBack, className }: { refs: NoteRefs; onBack: () => void; className?: string | undefined }) {
  const notes = useAskableNotes();
  const me = useQuery(q.session()).data?.user;
  const [query, setQuery] = useState('');
  const full = refs.refs.length >= MAX_REFS;
  const term = query.trim().toLowerCase();
  const rows: PickRow[] = notes
    .filter((n) => !refs.refs.some((r) => r.id === n.id) && (!term || n.title.toLowerCase().includes(term)))
    .slice(0, LISTED)
    .flatMap((n): PickRow[] => {
      const by = n.received?.by ?? me;
      if (!by) return [];
      const from = n.received?.role === 'team' ? `From ${firstName(by.name)}, your team’s` : n.received ? `From ${firstName(by.name)}` : 'Yours';
      return [{ key: n.id, name: n.title, sub: `${noteDay(n.startedAt)} · ${from}`, person: by }];
    });
  const open = (o: boolean) => { refs.setPicking(o); if (!o) setQuery(''); };
  const pick = (row: PickRow) => {
    refs.add({ id: row.key, title: row.name });
    open(false);
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {refs.refs.map((r) => (
        <Chip key={r.id} icon="at" className="max-w-full">
          <span className="ac-clamp-1">{r.title}</span>
          <IconButton icon="x" size={12} label={`Don’t refer to ${r.title}`} onClick={() => { refs.remove(r.id); onBack(); }} />
        </Chip>
      ))}
      <Popover open={refs.picking} onOpenChange={open} label="Refer to a note" tip={full ? `Up to ${MAX_REFS} notes` : 'Refer to a note (@)'}
        onCloseFocus={() => { onBack(); return true; }}
        anchor={<IconButton icon="at" size={16} label="Refer to a note" title={undefined} disabled={full} />}>
        <PickList label="Notes to refer to" placeholder="A note’s title" query={query} onQuery={setQuery} rows={rows}
          none={term ? <>No note you can open is called that.</> : <>No notes to refer to yet.</>} onPress={pick} />
      </Popover>
      {refs.refs.length > 0 && <span className="text-ink-2 text-xs"><Icon name="notes" size={12} className="mr-1 inline" />Read first</span>}
    </div>
  );
}

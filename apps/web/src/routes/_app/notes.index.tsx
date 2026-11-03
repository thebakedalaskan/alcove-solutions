import type { NoteKind, NoteSummary } from '@alcove/api';
import { ArchThumb, Button, EmptyState, Faces, Icon, Segmented, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { useOpenComposer } from '~/features/shell/context';
import { q } from '~/lib/queries';
import { noteDay, noteGroup } from '~/lib/time';
import { noteMeta } from '~/features/notes/meta';
import { listNames } from '~/lib/people';

export const Route = createFileRoute('/_app/notes/')({
  validateSearch: (s: Record<string, unknown>): { find?: boolean | undefined } => ({ find: s['find'] === true || s['find'] === 'true' ? true : undefined }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.notes()),
  component: Notes
});

type Filter = 'all' | NoteKind;

/** Marks where the search matched. */
function highlight(s: string, term: string): ReactNode {
  if (!term) return s;
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + term.length)}</mark>{s.slice(i + term.length)}</>;
}

function Notes() {
  const { find } = Route.useSearch();
  const open = useOpenComposer();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const term = useDeferredValue(text.trim());
  const search = useRef<HTMLInputElement>(null);
  const all = useQuery(q.notes()).data ?? [];
  const list = useQuery(q.notes(filter === 'all' ? undefined : filter, term || undefined)).data ?? [];
  useEffect(() => { if (find) search.current?.focus(); }, [find]);

  if (!all.length) {
    return (
      <>
        <div className="head" style={{ '--d': 0 }}><div><h1>Notes</h1></div></div>
        <section className="card" style={{ '--d': 1 }}>
          <EmptyState title="No notes yet" action={<Button variant="primary" icon="plus" onClick={open}>New call</Button>}>
            Calls with notes on, and recordings in the room, land here.
          </EmptyState>
        </section>
      </>
    );
  }
  const groups = [...new Set(list.map((n) => noteGroup(n.startedAt)))];
  return (
    <>
      <div className="head" style={{ '--d': 0 }}><div><h1>Notes</h1></div></div>
      <div className="lib-tools" style={{ '--d': 1 }}>
        <label className="lib-search"><Icon name="search" size={17} /><input ref={search} className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles, summaries and transcripts" autoComplete="off" aria-label="Search notes" /></label>
        <Segmented<Filter> value={filter} onChange={setFilter} label="Filter" options={[{ value: 'all', label: 'All' }, { value: 'call', label: 'Calls' }, { value: 'room', label: 'In the room' }]} />
      </div>
      <section className="card lib" style={{ '--d': 2 }} aria-live="polite">
        {list.length ? groups.map((g) => (
          <div key={g}>
            <div className="grp">{g}</div>
            {list.filter((n) => noteGroup(n.startedAt) === g).map((n) => <Row key={n.id} n={n} term={term} />)}
          </div>
        )) : <div className="lib-empty">{term ? <>Nothing matches “{term}”.</> : 'Nothing here yet.'}</div>}
      </section>
    </>
  );
}

function Row({ n, term }: { n: NoteSummary; term: string }) {
  return (
    <Link to="/notes/$noteId" params={{ noteId: n.id }} className="lrow">
      <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} />
      <span className="min-w-0"><b>{highlight(n.title, term)}</b><div className="sum">{n.excerpt ? highlight(n.excerpt, term) : listNames(n.people)}</div></span>
      <span className="flex items-center gap-3.5"><Faces people={n.people} size={24} max={3} /><span className="cnt">{n.from ? `From ${n.from.name.split(' ')[0] ?? n.from.name}` : noteMeta(n).replace(/^In the room · /, '')}</span></span>
      <span className="dt">{noteDay(n.startedAt)}</span>
    </Link>
  );
}

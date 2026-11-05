/*
 * The Drive (docs: Product › The Drive): every workspace you're in, newest first. A call's home says which call it was made
 * for, and when; one made by hand says when it was made. Each opens on its own page, and any of them can be shared from
 * there. New workspace is named in place, in the sky, and opens once it's made. Before the first, it says where they come from.
 */
import { errorMessage, type WorkspaceSummary } from '@alcove/api';
import { Button, EmptyState, Evening, Icon, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { peopleWords } from '~/features/workspace/List';
import { q, useCreateWorkspace } from '~/lib/queries';
import { daysFromToday, hm, noteDay, shortDay } from '~/lib/time';

/** When something was made, as a row says it: "today", "yesterday" or "Fri 30 Oct". */
function madeOn(iso: string): string {
  const n = daysFromToday(new Date(iso));
  return n === 0 ? 'today' : n === -1 ? 'yesterday' : shortDay(new Date(iso));
}

/** What a row says under a workspace's name: the call it's the home of, or when it was made, and who's in it. */
function aboutOf(w: WorkspaceSummary): string {
  if (w.role === null) return 'Only what’s shared with you';
  const made = w.call ? `From ${w.call.title}, ${noteDay(w.call.at)} at ${hm(w.call.at)}` : w.createdAt ? `Made ${madeOn(w.createdAt)}` : '';
  return [made, peopleWords(w.people)].filter(Boolean).join(' · ');
}

function Row({ w }: { w: WorkspaceSummary }) {
  return (
    <li>
      <Link to="/drive/$workspaceId" params={{ workspaceId: w.id }} className={cn('dv-row', w.call && 'is-call')}>
        <span className="dv-ic"><Icon name={w.role === null ? 'lock' : w.call ? 'video' : 'folders'} size={19} /></span>
        <span className="dv-t"><b className="ac-clamp-1">{w.name ?? 'Shared with you'}</b><small className="ac-clamp-1">{aboutOf(w)}</small></span>
        <span className="dv-end"><Icon name="chevron" size={16} /></span>
      </Link>
    </li>
  );
}

/** New workspace, then its name in the button's place: Enter makes it and opens it, Esc puts it away. */
function Make() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const push = useToast();
  const field = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const to = name.trim();
    if (!to || create.isPending) return;
    create.mutateAsync(to).then(({ id }) => navigate({ to: '/drive/$workspaceId', params: { workspaceId: id } }), (err: unknown) => { push(errorMessage(err), { icon: 'alert' }); });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(false); setName(''); } };
  if (!naming) return <Button variant="primary" onClick={() => { setNaming(true); requestAnimationFrame(() => field.current?.focus()); }}><Icon name="plus" size={18} />New workspace</Button>;
  return (
    <form className="dv-name" onSubmit={submit}>
      <input ref={field} type="text" aria-label="Name this workspace" placeholder="Name this workspace" value={name} maxLength={120} autoComplete="off" enterKeyHint="done"
        onChange={(e) => setName(e.target.value)} onKeyDown={keys} onBlur={() => { if (!name.trim()) setNaming(false); }} />
      <Button variant="primary" type="submit" loading={create.isPending} disabled={!name.trim()}>Make it</Button>
    </form>
  );
}

export function Drive() {
  const spaces = useQuery(q.workspaces()).data ?? [];
  return (
    <Evening moment="drive" className="dv">
      <header className="dv-top" style={{ '--d': 0 }}><h1>Drive</h1></header>
      <section className="dv-sky" style={{ '--d': 1 }} aria-label="New workspace">
        <p>Every call gets a workspace of its own, with its notes, follow-ups and transcript in a folder. They’re all here, with any you make yourself.</p>
        <Make />
      </section>
      <div className="dv-water" style={{ '--d': 2 }}>
        {spaces.length === 0 ? (
          <EmptyState className="dv-none" title="Nothing here yet">Your next call makes the first: its notes land in it when it ends, and you can work in it during the call.</EmptyState>
        ) : (
          <ul className="dv-list" aria-label="Your workspaces">{spaces.map((w) => <Row key={w.id} w={w} />)}</ul>
        )}
      </div>
    </Evening>
  );
}

/*
 * The Drive (docs: Product › The Drive): every workspace you're in, newest first. One made for a call says which call, and
 * when; one made by hand says when it was made. Each opens on its own page, and any of them can be shared from there. New
 * workspace is named in place, in the sky, and opens once it's made. Before the first, it says where they come from. Whoever
 * runs a workspace can delete it from its row's menu, which asks first, in place.
 */
import { errorMessage, type WorkspaceSummary } from '@alcove/api';
import { Button, EmptyState, Evening, Icon, IconButton, Popover, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { namesIn, peopleWords } from '~/features/workspace/List';
import { q, useCreateWorkspace, useDeleteWorkspace } from '~/lib/queries';
import { daysFromToday, hm, noteDay, shortDay } from '~/lib/time';

/** When something was made, as a row says it: "today", "yesterday" or "Fri 30 Oct". */
function madeOn(iso: string): string {
  const n = daysFromToday(new Date(iso));
  return n === 0 ? 'today' : n === -1 ? 'yesterday' : shortDay(new Date(iso));
}

/** What a row says under a workspace's name: the call it was made for, or when it was made, and who's in it. */
function aboutOf(w: WorkspaceSummary): string {
  if (w.role === null) return 'Only what’s shared with you';
  const made = w.call ? `From ${w.call.title}, ${noteDay(w.call.at)} at ${hm(w.call.at)}` : w.createdAt ? `Made ${madeOn(w.createdAt)}` : '';
  return [made, peopleWords(w.people)].filter(Boolean).join(' · ');
}

/** A workspace's menu, for its admins: Delete workspace, which asks once in place, and waits for Alcove to say it's done. */
function RowMenu({ id, name }: { id: string; name: string }) {
  const toast = useToast();
  const remove = useDeleteWorkspace();
  const keep = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (sure) keep.current?.focus(); }, [sure]);
  const change = (o: boolean) => { if (remove.isPending) return; setOpen(o); if (!o) setSure(false); };
  const drop = async () => {
    try {
      await remove.mutateAsync(id);
      setOpen(false);
      setSure(false);
      toast(`${name} is deleted for everyone`, { icon: 'trash' });
    } catch (e) {
      toast(errorMessage(e), { icon: 'alert' });
    }
  };
  return (
    <Popover open={open} onOpenChange={change} align="end" label={`${name}: more`} className="dv-pop" tip="More"
      anchor={<IconButton icon="more" label={`More for ${name}`} title={undefined} className="dv-more" />}>
      {sure ? (
        <div className="dv-sure" role="alertdialog" aria-label={`Delete ${name}`}>
          <b className="ac-clamp-2">Delete {name} for good?</b>
          <p>It goes for everyone in it, with every document and board. Notes from calls stay in Notes. Nobody can bring it back.</p>
          <div className="dv-sure-a">
            <Button ref={keep} variant="quiet" size="sm" disabled={remove.isPending} onClick={() => change(false)}>Keep it</Button>
            <Button variant="primary" size="sm" loading={remove.isPending} onClick={() => void drop()}>Delete</Button>
          </div>
        </div>
      ) : (
        <button type="button" className="dv-pop-row" onClick={() => setSure(true)}>
          <span className="dv-pop-ic"><Icon name="trash" size={18} /></span>
          <span className="dv-pop-b"><b>Delete workspace</b><small>For everyone. Can’t be undone.</small></span>
        </button>
      )}
    </Popover>
  );
}

function Row({ w, name }: { w: WorkspaceSummary; name: string }) {
  return (
    <li className="dv-item">
      <Link to="/drive/$workspaceId" params={{ workspaceId: w.id }} className={cn('dv-row', w.call && 'is-call')}>
        <span className="dv-ic"><Icon name={w.role === null ? 'lock' : w.call ? 'video' : 'folders'} size={19} /></span>
        <span className="dv-t"><b className="ac-clamp-1">{name}</b><small className="ac-clamp-1">{aboutOf(w)}</small></span>
        <span className="dv-end"><Icon name="chevron" size={16} /></span>
      </Link>
      {/* Outside the link, so pressing it opens the menu and nothing else. */}
      {w.role === 'admin' ? <RowMenu id={w.id} name={name} /> : <span aria-hidden="true" />}
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
  const named = namesIn(spaces);
  return (
    <Evening moment="drive" className="dv">
      <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Drive</h1></header>
      <section className="dv-sky" style={{ '--d': 1 }} aria-label="New workspace">
        <p>Workspaces hold documents and boards. Use one in a call and its notes, follow-ups and transcript land there, in a folder of their own.</p>
        <Make />
      </section>
      <div className="dv-water" style={{ '--d': 2 }}>
        {spaces.length === 0 ? (
          <EmptyState className="dv-none" title="Nothing here yet">Make one here, or when you schedule a call.</EmptyState>
        ) : (
          <ul className="dv-list" aria-label="Your workspaces">{spaces.map((w) => <Row key={w.id} w={w} name={named(w)} />)}</ul>
        )}
      </div>
    </Evening>
  );
}

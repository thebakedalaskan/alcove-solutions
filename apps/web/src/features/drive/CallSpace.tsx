/*
 * A call's own workspace on the sheet, beside the tree: the call's name, who's in it, when, and Open full screen; then the
 * call itself, as three cards (its Notes, its Follow-ups and its Transcript, each a picture of what it says), for whoever
 * has its notes; then what the call made, ending in the dashed ways to make something more for it; and in a series, the
 * calls before this one. Before the call there are no notes yet: what's been made for it, and the ways to add an agenda.
 */
import { errorCode, type Note, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import { Button, Dots, EmptyState, Faces, FileCard, Icon, cn, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { callName } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { noteQueries } from '~/features/notes/queries';
import { workspaceQueries } from '~/features/workspace/queries';
import { callLength, noteAt } from '~/lib/time';
import { plural } from '~/lib/words';
import { canEdit, type DriveActions } from './actions';
import { MakeTiles } from './New';
import { CallKept } from './Space';
import { FileList, Section, SheetHead } from './Sheet';
import { callTitle, fileOf, isAhead, type DriveFile } from './places';

/** How many lines each card of the call shows. */
const LINES = 4;

interface PageLine { text: string; kind: 'decision' | 'yours' | 'follow-up' | 'said' }
/** One of the call's own pages, as a card: what it is, a picture of what it says, and one line under it. */
function CallPage({ icon, title, side, summary, lines, note, onOpen }: {
  icon: IconName; title: string; side: string; summary?: string | undefined; lines: PageLine[]; note: string; onOpen: () => void;
}) {
  const picture = (
    <span className="dv-cc">
      <span className="hd"><span>{title}</span><span>{side}</span></span>
      {summary && <span className="s">{summary}</span>}
      {lines.map((l, i) => <span key={`${i}-${l.text}`} className={cn('o', `is-${l.kind}`)}><i /><span>{l.text}</span></span>)}
    </span>
  );
  return <FileCard size="lg" kind="doc" icon={icon} name={title} label={`Open ${title}`} by={note} onOpen={onOpen} thumb={{ picture }} />;
}

/** The call's Notes, Follow-ups and Transcript, as its note has them now for whoever reads it. */
function ThisCall({ note, me }: { note: Note; me: string | undefined }) {
  const navigate = useNavigate();
  const open = (hash?: string | undefined) => { void navigate({ to: '/calls/$noteId', params: { noteId: note.id }, ...(hash ? { hash } : {}) }); };
  const mine = (owner: { person?: { email: string } | undefined } | undefined) => !!me && owner?.person?.email.toLowerCase() === me.toLowerCase();
  const decided = note.decisions.filter((d) => d.state === 'proposed' || d.state === 'confirmed');
  const todo = note.actions.filter((a) => !a.done);
  const length = callLength(note.duration);
  const said = (note.transcript ?? []).filter((l) => !l.room);
  return (
    <div className="dv-grid is-call">
      <CallPage icon="notes" title="Notes" side={length} summary={note.excerpt || note.summary || undefined} note="Written in confidential compute" onOpen={() => open()}
        lines={[
          ...decided.slice(0, 1).map((d): PageLine => ({ text: d.text, kind: 'decision' })),
          ...todo.filter((a) => mine(a.owner)).slice(0, 1).map((a): PageLine => ({ text: `You: ${a.text.charAt(0).toLowerCase()}${a.text.slice(1)}`, kind: 'yours' }))
        ]} />
      <CallPage icon="todo" title="Follow-ups" side={todo.length ? `${todo.length} to do` : plural(note.actions.length, 'follow-up')} note="Ticked here, ticked everywhere" onOpen={() => open('follow-ups')}
        lines={note.actions.slice(0, LINES).map((a): PageLine => ({ text: `${mine(a.owner) ? 'You' : a.owner ? callName({ name: a.owner.name, email: a.owner.person?.email ?? '' }) : 'Someone'}: ${a.text.charAt(0).toLowerCase()}${a.text.slice(1)}`, kind: mine(a.owner) ? 'yours' : 'follow-up' }))} />
      {said.length > 0 && (
        <CallPage icon="waveform" title="Transcript" side={length} note="Every word, with who said it" onOpen={() => open('transcript')}
          lines={said.slice(0, LINES).map((l): PageLine => ({ text: l.speaker ? `${mine(l.speaker) ? 'You' : callName({ name: l.speaker.name, email: l.speaker.person?.email ?? '' })}: ${l.text}` : l.text, kind: 'said' }))} />
      )}
    </div>
  );
}

/** The call's folders in its workspace, the latest first: a series keeps every call of it in one. */
const callFoldersOf = (items: readonly WorkspaceItem[]): WorkspaceItem[] =>
  items.filter((i) => i.call !== null && i.trashedAt === null).sort((a, b) => (b.call?.startedAt ?? '').localeCompare(a.call?.startedAt ?? ''));

export function CallSheet({ w, actions }: { w: WorkspaceSummary; actions: DriveActions }) {
  const tree = useQuery(workspaceQueries.workspaceTree(w.id));
  const people = useQuery(workspaceQueries.workspacePeople(w.id)).data ?? [];
  const me = useQuery(accountQueries.session()).data?.user.email;
  const items = tree.data?.items ?? [];
  const calls = callFoldersOf(items);
  const noteId = calls[0]?.call?.noteId ?? null;
  const note = useQuery({ ...noteQueries.note(noteId ?? ''), enabled: noteId !== null });
  const ahead = isAhead(w);
  const title = callTitle(w);
  const when = w.call ? noteAt(w.call.at) : null;
  const full = <Button variant="secondary" size="sm" className="dv-full" onClick={() => actions.openFull(w.id)}><Icon name="grow" size={16} />Open full screen</Button>;
  const meta = <p>{people.length > 0 && <Faces people={people.map((p) => p.person)} size={22} max={5} />}<span>{['This call’s own workspace', when].filter(Boolean).join(' · ')}</span></p>;

  if (tree.isError) {
    const gone = errorCode(tree.error) === 'not-found';
    return (
      <>
        <SheetHead title={title} />
        <EmptyState className="dv-none" title={gone ? 'You can’t open this workspace' : 'This workspace didn’t load'}
          action={<Button variant="secondary" onClick={() => (gone ? actions.go({}) : void tree.refetch())}>{gone ? 'Back to Recent' : 'Try again'}</Button>}>
          {gone ? 'It may have been deleted, or you were taken out of it.' : 'Alcove couldn’t be reached. Check your connection.'}
        </EmptyState>
      </>
    );
  }
  if (!tree.data) return <><SheetHead title={title} meta={meta} actions={full} /><p className="dv-loading"><Dots /></p></>;

  const made = items.filter((i) => i.kind !== 'folder' && i.trashedAt === null).sort((a, b) => b.editedAt.localeCompare(a.editedAt))
    .flatMap((i): DriveFile[] => { const f = fileOf(w.id, i); return f ? [f] : []; });
  const target = { workspaceId: w.id, folder: null };
  const tiles = canEdit(w.role) && <MakeTiles target={target} actions={actions} />;
  return (
    <>
      <SheetHead title={title} meta={meta} actions={full} />
      {!ahead && note.data && <Section label="This call"><ThisCall note={note.data} me={me} /></Section>}
      {!ahead && noteId && note.isPending && <Section label="This call"><p className="dv-loading"><Dots /></p></Section>}
      <Section label={ahead ? 'For the call' : 'Made in the call'}>
        {made.length === 0 && !tiles
          ? <p className="dv-quiet">Nothing yet.</p>
          : <FileList files={made} spaces={[w]} actions={actions} list={false} inside tail={tiles} />}
      </Section>
      {calls.length > 1 && (
        <Section label="Earlier calls">
          <div role="list">{calls.slice(1).map((c) => <CallKept key={c.id} item={c} items={items} />)}</div>
        </Section>
      )}
    </>
  );
}

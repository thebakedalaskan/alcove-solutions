/*
 * A workspace on the sheet, beside the tree: its mark and name, who's in it and what it's for, and Open full screen; then its folders as
 * tiles with how many files each holds, the calls kept in it as rows that open the call, and its files as large previews
 * that don't say again which workspace they're in, ending in the dashed ways to make something there. A folder opens in
 * the same place, under the way back to its workspace.
 */
import { errorCode, type Person, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import { Button, Dots, EmptyState, Faces, Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import { callName } from '~/lib/people';
import { q } from '~/lib/queries';
import { noteAt } from '~/lib/time';
import { plural } from '~/lib/words';
import { canEdit, type DriveActions } from './actions';
import { MakeTiles } from './New';
import { FileList, Section, SheetHead } from './Sheet';
import { callFolderTitle, fileOf, type DriveAt, type DriveFile } from './places';

/** Who's in a workspace, as its head says: "Priya, Kofi, Ines and you", or the first three and how many more. */
export function peopleLine(people: readonly { person: Person; isMe: boolean }[]): string {
  const others = people.filter((p) => !p.isMe).map((p) => callName(p.person));
  if (others.length === 0) return 'Just you';
  if (others.length <= 3) return `${others.join(', ')} and you`;
  return `${others.slice(0, 3).join(', ')}, you and ${others.length - 3} more`;
}

/** What's in a folder, or at the top: its folders, the calls kept there, and its files, in the tree's order, out of Trash. */
function inPlace(items: readonly WorkspaceItem[], parent: string | null) {
  const here = items.filter((i) => i.parent === parent && i.trashedAt === null);
  return { folders: here.filter((i) => i.kind === 'folder' && i.call === null), calls: here.filter((i) => i.call !== null), files: here.filter((i) => i.kind !== 'folder') };
}
/** How many files are in a folder, however deep. */
function filesUnder(items: readonly WorkspaceItem[], folder: string): number {
  const kids = items.filter((i) => i.parent === folder && i.trashedAt === null);
  return kids.reduce((n, i) => n + (i.kind === 'folder' ? filesUnder(items, i.id) : 1), 0);
}
/** The folders from the top down to this one. */
function pathTo(items: readonly WorkspaceItem[], id: string): WorkspaceItem[] {
  const out: WorkspaceItem[] = [];
  const seen = new Set<string>();
  for (let at = items.find((i) => i.id === id); at && !seen.has(at.id); at = items.find((i) => i.id === at?.parent)) {
    seen.add(at.id);
    out.unshift(at);
  }
  return out;
}

/** A call kept in a workspace: when it was, how much it made, and the way to it, for whoever has its notes. */
export function CallKept({ item, items }: { item: WorkspaceItem; items: readonly WorkspaceItem[] }) {
  const made = filesUnder(items, item.id);
  const noteId = item.call?.noteId ?? null;
  return (
    <div className="dv-crow" role="listitem">
      <span className="dv-k"><Icon name="video" size={17} /></span>
      <span className="dv-row-t"><b className="ac-clamp-1">{callFolderTitle(item)}</b><small className="ac-clamp-1">{[item.call ? noteAt(item.call.startedAt) : null, made ? plural(made, 'file') : null].filter(Boolean).join(' · ')}</small></span>
      {noteId && <Link to="/calls/$noteId" params={{ noteId }} className="dv-go">Open the call<Icon name="chevron" size={15} /></Link>}
    </div>
  );
}

export function SpaceSheet({ w, mark, at, actions }: { w: WorkspaceSummary; mark: string; at: DriveAt; actions: DriveActions }) {
  const tree = useQuery(q.workspaceTree(w.id));
  const people = useQuery({ ...q.workspacePeople(w.id), enabled: w.role !== null }).data ?? [];
  const about = useQuery({ ...q.workspaceAbout(w.id), enabled: w.role !== null }).data ?? '';
  const items = tree.data?.items ?? [];
  const folder = at.folder ? items.find((i) => i.id === at.folder && i.kind === 'folder') : undefined;
  const name = w.name ?? 'Shared with you';
  const full = <Button variant="secondary" size="sm" className="dv-full" onClick={() => actions.openFull(w.id)}><Icon name="grow" size={16} />Open full screen</Button>;
  const meta = people.length > 0 && <p><Faces people={people.map((p) => p.person)} size={22} max={5} /><span>{[peopleLine(people), w.role === 'read' ? 'You can read it' : null, about || null].filter(Boolean).join(' · ')}</span></p>;

  if (tree.isError) {
    return (
      <>
        <SheetHead title={name} mark={mark} />
        <EmptyState className="dv-none" title={errorCode(tree.error) === 'not-found' ? 'You can’t open this workspace' : 'This workspace didn’t load'}
          action={<Button variant="secondary" onClick={() => (errorCode(tree.error) === 'not-found' ? actions.go({}) : void tree.refetch())}>{errorCode(tree.error) === 'not-found' ? 'Back to Recent' : 'Try again'}</Button>}>
          {errorCode(tree.error) === 'not-found' ? 'It may have been deleted, or you were taken out of it.' : 'Alcove couldn’t be reached. Check your connection.'}
        </EmptyState>
      </>
    );
  }
  if (!tree.data) return <><SheetHead title={name} mark={mark} meta={meta} actions={full} /><p className="dv-loading"><Dots /></p></>;

  const place = inPlace(items, folder?.id ?? null);
  const files = place.files.flatMap((i): DriveFile[] => { const f = fileOf(w.id, i); return f ? [f] : []; });
  const editable = canEdit(w.role);
  const target = { workspaceId: w.id, folder: folder?.id ?? null };
  const empty = place.folders.length === 0 && place.calls.length === 0 && files.length === 0;
  const crumbs = folder ? pathTo(items, folder.id) : [];
  return (
    <>
      {folder && (
        <nav className="dv-crumb" aria-label="Where this folder is">
          <button type="button" onClick={() => actions.go({ ws: w.id })}>{name}</button>
          {crumbs.slice(0, -1).map((c) => <Fragment key={c.id}><Icon name="chevron" size={13} /><button type="button" onClick={() => actions.go({ ws: w.id, folder: c.id })}>{c.name || 'Untitled folder'}</button></Fragment>)}
          <Icon name="chevron" size={13} /><span>{folder.name || 'Untitled folder'}</span>
        </nav>
      )}
      <SheetHead title={folder ? folder.name || 'Untitled folder' : name} mark={folder ? undefined : mark} meta={folder ? undefined : meta} actions={full} />
      {empty ? (
        <EmptyState className="dv-none" title={folder ? 'Nothing in this folder yet' : `Nothing in ${name} yet`} action={editable && <MakeTiles className="is-row" target={target} actions={actions} />}>
          {editable ? 'Make a document or a board here, or upload files.' : 'Whatever’s made here shows here.'}
        </EmptyState>
      ) : (
        <>
          {place.folders.length > 0 && (
            <Section label="Folders">
              <div className="dv-folders">
                {place.folders.map((f) => (
                  <button key={f.id} type="button" className="dv-folder" onClick={() => actions.go({ ws: w.id, folder: f.id })}>
                    <Icon name="folder" size={17} /><span className="ac-clamp-1">{f.name || 'Untitled folder'}</span><small>{plural(filesUnder(items, f.id), 'file')}</small>
                  </button>
                ))}
              </div>
            </Section>
          )}
          {place.calls.length > 0 && (
            <Section label="Calls kept here">
              <div role="list">{place.calls.map((c) => <CallKept key={c.id} item={c} items={items} />)}</div>
            </Section>
          )}
          {files.length > 0 && <Section label="Files"><FileList files={files} spaces={[w]} actions={actions} list={false} inside /></Section>}
        </>
      )}
    </>
  );
}

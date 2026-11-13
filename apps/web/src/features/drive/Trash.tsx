/*
 * One Trash for every workspace: what's in it, where it was, who sent it there and when, and how long it has left, with
 * Restore for whoever can edit it. What's inside a folder in Trash goes with the folder, so only the folder is listed.
 * Deleting for good is in each workspace's own Trash, full screen.
 */
import { firstName, type Trashed, type WorkspaceSummary } from '@alcove/api';
import { Button, Dots, EmptyState, Icon, WS_ITEM_ICONS } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNow } from '~/lib/live';
import { q } from '~/lib/queries';
import { cardWhen, callTitle, isCallSpace, type DriveFile } from './places';
import type { DriveActions } from './actions';
import { SheetHead } from './Sheet';

/** What's listed: everything in Trash but what's in a folder that's there too. */
const listed = (all: readonly Trashed[]): Trashed[] => all.filter((t) => !all.some((o) => o.workspaceId === t.workspaceId && o.item.id === t.item.parent));

/** Where it was, as its row says it. */
function wasIn(t: Trashed, spaces: readonly WorkspaceSummary[]): string {
  const w = spaces.find((s) => s.id === t.workspaceId);
  if (!w || w.role === null) return 'Shared with you';
  return `From ${isCallSpace(w) ? callTitle(w) : w.name ?? 'a workspace'}`;
}

export function TrashSheet({ spaces, actions }: { spaces: readonly WorkspaceSummary[]; actions: DriveActions }) {
  const trash = useQuery(q.trashed());
  const me = useQuery(q.session()).data?.user.name;
  const now = useNow(60_000);
  const head = <SheetHead title="Trash" meta={<p>Kept for 30 days, then deleted for everyone</p>} />;
  if (trash.isError) {
    return <>{head}<EmptyState className="dv-none" title="Trash didn’t load" action={<Button variant="secondary" onClick={() => void trash.refetch()}>Try again</Button>}>Alcove couldn’t be reached. Check your connection.</EmptyState></>;
  }
  if (!trash.data) return <>{head}<p className="dv-loading"><Dots /></p></>;
  const rows = listed(trash.data);
  if (rows.length === 0) return <>{head}<EmptyState className="dv-none" title="Nothing in Trash">What you move to Trash stays here for 30 days, then goes for good.</EmptyState></>;
  return (
    <>
      {head}
      <div className="dv-rows is-trash" role="list">
        {rows.map((t) => {
          const left = Math.max(0, Math.ceil((Date.parse(t.deletesAt) - now) / 86_400_000));
          const name = t.item.name || (t.item.kind === 'folder' ? 'Untitled folder' : t.item.kind === 'board' ? 'Untitled board' : 'Untitled');
          const who = !t.item.trashedBy ? 'someone' : t.item.trashedBy === me ? 'you' : firstName(t.item.trashedBy);
          const f: Pick<DriveFile, 'workspaceId' | 'id'> = { workspaceId: t.workspaceId, id: t.item.id };
          return (
            <div key={`${t.workspaceId}/${t.item.id}`} className="dv-row" role="listitem">
              <span className="dv-k"><Icon name={WS_ITEM_ICONS[t.item.kind]} size={17} /></span>
              <span className="dv-row-t"><b className="ac-clamp-1">{name}</b><small className="ac-clamp-1">{wasIn(t, spaces)} · moved here by {who}, {cardWhen(t.item.trashedAt ?? t.deletesAt)}</small></span>
              <span className="dv-tag">{left <= 1 ? 'Goes today' : `${left} days left`}</span>
              {t.item.role === 'edit' ? <Button variant="quiet" size="sm" onClick={() => actions.restore(f, name)}>Restore</Button> : <span />}
            </div>
          );
        })}
      </div>
    </>
  );
}

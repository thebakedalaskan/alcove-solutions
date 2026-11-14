/*
 * The Drive's places, down its left: Recent; Shared with you, with how many; Workspaces, each with its mark, opening to its
 * folders and files; From calls, each call's own workspace, the next ones first with their time, opening to what the call
 * made, five of them until Show more; and Trash, apart at the foot. The place you're in is the one shaded row, and only its
 * workspace is open. Pressing that row again folds it, and again opens it; going anywhere opens the workspace you go to.
 * No sentences: on the first day it's the same rows, with New workspace where workspaces will be.
 */
import type { WorkspaceItem, WorkspaceSummary } from '@alcove/api';
import { Icon, IconButton, WS_ITEM_ICONS, cn, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { namesIn } from '~/features/workspace/tree/List';
import { workspaceQueries } from '~/features/workspace/queries';
import { dayMonth, daysFromToday, hm, weekday } from '~/lib/time';
import { NameField } from './Card';
import type { DriveActions } from './actions';
import { callOrder, callTitle, fileName, isAhead, isSpace, marksFor, type DriveAt } from './places';

/** How many calls' workspaces show before Show more. */
const CALLS_SHOWN = 5;

/** One row of the tree: what it opens, how it's drawn, and whether it's where you are or open. */
function Row({ icon, mark, label, small, depth = 0, current = false, open, className, onPress }: {
  icon?: IconName | undefined; mark?: string | undefined; label: string; small?: ReactNode; depth?: number | undefined; current?: boolean | undefined;
  /** Rows that open to more have a chevron, turned while they're open. */
  open?: boolean | undefined; className?: string | undefined; onPress: () => void;
}) {
  return (
    <button type="button" className={cn('dv-t', current && 'is-on', className)} style={{ '--depth': depth }} aria-current={current ? 'page' : undefined}
      aria-expanded={open} onClick={onPress}>
      {open === undefined ? <span /> : <Icon name="chevron" size={13} className={cn('dv-cv', open && 'is-open')} />}
      {mark ? <span className="dv-mk" aria-hidden="true">{mark}</span> : icon ? <Icon name={icon} size={17} className="dv-ic" /> : <span />}
      <span className="ac-clamp-1">{label}</span>
      {small !== undefined && <small>{small}</small>}
    </button>
  );
}

/** What a workspace or a folder holds, as the tree shows it under it: folders first, then files, out of Trash, but not a call's folder. */
function kidsOf(items: readonly WorkspaceItem[], parent: string | null): WorkspaceItem[] {
  const here = items.filter((i) => i.parent === parent && i.trashedAt === null && i.call === null);
  return [...here.filter((i) => i.kind === 'folder'), ...here.filter((i) => i.kind !== 'folder')];
}
/** The folders above one, outermost first: they stay open while it's where you are. */
function foldersAbove(items: readonly WorkspaceItem[], id: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let at = id; at !== undefined && !seen.has(at);) {
    seen.add(at);
    out.unshift(at);
    const parent = items.find((i) => i.id === at)?.parent;
    at = parent ?? undefined;
  }
  return out;
}

/** A workspace's folders and files, under its row; a folder opens to what's in it while it's where you are. */
function SpaceKids({ workspaceId, at, actions }: { workspaceId: string; at: DriveAt; actions: DriveActions }) {
  const items = useQuery(workspaceQueries.workspaceTree(workspaceId)).data?.items ?? [];
  const open = foldersAbove(items, at.folder);
  const level = (parent: string | null, depth: number): ReactNode => kidsOf(items, parent).map((i) => (
    <div key={i.id}>
      <Row icon={WS_ITEM_ICONS[i.kind]} label={i.kind === 'folder' ? i.name || 'Untitled folder' : fileName(i.kind === 'board' ? 'board' : 'doc', i.name)} depth={depth}
        current={i.kind === 'folder' ? !at.doc && at.folder === i.id : at.doc === i.id} className="is-sub"
        onPress={() => (i.kind === 'folder' ? actions.go({ ws: workspaceId, folder: i.id }) : actions.open({ workspaceId, id: i.id }))} />
      {i.kind === 'folder' && open.includes(i.id) && level(i.id, depth + 1)}
    </div>
  ));
  return <>{level(null, 1)}</>;
}

/** What a call's workspace holds, under its row: what the call made, the latest first. */
function CallKids({ workspaceId, at, actions }: { workspaceId: string; at: DriveAt; actions: DriveActions }) {
  const items = useQuery(workspaceQueries.workspaceTree(workspaceId)).data?.items ?? [];
  const made = items.filter((i) => i.kind !== 'folder' && i.trashedAt === null).sort((a, b) => b.editedAt.localeCompare(a.editedAt));
  return <>{made.map((i) => <Row key={i.id} icon={WS_ITEM_ICONS[i.kind]} label={fileName(i.kind === 'board' ? 'board' : 'doc', i.name)} depth={1} className="is-sub" current={at.doc === i.id} onPress={() => actions.open({ workspaceId, id: i.id })} />)}</>;
}

/** When a call is, on its row: its time today, its day this week, else the date. */
function callAt(iso: string): string {
  const d = new Date(iso);
  const n = Math.abs(daysFromToday(d));
  return n === 0 ? hm(d) : n < 7 ? weekday(d).slice(0, 3) : dayMonth(d);
}

/** Where you are in the Drive, as one string, so a fold lasts only while you stay. */
const spotOf = (at: DriveAt): string => JSON.stringify([at.show ?? null, at.ws ?? null, at.folder ?? null, at.doc ?? null, at.q ?? null]);

/**
 * Whether the workspace you're in is folded: pressing its row while the sheet shows that workspace folds it, and again
 * opens it. Going anywhere else, from the tree, the sheet or Back, opens the workspace you're in again. `press` is what a
 * workspace's row does: fold or open it while you're on it, else go there.
 */
function useFold(at: DriveAt, go: (to: DriveAt) => void): { folded: boolean; press: (ws: string) => void } {
  const spot = spotOf(at);
  const [fold, setFold] = useState({ spot, folded: false });
  if (fold.spot !== spot) setFold({ spot, folded: false });
  const folded = fold.spot === spot && fold.folded;
  const press = (ws: string) => {
    if (at.ws === ws && !at.folder && !at.doc && !at.q) setFold({ spot, folded: !folded });
    else go({ ws });
  };
  return { folded, press };
}

export function Tree({ at, spaces, shared, actions }: {
  at: DriveAt; spaces: readonly WorkspaceSummary[];
  /** How many documents are shared with you, when there are any. */
  shared: number; actions: DriveActions;
}) {
  const [allCalls, setAllCalls] = useState(false);
  const [naming, setNaming] = useState(false);
  const mark = marksFor(spaces);
  const named = namesIn(spaces);
  const yours = spaces.filter(isSpace);
  const calls = callOrder(spaces);
  /* Calls with the same name, the same call twice say, say when each was, so no two rows read the same. */
  const twice = new Set(calls.map(callTitle).filter((t, i, all) => all.indexOf(t) !== i));
  const shownCalls = allCalls ? calls : calls.filter((w, i) => i < CALLS_SHOWN || w.id === at.ws);
  const recent = !at.ws && !at.show && !at.q;
  const go = (to: DriveAt) => { actions.go(to); };
  const { folded, press } = useFold(at, go);
  return (
    <nav className="dv-tree" aria-label="Places in the Drive">
      <Row icon="clock" label="Recent" current={recent} onPress={() => go({})} />
      <Row icon="people" label="Shared with you" small={shared || undefined} current={at.show === 'shared'} onPress={() => go({ show: 'shared' })} />

      <p className="dv-th">Workspaces{yours.length > 0 && <IconButton icon="plus" size={15} label="New workspace" onClick={() => setNaming(true)} />}</p>
      {yours.map((w) => {
        const here = at.ws === w.id;
        return (
          <div key={w.id}>
            <Row mark={mark(w)} label={named(w)} current={here && !at.folder && !at.doc} open={here && !folded} onPress={() => press(w.id)} />
            {here && !folded && <SpaceKids workspaceId={w.id} at={at} actions={actions} />}
          </div>
        );
      })}
      {naming ? (
        <div className="dv-t is-naming"><span /><Icon name="folders" size={17} className="dv-ic" />
          <NameField name="" label="Name this workspace" onDone={(name) => { setNaming(false); if (name) void actions.newWorkspace(name); }} />
        </div>
      ) : yours.length === 0 && <Row icon="plus" label="New workspace" className="is-new" onPress={() => setNaming(true)} />}

      {calls.length > 0 && (
        <>
          <p className="dv-th">From calls<Link to="/calls" className="dv-th-go" aria-label="All calls" title="All calls"><Icon name="chevron" size={15} /></Link></p>
          {shownCalls.map((w) => {
            const here = at.ws === w.id;
            const ahead = isAhead(w);
            return (
              <div key={w.id}>
                <Row icon={ahead ? 'cal' : 'video'} label={callTitle(w)} small={w.call && (ahead || twice.has(callTitle(w))) ? callAt(w.call.at) : undefined} current={here && !at.doc} open={here && !folded} onPress={() => press(w.id)} />
                {here && !folded && <CallKids workspaceId={w.id} at={at} actions={actions} />}
              </div>
            );
          })}
          {calls.length > shownCalls.length && <button type="button" className="dv-more" onClick={() => setAllCalls(true)}>Show {calls.length - shownCalls.length} more</button>}
        </>
      )}

      <Row icon="trash" label="Trash" current={at.show === 'trash'} className="is-trash" onPress={() => go({ show: 'trash' })} />
    </nav>
  );
}

/*
 * A workspace's side panel, full screen: the Alcove logo, the workspace switcher, Search, then Home and its Pages, with the
 * calls kept in it under Calls; or, for a call's own workspace, the call first ("The call, today ↗", holding what was made in
 * it), then the workspace's own Pages (For the call, before it), where + makes something, then a series' earlier calls. Trash
 * and who can open it at the foot. Its rows are the list's own (List.tsx): every menu, drag, rename and key works here as it
 * does there.
 */
import { firstName, type WorkspacePerson } from '@alcove/api';
import { Logo, WsMark, WsRow, WsSection, WsSide } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { shortcut } from '~/lib/keys';
import { useNow } from '~/lib/live';
import { workspaceQueries } from '~/features/workspace/queries';
import { beforeTheCall, callDay, callDayTitle, homeOf } from './calls';
import { useWs } from '../context';
import { CALL_ICON, useListParts, type ListDrag } from '../tree/List';
import { rowsOf, type ListRow } from '../tree/tree';
import { useSpaceShare } from '../sharing/Sheets';

/** How many of a series' earlier calls show before "N more". */
const EARLIER = 5;

/** Who can open a workspace, in words, beside the seal at the foot. */
export function whoCanOpen(people: readonly WorkspacePerson[] | undefined, count: number | null): string {
  if (count === null) return 'Shared with you';
  if (!people) return count === 1 ? 'Only you can open it' : `${count} people can open it`;
  const others = people.filter((p) => !p.isMe).map((p) => firstName(p.person.name));
  if (others.length === 0) return 'Only you can open it';
  if (others.length > 4) return `${people.length} people can open it`;
  return `${others.join(', ')} and you can open it`;
}

export function Side({ drags }: { drags: ListDrag }) {
  const ws = useWs();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const parts = useListParts(drags);
  const [allCalls, setAllCalls] = useState(false);
  const { tree, sent } = ws;
  const { inside } = parts;
  const summary = useQuery({ ...workspaceQueries.workspaces(), enabled: ws.owner !== null }).data?.find((w) => w.id === ws.workspaceId);
  const people = useQuery({ ...workspaceQueries.workspacePeople(ws.workspaceId), enabled: inside }).data;
  /* Who can open it, at the foot, opens who's in it: the way to share the whole workspace from any page of it, a call's own too. */
  const share = useSpaceShare();
  const home = homeOf(summary, tree);

  /* Every row of the tree, in its section: the call a call's workspace is for, the calls kept in it, and everything else. */
  const theCall = home?.call?.folder.id ?? null;
  const calling: ListRow[] = [];
  const pages: ListRow[] = [];
  const calls: ListRow[] = [];
  let top: string | null = null;
  let topIsCall = false;
  for (const row of rowsOf(tree, ws.open, ws.draft?.parent)) {
    if (!row.draft && row.depth === 0) { top = row.item.id; topIsCall = row.item.call !== null; }
    const inCall = row.draft ? row.depth > 0 && topIsCall : topIsCall;
    (!inCall ? pages : top === theCall ? calling : calls).push(row);
  }
  const shownCalls = allCalls ? calls : (() => {
    let seen = 0;
    return calls.filter((r) => { if (!r.draft && r.depth === 0) seen++; return seen <= EARLIER; });
  })();
  const hidden = calls.filter((r) => !r.draft && r.depth === 0).length - EARLIER;

  const rowOf = (row: ListRow, label?: string | undefined): ReactElement => (row.draft ? parts.draftRow(row.depth) : parts.rowOf(row.item, 'tree', row.depth, row.open, row.depth === 0 && label ? { label } : {}));
  const callLabel = (row: ListRow): string | undefined => (!row.draft && row.depth === 0 && home && row.item.call ? callDayTitle(row.item.call.startedAt, new Date(now)) : undefined);

  /*
   * What's at the top, outside the calls' folders, and where + puts what it makes. In a call's own workspace that's all for the
   * call until it starts; from then on what the call makes is in its folder, under its row, and the rest is the workspace's own.
   */
  const before = home !== null && beforeTheCall(home, now);
  const pagesLabel = before ? 'For the call' : inside ? 'Pages' : 'Shared with you';
  const items = pages.length + calls.length + calling.length;
  return (
    <>
      <WsSide brand={<Link to="/home" aria-label="Alcove, Home"><Logo size={22} /></Link>}
        space={{ name: ws.spaceName, mark: <WsMark name={ws.spaceName} call={home !== null} />, picker: parts.picker, naming: parts.namingField, saveState: ws.spaceSave }}
        onSearch={ws.openFind} searchKeys={shortcut('K')} reconnecting={ws.listDown}
        listKey={ws.workspaceId} onKeyDown={parts.rowKeys} empty={items > 0 ? false : !inside ? 'shared' : ws.canChange ? 'yours' : 'others'}
        foot={parts.trashRow} sealed={whoCanOpen(people, sent.people)} share={share}>
        {home ? (
          calling.length > 0
            ? calling.map((row) => (row.draft ? parts.draftRow(row.depth) : parts.rowOf(row.item, 'tree', row.depth, row.open, row.depth === 0 ? { label: `The call, ${callDay(home.at, new Date(now))}`, place: true } : {})))
            : <WsRow key="place:call" id="place:call" kind="place" icon={CALL_ICON} name={`${home.title}, ${callDay(home.at, new Date(now))}`} out
              onOpen={() => { void navigate({ to: '/calls' }); }} />
        ) : inside && <WsRow key="place:home" id="place:home" kind="place" icon="home" name="Home" current={ws.at.kind === 'home'} onOpen={() => ws.go({ kind: 'home' })} />}
        <WsSection key="sec:pages" label={pagesLabel} add={parts.createTop} addLabel={tree.boards ? 'New document, folder or board' : 'New document or folder'} />
        {pages.map((row) => rowOf(row))}
        {calls.length > 0 && <WsSection key="sec:calls" label={home ? 'Earlier calls' : 'Calls'} />}
        {shownCalls.map((row) => rowOf(row, callLabel(row)))}
        {!allCalls && hidden > 0 && <WsRow key="place:more" id="place:more" kind="place" icon="more" name={`${hidden} more`} onOpen={() => setAllCalls(true)} />}
        {parts.dropLine}
      </WsSide>
      {parts.files}
    </>
  );
}

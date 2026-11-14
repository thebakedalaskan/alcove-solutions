/*
 * Share in the Drive. A workspace's, beside Open full screen at the head of its sheet: who's in it, the people sheet its Home
 * opens, where its admins add people and anyone in it can see who's there or leave. A document's or a board's, from its card's
 * ⋯, in place of the menu's rows: who has it, the sheet Share opens on its own page. Each is offered only to someone it's for:
 * a workspace's to whoever's in it, a file's to whoever can edit in its workspace, and the server says the rest.
 */
import type { WorkspaceSummary } from '@alcove/api';
import { Button, Dots, WsPopover, useToast, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { workspaceQueries } from '~/features/workspace/queries';
import { PeopleSheetFor, ShareSheetFor } from '~/features/workspace/sharing/Sheets';
import { fileName, type DriveFile } from './places';

/** What a sheet says it did, as one of the Drive's toasts. */
function useSay(): (toast: WsToastData) => void {
  const push = useToast();
  return useCallback((t: WsToastData) => { push(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms }); }, [push]);
}

/** Share, at the head of a workspace's sheet, for anyone in it: who's in it, `name` as the workspace calls itself. */
export function SpaceShare({ w, name }: { w: WorkspaceSummary; name: string }) {
  const [open, setOpen] = useState(false);
  const say = useSay();
  if (w.role === null) return null;
  return (
    <WsPopover open={open} onOpenChange={setOpen} label={`People in ${name}`} align="end"
      anchor={<Button variant="secondary" size="sm" icon="share" className="dv-share">Share</Button>}>
      {open && <PeopleSheetFor workspaceId={w.id} name={name} admin={w.role === 'admin'} say={say} teamAccess={w.teamAccess} />}
    </WsPopover>
  );
}

/**
 * Who has a document or a board, in its card's ⋯: the sheet goes by the file as its workspace has it, read from the tree the
 * workspace's sheet reads, so it's there at once inside a workspace and a moment later from Recent.
 */
export function FileShare({ file }: { file: DriveFile }) {
  const say = useSay();
  const tree = useQuery(workspaceQueries.workspaceTree(file.workspaceId));
  const item = tree.data?.items.find((i) => i.id === file.id && i.trashedAt === null);
  const name = fileName(file.kind, file.name);
  if (tree.isPending) return <p className="dv-pop-wait" role="status" aria-label="Opening who has it"><Dots /></p>;
  if (!item) return <p className="dv-pop-note">{tree.isError ? 'Who has it didn’t load. Alcove couldn’t be reached.' : `${name} isn’t in its workspace any more.`}</p>;
  if (item.role !== 'edit') return <p className="dv-pop-note">You can read {name}. Only someone who can edit it can share it.</p>;
  return <ShareSheetFor workspaceId={file.workspaceId} item={item} say={say} />;
}

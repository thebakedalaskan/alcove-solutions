/*
 * The Board button, beside Share because it does the same job: it puts something in front of everyone. With no board open it
 * opens the Board menu: a new board from a template, or one your team already has, from anywhere in your Drive, with any
 * brought to this call first. Picking a saved board some people here can't open asks first, in the same menu, before anything
 * opens. With a board open, the button hides it for you alone, and brings it back. On a phone the dock has no room for it, and
 * it's in More beside Share, as Share is there.
 */
import { errorCode, type BoardCheck, type BoardOpen, type CallBrought, type CallSession } from '@alcove/api';
import { BoardMenu, BoardMenuBody, DockButton, Icon, type BoardMenuAccess, type BoardMenuContent, type BoardMenuRecent, type BoardTemplate } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { log } from '~/lib/log';
import { listNames } from '~/lib/people';
import { q, type BoardToBring } from '~/lib/queries';
import { pastDay } from '~/lib/time';
import type { CallBoard } from './callBoard';

const mlog = log.child({ component: 'board-menu' });

/** How many boards your team already has the menu offers. */
const SHOWN = 3;

/** A saved board as the menu offers it. */
interface Offered { workspaceId: string; id: string; name: string; by: string; when: string; where: string | null }

/** The boards to offer: what's been brought to this call first, then the newest from your Drive, each once. */
function offered(brought: readonly CallBrought[], drive: readonly BoardToBring[], spaceName: (workspaceId: string) => string | null): Offered[] {
  const inDrive = new Map(drive.map((b) => [`${b.workspaceId}/${b.id}`, b]));
  const first = brought.filter((d) => d.kind === 'board' && d.role === 'edit').map((d): Offered => {
    const b = inDrive.get(`${d.workspaceId}/${d.id}`);
    return { workspaceId: d.workspaceId, id: d.id, name: d.name || 'Untitled board', by: b?.by ? b.by.split(' ')[0] ?? b.by : 'Brought to this call', when: b ? whenOf(b.editedAt) : '', where: b?.workspace ?? spaceName(d.workspaceId) };
  });
  const seen = new Set(first.map((b) => `${b.workspaceId}/${b.id}`));
  const rest = drive.filter((b) => !seen.has(`${b.workspaceId}/${b.id}`)).map((b): Offered => ({
    workspaceId: b.workspaceId, id: b.id, name: b.name || 'Untitled board', by: b.by ? b.by.split(' ')[0] ?? b.by : b.workspace ?? 'Your Drive', when: whenOf(b.editedAt), where: b.workspace
  }));
  return [...first, ...rest].slice(0, SHOWN);
}
/** When a board was last changed, as the menu says it: Today, Yesterday, Mon, or 2 Oct. */
const whenOf = (iso: string) => { const d = pastDay(iso); return d.charAt(0).toUpperCase() + d.slice(1); };

interface BoardMenuFrom {
  session: CallSession;
  board: CallBoard;
  /** You're in a breakout room: a new board is the room's alone, and saved boards stay the main room's. */
  inRoom: boolean;
  /** What's been brought to this call that you can open. */
  brought: readonly CallBrought[];
  /** What a workspace is called, where you can know it. */
  spaceName: (workspaceId: string) => string | null;
  /** The menu is showing, so the boards to offer are fetched. */
  showing: boolean;
  /** Puts the menu away once a board opens. */
  onDone: () => void;
  failed: (e: unknown) => void;
}

/** What the Board menu offers and does, wherever it opens. `reset` forgets the access step, as the menu closes. */
function useBoardMenu({ session, board, inRoom, brought, spaceName, showing, onDone, failed }: BoardMenuFrom): { content: BoardMenuContent; reset: () => void } {
  // Your Drive's workspaces, which reaching for the menu read already, then the boards in the newest of them.
  const spaces = useQuery({ ...q.workspaces(), enabled: showing && !inRoom }).data;
  const drive = useQuery({ ...q.boardsToBring(spaces ?? []), enabled: showing && !inRoom && spaces !== undefined });
  const [access, setAccess] = useState<{ board: Offered; check: BoardCheck } | null>(null);
  const [busy, setBusy] = useState(false);
  const bring = (from: BoardOpen, says: string | null) => {
    setBusy(true);
    if (says) board.expect(says);
    session.openBoard(from).then(() => { setAccess(null); onDone(); }, (e: unknown) => { board.expect(''); failed(e); }).finally(() => setBusy(false));
  };
  const onTemplate = (template: BoardTemplate) => bring({ template }, null);
  const rows = offered(brought, drive.data ?? [], spaceName);
  const onRecent = (id: string) => {
    const b = rows.find((r) => r.id === id);
    if (!b || busy) return;
    setBusy(true);
    session.boardCheck(b.workspaceId, b.id).then((check) => {
      if (check.cannot.length) { setAccess({ board: b, check }); setBusy(false); return; }
      setBusy(false);
      bring({ workspaceId: b.workspaceId, documentId: b.id, letIn: false }, `${b.name} is open for everyone here.`);
    }, (e: unknown) => { setBusy(false); mlog.info('a board couldn’t be checked before opening', { workspaceId: b.workspaceId, documentId: b.id, code: errorCode(e) }); failed(e); });
  };
  const places = new Set(rows.map((r) => r.where ?? ''));
  const one = places.size === 1 ? [...places][0] : undefined;
  const recents = rows.length ? {
    workspace: one ? one : 'your Drive',
    // From several workspaces, each says which it's in, beside whose it is.
    boards: rows.map((r): BoardMenuRecent => ({ id: r.id, name: r.name, by: one || !r.where || r.where === r.by ? r.by : `${r.by} · ${r.where}`, when: r.when, thumb: <Icon name="presentation" size={17} /> }))
  } : undefined;
  const names = access ? listNames(access.check.cannot.map((n) => ({ name: n, email: '' }))) : '';
  const asking: BoardMenuAccess | undefined = access ? {
    names: access.check.cannot, board: access.board.name, where: access.board.where ?? 'another workspace',
    onLetIn: access.check.mayLetIn ? () => bring({ workspaceId: access.board.workspaceId, documentId: access.board.id, letIn: true }, `${names} can open this board until the call ends.`) : undefined,
    onWithout: () => bring({ workspaceId: access.board.workspaceId, documentId: access.board.id, letIn: false }, `${access.board.name} is open. ${names} can’t open it.`)
  } : undefined;
  return { content: { inRoom, recents, access: asking, busy, onTemplate, onRecent }, reset: () => setAccess(null) };
}

export function BoardButton({ session, board, inRoom, brought, spaceName, canStart, open, onOpenChange, onToggle, failed }: Omit<BoardMenuFrom, 'showing' | 'onDone'> & {
  /** You may start one here: you're invited, not a guest. */
  canStart: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button, with a board open: hides it for you, or brings it back. */
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const isOpen = board.open !== null;
  const menu = useBoardMenu({ session, board, inRoom, brought, spaceName, showing: open && canStart && !isOpen, onDone: () => onOpenChange(false), failed });
  if (!isOpen && !canStart) return null;

  const change = (o: boolean) => {
    if (isOpen) { onToggle(); return; }
    if (!o) menu.reset();
    onOpenChange(o);
  };
  const label = !isOpen ? 'Board' : board.hidden ? 'Show the board' : 'Hide the board for you';
  const tip = !isOpen ? 'Board · O' : board.hidden ? 'Show the board · O' : 'Hide the board, for you alone · O';
  // Reaching for the menu reads only your Drive's list, one request, so the boards in it come straight after as the menu opens.
  const reach = () => { if (!isOpen && canStart && !inRoom) void qc.prefetchQuery(q.workspaces()); };
  return (
    <BoardMenu open={open && !isOpen} onOpenChange={change} tip={tip} {...menu.content}
      anchor={<DockButton icon="presentation" label={label} title={undefined} on={isOpen && !board.hidden} aria-keyshortcuts="O" className="d-board" onPointerEnter={reach} />} />
  );
}

/** The Board menu inside More, on a phone. More's popover takes the menu's class (`bl`) while it shows. */
export function BoardMoreView(props: Omit<BoardMenuFrom, 'showing'>) {
  const menu = useBoardMenu({ ...props, showing: true });
  return <BoardMenuBody {...menu.content} />;
}

/*
 * The board picker (docs: Calls and recordings › A board in a call): under Board at the top right, where it opens a board on
 * your stage just for you, and in Share › A board, where it presents one straight away.
 *
 * - In this call: the board the call has, if it has one.
 * - New: Blank, Retro, Ideas or Flow. A new board is the board in the call, as the call's boards always are, but it opens only
 *   for whoever made it, until they present it.
 * - Your team's boards: what's been brought to this call first, then the newest from your Drive. Opening one just for you
 *   touches nothing in the call; presenting one brings it in first, and if some people here can't open it, asks first.
 *
 * Nobody can make or bring in a board while someone else presents one here, and a guest can't start one. In Share, where
 * what's picked is presented, nothing is picked while someone else presents a board or the workspace here. A call with no
 * workspace yet has nowhere to keep a new board, so New waits until its organizer picks or makes one; saved boards still open.
 */
import { AlcoveApiError, errorCode, firstName, type BoardCheck, type BoardOpen, type CallBrought, type CallPresent, type CallSession } from '@alcove/api';
import { Icon, type BoardPickerAccess, type BoardPickerRecent, type BoardPickerInCall, type BoardPickerProps, type BoardTemplate } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { log } from '~/lib/log';
import { listNames } from '~/lib/people';
import { q, type BoardToBring } from '~/lib/queries';
import { pastDay } from '~/lib/time';
import type { CallBoard, SavedBoard } from './callBoard';

const mlog = log.child({ component: 'board-picker' });

/** How many boards your team already has the picker offers. */
const SHOWN = 3;

/** A saved board as the picker offers it. */
export interface Offered { workspaceId: string; id: string; name: string; by: string; when: string; where: string | null }

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
/** When a board was last changed, as the picker says it: Today, Yesterday, Mon, or 2 Oct. */
const whenOf = (iso: string) => { const d = pastDay(iso); return d.charAt(0).toUpperCase() + d.slice(1); };

/**
 * Why nothing else can be presented where you are: someone else presents a board or the workspace there, one at a time. Share's
 * A board and The workspace say it, and so does the board picker in Share.
 */
export const presentingWhy = (theirs: Pick<CallPresent, 'by'>): string => `${firstName(theirs.by.name)} is presenting. You can present once they stop.`;

/**
 * Brings a board into the call if it isn't the board in it (`from`), and presents it from its first frame. What the call
 * says when it opens (`says`, such as who it let in) is told to whoever brought it. While someone else presents a board or
 * the workspace here, nothing is made or brought in: it couldn't be presented until they stop.
 */
export async function bringAndPresent(session: CallSession, board: CallBoard, from: BoardOpen | null, says: string | null): Promise<void> {
  const theirs = session.getSnapshot().workspace.present;
  if (theirs && !theirs.mine) throw new AlcoveApiError('conflict', presentingWhy(theirs));
  if (from) {
    if (says) board.expect(says);
    try { await session.openBoard(from); } catch (e) { board.expect(''); throw e; }
  }
  const id = session.getSnapshot().board.open?.documentId;
  if (!id) return;
  await session.startPresenting({ kind: 'board', id });
}

/** Who can't open a saved board, as the question before presenting it asks. */
export function accessAsk(check: BoardCheck, b: { workspaceId: string; id: string; name: string; where: string | null }, go: (letIn: boolean, says: string) => void): BoardPickerAccess {
  const names = listNames(check.cannot.map((n) => ({ name: n, email: '' })));
  return {
    names: check.cannot, board: b.name, where: b.where ?? 'another workspace',
    onLetIn: check.mayLetIn ? () => go(true, `${names} can open this board until the call ends.`) : undefined,
    onWithout: () => go(false, `${b.name} is open. ${names} can’t open it.`)
  };
}

interface PickerFrom {
  session: CallSession;
  board: CallBoard;
  /** Under Board, it opens on your stage just for you; in Share › A board, it's presented straight away. */
  mode: 'open' | 'present';
  /** You're in a breakout room: a new board is the room's alone, and saved boards stay the main room's. */
  inRoom: boolean;
  /** You have an account, and so a Drive to offer boards from: a guest has neither, and asking would be refused. */
  account: boolean;
  /** What's been brought to this call that you can open. */
  brought: readonly CallBrought[];
  /** What a workspace is called, where you can know it. */
  spaceName: (workspaceId: string) => string | null;
  /** The picker is showing, so the boards to offer are fetched. */
  showing: boolean;
  /** Why nothing can be made or brought in now: someone else presents a board here (in Share, or the workspace), or you're a guest. */
  blocked: string | undefined;
  /** Why a new board can't be made, though a saved one can be opened: the call has no workspace to keep it in yet. */
  newWhy: string | undefined;
  /** The board in the call, as the picker's first row says it, or nothing. */
  inCall: { name: string; by: string } | null;
  /** The board in the call, on your stage (following whoever presents it). */
  onOpenCall: () => void;
  /** A saved board, on your stage just for you. */
  onOpenSaved: (b: SavedBoard) => void;
  /** A board you made, on your stage just for you. */
  onMade: () => void;
  /** A board you present, on your stage and everyone's. */
  onPresented: (name: string) => void;
  /** Puts the picker away once something's chosen. */
  onDone: () => void;
  failed: (e: unknown) => void;
}

/** What the board picker offers and does, wherever it opens. `reset` forgets the access question, as the picker closes. */
export function useBoardPicker({ session, board, mode, inRoom, account, brought, spaceName, showing, blocked, newWhy, inCall, onOpenCall, onOpenSaved, onMade, onPresented, onDone, failed }: PickerFrom): { picker: BoardPickerProps; reset: () => void } {
  // Your Drive's workspaces, which reaching for the picker read already, then the boards in the newest of them.
  const spaces = useQuery({ ...q.workspaces(), enabled: showing && !inRoom && account }).data;
  const drive = useQuery({ ...q.boardsToBring(spaces ?? []), enabled: showing && !inRoom && account && spaces !== undefined });
  const [access, setAccess] = useState<BoardPickerAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = offered(brought, drive.data ?? [], spaceName);
  const present = (from: BoardOpen | null, says: string | null) => {
    setBusy(true);
    const name = from && 'documentId' in from ? rows.find((r) => r.id === from.documentId)?.name ?? 'the board' : null;
    bringAndPresent(session, board, from, says).then(() => {
      setAccess(null);
      onDone();
      onPresented(name ?? session.getSnapshot().board.open?.name ?? 'the board');
    }, failed).finally(() => setBusy(false));
  };
  const onTemplate = (template: BoardTemplate) => {
    if (mode === 'present') { present({ template }, null); return; }
    setBusy(true);
    session.openBoard({ template }).then(() => { onDone(); onMade(); }, failed).finally(() => setBusy(false));
  };
  const onRecent = (id: string) => {
    const b = rows.find((r) => r.id === id);
    if (!b || busy) return;
    if (mode === 'open') { onDone(); onOpenSaved({ workspaceId: b.workspaceId, documentId: b.id, name: b.name }); return; }
    setBusy(true);
    session.boardCheck(b.workspaceId, b.id).then((check) => {
      setBusy(false);
      const from = (letIn: boolean): BoardOpen => ({ workspaceId: b.workspaceId, documentId: b.id, letIn });
      if (check.cannot.length) { setAccess(accessAsk(check, b, (letIn, says) => present(from(letIn), says))); return; }
      present(from(false), null);
    }, (e: unknown) => { setBusy(false); mlog.info('a board couldn’t be checked before presenting', { workspaceId: b.workspaceId, documentId: b.id, code: errorCode(e) }); failed(e); });
  };
  // Your team's boards, each saying whose it is and which workspace it's in.
  const recents = rows.length ? {
    workspace: '',
    boards: rows.map((r): BoardPickerRecent => ({ id: r.id, name: r.name, by: !r.where || r.where === r.by ? r.by : `${r.by} · ${r.where}`, when: r.when, thumb: <Icon name="presentation" size={17} /> }))
  } : undefined;
  const callRow: BoardPickerInCall | undefined = inCall ? {
    name: inCall.name, by: inCall.by,
    onOpen: () => {
      onDone();
      if (mode === 'open') { onOpenCall(); return; }
      present(null, null);
    }
  } : undefined;
  return {
    picker: { inCall: callRow, blocked, newWhy, inRoom, recents, access: access ?? undefined, busy, onTemplate, onRecent },
    reset: () => setAccess(null)
  };
}

/*
 * A board on its own page, beside the list. The board's bar is the page's head: its name, with everything about the board
 * itself under it, and its seal, which says how it's saving. Reconnecting and Couldn't save take the pill at the top of the
 * sheet too, as in a call. Someone who can only look has no tools, and the seal says View only. Who else is here sits at the
 * end of the bar, beside Start a call here. What's done offline is kept on this device, as a document's is, and goes when
 * the connection's back; a board that goes from under someone says so in its place. More beside the tools has what it has in a
 * call: a picture kept in the board's files, a link to something in this workspace, a table, a mind map, a comment and a
 * template. On a phone the page is the phone's board: no tools beside it, + to add a sticky, and it opens where it can be read.
 */
import { errorCode, firstName, type WorkspaceItem } from '@alcove/api';
import type { BoardReply } from '@alcove/board';
import { BoardPop, Button, WsCantOpen, WsDoc, WsDocHead, WsGoneBar, WsOfflineEmpty, WsPopover, WsUnavailable, wsToast, type AvatarPerson, type BoardNaming, type IconName } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { boardPictures, boardUpload, linkableIn } from '~/features/board/around';
import type { BoardCommenting } from '~/features/board/comments';
import { BoardSurface } from '~/features/board/lazy';
import type { BoardLinks } from '~/features/board/more/objects';
import { useBoardPeople } from '~/features/board/people';
import { FollowingPill, StandingPill } from '~/features/board/pills';
import { sealedOnPage, standingOf, useChangesSinceSaved, type PopRow } from '~/features/board/standing';
import { useCallFlow } from '~/features/shell/context';
import { useLive, useMedia, useOnline } from '~/lib/live';
import { log } from '~/lib/log';
import { q, useSortStickies } from '~/lib/queries';
import { focusRow } from './actions';
import { useWs, type Ws } from './context';
import { canKeepEdits } from './keep';
import { useBackOnline, useOpensAgain, useSession, type Opened } from './opened';
import { ShareSheet } from './Sheets';
import { foldersAbove, nameOf } from './tree';

/** Where a board is: its workspace and the folders it's in. Its own name is on its bar, below. */
const crumbsAbove = (ws: Ws, item: WorkspaceItem): string[] => [...(ws.sent.name === null ? [] : [ws.spaceName]), ...foldersAbove(ws.tree, item.id).map(nameOf)];

const blog = log.child({ component: 'board-page' });

/**
 * Start a call here: the start flow, with this board brought to the call from your library, and opened for everyone as the
 * call starts when you can add to it. What you can bring is read as the page opens, so it's there by the time you press.
 */
function useStartHere(workspaceId: string, item: WorkspaceItem, name: string): () => void {
  const flow = useCallFlow();
  const qc = useQueryClient();
  useQuery(q.documents());
  return useCallback(() => {
    qc.ensureQueryData(q.documents()).then((library) => {
      const brought = library.workspaces.find((w) => w.id === workspaceId)?.documents.find((d) => d.item === item.id);
      flow.start(brought ? { documents: [brought], ...(item.role === 'edit' ? { open: { workspaceId, documentId: item.id, name } } : {}) } : {});
    }, (e: unknown) => {
      blog.info('what you can bring wasn’t read; the call starts without the board', { workspaceId, code: errorCode(e) });
      flow.start();
    });
  }, [flow, qc, workspaceId, item.id, item.role, name]);
}

/** What's open from the bar: the menu under the name, what the seal says, or the share sheet. */
type Pop = 'name' | 'seal' | 'share' | null;

/** "Rename, share or copy a link": what the menu under the name lets this person do, for its tip. */
function nameTip(doing: readonly string[]): string {
  const said = doing.length > 1 ? `${doing.slice(0, -1).join(', ')} or ${doing.at(-1) ?? ''}` : doing[0] ?? '';
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** The menu under the board's name, on the sheet, closing with Escape or a press anywhere else but the name. */
function NameMenu({ items, onClose }: { items: { id: string; icon: IconName; label: string; onPick: () => void }[]; onClose: () => void }) {
  const { ref, top } = usePopOnSheet(onClose, '.bd-head .nm');
  return <BoardPop ref={ref} left={12} top={top} label="The board" items={items} />;
}

/** What the seal says when it's pressed: how the board stands now. */
function SealPop({ title, rows, onClose }: { title: string; rows: PopRow[]; onClose: () => void }) {
  const { ref, top } = usePopOnSheet(onClose, '.bd-head .sv', title);
  return <BoardPop ref={ref} left={12} top={top} title={title} rows={rows} />;
}

/** Where a pop sits on the sheet: under the bar, or under the pill when there's one, which says what's wrong and holds Try again. */
const POP_TOP = 62;
const UNDER_PILL = 8;

/**
 * A pop over the sheet: focus goes into it, and Escape, or a press anywhere but on it or the bar's name and seal, closes it.
 * Escape gives the keys back to what opened it, `opener` on the bar, so the board's keys go on working. It sits under the pill,
 * found again whenever `standing` changes, as that's when a pill comes or goes.
 */
function usePopOnSheet(close: () => void, opener: string, standing = '') {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;
  const [top, setTop] = useState(POP_TOP);
  useLayoutEffect(() => {
    const el = ref.current, sheet = el?.offsetParent;
    if (!(sheet instanceof HTMLElement)) return;
    // By its layout, not how it's drawn now: a pill that has just come is still easing in, smaller than it will be.
    const pill = sheet.querySelector('.bd-pill');
    setTop(pill instanceof HTMLElement ? Math.max(POP_TOP, pill.offsetTop + pill.offsetHeight + UNDER_PILL) : POP_TOP);
  }, [standing]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const first = el.querySelector<HTMLElement>('button');
    if (first) first.focus({ preventScroll: true });
    else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const back = el.closest('.bd')?.querySelector<HTMLElement>(opener);
      latest.current();
      back?.focus({ preventScroll: true });
    };
    const onPress = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || el.contains(e.target) || e.target.closest('.bd-head .nm, .bd-head .sv')) return;
      latest.current();
    };
    el.addEventListener('keydown', onKey);
    addEventListener('pointerdown', onPress, true);
    return () => {
      el.removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onPress, true);
    };
  }, [opener]);
  return { ref, top };
}

/** Waiting for the board to open: the page with nothing on it yet, or, with no connection, what's said about that. */
export function BoardPane({ item }: { item: WorkspaceItem }) {
  const ws = useWs();
  const { opened, reopen } = useSession(ws, item.id);
  const online = useOnline();
  if (!opened) return <WsDoc className="is-board"><WsDocHead crumbs={crumbsAbove(ws, item)} save="quiet" onToggleList={ws.toggleList} />{!online && <WsOfflineEmpty />}</WsDoc>;
  return <OpenedBoard key={opened.round} ws={ws} item={item} opened={opened} reopen={reopen} />;
}

function OpenedBoard({ ws, item, opened, reopen }: { ws: Ws; item: WorkspaceItem; opened: Opened; reopen: () => void }) {
  const { session, ready } = opened;
  const status = useLive(session);
  const online = useOnline();
  const offline = status.status === 'offline' || (!online && status.status !== 'failed');
  useOpensAgain(status, ready, reopen);
  useBackOnline(ws, session, offline, status);
  const changes = useChangesSinceSaved(opened.session, status);
  const { mutateAsync: sortIn } = useSortStickies(ws.pass);
  const [pop, setPop] = useState<Pop>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const member = ws.sent.role !== null;
  const trashed = item.trashedAt !== null || status.trashed || status.refused === 'trashed';
  const gone = status.closed === 'access' || status.closed === 'deleted';
  // A session that's ended takes nothing more: anything added there would have nowhere to go.
  const readOnly = item.role !== 'edit' || trashed || status.role === 'read' || status.refused === 'read-only' || (status.closed !== null && status.closed !== 'session');
  const canShare = member && item.role === 'edit';
  const name = nameOf(item);
  const startHere = useStartHere(ws.workspaceId, item, name);
  // Edits kept on this device go again from there when it opens again: without them, nothing would be left to try.
  const tryAgain = ws.owner !== null && canKeepEdits() ? reopen : undefined;
  // Someone it's shared with from outside the workspace isn't told what the workspace is called.
  const kept: PopRow | null = member ? { icon: 'lock', text: `Saved in ${ws.spaceName}.` } : null;
  const standing = standingOf({ status, offline: offline && ready, readOnly, changes, tryAgain, kept, sealed: sealedOnPage(kept) });

  /*
   * Who's here, by what they're known by in the workspace: their face from who's in it now, else from its people, else their
   * name alone.
   */
  const here = ws.here;
  const members = useQuery({ ...q.workspacePeople(ws.workspaceId), enabled: member }).data;
  /*
   * Whether everyone who can open it can add to it, as a blank board says: nobody in the workspace who can open it only reads, and
   * nobody it's shared with does either. Only someone who can share it can see who it's shared with, so anyone else isn't told.
   */
  const shares = useQuery({ ...q.documentShare(ws.workspaceId, item.id), enabled: canShare }).data;
  const everyone = members !== undefined && shares !== undefined && (shares.restricted || members.every((p) => p.role !== 'read')) && shares.entries.every((e) => e.role === 'edit');
  const face = useCallback((id: string, named: string): AvatarPerson => (
    here.find((h) => h.person.id === id)?.person ?? members?.find((p) => p.person.id === id || (named !== '' && p.person.name === named))?.person ?? { name: named || 'Someone' }
  ), [here, members]);
  const me = here.find((h) => h.isMe)?.person;
  const people = useBoardPeople(session.awareness, face, me?.id);
  const commenting = useMemo((): BoardCommenting => ({
    me: readOnly || !ws.me ? null : { by: me?.id ?? '', name: ws.me.name },
    person: me ?? ws.me ?? { name: 'You' },
    face: (r: BoardReply) => face(r.by, r.name),
    onResolved: (reopenThread) => ws.say(wsToast.resolved(reopenThread))
  }), [readOnly, ws.me, me, face, ws.say]);

  /*
   * What the board reaches outside itself, as it does in a call: the pictures on it, read through it; Image and From your
   * workspace under More, for whoever can add to it; and each link's name for this person, which opens it here.
   */
  const { workspaceId, pass, items: inTree, go } = ws;
  const pictures = useMemo(() => boardPictures(workspaceId, item.id, pass), [workspaceId, item.id, pass]);
  const upload = useMemo(() => (readOnly ? undefined : boardUpload(workspaceId, item.id, pass)), [readOnly, workspaceId, item.id, pass]);
  const linkable = useMemo(() => linkableIn(inTree), [inTree]);
  const links = useMemo((): BoardLinks => {
    const named = new Map(linkable.map((i) => [i.id, i]));
    return { itemFor: (id) => named.get(id) ?? null, open: (id) => go({ kind: 'document', id }) };
  }, [linkable, go]);
  const toLink = useMemo(() => (readOnly ? undefined : { items: linkable.filter((i) => i.id !== item.id) }), [readOnly, linkable, item.id]);
  // The workspace's own phone width, where the list and the page take turns.
  const phone = useMedia('(max-width: 640px)');

  const nameButton = () => wrap.current?.querySelector<HTMLElement>('.bd-head .nm') ?? null;
  const backToName = () => requestAnimationFrame(() => nameButton()?.focus({ preventScroll: true }));
  const closePop = () => setPop(null);
  const nameField: BoardNaming | undefined = naming === null ? undefined : {
    value: naming,
    onChange: setNaming,
    onDone: () => {
      const to = naming.replace(/\s+/g, ' ').trim();
      setNaming(null);
      if (to && to !== name) ws.actions.rename(item.id, to);
      backToName();
    },
    onCancel: () => { setNaming(null); backToName(); }
  };
  const showInList = () => {
    if (ws.listOff || matchMedia('(max-width: 640px)').matches) ws.toggleList();
    focusRow(item.id);
  };
  const canRename = item.role === 'edit' && !trashed;
  const items = [
    ...(canRename ? [{ id: 'rename', icon: 'pen' as const, label: 'Rename', onPick: () => { closePop(); setNaming(name); } }] : []),
    // Someone it's shared with from outside the workspace isn't told what the workspace is called.
    ...(member ? [{ id: 'saved', icon: 'folderOpen' as const, label: `Saved in ${ws.spaceName}`, onPick: () => { closePop(); showInList(); } }] : []),
    ...(canShare ? [{ id: 'share', icon: 'people' as const, label: 'Who can add to it', onPick: () => setPop('share') }] : []),
    // The page is as it was, so the keys go back to the name, where the board's keys still reach.
    { id: 'link', icon: 'link' as const, label: 'Copy link', onPick: () => { closePop(); ws.actions.copyLink(item.id); backToName(); } }
  ];
  const nameTitle = nameTip([...(canRename ? ['rename'] : []), ...(canShare ? ['share'] : []), 'copy a link']);

  // Whatever the bar opened goes with what it was about.
  useEffect(() => { if (readOnly) setNaming(null); }, [readOnly]);

  const where = crumbsAbove(ws, item);
  if (gone) {
    return (
      <WsDoc>
        <WsDocHead crumbs={ws.sent.name === null ? [] : [ws.spaceName]} save="quiet" onToggleList={ws.toggleList} />
        <WsCantOpen what="board" action={<Button size="sm" onClick={() => ws.go({ kind: 'home' }, { replace: true })}>Back to {ws.spaceName}</Button>} />
      </WsDoc>
    );
  }
  if (!ready) return <WsDoc className="is-board"><WsDocHead crumbs={where} save="quiet" onToggleList={ws.toggleList} />{status.closed === 'unavailable' ? <WsUnavailable /> : offline && <WsOfflineEmpty />}</WsDoc>;

  const who = item.trashedBy ? firstName(item.trashedBy) : 'Someone';
  return (
    <WsDoc className="is-board">
      <WsDocHead crumbs={where} save="quiet" onToggleList={ws.toggleList} />
      <WsGoneBar what="board" who={trashed ? who : null} onRestore={item.role === 'edit' ? () => ws.actions.restore(item.id) : undefined} unsent={status.unsent} />
      <div ref={wrap} className="bpg">
        <Suspense>
          <BoardSurface doc={session.doc} awareness={session.awareness} mode={readOnly ? 'pageRead' : phone ? 'pagePhone' : 'page'} name={name} naming={nameField}
            nameTitle={nameTitle} seal={standing.seal} sealIcon={standing.icon} sealTitle={standing.title} everyone={everyone} people={people} comments={commenting}
            pictures={pictures} upload={upload} workspace={toLink} links={links}
            onName={() => setPop((p) => (p === 'name' ? null : 'name'))} onSeal={() => setPop((p) => (p === 'seal' ? null : 'seal'))}
            onCall={startHere} onSort={readOnly ? undefined : (stickies) => sortIn({ workspaceId: ws.workspaceId, documentId: item.id, stickies })}
            pill={(following, stop) => ({ standing: standing.pill && <StandingPill pill={standing.pill} />, following: following && <FollowingPill person={following} onStop={stop} /> })}>
            {pop === 'name' && <NameMenu items={items} onClose={closePop} />}
            {pop === 'seal' && <SealPop title={standing.pop.title} rows={standing.pop.rows} onClose={closePop} />}
          </BoardSurface>
        </Suspense>
        {pop === 'share' && (
          <WsPopover open onOpenChange={(to) => { if (!to) { closePop(); backToName(); } }} at={() => nameButton()?.getBoundingClientRect() ?? new DOMRect()} label="Who can add to it">
            <ShareSheet item={item} />
          </WsPopover>
        )}
      </div>
    </WsDoc>
  );
}

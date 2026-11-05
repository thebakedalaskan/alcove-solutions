/*
 * The workspace in a call: whether it's open, where you are in it, and the panel it's drawn in. The call says which
 * workspace (`CallState.workspace`, settled the first time anyone opens it); nothing here decides who can open what.
 *
 * Closing it and opening it again finds everything as it was: the panel stays mounted once it's been opened, out of sight
 * (PanelHost.tsx), so the page keeps its caret, its scroll and its undo, and where you were is kept with how you arranged
 * this call (view.ts), so a reload finds that too. Only your screen changes, whatever you do here.
 */
import { errorMessage, firstName, type CallSession, type CallWorkspace, type Person } from '@alcove/api';
import { WsLostSpace, WsNoAccess, WsPane, useToast, wsToast, type WsToastData } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CallPerson, CallTogether, WorkspaceCall, WorkspacePlace, WorkspacePlaying, WorkspacePresenting, WorkspaceTogether } from '~/features/workspace/context';
import { LiveRows } from '~/features/workspace/live/LiveRows';
import { OutsideSpace } from '~/features/workspace/live/OutsideSpace';
import type { LiveCall } from '~/features/workspace/live/types';
import { presentingStrip } from '~/features/workspace/Presentation';
import { Workspace } from '~/features/workspace/Workspace';
import { overlayOpen } from '~/lib/keys';
import { log } from '~/lib/log';
import { q, useMentionSeen } from '~/lib/queries';
import type { CallView } from './view';

const wlog = log.child({ component: 'call-workspace' });

const NOBODY_TOGETHER: CallTogether = { followable: [], following: null, writing: [], where: {} };
/** How long someone's tile stays lit for being tagged. */
const LIT_MS = 2600;
/** How often someone who hasn't opened the workspace in this call looks for tags: once it's open, its stream says. */
const TAGS_MS = 20_000;

/** Where a workspace opens: this call's agenda, or the first thing brought to it. With neither, it opens what you had open last. */
function firstPlace(w: CallWorkspace): WorkspacePlace {
  const id = w.agenda ?? w.documents.find((d) => d.workspaceId === w.id)?.id;
  return id ? { kind: 'document', id, area: 'pins' } : { kind: 'home' };
}

/** What the call's screen holds about the workspace. One a call has for good: everything in `act` keeps the same identity. */
export function useWorkspacePanel(session: CallSession, workspace: CallWorkspace, view: CallView) {
  const push = useToast();
  const kept = view.layout.workspace;
  const [open, setOpen] = useState(kept.open);
  const [mounted, setMounted] = useState(kept.open);
  const [at, setAt] = useState<WorkspacePlace>(kept.document ? { kind: 'document', id: kept.document } : { kind: 'home' });
  const [zen, setZen] = useState(false);
  const [peek, setPeek] = useState(false);
  /** ⌘K asked for Find, and the workspace hasn't heard yet. */
  const [finding, setFinding] = useState(false);
  /** The call has said which workspace it uses, for this browser. */
  const [settled, setSettled] = useState(false);
  const asked = useRef(false);
  /** What the tiles show of people working together. */
  const [together, setTogether] = useState<CallTogether>(NOBODY_TOGETHER);
  /** Whose tile just lit up, for being tagged. */
  const [lit, setLit] = useState<string | null>(null);
  const reach = useRef<WorkspaceTogether | null>(null);
  const unlit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(unlit.current), []);

  /** What the workspace said last: it says one thing at a time, so a second toast never climbs over the foot of the list. */
  const said = useRef<(() => void) | null>(null);
  const act = useMemo(() => {
    const show = (t: WsToastData) => push(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms });
    const say = (t: WsToastData) => { said.current?.(); said.current = show(t); };
    const failed = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
    const reveal = () => { setMounted(true); setOpen(true); };
    const hide = () => { setOpen(false); setZen(false); setPeek(false); setFinding(false); };
    return {
      say, failed, hide, reveal,
      /** A workspace that won't open any more: back to the call, which is asked again, so what opens next time is what it says now. */
      leave: () => { hide(); session.openWorkspace().catch(failed); },
      /** A toast of the call's own, beside whatever the workspace is saying. It returns what takes it away. */
      announce: show,
      toggle: () => { if (openNow.current) hide(); else reveal(); },
      /** ⌘K: Find, with the workspace opened for it. */
      find: () => { reveal(); setFinding(true); },
      found: () => setFinding(false),
      /** Opens it where you were, as for a presentation. */
      show: reveal,
      go: (to: WorkspacePlace) => { setAt(to); setPeek(false); },
      /** Just the document, which opens the workspace if it has to, or everything back. */
      setZen: (on: boolean) => { if (on) reveal(); setZen(on); },
      setPeek,
      bring: (id: string, brought: boolean) => {
        const name = () => session.getSnapshot().workspace.documents.find((d) => d.id === id)?.name || 'Untitled';
        session.bringDocument(id, brought).then(() => { if (brought) say(wsToast.broughtToCall(name())); }, failed);
      },
      /** Opens the workspace at this place. */
      openAt: (to: WorkspacePlace) => { setAt(to); setPeek(false); reveal(); },
      /** Follow, on a tile. */
      follow: (connection: string) => { reach.current?.follow(connection); },
      stopFollowing: () => { reach.current?.stop(); },
      setTogether,
      /** The tile's ring pulses once. */
      tagged: (connection: string) => {
        clearTimeout(unlit.current);
        setLit(connection);
        unlit.current = setTimeout(() => setLit(null), LIT_MS);
      },
      /** A workspace of their own, for an organizer who's lost the one the call uses. */
      newWorkspace: () => {
        session.newWorkspace().then(() => {
          const w = session.getSnapshot().workspace;
          setAt(firstPlace(w));
          say(wsToast.newSpace(w.name ?? 'Untitled'));
        }, failed);
      }
    };
  }, [push, session]);
  const openNow = useRef(open);
  openNow.current = open;

  /* Tagged here with the workspace not open: the call says so, and nothing moves until Go there. Someone with no account has only their stream. */
  const signedIn = !!useQuery(q.session()).data;
  const waiting = useQuery({ ...q.mentions(), enabled: signedIn && !mounted && workspace.id !== null, refetchInterval: TAGS_MS }).data;
  const saidSeen = useMentionSeen();
  const seen = saidSeen.mutate;
  const told = useRef(new Set<string>());
  useEffect(() => {
    const next = waiting?.find((m) => m.workspaceId === workspace.id && !told.current.has(m.id));
    if (!next) return;
    told.current.add(next.id);
    act.announce(wsToast.tagged(next.by, firstName(next.by.name), next.name || 'Untitled', () => act.openAt({ kind: 'document', id: next.document, block: next.block ?? undefined })));
    seen({ workspaceId: next.workspaceId, mention: next.id });
  }, [waiting, workspace.id, act, seen]);

  /* The first time it opens here, the call settles which workspace it uses, and finds its agenda. */
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    session.openWorkspace().then(() => {
      const w = session.getSnapshot().workspace;
      setAt((was) => (was.kind === 'home' ? firstPlace(w) : was));
      setSettled(true);
    }, (e: unknown) => {
      wlog.warn('the call’s workspace didn’t open', { err: e });
      asked.current = false;
      act.hide();
      act.failed(e);
    });
  }, [open, session, act]);

  /* The call moved to another workspace: what was open here isn't in that one. */
  const was = useRef(workspace.id);
  useEffect(() => {
    if (workspace.id === null) return;
    if (was.current !== null && was.current !== workspace.id) setAt(firstPlace(session.getSnapshot().workspace));
    was.current = workspace.id;
  }, [workspace.id, session]);

  /* Where you are, for a reload. */
  const openId = at.kind === 'document' ? at.id : null;
  const keep = useRef(view.keepWorkspace);
  keep.current = view.keepWorkspace;
  useEffect(() => { keep.current({ open, document: openId }); }, [open, openId]);

  /*
   * Esc puts away what's over the page, then gives everything back. Before either: a menu, a sheet or a drag, which take it on
   * the window, then whatever's being edited (`editing`). With only the caret in the document, the editor never sees it.
   */
  useEffect(() => {
    if (!zen && !peek) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen() || document.querySelector('.ws-pop, .wh') || editing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (peek) setPeek(false);
      else setZen(false);
    };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [zen, peek]);

  return { open, mounted, at, zen, peek, settled, finding, act, together, lit, reach };
}
export type WorkspacePanelState = ReturnType<typeof useWorkspacePanel>;

/**
 * Something being edited keeps Esc for itself: a field (a rename cancels, the chat box keeps its words), or words selected in a
 * document, whose format bar goes first.
 */
function editing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest('input, textarea, select')) return true;
  const selected = document.getSelection();
  return t.isContentEditable && selected !== null && !selected.isCollapsed;
}

const LIVE_ROWS = <LiveRows />;

/** The workspace as the panels say it stands, in a call. The call's screen renders far more often than this changes, so nothing here is drawn again unless it has to be. */
export const WorkspacePanel = memo(function WorkspacePanel({ workspace, organizer, pass, at, settled, showing, finding, zen, listOff, listPeek, live, act, reach, people, invited, presenting, playing, onToggleList, onShowList, onToggleZen }: {
  workspace: CallWorkspace;
  /** What's presented where you are, and what you're doing about it (presenting.ts). */
  presenting: WorkspacePresenting;
  /** What's playing for everyone, when there's somewhere to read a video from (PlayTogether.tsx). */
  playing: WorkspacePlaying | undefined;
  /** Who's in the call, and who's invited if you can know, for `@`. */
  people: readonly CallPerson[];
  invited: readonly Person[];
  reach: WorkspacePanelState['reach'];
  /** You're the call's organizer. */
  organizer: boolean;
  pass: string;
  at: WorkspacePlace;
  settled: boolean;
  /** It's open and in sight: something taking turns with it can be in front. */
  showing: boolean;
  finding: boolean;
  /** Just the document: on or off, if it's on offer at all. */
  zen: boolean | null;
  listOff: boolean;
  listPeek: boolean;
  /** The call's notes, follow-ups and transcript. */
  live: LiveCall;
  act: WorkspacePanelState['act'];
  onToggleList: () => void;
  /** Shows the list, and never hides it. */
  onShowList: () => void;
  onToggleZen: () => void;
}) {
  const chooser = firstName(workspace.chosenBy.name);
  const documents = useMemo(() => workspace.documents.filter((d) => d.workspaceId === workspace.id).map((d) => d.id), [workspace.documents, workspace.id]);
  /* Watching a presentation, your own page is under it: out of sight, as far as it knows. */
  const call = useMemo((): WorkspaceCall => ({
    top: LIVE_ROWS, live, documents, onBring: act.bring, chooser: organizer ? undefined : chooser, say: act.say, closed: !showing || presenting.watching, people, invited, onTogether: act.setTogether, onTagged: act.tagged, together: reach, finding, onFinding: act.found,
    zen: zen === null ? undefined : { on: zen, onToggle: onToggleZen },
    list: { off: listOff, peek: listPeek, onToggle: onToggleList, onShow: onShowList },
    presenting, playing
  }), [ live, documents, act, reach, people, invited, organizer, chooser, showing, finding, zen, onToggleZen, listOff, listPeek, onToggleList, onShowList, presenting, playing ]);
  /* In a call the picker says what happens, and nothing else goes to another workspace. */
  const switchNowhere = useCallback(() => undefined, []);
  /* Nothing opens until the call has said what's here: what it opens on may have only just been made. */
  if (!settled) return <WsPane />;
  /* Something brought to the call can open for someone with nothing in the workspace the call uses now. */
  const id = workspace.id ?? workspace.documents[0]?.workspaceId ?? null;
  if (id !== null) return <Workspace mode="call" workspaceId={id} at={at} onGo={act.go} onSwitch={switchNowhere} onLeave={act.leave} pass={pass} call={call} />;
  return (
    <OutsideSpace live={live} at={at} go={act.go} say={act.say} closed={!open} zen={call.zen} list={call.list}>
      {presentingStrip(presenting)}{organizer ? <WsLostSpace onNew={act.newWorkspace} /> : <WsNoAccess organizer={chooser} asked={false} />}
    </OutsideSpace>
  );
});

/*
 * The workspace in a call: whether it's open, where you are in it, and the panel it's drawn in. The call says which
 * workspace (`CallState.workspace`, settled the first time anyone opens it); nothing here decides who can open what.
 *
 * It's on your stage or it isn't (layout/onStage.ts says which). Closing it and opening it again finds everything as it was:
 * it stays mounted once it's been opened, out of sight (layout/frame.tsx), so the page keeps its caret, its scroll and its
 * undo, and where you were is kept with how you arranged this call (view.ts), so a reload finds that too. Only your screen
 * changes, whatever you do here.
 */
import { errorMessage, firstName, type CallParticipant, type CallRole, type CallSession, type CallWorkspace, type Person } from '@alcove/api';
import { DURATION, Icon, Kbd, WsLostSpace, WsNameSheet, WsNoAccess, WsPane, cn, useSettledPress, useToast, wsToast, type IconName, type WsToastData } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CallPerson, CallTogether, WorkspaceCall, WorkspacePlace, WorkspacePlaying, WorkspaceTogether } from '~/features/workspace/context';
import type { StopFollowing } from '~/features/workspace/follow';
import { LiveRows } from '~/features/workspace/live/LiveRows';
import { OutsideSpace } from '~/features/workspace/live/OutsideSpace';
import { CallPeopleSheet, PeopleSheetFor, type InTheCall } from '~/features/workspace/Sheets';
import type { LiveCall } from '~/features/workspace/live/types';
import { Workspace } from '~/features/workspace/Workspace';
import { moveFocusOut, overlayOpen, shortcut } from '~/lib/keys';
import { log } from '~/lib/log';
import { useFirstDocument, q, useMentionSeen, useRenameWorkspace } from '~/lib/queries';
import { SpacePicker } from './SpacePicker';
import type { CallView } from '../layout/view';

const wlog = log.child({ component: 'call-workspace' });

const NOBODY_TOGETHER: CallTogether = { followable: [], following: null, writing: [], where: {}, reachable: [] };
/** How long someone's tile stays lit for being tagged. */
const LIT_MS = 2600;
/** How often someone who hasn't opened the workspace in this call looks for tags: once it's open, its stream says. */
const TAGS_MS = 20_000;

/**
 * Where a workspace opens: this call's agenda, or the first thing brought to it, in the workspace the call uses now. With
 * neither, it opens what you had open last.
 */
function firstPlace(w: CallWorkspace): WorkspacePlace {
  const here = w.documents.filter((d) => d.workspaceId === w.id);
  const id = here.find((d) => d.id === w.agenda)?.id ?? here[0]?.id;
  return id ? { kind: 'document', id, area: 'pins' } : { kind: 'home' };
}

/**
 * What the call's screen holds about the workspace. One a call has for good: everything in `act` keeps the same identity.
 * `stage` says whether it's on your stage, and puts it there or away (layout/onStage.ts), which is what opening and closing it is.
 */
export function useWorkspacePanel(session: CallSession, workspace: CallWorkspace, view: CallView, stage: { open: boolean; setOpen: (open: boolean) => void }) {
  const push = useToast();
  const qc = useQueryClient();
  /** A workspace's name, as your Drive has it: the call names only the one everyone views. */
  const spaceName = useCallback((id: string) => qc.getQueryData(q.workspaces().queryKey)?.find((w) => w.id === id)?.name ?? 'the call’s home', [qc]);
  const kept = view.layout.workspace;
  const open = stage.open;
  const setOpen = stage.setOpen;
  /* Once it's been on your stage it stays mounted, out of sight while it isn't, so it keeps its place, caret and undo. */
  const [mounted, setMounted] = useState(kept.open);
  if (open && !mounted) setMounted(true);
  const [at, setAt] = useState<WorkspacePlace>(kept.document ? { kind: 'document', id: kept.document } : { kind: 'home' });
  const [peek, setPeek] = useState(false);
  /** How many times something outside the workspace asked for its list (`WorkspaceCall.list.wanted`). */
  const [listWanted, setListWanted] = useState(0);
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
  const firstDocument = useFirstDocument(session.ticket.pass).mutateAsync;
  const makeFirst = useRef(firstDocument);
  makeFirst.current = firstDocument;
  const act = useMemo(() => {
    const show = (t: WsToastData) => push(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms });
    const say = (t: WsToastData) => { said.current?.(); said.current = show(t); };
    const failed = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
    const reveal = () => { setOpen(true); };
    const hide = () => { setOpen(false); setPeek(false); setFinding(false); };
    /** The call's home by name, when everyone's viewing another workspace: where the notes still go. */
    const homeName = (w: CallWorkspace) => (w.home === null || w.home === w.id ? null : spaceName(w.home));
    /** Organizer only: everyone views another workspace, or the home again, at once, and Back goes back. The notes stay in the home. */
    const switchTo = (to: string) => {
      const from = session.getSnapshot().workspace.id;
      session.setWorkspace(to).then(() => {
        const w = session.getSnapshot().workspace;
        say(wsToast.switched(w.name ?? 'Untitled', homeName(w), () => { if (from) switchTo(from); }));
      }, failed);
    };
    return {
      say, failed, hide, reveal, switchTo,
      /** Organizer only: what moving the call to another workspace would mean, for the question the picker asks. Changes nothing. */
      preview: (id: string) => session.previewWorkspace(id),
      /** A workspace that won't open any more: back to the call, which is asked again, so what opens next time is what it says now. */
      leave: () => { hide(); session.openWorkspace().catch(failed); },
      /** A toast of the call's own, beside whatever the workspace is saying. It returns what takes it away. */
      announce: show,
      /** ⌘K: Find, with the workspace opened for it. */
      find: () => { reveal(); setFinding(true); },
      found: () => setFinding(false),
      /** Opens it on something to share: the document last open there, or its list to pick one, on a phone too (`WorkspaceCall.list.wanted`). */
      wantList: () => { reveal(); setListWanted((n) => n + 1); },
      /** Takes away what the workspace said last, for something it would sit over, such as the call ending. */
      hush: () => { said.current?.(); said.current = null; },
      go: (to: WorkspacePlace) => { setAt(to); setPeek(false); },
      setPeek,
      bring: (id: string, brought: boolean) => {
        const name = () => session.getSnapshot().workspace.documents.find((d) => d.id === id)?.name || 'Untitled';
        session.bringDocument(id, brought).then(() => { if (brought) say(wsToast.broughtToCall(name())); }, failed);
      },
      /** Opens the workspace at this place. */
      openAt: (to: WorkspacePlace) => { setAt(to); setPeek(false); reveal(); },
      /** Follow, on a tile. */
      follow: (connection: string) => { reach.current?.follow(connection); },
      stopFollowing: (how?: StopFollowing) => { reach.current?.stop(how); },
      /** Go there and Tag, from someone's arch on a phone. */
      goTo: (connection: string) => { reach.current?.go(connection); },
      tagIn: (connection: string) => { reach.current?.tag(connection); },
      canTag: () => reach.current?.canTag() ?? false,
      setTogether,
      /** The tile's ring pulses once. */
      tagged: (connection: string) => {
        clearTimeout(unlit.current);
        setLit(connection);
        unlit.current = setTimeout(() => setLit(null), LIT_MS);
      },
      /**
       * Organizer only: a workspace made for this call, with everyone invited in it as the home has, and the call moves to it.
       * It starts with one blank document, open, ready to write in: from the picker, or for an organizer who's lost the one the
       * call uses.
       */
      newWorkspace: () => {
        session.newWorkspace().then(async () => {
          const w = session.getSnapshot().workspace;
          say(wsToast.newSpace(w.name ?? 'Untitled', homeName(w)));
          if (w.id === null) return;
          const { id } = await makeFirst.current(w.id);
          setAt({ kind: 'document', id });
        }).catch(failed);
      }
    };
  }, [push, session, spaceName, setOpen]);

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
   * Esc puts away the list over the page. Before that: a menu, a sheet or a drag, which take it on the window, then whatever's
   * being edited (`editing`). With only the caret in the document, the editor never sees it.
   */
  useEffect(() => {
    if (!peek) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen() || document.querySelector('.ws-pop, .wh') || editing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setPeek(false);
    };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [peek]);

  return { open, mounted, at, peek, listWanted, settled, finding, act, together, lit, reach };
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

/** The workspace in its frame, in a call. The call's screen renders far more often than this changes, so nothing here is drawn again unless it has to be. */
export const WorkspacePanel = memo(function WorkspacePanel({ workspace, organizer, pass, at, settled, showing, finding, listOff, listPeek, listWanted, live, act, reach, people, invited, presenter, playing, foot, onToggleList, onShowList }: {
  workspace: CallWorkspace;
  /** What the call puts at the foot of the list (`WorkspaceCall.foot`). Keep it the same element while it's the same, or the panel draws again. */
  foot: ReactNode;
  /** Whoever presents the workspace, by connection, while someone else does (presenting.ts). */
  presenter: string | null;
  /** What's playing for everyone (PlayTogether.tsx). */
  playing: WorkspacePlaying;
  /** Who's in the call, and who's invited if you can know, for `@`. */
  people: readonly CallPerson[];
  invited: readonly Person[];
  reach: WorkspacePanelState['reach'];
  /** You're the call's organizer. */
  organizer: boolean;
  pass: string;
  at: WorkspacePlace;
  settled: boolean;
  /** It's on your stage and in sight: something taking turns with it can be in front. */
  showing: boolean;
  finding: boolean;
  listOff: boolean;
  listPeek: boolean;
  listWanted: number;
  /** The call's notes, follow-ups and transcript. */
  live: LiveCall;
  act: WorkspacePanelState['act'];
  onToggleList: () => void;
  /** Shows the list, and never hides it. */
  onShowList: () => void;
}) {
  const documents = useMemo(() => workspace.documents.filter((d) => d.workspaceId === workspace.id).map((d) => d.id), [workspace.documents, workspace.id]);
  const call = useMemo((): WorkspaceCall => ({
    top: LIVE_ROWS, foot, live, documents, onBring: act.bring, say: act.say, closed: !showing, people, invited, onTogether: act.setTogether, onTagged: act.tagged, together: reach, finding, onFinding: act.found,
    list: { off: listOff, peek: listPeek, onToggle: onToggleList, onShow: onShowList, wanted: listWanted },
    presenter, playing
  }), [ foot, workspace.id, live, documents, act, reach, people, invited, showing, finding, listOff, listPeek, listWanted, onToggleList, onShowList, presenter, playing ]);
  /* In a call the picker says what happens, and nothing else goes to another workspace. */
  const switchNowhere = useCallback(() => undefined, []);
  /*
   * The workspace the call uses, for anyone who can open something in it. What was brought from one it used before stays
   * with that one, as it does in the list: whoever can't open this one is told it's private, and nothing about another.
   */
  const now: Shown = { key: workspace.id ?? 'outside', id: workspace.id, at, call };
  const { leaving, gone, box, held } = useLeaving(now, settled);
  /* Nothing opens until the call has said what's here: what it opens on may have only just been made. */
  if (!settled) return <WsPane />;
  const draw = (s: Shown) => (s.id !== null
    ? <Workspace mode="call" workspaceId={s.id} at={s.at} onGo={act.go} onSwitch={switchNowhere} onLeave={act.leave} pass={pass} call={s.call} />
    /*
     * The workspace the call uses opens to everyone in it: someone it doesn't open for (once its organizer can't edit there) is
     * told it's private, and the organizer can give the call another. The call's own pages are around it, for everyone.
     */
      : (
        <OutsideSpace live={live} at={s.at} go={act.go} say={act.say} closed={s.call.closed} list={s.call.list}>
          {organizer ? <WsLostSpace onNew={act.newWorkspace} /> : <WsNoAccess />}
        </OutsideSpace>
      ));
  return (
    <div className="ic-wsx">
      {leaving && <div key={leaving.key} ref={held} className={cn('ic-wsx-slot is-leaving', gone && 'is-gone')} inert aria-hidden>{draw(leaving)}</div>}
      <div key={now.key} ref={box} tabIndex={-1} className="ic-wsx-slot">{draw(now)}</div>
    </div>
  );
});

/** What the panel shows: the call's workspace as you have it, or that it's private (`outside`). */
interface Shown { key: string; id: string | null; at: WorkspacePlace; call: WorkspaceCall }

/**
 * The call moving to another workspace, or what you can open in it changing, cross-fades the list, 240 ms. What was there stays
 * over what's coming, as it was and out of reach, until what's coming has drawn itself (its list and its page, or that it's
 * private) and stayed that way a moment, and then fades away. Without that, the list would be blank for as long as the other
 * workspace takes to answer.
 */
function useLeaving(now: Shown, settled: boolean) {
  const [shown, setShown] = useState(now);
  const [leaving, setLeaving] = useState<Shown | null>(null);
  const [gone, setGone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** What's leaving, which goes out of reach the moment it starts to. */
  const held = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  /* Worked out as it's drawn, so there's never a frame with neither. What's leaving keeps the place and the call it had. */
  if (shown.key !== now.key) {
    setShown(now);
    setLeaving(settled ? { ...shown, call: { ...shown.call, closed: true, leaving: true } } : null);
    setGone(false);
  } else if (shown.at !== now.at || shown.call !== now.call) setShown(now);
  /* Whoever was in what's leaving, typing perhaps, lands on what's coming, where a key does nothing, and the call's letters sleep. */
  useLayoutEffect(() => { if (leaving) moveFocusOut(held.current, box.current); }, [leaving]);
  useEffect(() => {
    if (!leaving) return;
    let frame = 0;
    let done: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let since = 0;
    /*
     * How long what's drawn has to hold: a workspace's page on its way to a document can say "pick one" for a frame, and
     * a private one is drawn at once, so nothing waits for what's leaving to say it's gone.
     */
    const drawn = (): number | null => {
      const b = box.current;
      if (!b || b.querySelector('.ProseMirror, .wd-none') === null) return null;
      if (b.querySelector('.wt') === null) return 0;
      return b.querySelector('.wt-scroll') === null ? null : 100;
    };
    const look = () => {
      const now = Date.now();
      const hold = drawn();
      since = hold === null ? 0 : since || now;
      if ((hold === null || now - since < hold) && now - started < 1500) { frame = requestAnimationFrame(look); return; }
      // Drawn: from the slot to its document, if focus is still where it landed, so the keys that move a page move this one.
      const page = box.current?.querySelector<HTMLElement>('.wd-scroll');
      if (page && document.activeElement === box.current) { page.tabIndex = -1; page.focus({ preventScroll: true }); }
      setGone(true);
      done = setTimeout(() => setLeaving(null), reduce ? 0 : DURATION[2] * 1000 + 40);
    };
    look();
    return () => { cancelAnimationFrame(frame); clearTimeout(done); };
  }, [leaving, reduce]);
  return { leaving, gone, box, held };
}

/**
 * Who's in it, as Who's in it shows them: everyone in the call, as you may know them. Someone with no address is a guest, as far
 * as you can tell: everyone's is kept from a guest, so a guest knows only that they're one themselves.
 */
export function inTheCall(participants: readonly CallParticipant[], viewer: CallRole): InTheCall[] {
  return participants.map((p) => ({
    person: p.person, isMe: p.isMe, organizer: p.isOrganizer,
    guest: p.isMe ? viewer === 'guest' : viewer !== 'guest' && !p.isOrganizer && p.person.email === ''
  }));
}

/**
 * The workspace's one menu, on its name on the frame's bar. The organizer: Switch workspace, Find in the workspace, Who's in it,
 * Rename (an admin) and Copy link. Anyone else in it: the same but Switch workspace. Someone it's open to only through the call,
 * a guest say: Find in the workspace and Who's in it. Switch workspace, Who's in it and Rename open in place of the rows; `start`
 * opens it on Who's in it, from who can edit it on the bar.
 */
export function WorkspaceMenuRows({ workspace, organizer, people, act, start, onFind, onCopy, onRenamed, onDone }: {
  workspace: CallWorkspace; organizer: boolean; act: WorkspacePanelState['act'];
  /** Everyone in the call, for Who's in it. */
  people: readonly InTheCall[];
  start: 'access' | null;
  onFind: () => void;
  onCopy: (() => void) | undefined;
  /** A new name was kept: the call says it from then on. */
  onRenamed: () => void;
  onDone: () => void;
}) {
  const [inside, setInside] = useState<'switch' | 'people' | 'name' | null>(start === 'access' ? 'people' : null);
  const rename = useRenameWorkspace();
  const id = workspace.id;
  const name = workspace.name ?? 'Untitled';
  const member = workspace.role !== null;
  const admin = workspace.role === 'admin';
  const copy = member ? onCopy : undefined;
  /* Before the call has said which workspace it uses, or once it doesn't open for you, there's only Find. */
  const opened = id !== null;
  /* A press waits a moment after the rows change, as in every menu. */
  const press = useSettledPress([...(organizer && opened ? ['switch'] : []), 'find', ...(opened ? ['people'] : []), ...(admin ? ['rename'] : []), ...(copy ? ['link'] : [])].join('\n'));
  const pick = (f: () => void) => press(() => { onDone(); f(); });
  if (inside === 'switch' && id !== null) return <SpacePicker current={{ id, name }} home={workspace.home} act={act} onClose={onDone} />;
  if (inside === 'people' && id !== null) {
    return (
      <div className="ic-menu-sheet">
        {member
          ? <PeopleSheetFor workspaceId={id} name={name} admin={admin} say={act.say} call={workspace.everyone ? people : undefined} />
          : <CallPeopleSheet name={name} people={people} />}
      </div>
    );
  }
  if (inside === 'name' && id !== null) {
    return (
      <div className="ic-menu-sheet">
        <WsNameSheet name={name} onCommit={(typed) => {
          onDone();
          const to = typed.replace(/\s+/g, ' ').trim();
          if (!to || to === name) return;
          rename.mutateAsync({ id, name: to }).then(onRenamed, act.failed);
        }} />
      </div>
    );
  }
  const row = (icon: IconName, label: string, onPick: () => void, kb?: string) => (
    <button type="button" className="mi" role="menuitem" onClick={onPick}><Icon name={icon} size={17} /><span className="t">{label}</span>{kb && <Kbd>{kb}</Kbd>}</button>
  );
  return (
    <>
      {organizer && opened && row('folders', 'Switch workspace', press(() => setInside('switch')))}
      {row('search', 'Find in the workspace', pick(onFind), shortcut('K'))}
      {opened && row('people', 'Who’s in it', press(() => setInside('people')))}
      {admin && row('pen', 'Rename', press(() => setInside('name')))}
      {copy && row('link', 'Copy link', pick(copy))}
    </>
  );
}

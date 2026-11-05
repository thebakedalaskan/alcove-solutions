/*
 * The workspace in a call: whether it's open, where you are in it, and the panel it's drawn in. The call says which
 * workspace (`CallState.workspace`, settled the first time anyone opens it); nothing here decides who can open what.
 *
 * Closing it and opening it again finds everything as it was: the panel stays mounted once it's been opened, out of sight
 * (PanelHost.tsx), so the page keeps its caret, its scroll and its undo, and where you were is kept with how you arranged
 * this call (view.ts), so a reload finds that too. Only your screen changes, whatever you do here.
 */
import { errorMessage, firstName, type CallSession, type CallWorkspace } from '@alcove/api';
import { DURATION, WsDoc, WsLostSpace, WsNoAccess, WsPane, cn, useToast, wsToast, type WsToastData } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SpaceHead, WorkspaceCall, WorkspacePlace } from '~/features/workspace/context';
import { Workspace } from '~/features/workspace/Workspace';
import { overlayOpen } from '~/lib/keys';
import { log } from '~/lib/log';
import { useFirstDocument } from '~/lib/queries';
import { SpacePicker } from './SpacePicker';
import type { CallView } from './view';
import { useAskAnswered } from './WorkspaceAsks';

const wlog = log.child({ component: 'call-workspace' });

/**
 * Where a workspace opens: this call's agenda, or the first thing brought to it, in the workspace the call uses now. With
 * neither, it opens what you had open last.
 */
function firstPlace(w: CallWorkspace): WorkspacePlace {
  const here = w.documents.filter((d) => d.workspaceId === w.id);
  const id = here.find((d) => d.id === w.agenda)?.id ?? here[0]?.id;
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
  /** The call has said which workspace it uses, for this browser. */
  const [settled, setSettled] = useState(false);
  const asked = useRef(false);

  /** What the workspace said last: it says one thing at a time, so a second toast never climbs over the foot of the list. */
  const said = useRef<(() => void) | null>(null);
  const firstDocument = useFirstDocument().mutateAsync;
  const makeFirst = useRef(firstDocument);
  makeFirst.current = firstDocument;
  const act = useMemo(() => {
    const show = (t: WsToastData) => push(t.text, { icon: t.icon, person: t.person, action: t.action, ms: t.ms });
    const say = (t: WsToastData) => { said.current?.(); said.current = show(t); };
    const failed = (e: unknown) => { say(wsToast.failed(errorMessage(e))); };
    const reveal = () => { setMounted(true); setOpen(true); };
    const hide = () => { setOpen(false); setZen(false); setPeek(false); };
    /** Organizer only: the call moves to another workspace, for everyone at once, and Back moves it back. */
    const switchTo = (to: string) => {
      const from = session.getSnapshot().workspace.id;
      session.setWorkspace(to).then(() => {
        say(wsToast.switched(session.getSnapshot().workspace.name ?? 'Untitled', () => { if (from) switchTo(from); }));
      }, failed);
    };
    return {
      say, failed, hide, reveal, switchTo,
      /** Organizer only: what moving the call to another workspace would mean, for the question the picker asks. Changes nothing. */
      preview: (id: string) => session.previewWorkspace(id),
      /** Anyone who can't open the call's workspace: asks the organizer, who can open one document to them. */
      ask: () => { session.askForWorkspace(true).catch(failed); },
      /** A workspace that won't open any more: back to the call, which is asked again, so what opens next time is what it says now. */
      leave: () => { hide(); session.openWorkspace().catch(failed); },
      /** A toast of the call's own, beside whatever the workspace is saying. It returns what takes it away. */
      announce: show,
      toggle: () => { if (openNow.current) hide(); else reveal(); },
      go: (to: WorkspacePlace) => { setAt(to); setPeek(false); },
      /** Just the document, which opens the workspace if it has to, or everything back. */
      setZen: (on: boolean) => { if (on) reveal(); setZen(on); },
      setPeek,
      bring: (id: string, brought: boolean) => {
        const name = () => session.getSnapshot().workspace.documents.find((d) => d.id === id)?.name || 'Untitled';
        session.bringDocument(id, brought).then(() => { if (brought) say(wsToast.broughtToCall(name())); }, failed);
      },
      /**
       * Organizer only: a workspace with just them in it, made right here, and the call moves to it. It starts with one blank
       * document, open, ready to write in: from the picker, or for an organizer who's lost the one the call uses.
       */
      newWorkspace: () => {
        session.newWorkspace().then(async () => {
          const w = session.getSnapshot().workspace;
          say(wsToast.newSpace(w.name ?? 'Untitled'));
          if (w.id === null) return;
          const { id } = await makeFirst.current(w.id);
          setAt({ kind: 'document', id });
        }).catch(failed);
      }
    };
  }, [push, session]);
  const openNow = useRef(open);
  openNow.current = open;
  useAskAnswered(workspace, act);

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

  /* Esc puts away what's over the page, then gives everything back. A menu or a sheet goes first, and so does anything that took the key before it got this far. */
  useEffect(() => {
    if (!zen && !peek) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOpen() || document.querySelector('.ws-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      if (peek) setPeek(false);
      else setZen(false);
    };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [zen, peek]);

  return { open, mounted, at, zen, peek, settled, act };
}
export type WorkspacePanelState = ReturnType<typeof useWorkspacePanel>;

/** The workspace as the panels say it stands, in a call. The call's screen renders far more often than this changes, so nothing here is drawn again unless it has to be. */
export const WorkspacePanel = memo(function WorkspacePanel({ workspace, organizer, pass, at, settled, showing, zen, listOff, listPeek, top, act, onToggleList, onToggleZen }: {
  workspace: CallWorkspace;
  /** You're the call's organizer. */
  organizer: boolean;
  pass: string;
  at: WorkspacePlace;
  settled: boolean;
  /** It's open and in sight: something taking turns with it can be in front. */
  showing: boolean;
  /** Just the document: on or off, if it's on offer at all. */
  zen: boolean | null;
  listOff: boolean;
  listPeek: boolean;
  /** The first rows under This call. */
  top?: ReactNode;
  act: WorkspacePanelState['act'];
  onToggleList: () => void;
  onToggleZen: () => void;
}) {
  const chooser = firstName(workspace.chosenBy.name);
  const documents = useMemo(() => workspace.documents.filter((d) => d.workspaceId === workspace.id).map((d) => d.id), [workspace.documents, workspace.id]);
  /* The organizer chooses the call's workspace from the name at the top of the list; everyone else is told who chooses. */
  const picker = useMemo(() => (organizer ? (head: SpaceHead) => <SpacePicker head={head} act={act} /> : undefined), [organizer, act]);
  const call = useMemo((): WorkspaceCall => ({
    top, documents, onBring: act.bring, picker, chooser: organizer ? undefined : chooser, say: act.say, closed: !showing,
    zen: zen === null ? undefined : { on: zen, onToggle: onToggleZen },
    list: { off: listOff, peek: listPeek, onToggle: onToggleList }
  }), [top, documents, act, picker, organizer, chooser, showing, zen, onToggleZen, listOff, listPeek, onToggleList]);
  /* In a call the picker says what happens, and nothing else goes to another workspace. */
  const switchNowhere = useCallback(() => undefined, []);
  /*
   * The workspace the call uses, for anyone who can open something in it. What was brought from one it used before stays
   * with that one, as it does in the list: whoever can't open this one is told it's private, and nothing about another.
   */
  const now: Shown = { key: workspace.id ?? 'outside', id: workspace.id, at, call };
  const { leaving, gone, box } = useLeaving(now, settled);
  /* Nothing opens until the call has said what's here: what it opens on may have only just been made. */
  if (!settled) return <WsPane />;
  const draw = (s: Shown) => (s.id !== null
    ? <Workspace mode="call" workspaceId={s.id} at={s.at} onGo={act.go} onSwitch={switchNowhere} onLeave={act.leave} pass={pass} call={s.call} />
    /* Being in the call opens nothing: someone who can't open the workspace is told it's private, and can ask the organizer. */
    : <WsPane><WsDoc className="is-bare">{organizer ? <WsLostSpace onNew={act.newWorkspace} /> : <WsNoAccess organizer={chooser} asked={workspace.asked === 'asking'} onAsk={act.ask} />}</WsDoc></WsPane>);
  return (
    <div className="ic-wsx">
      {leaving && <div key={leaving.key} className={cn('ic-wsx-slot is-leaving', gone && 'is-gone')} inert aria-hidden>{draw(leaving)}</div>}
      <div key={now.key} ref={box} className="ic-wsx-slot">{draw(now)}</div>
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
  const reduce = useReducedMotion();
  /* Worked out as it's drawn, so there's never a frame with neither. What's leaving keeps the place and the call it had. */
  if (shown.key !== now.key) {
    setShown(now);
    setLeaving(settled ? { ...shown, call: { ...shown.call, closed: true } } : null);
    setGone(false);
  } else if (shown.at !== now.at || shown.call !== now.call) setShown(now);
  useEffect(() => {
    if (!leaving) return;
    let frame = 0;
    let done: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let since = 0;
    /* A page on its way to a document can say "pick one" for a frame, so what's drawn has to hold for 100 ms. */
    const drawn = () => {
      const b = box.current;
      if (!b) return false;
      const page = b.querySelector('.ProseMirror, .wd-none') !== null;
      return b.querySelector('.wt') === null ? page : page && b.querySelector('.wt-scroll') !== null;
    };
    const look = () => {
      const now = Date.now();
      since = drawn() ? since || now : 0;
      if ((since === 0 || now - since < 100) && now - started < 1500) { frame = requestAnimationFrame(look); return; }
      setGone(true);
      done = setTimeout(() => setLeaving(null), reduce ? 0 : DURATION[2] * 1000 + 40);
    };
    look();
    return () => { cancelAnimationFrame(frame); clearTimeout(done); };
  }, [leaving, reduce]);
  return { leaving, gone, box };
}

/*
 * Following someone: going where they go, to the same line, until you choose to stop. It's this browser that goes, from who's
 * here: nobody is pulled along, and the person followed does nothing. In a call they're told you follow them, and nobody
 * else is (presence.ts says so with where you are), so whoever presents knows who's still with them. Somewhere you can't
 * open you stay put, and the stream says only that it's elsewhere, so nothing here can name it. Pressing, scrolling, typing,
 * Esc in the workspace or going somewhere yourself stops it, and a toast picks it back up.
 */
import { firstName, type Person, type WorkspaceHere } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { overlayOpen } from '~/lib/keys';
import type { OpenPage, WorkspaceCall, WorkspacePlace } from './context';
import { pageName, type Someone } from './presence';
import { nameOf, type Tree } from './tree/tree';

/**
 * Who you're following and where they are now. `document` and `block` only ever name what you can open. `quiet`: they're
 * presenting the workspace, which the call's frame says, so the page says nothing about it.
 */
export interface Following { person: Person; name: string; where: string; lost: boolean; document: string | null; block: string | null; quiet: boolean }

/** Why it stopped. `quiet` says nothing: something else took over. `moved`: the call's workspace changed under them, which is said. */
export type StopFollowing = 'asked' | 'quiet' | 'moved';

interface FollowInput {
  others: readonly Someone[];
  /** Whoever presents the workspace in a call, by connection: following them is said by the call's frame, not here. */
  presenter: string | null;
  tree: Tree;
  at: WorkspacePlace;
  /** Goes there without it counting as you going somewhere. */
  goWith: (to: WorkspacePlace) => void;
  say: (toast: WsToastData) => void;
  /** The workspace itself: Esc stops following only from inside it, so a call round it keeps its own Esc (focus, your side). */
  pane: RefObject<HTMLElement | null>;
  /** You went your own way: any stop you asked for, following anyone or not yet, which a call hears (`WorkspaceCall.onOwn`). */
  onOwn?: (() => void) | undefined;
}

export function useFollow({ others, presenter, tree, at, goWith, say, pane, onOwn }: FollowInput) {
  const [id, setId] = useState<string | null>(null);
  /** Their face and their connection to the call, for while they're gone: a reload, say. Only ever whoever you follow now. */
  const known = useRef<{ id: string; person: Person; callIdentity: string | null } | null>(null);
  const someone = id === null ? undefined : others.find((o) => o.person.id === id);
  if (someone) known.current = { id: someone.person.id, person: someone.person, callIdentity: someone.callIdentity };
  const last = id !== null && known.current?.id === id ? known.current : null;
  const item = someone?.document ? tree.all.get(someone.document) : undefined;
  const target = item && item.kind !== 'folder' ? item.id : null;
  /* Where they are and where you are, each as one key: a document by its ID, or one of the call's own pages. */
  const page = target === null ? someone?.page ?? null : null;
  const there = target ?? (page === null ? null : `$${page}`);
  const here = at.kind === 'document' ? at.id : at.kind === 'live' ? `$${at.page}` : null;

  const follow = useCallback((person: string) => setId(person), []);
  const quiet = last !== null && presenter !== null && last.callIdentity === presenter;
  const latest = useRef({ id, say, quiet, onOwn });
  latest.current = { id, say, quiet, onOwn };
  const stop = useCallback((how: StopFollowing = 'asked') => {
    const { id: was, say: tell, quiet: hush, onOwn: own } = latest.current;
    const person = known.current?.id === was ? known.current.person : null;
    if (how === 'asked') own?.();
    if (was === null) return;
    setId(null);
    if (how === 'asked' && person && !hush) tell(wsToast.stoppedFollowing(firstName(person.name), () => setId(was)));
    if (how === 'moved' && person) tell(wsToast.followingEnded(firstName(person.name)));
  }, []);

  /* They moved: you go too. You moved, by the address, say, and not with them: that's you going somewhere. */
  const before = useRef<{ target: string | null; here: string | null }>({ target: there, here });
  useEffect(() => {
    const was = before.current;
    before.current = { target: there, here };
    if (id === null || there === null || here === there) return;
    if (was.here !== here && was.target === there) { stop(); return; }
    if (target !== null) goWith({ kind: 'document', id: target });
    else if (page !== null) goWith({ kind: 'live', page });
  }, [id, there, target, page, here, goWith, stop]);

  /* Esc in the workspace, once nothing's open on top of the page. */
  useEffect(() => {
    if (id === null) return;
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOpen() || !(e.target instanceof Node) || !pane.current?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    addEventListener('keydown', keys, true);
    return () => removeEventListener('keydown', keys, true);
  }, [id, stop, pane]);

  const person = last?.person ?? null;
  const lost = someone?.elsewhere === true;
  const following: Following | null = id === null || !person ? null : {
    person, name: firstName(person.name), lost,
    where: item ? nameOf(item) : page ? pageName(page) : 'Not in the workspace',
    document: target, block: target !== null ? someone?.block ?? null : null, quiet
  };
  return { following, follow, stopFollowing: stop };
}

/**
 * The workspace and the call's tiles. The tiles show who's here, who's writing and who you're following, and whoever presents
 * counts who follows them. The call asks to follow from a tile. Where each is is said while it's put away too: a presented
 * workspace's tile says where its presenter is. Out of sight, put away or behind what it takes turns with, there's nothing to
 * go with; leaving with the call's workspace, it's said: they'd otherwise just stop going with whoever they followed.
 */
export function useCallTiles({ call, here, others, tree, following, follow, stopFollowing, go, page, closed }: {
  call: WorkspaceCall | undefined;
  /** Every window here, as the stream says: who follows you is said of each of them. */
  here: readonly WorkspaceHere[];
  others: readonly Someone[];
  tree: Tree;
  following: Following | null;
  follow: (person: string) => void;
  stopFollowing: (how?: StopFollowing) => void;
  go: (to: WorkspacePlace) => void;
  /** The page open now, which tags someone. */
  page: RefObject<OpenPage | null>;
  /** Out of sight: put away, or behind what it takes turns with. */
  closed: boolean;
}): void {
  const followable = closed ? '' : others.flatMap((o) => (o.callIdentity !== null && (o.document !== null || o.page !== null || o.elsewhere) ? [o.callIdentity] : [])).join(' ');
  const writing = others.flatMap((o) => (o.typing && o.callIdentity !== null ? [o.callIdentity] : [])).join(' ');
  const followingIn = following ? others.find((o) => o.person.id === following.person.id)?.callIdentity ?? null : null;
  const placed = others.flatMap((o): [string, string][] => {
    if (o.callIdentity === null) return [];
    const doc = o.document === null ? undefined : tree.all.get(o.document);
    return doc ? [[o.callIdentity, nameOf(doc)]] : o.page ? [[o.callIdentity, pageName(o.page)]] : o.elsewhere ? [[o.callIdentity, 'A document you can’t open']] : [];
  });
  const placedNow = useRef(placed);
  placedNow.current = placed;
  const where = JSON.stringify(placed);
  const reachable = closed ? '' : others.flatMap((o) => (o.callIdentity !== null && o.document !== null && tree.all.has(o.document) ? [o.callIdentity] : [])).join(' ');
  /* Who follows you, as each says from any of their windows: whoever presents counts them. */
  const followers = [...new Set(here.flatMap((h) => (h.followsYou && !h.isMe && h.callIdentity !== null ? [h.callIdentity] : [])))].join(' ');
  const tellTiles = call?.onTogether;
  useEffect(() => {
    tellTiles?.({
      followable: followable ? followable.split(' ') : [], following: followingIn, writing: writing ? writing.split(' ') : [], where: Object.fromEntries(placedNow.current),
      reachable: reachable ? reachable.split(' ') : [], followers: followers ? followers.split(' ') : []
    });
  }, [tellTiles, followable, followingIn, writing, where, reachable, followers]);
  const othersNow = useRef(others);
  othersNow.current = others;
  const treeNow = useRef(tree);
  treeNow.current = tree;
  const togetherRef = call?.together;
  useEffect(() => {
    if (!togetherRef) return;
    const someone = (connection: string) => othersNow.current.find((x) => x.callIdentity === connection);
    togetherRef.current = {
      follow: (connection) => { const o = someone(connection); if (o) follow(o.person.id); },
      stop: (how) => stopFollowing(how),
      /* To the line they're on, as Go there on their card does. */
      go: (connection) => {
        const o = someone(connection);
        if (o?.document && treeNow.current.all.has(o.document)) go({ kind: 'document', id: o.document, block: o.block ?? undefined });
      },
      tag: (connection) => { const o = someone(connection); if (o) page.current?.tag(o.person); },
      canTag: () => page.current?.canTag === true
    };
    return () => { togetherRef.current = null; };
  }, [togetherRef, follow, stopFollowing, go]);
  const leaving = call?.leaving ?? false;
  useEffect(() => { if (closed) stopFollowing(leaving ? 'moved' : 'quiet'); }, [closed, leaving, stopFollowing]);
}

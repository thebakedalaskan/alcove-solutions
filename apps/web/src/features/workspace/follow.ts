/*
 * Following someone: going where they go, to the same line, until you choose to stop. It's all in this browser, from who's
 * here: nobody is told, nobody is pulled along, and the person followed does nothing. Somewhere you can't open you stay put,
 * and the stream says only that it's elsewhere, so nothing here can name it. Pressing, scrolling, typing, Esc or going
 * somewhere yourself stops it, and a toast picks it back up.
 */
import { firstName, type Person } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { overlayOpen } from '~/lib/keys';
import type { WorkspacePlace } from './context';
import { pageName, type Someone } from './presence';
import { nameOf, type Tree } from './tree';

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
}

export function useFollow({ others, presenter, tree, at, goWith, say }: FollowInput) {
  const [id, setId] = useState<string | null>(null);
  /** Their face, for after they've gone. */
  const known = useRef<Person | null>(null);
  const someone = id === null ? undefined : others.find((o) => o.person.id === id);
  if (someone) known.current = someone.person;
  const item = someone?.document ? tree.all.get(someone.document) : undefined;
  const target = item && item.kind !== 'folder' ? item.id : null;
  /* Where they are and where you are, each as one key: a document by its ID, or one of the call's own pages. */
  const page = target === null ? someone?.page ?? null : null;
  const there = target ?? (page === null ? null : `$${page}`);
  const here = at.kind === 'document' ? at.id : at.kind === 'live' ? `$${at.page}` : null;

  const follow = useCallback((person: string) => setId(person), []);
  const quiet = someone !== undefined && presenter !== null && someone.callIdentity === presenter;
  const latest = useRef({ id, say, quiet });
  latest.current = { id, say, quiet };
  const stop = useCallback((how: StopFollowing = 'asked') => {
    const { id: was, say: tell, quiet: hush } = latest.current;
    const person = known.current;
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

  /* Esc, once nothing's open on top of the page. */
  useEffect(() => {
    if (id === null) return;
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    addEventListener('keydown', keys, true);
    return () => removeEventListener('keydown', keys, true);
  }, [id, stop]);

  const person = someone?.person ?? known.current;
  const lost = someone?.elsewhere === true;
  const following: Following | null = id === null || !person ? null : {
    person, name: firstName(person.name), lost,
    where: item ? nameOf(item) : page ? pageName(page) : 'Not in the workspace',
    document: target, block: target !== null ? someone?.block ?? null : null, quiet
  };
  return { following, follow, stopFollowing: stop };
}

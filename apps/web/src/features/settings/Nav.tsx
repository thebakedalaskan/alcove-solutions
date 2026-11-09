/*
 * Getting around Settings: the index beside the page, which is a strip at its top at 1000px and narrower, with a small
 * sun that follows the group in view. An address can name a group, or one of the places inside one that other pages link
 * to (Record's recording in the room, Home's calendar, a note's Google Drive, agents): the page lands there, and the
 * index lights the group that holds it.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

/** The seven groups, in the order the page shows them. */
export const GROUPS = [
  { id: 'you', label: 'You' },
  { id: 'calls', label: 'Calls and notes' },
  { id: 'audio', label: 'Audio and video' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'connections', label: 'Connections' },
  { id: 'plan', label: 'Plan and credits' },
  { id: 'privacy', label: 'Privacy' }
] as const;
export type Group = (typeof GROUPS)[number];
export type GroupId = Group['id'];

/** The places inside a group that other pages link to, and the group each is in. */
const INSIDE: Readonly<Record<string, GroupId>> = { recording: 'calls', calendar: 'connections', 'google-drive': 'connections', agents: 'connections' };

/** The group an address's target is, or is in. */
const groupOf = (target: string): GroupId | undefined => GROUPS.find((g) => g.id === target)?.id ?? INSIDE[target];

/**
 * The group in view, for the index: the last whose top has passed a quarter of the way down the window, or the last one
 * once the page is scrolled to the end. Where the address points (`to`) the page lands, and it stays there as the groups
 * above it fill in, for a moment, unless the page is scrolled by hand meanwhile. A group picked in the index stays picked
 * until the page is scrolled by hand. `column` holds the groups.
 */
export function useGroupInView(ids: readonly GroupId[], to: string | undefined, column: RefObject<HTMLElement | null>): [GroupId | undefined, (id: GroupId) => void] {
  const [current, setCurrent] = useState<GroupId | undefined>(ids[0]);
  const held = useRef(false);
  /** The group just picked in the index, which is on its way there by itself. */
  const going = useRef<string | null>(null);
  useEffect(() => {
    const group = to ? groupOf(to) : undefined;
    if (!to || !group || going.current === to) return;
    held.current = true;
    setCurrent(group);
    // What's above it may still be filling in (the calendar, Google Drive): it stays in place as they arrive, and it's
    // looked for each time, since what's named may only just have arrived itself.
    const box = column.current;
    if (!box) return;
    const keep = new ResizeObserver(() => { if (held.current) document.getElementById(to)?.scrollIntoView({ block: 'start' }); });
    keep.observe(box);
    const t = setTimeout(() => keep.disconnect(), 2000);
    return () => { clearTimeout(t); keep.disconnect(); };
  }, [to, column]);
  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      if (held.current) return;
      const line = innerHeight / 4;
      let at = ids[0];
      for (const id of ids) if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line) at = id;
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) at = ids.at(-1) ?? at;
      setCurrent(at);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(look); };
    const byHand = () => { held.current = false; going.current = null; };
    look();
    addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['wheel', 'touchstart', 'keydown']) addEventListener(e, byHand, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      for (const e of ['wheel', 'touchstart', 'keydown']) removeEventListener(e, byHand);
    };
  }, [ids]);
  const pick = (id: GroupId) => { held.current = true; going.current = id; setCurrent(id); };
  return [current, pick];
}

type Jump = (e: MouseEvent<HTMLAnchorElement>, id: GroupId) => void;

/** Moves to a group from the index or the strip, and the address follows. A press that opens it elsewhere is left alone. */
export function useJump(pick: (id: GroupId) => void): Jump {
  const navigate = useNavigate();
  return (e, id) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    pick(id);
    const group = document.getElementById(id);
    group?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // As a link would: the next Tab carries on from there.
    group?.focus({ preventScroll: true });
    void navigate({ to: '/settings', hash: id, replace: true, resetScroll: false, hashScrollIntoView: false });
  };
}

/** The groups, beside the page: a line with a small sun that goes with the group in view. */
export function Index({ groups, current, onJump }: { groups: readonly Group[]; current: GroupId | undefined; onJump: Jump }) {
  return (
    <nav className="set-idx" aria-label="Settings">
      <ol>{groups.map((g) => <li key={g.id}><a href={`#${g.id}`} className="set-ix" aria-current={current === g.id ? 'true' : undefined} onClick={(e) => onJump(e, g.id)}>{g.label}</a></li>)}</ol>
      <i className="set-mark" style={{ '--i': Math.max(0, groups.findIndex((g) => g.id === current)) }} aria-hidden="true" />
    </nav>
  );
}

/** The groups on a narrow screen: a strip that stays at the top, keeping the group in view in sight. */
export function Strip({ groups, current, onJump }: { groups: readonly Group[]; current: GroupId | undefined; onJump: Jump }) {
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (on) strip.current?.scrollTo({ left: on.offsetLeft - 40 });
  }, [current]);
  return (
    <nav ref={strip} className="set-strip" aria-label="Settings">
      {groups.map((g) => <a key={g.id} href={`#${g.id}`} className="set-sx" aria-current={current === g.id ? 'true' : undefined} onClick={(e) => onJump(e, g.id)}>{g.label}</a>)}
    </nav>
  );
}

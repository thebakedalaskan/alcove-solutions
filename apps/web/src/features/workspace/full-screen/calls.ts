/*
 * The calls a workspace keeps. Each call that used it has a folder at its top (`ItemCall`): full screen, that folder is the
 * call itself, which opens the call's own page once it has notes. A call's own workspace, the home made for it, is about
 * that call: the newest call in it is "the call", what's in it is what the call made, and the rest of a series' calls come
 * after. What's in a workspace and when it was made say which call something came from; nothing of the call is copied in.
 */
import type { NoteSummary, WorkspaceItem, WorkspaceSummary } from '@alcove/api';
import { daysFromToday, shortDay } from '~/lib/time';
import { foldersAbove, type Tree } from '../tree/tree';

/** A call kept in a workspace: its folder, when it started, whether it's on, and its notes once it's over, for someone who has them. */
export interface KeptCall { folder: WorkspaceItem; startedAt: string; on: boolean; noteId: string | null }

const keptOf = (item: WorkspaceItem): KeptCall | null => (item.call ? { folder: item, startedAt: item.call.startedAt, on: item.call.on, noteId: item.call.noteId } : null);

/** The calls kept at a workspace's top level, the newest first. */
export function callsIn(tree: Tree): KeptCall[] {
  return (tree.kids.get(null) ?? []).flatMap((i) => keptOf(i) ?? []).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** How many of the calls kept in a workspace its side panel shows, full screen, before "N more" (Side.tsx). */
export const EARLIER = 5;
/**
 * Whether the side panel keeps `id` behind "N more": it's one of the calls kept at the top, after the first EARLIER of them in
 * the list's order, or it's in one. A call's own workspace's call (`theCall`) is never among them: it's first, on its own.
 */
export function behindMore(tree: Tree, id: string, theCall: string | null): boolean {
  const top = foldersAbove(tree, id)[0] ?? tree.all.get(id);
  if (!top || top.call === null || top.id === theCall) return false;
  return (tree.kids.get(null) ?? []).filter((i) => i.call !== null && i.id !== theCall).findIndex((i) => i.id === top.id) >= EARLIER;
}

/** The day a call was, or is, in a sentence: "today", "yesterday", "tomorrow", else "Mon 2 Nov". */
export function callDay(iso: string, now = new Date()): string {
  const n = daysFromToday(new Date(iso), now);
  return n === 0 ? 'today' : n === -1 ? 'yesterday' : n === 1 ? 'tomorrow' : shortDay(new Date(iso));
}

/** A day on its own, as a row says it: "Today", "Yesterday", "Mon 2 Nov". */
export const callDayTitle = (iso: string, now = new Date()): string => { const d = callDay(iso, now); return d.charAt(0).toUpperCase() + d.slice(1); };

/**
 * A call's own workspace: the call it was made for (from the Drive's summary of it) and the newest call kept in it, which is
 * that call or, in a series, its latest. Null for any other workspace.
 */
export interface HomeOf { title: string; at: string; call: KeptCall | null; earlier: KeptCall[] }
export function homeOf(summary: WorkspaceSummary | undefined, tree: Tree): HomeOf | null {
  if (!summary?.call) return null;
  const [call = null, ...earlier] = callsIn(tree);
  return { title: summary.call.title, at: call?.startedAt ?? summary.call.at, call, earlier };
}

/** Whether a call's own workspace is still waiting for its call: nothing's happened in it yet. */
export const beforeTheCall = (home: HomeOf, now = Date.now()): boolean => home.call === null && Date.parse(home.at) > now;

/**
 * The call something came from: the call whose folder it's in, or the call that was on when it was made, as far as what you
 * can read says how long that went on (its notes). Null when nothing says.
 */
export function cameFrom(tree: Tree, item: WorkspaceItem, notes: readonly NoteSummary[]): KeptCall | null {
  const inFolder = foldersAbove(tree, item.id).reverse().map(keptOf).find((c) => c !== null);
  if (inFolder) return inFolder;
  const made = Date.parse(item.createdAt);
  return callsIn(tree).find((c) => {
    const start = Date.parse(c.startedAt);
    if (made < start) return false;
    if (c.on) return true;
    const note = c.noteId === null ? undefined : notes.find((n) => n.id === c.noteId);
    return note !== undefined && made <= start + note.duration * 1000;
  }) ?? null;
}

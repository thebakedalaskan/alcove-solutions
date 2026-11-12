/*
 * Where you are in the Drive, as its address says it, and what the Drive knows of each workspace. The Drive is one page:
 * its places are the address's search params (`/drive?ws=…&folder=…`), so the sky and the tree stay put as you move. A
 * workspace full screen is a route of its own, `/drive/$workspaceId`.
 */
import { firstName, type Document, type DocumentLibrary, type DocumentKind, type WorkspaceItem, type WorkspaceSummary } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { daysFromToday, dayMonth, hm, shortDay, weekday } from '~/lib/time';

/** The places that aren't a workspace: what's shared with you, Trash, and on a phone, the lists the tree holds. Recent is none. */
export const SHOWS = ['shared', 'trash', 'workspaces', 'calls'] as const;
export type Show = (typeof SHOWS)[number];

/**
 * Where the Drive is: Recent with nothing set; a place; a workspace (or a call's), and a folder in it, or a document of it
 * open beside the tree; or what's searched for.
 */
export interface DriveAt {
  show?: Show | undefined;
  ws?: string | undefined;
  folder?: string | undefined;
  doc?: string | undefined;
  q?: string | undefined;
}

/** An ID as the address carries one. Anything else names nothing. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const idIn = (v: unknown): string | undefined => (typeof v === 'string' && ID.test(v) ? v : undefined);
const isShow = (v: unknown): v is Show => SHOWS.some((s) => s === v);

/** What the address says, with anything that isn't a place left out. */
export function driveSearch(s: Record<string, unknown>): DriveAt {
  const ws = idIn(s['ws']);
  const show = s['show'];
  const text = s['q'];
  return {
    show: ws === undefined && isShow(show) ? show : undefined,
    ws,
    folder: ws === undefined ? undefined : idIn(s['folder']),
    doc: ws === undefined ? undefined : idIn(s['doc']),
    q: typeof text === 'string' && text.trim() ? text.slice(0, 200) : undefined
  };
}

/* ---------- the workspaces ---------- */

/** A call's own workspace: what the Drive lists under From calls. */
export const isCallSpace = (w: WorkspaceSummary): boolean => w.call !== null && w.role !== null;
/** A workspace someone's in, made on purpose: what the Drive lists under Workspaces. */
export const isSpace = (w: WorkspaceSummary): boolean => w.call === null && w.role !== null;
/** One someone has only documents in, which they see under Shared with you. */
export const isSharedOnly = (w: WorkspaceSummary): boolean => w.role === null;
/** A call that's still to come: its workspace says its time. */
export const isAhead = (w: WorkspaceSummary, now = Date.now()): boolean => w.call !== null && Date.parse(w.call.at) > now;

/** The calls' workspaces, the ones still to come first, soonest first, then the rest, the latest first. */
export function callOrder(spaces: readonly WorkspaceSummary[], now = Date.now()): WorkspaceSummary[] {
  const at = (w: WorkspaceSummary) => Date.parse(w.call?.at ?? '');
  const ahead = spaces.filter((w) => isCallSpace(w) && isAhead(w, now)).sort((a, b) => at(a) - at(b));
  const past = spaces.filter((w) => isCallSpace(w) && !isAhead(w, now)).sort((a, b) => at(b) - at(a));
  return [...ahead, ...past];
}

/**
 * A workspace's mark: its first letter, or where an older workspace has that already, its first letter and the first letter
 * of its second word, or of the next consonant in its name ("Hr" for Harbourline beside Hiring). Neutral, as names are, and
 * the oldest keep theirs, so a new workspace never changes another's.
 */
export function marksFor(spaces: readonly WorkspaceSummary[]): (w: WorkspaceSummary) => string {
  const marks = new Map<string, string>();
  const used = new Set<string>();
  const oldest = spaces.filter(isSpace).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  for (const w of oldest) {
    const name = (w.name ?? '').trim();
    const one = name.charAt(0).toUpperCase() || '·';
    const rest = name.slice(1).toLowerCase();
    const second = name.split(/\s+/)[1]?.charAt(0).toLowerCase();
    const after = (letters: string) => [...letters].map((c) => `${one}${c}`);
    const mark = [one, ...(second ? [`${one}${second}`] : []), ...after(rest.replace(/[^bcdfghjklmnpqrstvwxz]/g, '')), ...after(rest.replace(/[^a-z0-9]/g, ''))].find((m) => !used.has(m)) ?? one;
    used.add(mark);
    marks.set(w.id, mark);
  }
  return (w) => marks.get(w.id) ?? ((w.name ?? '').trim().charAt(0).toUpperCase() || '·');
}

/** What a call's workspace is called in the Drive: its call. */
export const callTitle = (w: WorkspaceSummary): string => w.call?.title || 'Untitled call';

/* ---------- what's in them ---------- */

/** What a card or a row is about: an item of a workspace, by kind, as the Drive shows it. */
export type FileKind = DocumentKind;
export const KIND_ICON: Record<FileKind, IconName> = { doc: 'fileText', board: 'presentation' };
const UNNAMED: Record<FileKind, string> = { doc: 'Untitled', board: 'Untitled board' };
export const fileName = (kind: FileKind, name: string): string => name.trim() || UNNAMED[kind];

/** One document or board in the Drive: where it is, and what its card says of it. */
export interface DriveFile {
  workspaceId: string;
  /** Its own ID in its workspace. */
  id: string;
  kind: FileKind;
  name: string;
  /** Whose it is, by first name, or null. */
  by: string | null;
  editedAt: string;
}

/** Every document and board you can open, the most recently edited first. */
export function filesIn(library: DocumentLibrary | undefined): DriveFile[] {
  return (library?.workspaces ?? [])
    .flatMap((w) => w.documents.map((d: Document): DriveFile => ({ workspaceId: w.id, id: d.item, kind: d.kind, name: d.name, by: d.by, editedAt: d.updatedAt })))
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
}
/** An item of a tree as the Drive shows it. Null for a folder. */
export function fileOf(workspaceId: string, item: WorkspaceItem): DriveFile | null {
  if (item.kind === 'folder') return null;
  return { workspaceId, id: item.id, kind: item.kind === 'board' ? 'board' : 'doc', name: item.name, by: item.by ? firstName(item.by.name) : null, editedAt: item.editedAt };
}

/** Where a file is, said once on its card: the call it's from or for, the workspace it's in, or that it was shared with you. */
export function whereOf(f: DriveFile, spaces: readonly WorkspaceSummary[], now = Date.now()): string {
  const w = spaces.find((s) => s.id === f.workspaceId);
  if (!w || isSharedOnly(w)) return 'Shared with you';
  if (w.call) return `${isAhead(w, now) ? 'For' : 'From'} ${callTitle(w)}`;
  return `In ${w.name ?? 'a workspace'}`;
}

/** When, after who, on a card: "10:12" today, "Mon" this past week, else "Tue 27 Oct". */
export function cardWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const n = -daysFromToday(d, now);
  if (n <= 0) return hm(d);
  if (n < 7) return weekday(d).slice(0, 3);
  return d.getFullYear() === now.getFullYear() ? shortDay(d) : `${dayMonth(d)} ${d.getFullYear()}`;
}
/** Who and when, on a card: "Kofi, 10:12", or "You, 12:10" for what's yours. */
export const byLine = (f: Pick<DriveFile, 'by' | 'editedAt'>, me: string | undefined, now = new Date()): string =>
  [f.by && me && f.by === firstName(me) ? 'You' : f.by, cardWhen(f.editedAt, now)].filter(Boolean).join(', ');

/** Recent's groups, by the day each was last edited: Today, Yesterday, Earlier this week, Last week, Earlier. */
export function dayGroup(iso: string, now = new Date()): string {
  const n = -daysFromToday(new Date(iso), now);
  const intoWeek = (now.getDay() + 6) % 7;
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n <= intoWeek) return 'Earlier this week';
  if (n <= intoWeek + 7) return 'Last week';
  return 'Earlier';
}
/** Things in groups, in the order the groups first come. */
export function grouped<T>(list: readonly T[], label: (x: T) => string): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const x of list) {
    const l = label(x);
    const g = out.find((o) => o.label === l);
    if (g) g.items.push(x);
    else out.push({ label: l, items: [x] });
  }
  return out;
}

/** A folder's name, or a call's folder's without the day its name ends in ("Launch planning · 27 Oct"). */
export const callFolderTitle = (item: Pick<WorkspaceItem, 'name'>): string => item.name.split(' · ')[0]?.trim() || item.name || 'A call';

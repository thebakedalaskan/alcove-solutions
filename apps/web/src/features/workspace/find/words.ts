/*
 * What Find looks through: the words of everything someone can open in a workspace, read once from `searchText` and held in
 * this tab's memory. Nothing typed into Find leaves the browser, because it's looked for here. The words are for this session
 * and nowhere else: never stored, gone on signing out, and gone as soon as what they're from can't be opened.
 */
import { errorCode, type LiveStore, type SearchDoc, type WorkspaceItem, type WorkspaceRole, type WorkspaceView } from '@alcove/api';
import { useEffect } from 'react';
import { api } from '~/lib/api';
import { log } from '~/lib/log';

const wlog = log.child({ component: 'workspace-find' });

/** How often results are shown as documents arrive. */
const SHOW_EVERY_MS = 80;
/** The soonest everything is read again, however much changed: Alcove takes twelve of these a minute from someone. */
const READ_AGAIN_MS = 6_000;

/** The words held so far. `reading`: more are on their way. `failed`: the last read didn't finish, and what's here is what got here. */
export interface Words { docs: ReadonlyMap<string, SearchDoc>; reading: boolean; failed: boolean }

const NONE: ReadonlyMap<string, SearchDoc> = new Map();

class WorkspaceWords implements LiveStore<Words> {
  private view: Words = { docs: NONE, reading: false, failed: false };
  private readonly listeners = new Set<() => void>();
  /** Which read is going: a read that's been let go of stops at its next line. */
  private run = 0;
  /** When the last whole read began. What changed after that may say something else now. */
  private readAt = 0;
  private lastTry = 0;
  /** Someone's role here, the last time it was looked at. */
  private role: WorkspaceRole | null | undefined;
  /** What the tree last said can be opened: a read on its way may hold something that's been lost since. */
  private open: ReadonlySet<string> | null = null;

  constructor(private readonly workspaceId: string, private readonly pass: string | undefined) {}

  getSnapshot = (): Words => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  private set(next: Partial<Words>): void {
    this.view = { ...this.view, ...next };
    this.listeners.forEach((l) => l());
  }
  /** Only what can still be opened. */
  private within(docs: Iterable<[string, SearchDoc]>): ReadonlyMap<string, SearchDoc> {
    return new Map([...docs].filter(([id]) => this.open?.has(id) ?? true));
  }

  /** Reads everything again if something in `docs` may say more than what's held. Called as Find opens. */
  refresh(docs: readonly WorkspaceItem[]): void {
    if (this.view.reading || Date.now() - this.lastTry < READ_AGAIN_MS) return;
    const behind = this.readAt === 0 || docs.some((d) => !this.view.docs.has(d.id) || Date.parse(d.editedAt) > this.readAt);
    if (behind) void this.read();
  }

  private async read(): Promise<void> {
    const run = ++this.run;
    const began = Date.now();
    this.lastTry = began;
    const found = new Map<string, SearchDoc>();
    let shown = 0;
    this.set({ reading: true, failed: false });
    try {
      for await (const doc of api.workspaces.searchText(this.workspaceId, this.pass ? { pass: this.pass } : undefined)) {
        if (run !== this.run) return;
        found.set(doc.id, doc);
        if (Date.now() - shown < SHOW_EVERY_MS) continue;
        shown = Date.now();
        this.set({ docs: this.within([...this.view.docs, ...found]) });
      }
      if (run !== this.run) return;
      this.readAt = began;
      /* Only what this read found: anything else has gone, or can't be opened any more. */
      this.set({ docs: this.within(found), reading: false });
    } catch (e) {
      if (run !== this.run) return;
      wlog.info('a workspace’s words weren’t read', { workspaceId: this.workspaceId, code: errorCode(e), found: found.size });
      this.set({ docs: this.within([...this.view.docs, ...found]), reading: false, failed: true });
    }
  }

  /**
   * What someone can open has just changed, or may have: the words of anything they've lost go now, and with a new role
   * everything does, to be read as that role next time. What's in Trash isn't searched either.
   */
  follow(items: readonly WorkspaceItem[], role: WorkspaceRole | null): void {
    if (this.role !== undefined && this.role !== role) this.forget();
    this.role = role;
    const open = new Set(items.flatMap((i) => (i.trashedAt === null ? [i.id] : [])));
    this.open = open;
    if ([...this.view.docs.keys()].every((id) => open.has(id))) return;
    this.set({ docs: this.within(this.view.docs) });
  }

  /** Lets go of everything, and of anything on its way. */
  forget(): void {
    this.run++;
    this.readAt = 0;
    this.lastTry = 0;
    this.set({ docs: NONE, reading: false, failed: false });
  }
}

const held = new Map<string, WorkspaceWords>();

/** The words of a workspace as this person reads it: `pass` is a guest's, who reads what a seat can open. */
export function wordsOf(workspaceId: string, pass: string | undefined): WorkspaceWords {
  const key = `${workspaceId} ${pass ?? ''}`;
  const here = held.get(key);
  if (here) return here;
  const made = new WorkspaceWords(workspaceId, pass);
  held.set(key, made);
  return made;
}

/** This workspace can't be opened here any more, or it's a guest's and the call's over. */
export function forgetWordsOf(workspaceId: string, pass: string | undefined): void {
  const key = `${workspaceId} ${pass ?? ''}`;
  held.get(key)?.forget();
  held.delete(key);
}

/** Whoever was signed in here isn't any more. */
export function forgetWords(): void {
  for (const words of held.values()) words.forget();
  held.clear();
}

/** Keeps the words held for a workspace to what its stream says someone can open. A guest's go when they leave. */
export function useWordsFollow(workspaceId: string, pass: string | undefined, view: WorkspaceView): void {
  useEffect(() => {
    if (view.status === 'closed') forgetWordsOf(workspaceId, pass);
    else if (view.tree) wordsOf(workspaceId, pass).follow(view.tree.items, view.tree.role);
  }, [workspaceId, pass, view.status, view.tree]);
  useEffect(() => () => { if (pass) forgetWordsOf(workspaceId, pass); }, [workspaceId, pass]);
}

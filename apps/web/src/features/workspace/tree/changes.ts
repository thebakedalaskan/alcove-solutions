/*
 * A change to the tree shows at once and reaches everyone on the workspace's stream. Until the stream brings it back, the
 * change is laid over the tree it sent, however long that takes (the stream may be down, and the list then says so), and
 * it's taken off again if Alcove refuses it. Applying one to a tree that already has it changes nothing, so it doesn't
 * matter which arrives first.
 */
import { AlcoveApiError, type ItemPlace, type LiveStore, type WorkspaceItem, type WorkspaceTree, type WorkspaceView } from '@alcove/api';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

export type TreeChange =
  | { kind: 'add'; item: WorkspaceItem; place: ItemPlace }
  | { kind: 'move'; id: string; to: ItemPlace }
  | { kind: 'name'; id: string; name: string }
  | { kind: 'trash'; id: string; at: string; by: string }
  | { kind: 'restore'; id: string }
  | { kind: 'delete'; id: string };

/** `items` with `item` put back among its siblings, parents still before what's in them. */
function placed(items: WorkspaceItem[], item: WorkspaceItem, to: ItemPlace): WorkspaceItem[] {
  const rest = items.filter((i) => i.id !== item.id);
  const landed = { ...item, parent: to.parent };
  const siblings = rest.filter((i) => i.parent === to.parent);
  const anchor = to.after === null ? siblings[0] : to.after === undefined ? siblings.at(-1) : siblings.find((i) => i.id === to.after);
  if (!anchor) {
    const parentAt = rest.findIndex((i) => i.id === to.parent);
    return [...rest.slice(0, parentAt + 1), landed, ...rest.slice(parentAt + 1)];
  }
  const at = rest.indexOf(anchor) + (to.after === null ? 0 : 1);
  return [...rest.slice(0, at), landed, ...rest.slice(at)];
}

export function withChange(items: WorkspaceItem[], c: TreeChange): WorkspaceItem[] {
  const edit = (id: string, patch: Partial<WorkspaceItem>) => items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  switch (c.kind) {
    case 'add': return items.some((i) => i.id === c.item.id) ? items : placed(items, c.item, c.place);
    case 'move': { const item = items.find((i) => i.id === c.id); return item ? placed(items, item, c.to) : items; }
    case 'name': return edit(c.id, { name: c.name });
    case 'trash': return edit(c.id, { trashedAt: c.at, trashedBy: c.by });
    case 'restore': return edit(c.id, { trashedAt: null, trashedBy: null });
    case 'delete': return items.filter((i) => i.id !== c.id);
  }
}

interface Pending { n: number; change: TreeChange; answeredAt: WorkspaceTree | null | undefined }

/** Whether `tree` is what came after the answer, so it shows the change by now. */
const caughtUp = (p: Pending, tree: WorkspaceTree | null): boolean => {
  if (p.change.kind === 'add') { const { id } = p.change.item; return !!tree?.items.some((i) => i.id === id); }
  return p.answeredAt !== undefined && p.answeredAt !== tree;
};

/** The tree as it should look now, and `change`, which shows a change while `work` carries it out. */
export class TreeChanges implements LiveStore<WorkspaceItem[]> {
  private pending: Pending[] = [];
  private count = 0;
  private items: WorkspaceItem[];
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  constructor(private store: LiveStore<WorkspaceView>) { this.items = store.getSnapshot().tree?.items ?? []; }
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.stop) { this.stop = this.store.subscribe(this.refresh); this.refresh(); }
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.stop?.(); this.stop = null; } };
  };
  private refresh = () => {
    const tree = this.store.getSnapshot().tree;
    // An answered newer name must stay over an older pending name, even if the stream already has the newer one.
    const blocked = (p: Pending) => this.pending.some((before) => before.n < p.n && before.answeredAt === undefined);
    this.pending = this.pending.filter((p) => blocked(p) || !caughtUp(p, tree));
    this.items = this.pending.reduce((all, p) => withChange(all, p.change), tree?.items ?? []);
    this.listeners.forEach((listener) => listener());
  };
  close = () => { this.generation++; this.stop?.(); this.stop = null; this.pending = []; this.items = []; this.tail = Promise.resolve(); };
  change = async <T,>(c: TreeChange, work: () => Promise<T>): Promise<T> => {
    const n = ++this.count;
    const generation = this.generation;
    const before = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    const drop = () => { this.pending = this.pending.filter((p) => p.n !== n); this.refresh(); };
    this.pending.push({ n, change: structuredClone(c), answeredAt: undefined });
    this.refresh();
    try {
      await before;
      if (generation !== this.generation) throw new AlcoveApiError('forbidden', 'The workspace closed before this change could be sent. Open it again to retry.');
      const answer = await work();
      if (generation !== this.generation) return answer;
      // Alcove has it: it stays laid over the tree until the stream brings a tree from after this answer, which has it.
      this.pending = this.pending.map((p) => p.n === n ? { ...p, answeredAt: this.store.getSnapshot().tree } : p);
      return answer;
    } catch (e) {
      if (generation === this.generation) drop();
      throw e;
    } finally { release(); }
  };
}

/** The live stream remains authoritative; React reads just the owner’s projected item list. */
export function useLaidOver(store: LiveStore<WorkspaceView>) {
  const owner = useMemo(() => new TreeChanges(store), [store]);
  const items = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useLayoutEffect(() => owner.close, [owner]);
  return { items, change: owner.change };
}

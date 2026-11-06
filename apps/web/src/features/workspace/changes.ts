/*
 * A change to the tree shows at once and reaches everyone on the workspace's stream. Until the stream brings it back, the
 * change is laid over the tree it sent, and it's taken off again if Alcove refuses it. Applying one to a tree that
 * already has it changes nothing, so it doesn't matter which arrives first.
 */
import type { ItemPlace, WorkspaceItem, WorkspaceTree } from '@alcove/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

/** How long a change Alcove has taken stays laid over the tree, for a stream that's slow to bring it back. */
const KEEP_MS = 2000;

interface Pending { n: number; change: TreeChange; answeredAt: WorkspaceTree | null | undefined }

/** Whether `tree` is what came after the answer, so it shows the change by now. */
const caughtUp = (p: Pending, tree: WorkspaceTree | null): boolean => {
  if (p.change.kind === 'add') { const { id } = p.change.item; return !!tree?.items.some((i) => i.id === id); }
  return p.answeredAt !== undefined && p.answeredAt !== tree;
};

/** The tree as it should look now, and `change`, which shows a change while `work` carries it out. */
export function useLaidOver(tree: WorkspaceTree | null) {
  const [pending, setPending] = useState<Pending[]>([]);
  const count = useRef(0);
  const latest = useRef(tree);
  latest.current = tree;
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => { const t = timers.current; return () => { t.forEach(clearTimeout); }; }, []);
  useEffect(() => {
    setPending((was) => { const kept = was.filter((p) => !caughtUp(p, tree)); return kept.length === was.length ? was : kept; });
  }, [tree]);

  const items = useMemo(() => pending.reduce((all, p) => withChange(all, p.change), tree?.items ?? []), [tree, pending]);

  const change = useCallback(async <T,>(c: TreeChange, work: () => Promise<T>): Promise<T> => {
    const n = ++count.current;
    const drop = () => setPending((was) => was.filter((p) => p.n !== n));
    setPending((was) => [...was, { n, change: c, answeredAt: undefined }]);
    try {
      const answer = await work();
      setPending((was) => was.map((p) => (p.n === n ? { ...p, answeredAt: latest.current } : p)));
      const t = setTimeout(() => { timers.current.delete(t); drop(); }, KEEP_MS);
      timers.current.add(t);
      return answer;
    } catch (e) {
      drop();
      throw e;
    }
  }, []);

  return { items, change };
}

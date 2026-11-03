/* The words on the left of the welcome screens: the old moment lifts away and the new one rises in. */
import { cn } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Entry<K> { id: number; kind: K; out: boolean; replacing: boolean }

export function useMoments<K extends string>(first: K) {
  const [list, setList] = useState<Entry<K>[]>([{ id: 0, kind: first, out: false, replacing: false }]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const show = useCallback((kind: K) => {
    setList((l) => [...l.filter((m) => !m.out).map((m) => ({ ...m, out: true })), { id: (l.at(-1)?.id ?? 0) + 1, kind, out: false, replacing: true }]);
    timers.current.push(setTimeout(() => setList((l) => l.filter((m) => !m.out)), 320));
  }, []);
  return { list, show };
}

/** One moment: each part rises in a beat after the one before. */
export function Moment({ out, replacing, parts }: { out: boolean; replacing: boolean; parts: ReactNode[] }) {
  return (
    <div className={cn('in-moment', out ? 'out' : 'enter')} aria-hidden={out || undefined}>
      {parts.map((p, i) => <div key={i} style={{ '--d': i + (replacing ? 2 : 0) }}>{p}</div>)}
    </div>
  );
}

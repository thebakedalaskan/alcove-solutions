/** A validated call action opens its existing panel and focuses its exact current row after that panel mounts. */
import { useEffect, useRef } from 'react';
export interface ActionJump { id: string; request: number }
export function useActionFocus(jump: ActionJump | undefined) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!jump) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-call-action="${CSS.escape(jump.id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true });
  }, [jump?.id, jump?.request]);
  return root;
}

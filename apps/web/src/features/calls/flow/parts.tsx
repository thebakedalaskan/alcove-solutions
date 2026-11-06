/* Small pieces the call modal and the call card share. */
import { errorMessage, errorRequestId } from '@alcove/api';
import { Flood, FlowNote, RequestRef } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

/** How long night takes to flood out. */
const FLOOD_MS = 560;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Night floods out from what was pressed while `open` (which says where to go) gets ready, then the page goes there.
 * If it can't, night draws back and the error goes to whoever asked. With reduced motion there's no flood.
 */
export function useFloodToCall() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [flood, setFlood] = useState<{ at: { x: number; y: number }; back: boolean } | null>(null);
  const go = useCallback(async (from: Element | null, open: () => Promise<string>) => {
    const box = from?.getBoundingClientRect();
    if (box && !reduce) setFlood({ at: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, back: false });
    try {
      const [code] = await Promise.all([open(), reduce ? undefined : sleep(FLOOD_MS)]);
      await navigate({ to: '/join/$code', params: { code } });
    } catch (e) {
      setFlood((f) => f && { ...f, back: true });
      throw e;
    }
  }, [navigate, reduce]);
  /* Night that drew back has nothing left to show. */
  useEffect(() => {
    if (!flood?.back) return undefined;
    const t = setTimeout(() => setFlood(null), 240);
    return () => clearTimeout(t);
  }, [flood]);
  return { go, flood: flood && <Flood at={flood.at} back={flood.back} /> };
}

/** A save that didn't go through, in place, with what to quote when reporting it. What was being changed stays as it was. */
export function Failed({ error }: { error: unknown }) {
  const ref = errorRequestId(error);
  return <FlowNote icon="alert" className="cf-fail" actions={ref ? <RequestRef id={ref} /> : undefined}>{errorMessage(error)}</FlowNote>;
}

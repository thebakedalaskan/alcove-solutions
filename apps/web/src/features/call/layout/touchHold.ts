/*
 * Holding a live list still for a finger, in your side of the call: Chat's questions (ChatQuestions.tsx) and what the call
 * suggests under Notes' follow-ups (../notes/SuggestedFollowUps.tsx). A mouse or pen holds such a list while it points at it,
 * and keyboard focus while it's in it; each list does that itself. A finger is this.
 */
import { useEffect, useRef, useState, type PointerEvent, type TouchEvent } from 'react';

/** On a touch screen, how long a list holds after the last touch or scroll in it: time to read where it stopped, or tap again. */
const TOUCH_HOLD_MS = 2500;
/** Whether a touch is a finger's: a pen on a tablet sends touches too, and holds a list only while it points, as a mouse does. */
const byFinger = (e: TouchEvent) => Array.from(e.changedTouches).some((t) => !('touchType' in t) || t.touchType !== 'stylus');

/**
 * Holding a list for a finger, which the pointer's enter and leave can't do: a finger leaves the list as it lifts and as soon
 * as a scroll starts, and a tap leaves no keyboard focus. So for touch a list holds while a finger is on it, and for
 * `TOUCH_HOLD_MS` after the last touch or scroll there, so a row doesn't move from under a second tap when something comes back.
 * A finger's pointer is cancelled once the page takes it for a scroll, so its touch says when it lifts. A mouse or pen still
 * holds a list only while it points at it. Owns its timer, cleared as the list goes. Its handlers are made once, as all they
 * change is kept in refs, so a listener added once can call them.
 */
export function useTouchHold() {
  const [held, setHeld] = useState(false);
  const holding = useRef(false);
  const down = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const [handlers] = useState(() => {
    const hold = (on: boolean) => { holding.current = on; setHeld(on); };
    const soon = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => hold(false), TOUCH_HOLD_MS); };
    const press = () => { down.current = true; window.clearTimeout(timer.current); hold(true); };
    const lift = () => { down.current = false; soon(); };
    return {
      /** On the list and its bar. */
      on: {
        onPointerDown: (e: PointerEvent) => { if (e.pointerType === 'touch') press(); },
        onPointerUp: (e: PointerEvent) => { if (e.pointerType === 'touch') lift(); },
        onTouchStart: (e: TouchEvent) => { if (byFinger(e)) press(); },
        onTouchEnd: (e: TouchEvent) => { if (byFinger(e)) lift(); },
        onTouchCancel: (e: TouchEvent) => { if (byFinger(e)) lift(); }
      },
      /** On what scrolls: while a touch holds the list, each scroll there, a flick's glide included, keeps it a while longer. */
      onScroll: () => { if (holding.current && !down.current) soon(); }
    };
  });
  return { held, ...handlers };
}

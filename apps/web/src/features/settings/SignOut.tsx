/*
 * Signing out, in Settings' sky: the button, and the question it asks when something on this device would be lost
 * (`useSigningOut`, features/account/signOut.ts, decides). Focus goes to staying signed in, the choice that loses nothing;
 * Escape closes the question and goes back to Sign out. The question grows the sky to hold it, and for a moment the page is
 * that one action.
 */
import { Button, Spinner } from '@alcove/ui';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSigningOut, type SignOutQuestion } from '~/features/account/signOut';

/**
 * Settings' Sign out, in the sky: the button, the step it opens when something here would be lost, and how tall that step
 * is for the sky to hold it.
 */
export function useSignOutStep(): { button: ReactNode; step: ReactNode; asking: boolean; height: number } {
  const [height, setHeight] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const out = useSigningOut({
    back: () => opener.current?.focus(),
    holding: () => Boolean(document.getElementById(id)?.contains(document.activeElement))
  });
  const asking = out.question !== null;
  const button = (
    <Button ref={opener} variant="quiet" size="sm" icon="signOut" loading={out.pending && !asking}
      aria-expanded={out.asks ? asking : undefined} aria-controls={asking ? id : undefined} onClick={out.press}>Sign out</Button>
  );
  return {
    button, asking, height,
    step: out.question ? <SignOutStep id={id} question={out.question} copying={out.copying} onCopy={out.copy} pending={out.pending} onStay={out.stay} onSignOut={out.signOut} onHeight={setHeight} /> : null
  };
}

function SignOutStep({ id, question, copying, onCopy, pending, onStay, onSignOut, onHeight }: { id: string; question: SignOutQuestion; copying: boolean; onCopy: () => void; pending: boolean; onStay: () => void; onSignOut: () => void; onHeight: (px: number) => void }) {
  const title = useId();
  const box = useRef<HTMLDivElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => { stay.current?.focus({ preventScroll: true }); }, []);
  // However it wraps, the sky holds it, from before it's first drawn.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const say = () => onHeight(el.offsetHeight);
    say();
    const watch = new ResizeObserver(say);
    watch.observe(el);
    return () => watch.disconnect();
  }, [onHeight]);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Escape' && !pending) { e.stopPropagation(); onStay(); } };
  return (
    <div ref={box} id={id} className="set-ask" role="group" aria-labelledby={title} onKeyDown={keys}>
      <b id={title}>{question.says}</b>
      {question.lines.map((line) => <p key={line}>{line}</p>)}
      <div className="set-ask-a">
        {/* aria-disabled, not disabled, while signing out: focus stays on the button pressed. */}
        <Button ref={stay} variant="primary" aria-disabled={pending || undefined} onClick={() => { if (!pending) onStay(); }}>Stay signed in</Button>
        {question.words && (
          <Button aria-disabled={pending || copying || undefined} onClick={() => { if (!pending && !copying) onCopy(); }}>
            {copying && <Spinner />}{copying ? 'Copying' : 'Copy what you wrote'}
          </Button>
        )}
        <Button className="set-sky" aria-disabled={pending || undefined} onClick={() => { if (!pending) onSignOut(); }}>
          {pending && <Spinner />}{pending ? 'Signing out' : question.signOutLabel}
        </Button>
      </div>
    </div>
  );
}

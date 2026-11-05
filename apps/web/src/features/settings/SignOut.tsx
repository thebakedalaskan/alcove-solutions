/*
 * Signing out, from the sky. It deletes what this device kept for the account, recordings that haven't uploaded among
 * them (features/record/offline.ts), so with any waiting it says so first: the sky grows to hold one step, stay signed in
 * or sign out and delete them, and for a moment the page is that one action. Focus goes to staying signed in, the choice
 * that loses nothing; Escape closes the step and goes back to Sign out.
 */
import { errorMessage } from '@alcove/api';
import { Button, Spinner, useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { uploads, type KeptItem } from '~/features/record/uploads';
import { useLive } from '~/lib/live';
import { useSignOut } from '~/lib/queries';
import { plural } from '~/lib/words';

/** The Sign out button, the step it opens when recordings here haven't uploaded yet, and how tall that step is for the sky to hold it. */
export function useSignOutStep(): { button: ReactNode; step: ReactNode; asking: boolean; height: number } {
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const { list } = useLive(uploads);
  const waiting = list.length;
  const [asking, setAsking] = useState(false);
  const [height, setHeight] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const go = () => signOut.mutate(undefined, { onSuccess: () => void navigate({ to: '/welcome', replace: true }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const close = () => { setAsking(false); opener.current?.focus(); };
  // Decided on what's really here: a list not read yet would look empty, and sign out without a word.
  const press = () => { void uploads.listed().then((k) => { if (k.list.length > 0) setAsking(!asking); else go(); }); };
  // Nothing waits any more (it uploaded meanwhile), so the step has nothing left to say: it closes for good, before it's
  // drawn, and focus that was in it goes back to Sign out.
  useLayoutEffect(() => {
    if (!asking || waiting > 0) return;
    const inside = document.getElementById(id)?.contains(document.activeElement);
    setAsking(false);
    if (inside) opener.current?.focus();
  }, [asking, waiting, id]);
  const button = (
    <Button ref={opener} variant="quiet" size="sm" icon="signOut" loading={signOut.isPending && !asking}
      aria-expanded={waiting > 0 ? asking : undefined} aria-controls={asking ? id : undefined} onClick={press}>Sign out</Button>
  );
  return { button, asking, height, step: asking ? <SignOutStep id={id} kept={list} pending={signOut.isPending} onStay={close} onSignOut={go} onHeight={setHeight} /> : null };
}

/** What staying signed in does for them: they upload by themselves, unless they're too old or won't open here. */
function staying(count: number, stuck: number): string {
  if (stuck === count) {
    return count === 1
      ? 'It can’t upload: it’s too old, or it won’t open on this device. It stays here until you delete it on Record.'
      : 'They can’t upload: they’re too old, or won’t open on this device. They stay here until you delete them on Record.';
  }
  const going = count - stuck;
  const upload = stuck === 0
    ? (count === 1 ? 'it uploads by itself' : 'they upload by themselves')
    : (going === 1 ? 'one uploads by itself' : `${going} upload by themselves`);
  const rest = stuck === 0 ? ''
    : stuck === 1 ? ' The other can’t upload: it’s too old, or won’t open on this device.'
      : ` The other ${stuck} can’t upload: they’re too old, or won’t open on this device.`;
  return `Stay signed in and ${upload} once you’re online, then the notes are written.${rest}`;
}

function SignOutStep({ id, kept, pending, onStay, onSignOut, onHeight }: { id: string; kept: readonly KeptItem[]; pending: boolean; onStay: () => void; onSignOut: () => void; onHeight: (px: number) => void }) {
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
  const count = kept.length;
  const one = count === 1;
  const stuck = kept.filter((k) => k.status === 'expired' || k.status === 'unreadable').length;
  return (
    <div ref={box} id={id} className="set-ask" role="group" aria-labelledby={title} onKeyDown={keys}>
      <b id={title}>{plural(count, 'recording')} on this device {one ? 'hasn’t' : 'haven’t'} uploaded. Signing out deletes {one ? 'it' : 'them'}.</b>
      <p>{staying(count, stuck)}</p>
      <div className="set-ask-a">
        {/* aria-disabled, not disabled, while signing out: focus stays on the button pressed. */}
        <Button ref={stay} variant="primary" aria-disabled={pending || undefined} onClick={() => { if (!pending) onStay(); }}>Stay signed in</Button>
        <Button className="set-sky" aria-disabled={pending || undefined} onClick={() => { if (!pending) onSignOut(); }}>
          {pending && <Spinner />}{pending ? 'Signing out' : `Sign out and delete ${one ? 'it' : 'them'}`}
        </Button>
      </div>
    </div>
  );
}

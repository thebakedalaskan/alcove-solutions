/*
 * Signing out, from the sky. It deletes what this device kept for the account: recordings that haven't uploaded
 * (features/record/offline.ts), and anything written in the workspace that hasn't reached Alcove
 * (features/workspace/keep.ts). With any of that here it says so first: the sky grows to hold one step, stay signed in,
 * copy what was written, or sign out and delete it, and for a moment the page is that one action. The copy holds only the
 * person's own words, as plain text. Focus goes to staying signed in, the choice that loses nothing; Escape closes the step
 * and goes back to Sign out.
 */
import { errorMessage } from '@alcove/api';
import { Button, Spinner, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { uploads, type KeptItem } from '~/features/record/uploads';
import { keptDocuments } from '~/features/workspace/keep';
import { unsentText } from '~/features/workspace/sendKept';
import { useLive } from '~/lib/live';
import { q, useSignOut } from '~/lib/queries';
import { plural } from '~/lib/words';

/**
 * The Sign out button, the step it opens when recordings here haven't uploaded yet or something written hasn't reached
 * Alcove, and how tall that step is for the sky to hold it.
 */
export function useSignOutStep(): { button: ReactNode; step: ReactNode; asking: boolean; height: number } {
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const { list } = useLive(uploads);
  const waiting = list.length;
  const owner = useQuery(q.session()).data?.ownerId ?? null;
  /** How many documents hold something written here that hasn't reached Alcove. */
  const [words, setWords] = useState(0);
  const [copying, setCopying] = useState(false);
  const [asking, setAsking] = useState(false);
  const [height, setHeight] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const go = () => signOut.mutate(undefined, { onSuccess: () => void navigate({ to: '/welcome', replace: true }), onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const close = () => { setAsking(false); opener.current?.focus(); };
  // Decided on what's really here: a list not read yet would look empty, and sign out without a word.
  const press = () => {
    void Promise.all([uploads.listed(), owner ? keptDocuments(owner) : Promise.resolve([])]).then(([k, kept]) => {
      setWords(kept.length);
      if (k.list.length > 0 || kept.length > 0) setAsking(!asking);
      else go();
    });
  };
  // Only their own words, as plain text. Opening each document sends what can go meanwhile, so it may all be in by then.
  const copy = () => {
    if (!owner || copying) return;
    setCopying(true);
    unsentText(owner)
      .then(async (text) => {
        if (!text) { toast('It all reached Alcove meanwhile, so there’s nothing to copy.'); return; }
        await navigator.clipboard.writeText(text);
        toast('Copied. Paste it wherever you like.', { icon: 'copy' });
      })
      .then(() => keptDocuments(owner))
      .then((kept) => { setWords(kept.length); }, (e: unknown) => { toast(errorMessage(e), { icon: 'x' }); })
      .finally(() => { setCopying(false); });
  };
  // Nothing waits any more (it uploaded or reached Alcove meanwhile), so the step has nothing left to say: it closes for
  // good, before it's drawn, and focus that was in it goes back to Sign out.
  useLayoutEffect(() => {
    if (!asking || waiting > 0 || words > 0) return;
    const inside = document.getElementById(id)?.contains(document.activeElement);
    setAsking(false);
    if (inside) opener.current?.focus();
  }, [asking, waiting, words, id]);
  const button = (
    <Button ref={opener} variant="quiet" size="sm" icon="signOut" loading={signOut.isPending && !asking}
      aria-expanded={waiting > 0 || words > 0 ? asking : undefined} aria-controls={asking ? id : undefined} onClick={press}>Sign out</Button>
  );
  return {
    button, asking, height,
    step: asking ? <SignOutStep id={id} kept={list} words={words > 0} copying={copying} onCopy={copy} pending={signOut.isPending} onStay={close} onSignOut={go} onHeight={setHeight} /> : null
  };
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

/** What signing out deletes here, said plainly. `words`: something written in the workspace hasn't reached Alcove. */
function deletes(count: number, words: boolean): { says: string; them: string } {
  const one = count === 1;
  const recordings = `${plural(count, 'recording')} on this device ${one ? 'hasn’t' : 'haven’t'} uploaded`;
  if (count > 0 && words) return { says: `${recordings}, and something you wrote hasn’t reached Alcove. Signing out deletes them.`, them: 'them' };
  if (count > 0) return { says: `${recordings}. Signing out deletes ${one ? 'it' : 'them'}.`, them: one ? 'it' : 'them' };
  return { says: 'Something you wrote hasn’t reached Alcove yet. Signing out deletes it from this browser.', them: 'it' };
}

function SignOutStep({ id, kept, words, copying, onCopy, pending, onStay, onSignOut, onHeight }: { id: string; kept: readonly KeptItem[]; words: boolean; copying: boolean; onCopy: () => void; pending: boolean; onStay: () => void; onSignOut: () => void; onHeight: (px: number) => void }) {
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
  const stuck = kept.filter((k) => k.status === 'expired' || k.status === 'unreadable').length;
  const { says, them } = deletes(count, words);
  return (
    <div ref={box} id={id} className="set-ask" role="group" aria-labelledby={title} onKeyDown={keys}>
      <b id={title}>{says}</b>
      {count > 0 && <p>{staying(count, stuck)}</p>}
      {words && <p>Stay signed in and it stays here until it can go, or copy it first: only your own words come with it.</p>}
      <div className="set-ask-a">
        {/* aria-disabled, not disabled, while signing out: focus stays on the button pressed. */}
        <Button ref={stay} variant="primary" aria-disabled={pending || undefined} onClick={() => { if (!pending) onStay(); }}>Stay signed in</Button>
        {words && (
          <Button aria-disabled={pending || copying || undefined} onClick={() => { if (!pending && !copying) onCopy(); }}>
            {copying && <Spinner />}{copying ? 'Copying' : 'Copy what you wrote'}
          </Button>
        )}
        <Button className="set-sky" aria-disabled={pending || undefined} onClick={() => { if (!pending) onSignOut(); }}>
          {pending && <Spinner />}{pending ? 'Signing out' : `Sign out and delete ${them}`}
        </Button>
      </div>
    </div>
  );
}

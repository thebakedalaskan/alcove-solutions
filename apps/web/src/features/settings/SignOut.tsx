/*
 * Signing out. It deletes what this device kept for the account: recordings that haven't uploaded
 * (features/record/offline.ts), and anything written in the workspace that hasn't reached Alcove
 * (features/workspace/keep.ts). With any of that here it says so first, and asks: stay signed in, copy what was written,
 * or sign out and delete it. The copy holds only the person's own words, as plain text. Focus goes to staying signed in,
 * the choice that loses nothing; Escape closes the question and goes back to Sign out.
 *
 * One hook decides (`useSigningOut`): what's waiting here, what to say about it, copying, signing out. Settings' sky
 * (`useSignOutStep`, below) and your menu at the top right (features/shell/YouMenu.tsx) are two ways of showing it. In the
 * sky the question grows the sky to hold it, and for a moment the page is that one action.
 */
import { errorMessage } from '@alcove/api';
import { Button, Spinner, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { uploads } from '~/features/record/uploads';
import { keptDocuments } from '~/features/workspace/keep';
import { unsentText } from '~/features/workspace/sendKept';
import { useLive } from '~/lib/live';
import { q, useSignOut } from '~/lib/queries';
import { plural } from '~/lib/words';

/** What Sign out asks when something on this device would be lost, in the words both ways of showing it use. */
export interface SignOutQuestion {
  /** What signing out deletes. */
  says: string;
  /** What staying signed in does: a line for the recordings, and one for what was written, as there are. */
  lines: readonly string[];
  /** The way out: Sign out and delete them (or it). */
  signOutLabel: string;
  /** Something written hasn't reached Alcove, so it can be copied first. */
  words: boolean;
}

export interface SigningOut {
  /** Sign out, pressed: with nothing here that would be lost it signs out at once; otherwise it asks, or stops asking. */
  press: () => void;
  /** What it asks, while it's asking. */
  question: SignOutQuestion | null;
  /** Something is waiting here, as far as is known, so Sign out asks before it goes (its `aria-expanded`). */
  asks: boolean;
  /** Stay signed in: the question closes, and focus goes back to Sign out. */
  stay: () => void;
  /** The question closes and focus stays where it is: what it was asked in has closed (your menu). */
  dismiss: () => void;
  /** Signs out, deleting what waits here, onto the welcome page. Without a connection it says so, and nothing happens later. */
  signOut: () => void;
  /** Copies what was written that hasn't reached Alcove: only the person's own words, as plain text. */
  copy: () => void;
  copying: boolean;
  /** Signing out. */
  pending: boolean;
}

/**
 * Signing out of this device, for Settings' sky and your menu alike. `back` puts focus back on Sign out as the question
 * closes: when Stay signed in (or Escape) closes it, and when it closes by itself, nothing waiting any more, while focus
 * was in it (`holding`).
 */
export function useSigningOut({ back, holding }: { back: () => void; holding: () => boolean }): SigningOut {
  const navigate = useNavigate();
  const signOut = useSignOut(() => navigate({ to: '/welcome', replace: true }));
  const toast = useToast();
  const { list } = useLive(uploads);
  const waiting = list.length;
  const owner = useQuery(q.session()).data?.ownerId ?? null;
  /** How many documents hold something written here that hasn't reached Alcove. */
  const [words, setWords] = useState(0);
  const [copying, setCopying] = useState(false);
  const [asking, setAsking] = useState(false);
  const go = () => signOut.mutate(undefined, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) });
  const stay = () => { setAsking(false); back(); };
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
  // Nothing waits any more (it uploaded or reached Alcove meanwhile), so the question has nothing left to say: it closes
  // for good, before it's drawn, and focus that was in it goes back to Sign out.
  useLayoutEffect(() => {
    if (!asking || waiting > 0 || words > 0) return;
    const inside = holding();
    setAsking(false);
    if (inside) back();
  }, [asking, waiting, words, holding, back]);
  return {
    press, stay, dismiss: () => setAsking(false), signOut: go, copy, copying, pending: signOut.isPending, asks: waiting > 0 || words > 0,
    question: asking ? question(list.length, list.filter((k) => k.status === 'expired' || k.status === 'unreadable').length, words > 0) : null
  };
}

/** What signing out asks about `count` recordings here (`stuck` of them can't upload), and `words`, something written. */
function question(count: number, stuck: number, words: boolean): SignOutQuestion {
  const { says, them } = deletes(count, words);
  const lines: string[] = [];
  if (count > 0) lines.push(staying(count, stuck));
  if (words) lines.push('Stay signed in and it stays here until it can go, or copy it first: only your own words come with it.');
  return { says, lines, signOutLabel: `Sign out and delete ${them}`, words };
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

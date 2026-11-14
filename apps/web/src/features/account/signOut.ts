/*
 * Ending the account's session on this device: signing out, or deleting the account. It reaches into every feature that
 * keeps something here for the account, so it lives above them: what each kept goes, every tab hears it (lib/signedOut.ts),
 * the screen leaves for the welcome page, and only then is what the app read for the account forgotten.
 *
 * Signing out deletes what this device kept: recordings that haven't uploaded (features/record/offline.ts), and anything
 * written in the workspace that hasn't reached Alcove (features/workspace/offline/keep.ts). With any of that here it says so
 * first, and asks: stay signed in, copy what was written, or sign out and delete it. The copy holds only the person's own
 * words, as plain text. One hook decides (`useSigningOut`): what's waiting here, what to say about it, copying, signing out.
 * Settings' sky (features/settings/SignOut.tsx) and your menu at the top right (features/account/YouMenu.tsx) are two ways of
 * showing it.
 */
import { AlcoveApiError } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useLayoutEffect, useState } from 'react';
import { forgetPictures } from '~/features/call/media/backgrounds/backgrounds';
import { forgetNotified } from '~/features/notifications/notified';
import { forgetHourLeft } from '~/features/plans/hourLeft';
import { forgetTeamOffer } from '~/features/plans/teamOffer';
import { forgetAccount } from '~/features/record/offline';
import { uploads } from '~/features/record/uploads';
import { forgetWords } from '~/features/workspace/find/words';
import { forgetEdits, keptDocuments } from '~/features/workspace/offline/keep';
import { unsentText } from '~/features/workspace/offline/sendKept';
import { forgetPlaces } from '~/features/workspace/tree/places';
import { api } from '~/lib/api';
import { toastFailure } from '~/lib/failed';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { announceSignOut } from '~/lib/signedOut';
import { plural } from '~/lib/words';
import { accountQueries } from './queries';
import { accountKeys } from './queryKeys';

/**
 * Signed out (or the account deleted) on this device: whatever it kept for the account goes too, the recordings
 * waiting to upload among it (features/record/offline.ts; anyone else's stay), its notifications, those showing too, and
 * the words of its workspaces this tab held for Find.
 */
async function forgetHere(owner: string | undefined, deleted: boolean) {
  forgetWords();
  // The mutation captured this account before its request. A session refresh may already have cleared the cache.
  if (owner) {
    announceSignOut(owner, deleted);
    forgetPlaces(owner);
    forgetHourLeft(owner);
    forgetTeamOffer(owner);
  }
  await forgetNotified();
  if (!owner) return;
  try { await forgetAccount(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete what this device kept for the account', { err: e }); }
  try { await forgetEdits(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete the edits this device kept for the account', { err: e }); }
  try { await forgetPictures(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete the backgrounds this device kept for the account', { err: e }); }
}
/**
 * The account's session ended here (signed out, or the account deleted): what this device kept goes, `leave` takes the
 * screen to the welcome page, and only once the welcome page has replaced the app is what the app read for the account
 * forgotten. Emptied first, the app would change under the person while the welcome page loaded. The guards count the
 * account as signed out meanwhile (./guards.ts). `leave` runs even if the screen that asked has gone.
 */
async function endHere(qc: QueryClient, owner: string | undefined, deleted: boolean, leave: () => Promise<void>) {
  await forgetHere(owner, deleted);
  try { await leave(); } finally { qc.clear(); qc.setQueryData(accountKeys.session, null); }
}
/** Signs out of this device, then `leave` takes the screen to the welcome page (`endHere`). */
export function useSignOut(leave: () => Promise<void>) {
  const qc = useQueryClient();
  // With no connection it fails now. Queued, it would happen by itself at some moment nobody chose.
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const owner = qc.getQueryData(accountQueries.session().queryKey)?.ownerId;
      await api.auth.signOut();
      return owner;
    },
    onSuccess: (owner) => endHere(qc, owner, false, leave)
  });
}
/**
 * Deletes the account for good. Every browser it was signed in on is signed out, this one included. `onDeleted` then
 * takes the screen to the welcome page (`endHere`), even if the screen that asked has gone meanwhile. It's never queued
 * for later, as signing out isn't. The cookie decides whose account goes and another tab can have changed it since this
 * page was drawn, so it first asks who's signed in, and goes ahead only for the account on this screen.
 */
export function useDeleteAccount(onDeleted: () => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const here = qc.getQueryData(accountQueries.session().queryKey)?.ownerId;
      const now = await api.auth.getSession();
      if (!here || now?.ownerId !== here) throw new AlcoveApiError('forbidden', 'Who’s signed in here changed in another tab, so nothing was deleted. Reload this page.');
      await api.account.delete();
      return here;
    },
    onSuccess: (owner) => endHere(qc, owner, true, onDeleted)
  });
}

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
  const owner = useQuery(accountQueries.session()).data?.ownerId ?? null;
  /** How many documents hold something written here that hasn't reached Alcove. */
  const [words, setWords] = useState(0);
  const [copying, setCopying] = useState(false);
  const [asking, setAsking] = useState(false);
  const go = () => signOut.mutate(undefined, { onError: (e) => toastFailure(toast, e) });
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
      .then((kept) => { setWords(kept.length); }, (e: unknown) => { toastFailure(toast, e); })
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

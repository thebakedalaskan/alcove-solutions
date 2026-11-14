/*
 * Who you join a call as. Signed out: a name, and the trade-off in one line, with signing in a click away (in place,
 * never a dialog). Signed in: your account, which the organizer sees when you ask, and which gets the notes when they
 * may go to it.
 */
import type { Person, SignInProvider } from '@alcove/api';
import { Avatar, Icon } from '@alcove/ui';
import { useCallback } from 'react';
import { WaysIn, type Auth } from '~/features/account/WaysIn';

/** A guest's name, as the organizer sees it when they ask. Enter asks. On a computer it takes the focus, so joining is typing your name. */
export function GuestName({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const focus = useCallback((el: HTMLInputElement | null) => { if (el && matchMedia('(pointer: fine)').matches) el.focus({ preventScroll: true }); }, []);
  return (
    <input ref={focus} className="ac-input pj-name" value={value} maxLength={60} autoComplete="name" placeholder="Your name" aria-label="Your name"
      onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }} />
  );
}

/** Signed in: the account you join as. */
export function SignedInAs({ me }: { me: Person }) {
  return (
    <div className="pj-as">
      <Avatar person={me} size={40} />
      <div className="min-w-0"><b>Joining as {me.name}</b><small>{me.email}</small></div>
    </div>
  );
}

/**
 * The trade-off in one line, and the way to the other side of it: for a guest without an account, and for someone
 * signed in with an account this call's notes can't go to (a demo sign-in on a real organizer's call). While someone
 * stands in for the organizer (`away`, the organizer's first name), everyone new comes in as a guest, however they
 * signed in, so there's no other side to offer.
 */
export function GuestTradeOff({ notesOn, signedIn, away, onSignIn }: { notesOn: boolean; signedIn: boolean; away?: string | undefined; onSignIn: () => void }) {
  if (away) return <p className="pj-trade">While {away} is away, you join as a guest, without the notes.</p>;
  return (
    <p className="pj-trade">
      {signedIn ? 'You join as a guest, without the notes.' : notesOn ? 'Guests don’t get the notes.' : 'If notes go on, guests don’t get them.'}{' '}
      <button type="button" className="pj-link" onClick={onSignIn}>{signedIn ? 'Sign in another way' : 'Sign in to get them'}</button>
    </p>
  );
}

/**
 * The ways of signing in that get this call's notes (`only`), in place of the guest's name. Microsoft and single
 * sign-on stay on this page; Google comes back to it.
 */
export function SignInHere({ auth, only, organizer, onBack }: { auth: Auth; only: SignInProvider[]; organizer: string; onBack: () => void }) {
  return (
    <div className="pj-ways">
      <p className="pj-trade">Once {organizer} lets you in, you’re added to the invite and get the notes.</p>
      <WaysIn auth={auth} layout="stack" only={only} />
      <button type="button" className="pj-link pj-back" disabled={auth.busy !== null} onClick={onBack}><Icon name="left" size={15} />Join as a guest instead</button>
    </div>
  );
}

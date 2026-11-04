/*
 * Who you join a call as. Signed out: a name, and the trade-off in one line, with signing in a click away (in place,
 * never a dialog). Signed in: your account, which the organizer sees when you ask, and which gets the notes.
 */
import type { CallNotesStatus, Person } from '@alcove/api';
import { Avatar, Icon } from '@alcove/ui';
import { useCallback } from 'react';
import { WaysIn, type Auth } from '~/features/welcome/WaysIn';

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

/** The trade-off for a guest, in one line, and the way to the other side of it. */
export function GuestTradeOff({ notes, onSignIn }: { notes: CallNotesStatus; onSignIn: () => void }) {
  return (
    <p className="pj-trade">
      {notes === 'on' ? 'Guests don’t get the notes.' : 'If notes go on, guests don’t get them.'}{' '}
      <button type="button" className="pj-link" onClick={onSignIn}>Sign in to get them</button>
    </p>
  );
}

/** Google, Microsoft and single sign-on, in place of the guest's name. Microsoft and single sign-on stay on this page; Google comes back to it. */
export function SignInHere({ auth, organizer, onBack }: { auth: Auth; organizer: string; onBack: () => void }) {
  return (
    <div className="pj-ways">
      <p className="pj-trade">Once {organizer} lets you in, you’re added to the invite and get the notes.</p>
      <WaysIn auth={auth} layout="stack" />
      <button type="button" className="pj-link pj-back" disabled={auth.busy !== null} onClick={onBack}><Icon name="left" size={15} />Join as a guest instead</button>
    </div>
  );
}

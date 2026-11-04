/*
 * Privacy: what Alcove knows and what it can't read, the confidential-compute check (made when the app opens), and
 * deleting the account. Deleting takes one more step, which opens in place under it (never a dialog) and names what
 * goes. The shared demo account can't be deleted; the step then says so, in the server's words.
 */
import { errorCode, errorMessage } from '@alcove/api';
import { Button, Icon, SealedBadge, SettingRow, SettingsCard, Spinner, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { forgetView } from '~/features/call/view';
import { forgetTour } from '~/features/onboarding/store';
import { q, trustLine, useDeleteAccount } from '~/lib/queries';
import { hm, hoursAndMinutes } from '~/lib/time';
import { plural } from '~/lib/words';

export function PrivacyCard() {
  const trust = useQuery(q.trust()).data;
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const step = useId();
  const close = () => { setConfirming(false); opener.current?.focus(); };
  return (
    <SettingsCard id="privacy" title="Privacy" lead="Notes are written in confidential compute. Alcove can’t read them." className="set-privacy">
      <div className="set-ledger">
        <div><b><Icon name="server" size={17} />Alcove knows</b><ul><li>Your name, email and photo</li><li>When calls happen</li><li>Who was invited</li></ul></div>
        <div className="no"><b><Icon name="lock" size={17} />Alcove can’t read</b><ul><li>What was said</li><li>Your notes and summaries</li><li>The audio</li></ul></div>
      </div>
      <SealedBadge className="set-seal" detail="Where your audio is opened and your notes are written"
        title={trust?.tee === 'dstack' && trust.bound ? `Confidential compute · hardware verified ${hm(new Date(trust.at))}` : trustLine(trust)} />
      <SettingRow tone="caution" label="Delete your account" help="Deletes your account and the notes and recordings you made from Alcove, for good."
        control={(
          <Button ref={opener} size="sm" icon="trash" className="set-caution" aria-expanded={confirming} aria-controls={confirming ? step : undefined}
            onClick={() => setConfirming(true)}>Delete account</Button>
        )} />
      {confirming && <DeleteStep id={step} onClose={close} />}
    </SettingsCard>
  );
}

/**
 * The one step before deleting: what goes, what stays, and the button that does it. Focus stays in it throughout, and
 * its status region says why a deletion didn't happen. Once the account is gone, this browser forgets what it kept
 * for it, and the welcome page follows with a toast, even if you've moved on from Settings meanwhile.
 */
function DeleteStep({ id, onClose }: { id: string; onClose: () => void }) {
  const ownerId = useQuery(q.session()).data?.ownerId;
  const notes = useQuery(q.notes()).data;
  const upcoming = useQuery(q.upcoming()).data;
  const prefs = useQuery(q.prefs()).data;
  const credits = useQuery(q.balance()).data;
  const calendar = useQuery(q.calendar()).data;
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteAccount(() => {
    if (ownerId) { forgetTour(ownerId); forgetView(ownerId); }
    toast('Your account is deleted.', { icon: 'check', ms: 5000 });
    void navigate({ to: '/welcome', replace: true });
  });
  const pending = del.isPending;
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    cancel.current?.focus({ preventScroll: true });
  }, []);
  // After a refusal, focus goes to what's left to do: Close when it's final, Delete my account to try again.
  useEffect(() => { if (problem) (problem.final ? cancel : confirm).current?.focus(); }, [problem]);

  const mine = notes?.filter((n) => !n.received).length;
  const calls = upcoming?.filter((m) => m.isOrganizer && m.status !== 'ended').length;
  const kept = (prefs?.groups.length ?? 0) + (prefs?.pinned.length ?? 0) > 0;
  const google = calendar?.source === 'google' && !calendar.needsAccess;
  // Until a count is in, its line says what it covers without a number.
  const goes = [
    mine === undefined ? 'The notes you made, with their audio, for everyone who has them'
      : mine > 0 ? `${plural(mine, 'note', 'notes')} you made, with their audio, for everyone who has them` : null,
    calls === undefined ? 'The calls you scheduled, cancelled for everyone invited'
      : calls > 0 ? `${plural(calls, 'call', 'calls')} you scheduled, cancelled for everyone invited` : null,
    credits === undefined ? 'The minutes of notes left on your account'
      : credits.balance > 0 ? `Your ${hoursAndMinutes(credits.balance / credits.perMinute)} of notes left` : null,
    kept ? 'Your groups and pinned notes' : null,
    google ? 'Your Google Calendar connection, and Alcove’s access to your Google account' : null,
    'Your sign-in, on every browser'
  ].filter((g): g is string => g !== null);

  const go = () => {
    if (pending) return;
    setProblem(null);
    // Refused (the shared demo account) is final; anything else can be tried again.
    del.mutate(undefined, { onError: (e) => setProblem({ text: errorMessage(e), final: errorCode(e) === 'forbidden' }) });
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Escape' && !pending) { e.stopPropagation(); onClose(); } };

  return (
    <div ref={box} id={id} className="set-confirm" role="group" aria-labelledby={title} onKeyDown={keys}>
      <b id={title}>Delete your account for good?</b>
      <ul>{goes.map((g) => <li key={g}>{g}</li>)}</ul>
      <p>Notes other people gave you stay with them, without you. This can’t be undone.</p>
      <div role="status" className="set-step-status">{problem && <p className="set-refused"><Icon name="alert" size={18} />{problem.text}</p>}</div>
      <div className="btns">
        <Button ref={cancel} variant="secondary" size="sm" aria-disabled={pending || undefined} onClick={() => { if (!pending) onClose(); }}>{problem?.final ? 'Close' : 'Cancel'}</Button>
        {!problem?.final && (
          <Button ref={confirm} size="sm" icon={pending ? undefined : 'trash'} className="set-caution" aria-disabled={pending || undefined} onClick={go}>
            {pending && <Spinner />}{pending ? 'Deleting' : 'Delete my account'}
          </Button>
        )}
      </div>
    </div>
  );
}

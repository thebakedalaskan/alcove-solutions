/*
 * Privacy: what Alcove processes and stores, the confidential-compute check (made when the app opens) and the privacy policy;
 * then, in its own panel at the end, deleting the account. Deleting takes one more step, which opens where the row is
 * (never a dialog) and sets what goes beside what stays. The shared demo account can't be deleted, so the row says that
 * instead.
 */
import { errorCode, errorMessage, type Session } from '@alcove/api';
import { Button, Icon, Notice, SettingFact, SettingRow, SettingsGroup, SettingsPanel, Spinner, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { forgetView } from '~/features/call/layout/view';
import { forgetTour } from '~/features/onboarding/store';
import { q, topUpOpen, useDeleteAccount, verifiedAt } from '~/lib/queries';
import { hm, hoursAndMinutes } from '~/lib/time';
import { plural } from '~/lib/words';

const LEDGER = [
  ['Your name, email and photo', 'What was said'],
  ['When calls happen', 'Your notes and summaries'],
  ['Who was invited', 'The audio']
] as const;

/**
 * What the check made when the app opened found: only an answer bound to this browser's own request counts, and says when.
 * With nothing to show, the row just says what it is.
 */
function Compute() {
  const checked = useQuery(q.trust());
  const verified = verifiedAt(checked.data);
  if (verified === null && !checked.isPending) return <SettingRow mark={<Icon name="sealed" />} label="Confidential compute" help="Where your audio is opened and your notes are written." />;
  return (
    <SettingRow label="Confidential compute"
      control={verified !== null ? <SettingFact icon="sealed" tone="yes">Hardware verified {hm(new Date(verified))}</SettingFact> : <SettingFact icon="sealed">Checking the hardware…</SettingFact>} />
  );
}

export function PrivacyGroup({ session }: { session: Session }) {
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  const close = () => { back.current = true; setConfirming(false); };
  // Delete account goes while the step is open, so focus comes back to it once it's drawn again.
  useEffect(() => {
    if (confirming || !back.current) return;
    back.current = false;
    opener.current?.focus();
  }, [confirming]);
  return (
    <SettingsGroup id="privacy" title="Privacy">
      <SettingsPanel>
        {/* Two columns on one grid, so each line of one sits level with the other's however they wrap. */}
        <div className="set-led" role="table" aria-label="What Alcove processes">
          <div className="contents" role="row">
            <p className="set-led-h" role="columnheader"><Icon name="server" size={16} />Account and scheduling</p>
            <p className="set-led-h" role="columnheader"><Icon name="lock" size={16} />Call content</p>
          </div>
          {LEDGER.map(([account, content]) => (
            <div key={account} className="contents" role="row">
              <p className="set-led-c" role="cell">{account}</p>
              <p className="set-led-c is-cant" role="cell">{content}</p>
            </div>
          ))}
        </div>
        <Compute />
        <SettingRow label="How Alcove uses your information" control={<Link to="/privacy" className="set-go">Privacy policy<Icon name="right" size={14} /></Link>} />
      </SettingsPanel>
      <SettingsPanel>
        {confirming ? <DeleteStep shared={session.sharedDemo} onClose={close} /> : (
          <SettingRow data-row="delete" label="Delete your account" help="Your notes, the calls you scheduled and your sign-in go, for good."
            control={<Button ref={opener} size="sm" icon="trash" className="set-caution" onClick={() => setConfirming(true)}>Delete account</Button>} />
        )}
      </SettingsPanel>
    </SettingsGroup>
  );
}

/**
 * The one step before deleting: what goes, what stays, and the button that does it. The row itself becomes the question,
 * so nothing is said twice. Focus starts on keeping the account, and its status region says why a deletion didn't
 * happen. Once the account is gone, this browser forgets what it kept for it, and the welcome page follows with a toast,
 * even if you've moved on from Settings meanwhile.
 */
function DeleteStep({ shared, onClose }: { shared: boolean; onClose: () => void }) {
  const ownerId = useQuery(q.session()).data?.ownerId;
  const notes = useQuery(q.notes()).data;
  const upcoming = useQuery(q.upcoming()).data;
  const prefs = useQuery(q.prefs()).data;
  const credits = useQuery(q.balance()).data;
  const calendar = useQuery(q.calendar()).data;
  const topUps = useQuery(q.topUps()).data;
  const paying = topUps?.some(topUpOpen) ?? false;
  // 1Click can't cancel a quote: a cancelled top-up's address still takes a payment until it expires.
  const takesPayment = topUps?.some((t) => t.state === 'cancelled' && Date.parse(t.expiresAt) > Date.now()) ?? false;
  const spaces = useQuery(q.workspaces()).data;
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteAccount(() => {
    if (ownerId) { forgetTour(ownerId); forgetView(ownerId); }
    toast('Your account is deleted.', { icon: 'check', ms: 5000 });
    return navigate({ to: '/welcome', replace: true });
  });
  const pending = del.isPending;
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const refusal = shared ? 'This is the shared demo account, so it can’t be deleted.' : problem?.final ? problem.text : null;
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    keep.current?.focus({ preventScroll: true });
  }, []);
  // After a refusal, focus goes to what's left to do: Close when it's final, Delete my account to try again.
  useEffect(() => { if (problem) (problem.final ? keep : confirm).current?.focus(); }, [problem]);

  const mine = notes?.filter((n) => !n.received).length;
  const calls = upcoming?.filter((m) => m.isOrganizer && m.status !== 'ended').length;
  const kept = (prefs?.groups.length ?? 0) + (prefs?.pinned.length ?? 0) > 0;
  const google = calendar?.source === 'google' && !calendar.needsAccess;
  // Until a count is in, its line says what it covers without a number.
  const goes = [
    mine === undefined ? 'The notes you made, with their audio, for everyone who has them'
      : mine > 0 ? `${plural(mine, 'note', 'notes')} you made, with their audio, for everyone who has them` : null,
    calls === undefined ? 'The calls you scheduled, for everyone invited'
      : calls > 0 ? `${plural(calls, 'call', 'calls')} you scheduled, for everyone invited` : null,
    credits === undefined ? 'The minutes of notes left on your account'
      : credits.balance > 0 ? `Your ${hoursAndMinutes(credits.balance / credits.perMinute)} of notes left` : null,
    'Your own notes on every call, and anything you added from them to other people’s notes',
    kept ? 'Your groups and pins' : null,
    spaces === undefined || spaces.length > 0 ? 'Workspaces only you are in, and documents only you can open' : null,
    google ? 'Your Google Calendar connection. Alcove asks Google to cancel your calls and end its access.' : null,
    'Your sign-in, on every browser'
  ].filter((g): g is string => g !== null);

  const go = () => {
    if (pending) return;
    setProblem(null);
    // Refused (the shared demo account) is final; anything else can be tried again.
    del.mutate(undefined, { onError: (e) => { const final = errorCode(e) === 'forbidden'; setProblem({ text: final ? errorMessage(e) : `That didn’t work. ${errorMessage(e)}`, final }); } });
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Escape' && !pending) { e.stopPropagation(); onClose(); } };

  if (refusal) {
    return (
      <div onKeyDown={keys}>
        <SettingRow ref={box} data-row="delete" className="is-q is-say" label={refusal} control={<Button ref={keep} variant="primary" size="sm" onClick={onClose}>Close</Button>} />
      </div>
    );
  }
  return (
    <div onKeyDown={keys}>
      <SettingRow ref={box} data-row="delete" className="is-q" label="Delete your account for good?" />
      <div className="set-del" role="group" aria-label="Delete your account for good?">
        <div className="set-gs">
          <div><p className="set-gh">What goes</p><ul className="set-gl">{goes.map((g) => <li key={g}><Icon name="x" size={15} /><span>{g}</span></li>)}</ul></div>
          <div><p className="set-gh">What stays</p><p className="set-gp">Notes other people gave you stay with them, without you. They keep what you said in the call, and your name and address on what you did in them.</p></div>
        </div>
        {paying && <Notice tone="caution">You have a payment on its way. If it arrives after you delete your account, it can’t be added to anything.</Notice>}
        {!paying && takesPayment && <Notice tone="caution">A top-up you cancelled can still take a payment until its address expires. If one arrives after you delete your account, it can’t be added to anything.</Notice>}
        <div role="status">{problem && <p className="set-no"><Icon name="alert" size={16} /><span>{problem.text}</span></p>}</div>
        <div className="set-da">
          {/* aria-disabled, not disabled, while deleting: focus stays on the button pressed. */}
          <Button ref={keep} variant="primary" aria-disabled={pending || undefined} onClick={() => { if (!pending) onClose(); }}>Keep my account</Button>
          <Button ref={confirm} className="set-caution" aria-disabled={pending || undefined} onClick={go}>{pending && <Spinner />}{pending ? 'Deleting' : 'Delete my account'}</Button>
        </div>
      </div>
    </div>
  );
}

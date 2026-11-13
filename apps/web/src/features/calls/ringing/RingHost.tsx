/*
 * Being rung: a card on whatever page is open, over a modal too, for anyone signed in. One stream per tab; what it says
 * is read with useLive, and a ring that runs out by itself simply leaves. On the page of the call itself there's nothing
 * to ring about, so the card stays away. Join goes through pre-join; Can't now offers three answers, and the organizer
 * sees whichever is picked. While Alcove isn't in front, each card is also a browser notification (ringAlert.ts).
 */
import { errorMessage, firstName, type AlcoveApi, type IncomingRing, type RingReply } from '@alcove/api';
import { RingCard, RingShelf, useToast, type RingAnswer } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '~/lib/api';
import { stopSounds } from '~/features/notifications/soundCues';
import { useSoundPreferences } from '~/features/notifications/soundPreferences';
import { readPrefs } from '~/features/call/media/devices';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { accountQueries } from '~/features/account/queries';
import { useRingAnswer } from '~/features/calls/list/queries';
import { useRingAlerts } from './ringAlert';
import { playRing, readyRingSound } from './ringSound';

const rlog = log.child({ component: 'rings' });
type Rings = ReturnType<AlcoveApi['rings']['live']>;
type Later = Exclude<RingReply, 'join'>;
const ANSWERS: RingAnswer<Later>[] = [
  { value: 'in-5', icon: 'clock', label: 'In 5 minutes' },
  { value: 'in-15', icon: 'hourglass', label: 'In 15 minutes' },
  { value: 'no', icon: 'x', label: 'Not this time' }
];
/** One ring: someone rung again later is rung anew. */
const keyOf = (r: IncomingRing) => `${r.id}:${r.expiresAt}`;
/** Pages on the night stage. */
const NIGHT = /^\/(?:call|join|move|record\/live)(?:\/|$)/;

export function RingHost() {
  const session = useQuery(accountQueries.session()).data;
  return session ? <Signed key={session.ownerId} /> : null;
}

/** The stream, for as long as someone is signed in. */
function Signed() {
  const [rings, setRings] = useState<Rings | null>(null);
  useEffect(() => {
    const live = api.rings.live();
    setRings(live);
    const stopReady = readyRingSound();
    return () => { stopReady(); live.close(); };
  }, []);
  return rings ? createPortal(<Cards rings={rings} />, document.body) : null;
}

function Cards({ rings }: { rings: Rings }) {
  const all = useLive(rings);
  const { prefs, notificationsPauseEnd, ready } = useSoundPreferences();
  const owner = useRef({});
  const current = useRef({ prefs, notificationsPauseEnd, speakerId: readPrefs().speaker ?? null });
  current.current = { prefs, notificationsPauseEnd, speakerId: readPrefs().speaker ?? null };
  useEffect(() => () => stopSounds(owner.current), [prefs, notificationsPauseEnd]);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const toast = useToast();
  const answer = useRingAnswer();
  // Answered here: off the screen at once, and back if the answer didn't get through while the ring lasts.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const mark = (key: string, on: boolean) => setAnswered((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
  const shown = all.filter((r) => !answered.has(keyOf(r)) && path !== `/join/${r.code}` && path !== `/call/${r.code}`);
  useRingAlerts(shown, keyOf);

  const played = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    for (const r of shown) {
      const key = keyOf(r);
      if (played.current.has(key)) continue;
      played.current.add(key);
      if (played.current.size > 128) { const first = played.current.values().next().value; if (first) played.current.delete(first); }
      playRing(key, new Date(r.expiresAt).getTime(), owner.current, () => current.current);
    }
  }, [shown, ready]);

  const join = (r: IncomingRing) => {
    mark(keyOf(r), true);
    answer.mutateAsync({ id: r.id, reply: 'join' }).catch((e: unknown) => rlog.warn('couldn’t say a ring was answered', { err: e, ringId: r.id }));
    void navigate({ to: '/join/$code', params: { code: r.code } });
  };
  const reply = (r: IncomingRing, value: Later) => {
    const who = firstName(r.from.name);
    const said = ANSWERS.find((a) => a.value === value)?.label ?? '';
    mark(keyOf(r), true);
    answer.mutateAsync({ id: r.id, reply: value }).then(
      () => toast(value === 'no' ? `${who} sees “${said}”.` : `${who} sees “${said}”. Alcove rings you again then.`, { icon: value === 'no' ? 'x' : 'clock' }),
      (e: unknown) => {
        rlog.warn('couldn’t answer a ring', { err: e, ringId: r.id });
        mark(keyOf(r), false);
        toast(`Couldn’t tell ${who}. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
      });
  };
  return (
    <RingShelf>
      {shown.map((r) => (
        <RingCard key={keyOf(r)} person={r.from} title={`${firstName(r.from.name)} is ringing you`} line={r.notes === 'on' ? `${r.title} · you get the notes` : r.title} answers={ANSWERS} night={NIGHT.test(path)}
          onJoin={() => join(r)} onAnswer={(v) => reply(r, v)} />
      ))}
    </RingShelf>
  );
}

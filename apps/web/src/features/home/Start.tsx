/*
 * The middle of Home. Start now goes to the lobby, Schedule to the first step of scheduling, and a person's chip
 * starts a call that rings them. While a call is going, or in its last few minutes, a line above them joins it, and
 * Join takes the one filled button. Nothing else about the day comes up here: people join from their calendar.
 */
import { errorMessage, firstName } from '@alcove/api';
import { Avatar, Button, Faces, Icon, buttonClass, cn, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useRef } from 'react';
import { useScheduled } from '~/features/calls/flow/CallFlow';
import { DEFAULT_MINUTES } from '~/features/calls/flow/draft';
import { useFloodToCall } from '~/features/calls/flow/parts';
import { ringable } from '~/features/calls/ringing/RingWords';
import { useCallFlow } from '~/features/shell/context';
import { q, useScheduleCall, useStartNow } from '~/lib/queries';
import { minutesUntil, untilLabel } from '~/lib/time';
import { peopleOn, started, type Ahead } from './day';

const PEOPLE = 3;

export function Start({ first, soon, me, now }: { first: boolean; soon: Ahead | undefined; me: string | undefined; now: number }) {
  const flow = useCallFlow();
  const toast = useToast();
  const startNow = useStartNow();
  const schedule = useScheduleCall();
  const scheduled = useScheduled();
  const team = useQuery(q.team()).data;
  const session = useQuery(q.session()).data;
  const prefs = useQuery(q.prefs()).data;
  const { go, flood } = useFloodToCall();
  const h = useId();
  /* One call at a time, however fast the buttons are pressed. */
  const busy = useRef(false);
  const once = (run: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    run().catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => { busy.current = false; });
  };
  const begin = (from: Element, guests?: string[]) => once(() => go(from, async () => (await startNow.mutateAsync(guests ? { guests } : {})).code));
  /* A link to send means a call that keeps: scheduled for now, so it's listed and has a card, and nobody's back button ends it. */
  const link = () => once(async () => {
    const title = session ? `${firstName(session.user.name)}’s call` : 'Call';
    await scheduled(await schedule.mutateAsync({ title, startsAt: new Date().toISOString(), durationMinutes: DEFAULT_MINUTES, guests: [], notes: prefs?.notesDefault ?? 'on' }), []);
  });
  const people = ringable(team, me ? { email: me } : undefined).slice(0, PEOPLE);
  return (
    <section className="hm-start" aria-labelledby={h} style={{ '--d': 1 }}>
      {soon && <Soon soon={soon} me={me} now={now} />}
      <h2 id={h}>{first ? 'Start your first call' : 'Start a call'}</h2>
      <div className="hm-acts">
        <Button variant={soon ? 'secondary' : 'primary'} size="lg" icon="video" className="hm-go" data-tour="new-call" onClick={(e) => begin(e.currentTarget)}>Start now</Button>
        <Button variant="secondary" size="lg" icon="cal" aria-haspopup="dialog" onClick={() => flow.start({ later: true })}>Schedule</Button>
        <button type="button" className={cn(buttonClass({ size: 'lg' }), 'hm-link')} aria-label="Copy a link for a new call" title="Copy a link for a new call" onClick={link}><Icon name="link" /></button>
      </div>
      {people.length > 0 && (
        <div className="hm-people">
          {people.map((p) => (
            <button key={p.email} type="button" className="hm-who" aria-label={`Ring ${p.name}`} title={`Ring ${p.name}`} onClick={(e) => begin(e.currentTarget, [p.email])}>
              <Avatar person={p} size={26} /><span>{firstName(p.name)}</span>
            </button>
          ))}
          <button type="button" className="hm-add" aria-label="Add someone" title="Add someone" aria-haspopup="dialog" onClick={() => flow.start({ later: true })}><Icon name="plus" size={18} /></button>
        </div>
      )}
      {flood}
    </section>
  );
}

/** A call is going once someone's in it. A meeting elsewhere goes by the clock. */
const going = (a: Ahead, now: number) => (a.kind === 'call' ? a.call.status === 'live' : started(a, now));

/** The call that's about to start, or going, and the way into it. */
function Soon({ soon, me, now }: { soon: Ahead; me: string | undefined; now: number }) {
  const people = peopleOn(soon, me);
  return (
    <div className="hm-join">
      {people.length > 0 && <Faces people={people} size={26} max={3} />}
      <span className="hm-join-t">
        <b className="ac-clamp-1" title={soon.title}>{soon.title}</b>
        <small>{going(soon, now) ? 'Happening now' : `Starts ${untilLabel(minutesUntil(soon.startsAt, now))}`}</small>
      </span>
      <Join soon={soon} />
    </div>
  );
}

function Join({ soon }: { soon: Ahead }) {
  const label = <><Icon name="video" />Join<span className="kb" aria-hidden="true">J</span></>;
  const look = buttonClass({ variant: 'primary' });
  return soon.kind === 'call'
    ? <Link to="/join/$code" params={{ code: soon.call.code }} className={look} aria-keyshortcuts="J" data-tour="join">{label}</Link>
    : <a href={soon.event.join?.url} target="_blank" rel="noopener noreferrer" className={look} aria-keyshortcuts="J">{label}</a>;
}

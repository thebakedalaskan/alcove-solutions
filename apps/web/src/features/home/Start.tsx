/*
 * The middle of Home. Start now goes to the lobby, and Schedule to the first step of scheduling. While a call is going,
 * or in its last few minutes, a line above them joins it, and Join takes the one filled button. Nothing else about the
 * day comes up here: people join from their calendar, and ring someone from Team or from Start a call.
 */
import { errorMessage } from '@alcove/api';
import { Button, Faces, Icon, buttonClass, useToast } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId, useRef } from 'react';
import { useFloodToCall } from '~/features/calls/flow/parts';
import { useCallFlow } from '~/features/shell/context';
import { useStartNow } from '~/lib/queries';
import { minutesUntil, untilLabel } from '~/lib/time';
import { peopleOn, started, type Ahead } from './day';

export function Start({ first, soon, me, now }: { first: boolean; soon: Ahead | undefined; me: string | undefined; now: number }) {
  const flow = useCallFlow();
  const toast = useToast();
  const startNow = useStartNow();
  const { go, flood } = useFloodToCall();
  const h = useId();
  /* One call at a time, however fast the buttons are pressed. */
  const busy = useRef(false);
  const once = (run: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    run().catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => { busy.current = false; });
  };
  const begin = (from: Element) => once(() => go(from, async () => (await startNow.mutateAsync({})).code));
  return (
    <section className="hm-start" aria-labelledby={h} style={{ '--d': 1 }}>
      {soon && <Soon soon={soon} me={me} now={now} />}
      <h2 id={h}>{first ? 'Start your first call' : 'Start a call'}</h2>
      <div className="hm-acts">
        <Button variant={soon ? 'secondary' : 'primary'} size="lg" icon="video" className="hm-go" data-tour="new-call" onClick={(e) => begin(e.currentTarget)}>Start now</Button>
        <Button variant="secondary" size="lg" icon="cal" aria-haspopup="dialog" onClick={() => flow.start({ later: true })}>Schedule</Button>
      </div>
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

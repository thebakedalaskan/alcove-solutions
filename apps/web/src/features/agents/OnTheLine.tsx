/*
 * The agents standing on the horizon. A connected one opens what it can do; one people use that isn't connected yet
 * opens how to connect it; Another agent opens Alcove's address, and a token for a script. While the line is on its way,
 * three empty windows breathe in its place.
 */
import { AgentGap, AgentLine, AgentPlace, AgentWaitingPlace } from '@alcove/ui';
import { iconOf, OTHER } from './catalogue';
import { ConnectPop, JoinedPop } from './Connect';
import { ConnectedPop } from './Connected';
import type { Spot } from './line';
import type { AgentsLine } from './open';
import { TokenPop } from './Token';
import { ending, lineUnder, popLine } from './when';

/** How many empty windows wait on the line while it loads. */
const WAITING = 3;

/** Focus on a place's window, once the line has drawn: the one that was open has gone. */
const focusPlace = (key: string | undefined) => requestAnimationFrame(() => {
  const at = key ? document.querySelector<HTMLElement>(`[data-place="${CSS.escape(key)}"] .ag-who`) : null;
  at?.focus({ preventScroll: true });
});

export function OnTheLine({ spots, state, now }: { spots: readonly Spot[]; state: AgentsLine; now: number }) {
  return (
    <AgentLine label="Your agents">
      {spots.map((s, i) => {
        if (s.type === 'gap') return <AgentGap key={s.key} />;
        /* Disconnecting one hands focus on to whoever stands next. */
        const next = spots.slice(i + 1).find((n) => n.type !== 'gap')?.key;
        return <Place key={s.key} spot={s} at={i} state={state} now={now} next={next} />;
      })}
    </AgentLine>
  );
}

/** The line while it loads. */
export function WaitingLine() {
  return <AgentLine label="Your agents" loading>{Array.from({ length: WAITING }, (_, i) => <AgentWaitingPlace key={i} at={i} />)}</AgentLine>;
}

function Place({ spot, at, state, now, next }: { spot: Exclude<Spot, { type: 'gap' }>; at: number; state: AgentsLine; now: number; next: string | undefined }) {
  const open = state.open?.key === spot.key ? state.open.view : undefined;
  const opens = (view: 'conn' | 'connect') => (on: boolean) => (on ? state.show(spot.key, view) : state.close(spot.key));
  if (spot.type === 'conn') {
    const c = spot.connection;
    return (
      <AgentPlace place={c.id} icon={iconOf(spot.mark)} name={c.name} line={lineUnder(c, now)} caution={ending(c, now)} tick={open === 'joined'}
        label={`${c.name}, ${popLine(c, now)}`} popLabel={c.name} open={open !== undefined} onOpenChange={opens('conn')} at={at}>
        {open === 'joined' ? <JoinedPop connection={c} />
          : <ConnectedPop connection={c} now={now} asking={open === 'off'} onAsk={() => state.show(c.id, 'off')} onKeepIt={() => state.show(c.id, 'conn')}
            onGone={() => { state.close(c.id); focusPlace(next); }} />}
      </AgentPlace>
    );
  }
  if (spot.type === 'yet') {
    const k = spot.kind;
    return (
      <AgentPlace place={k.id} icon={k.icon} name={k.name} look="dashed" label={`Connect ${k.name}`} popLabel={`Connect ${k.name}`}
        open={open !== undefined} onOpenChange={opens('connect')} at={at}>
        <ConnectPop kind={k} onAct={() => state.lookOut()} />
      </AgentPlace>
    );
  }
  return (
    <AgentPlace place={spot.key} icon={OTHER.icon} name={OTHER.name} look="dashed" label="Connect another agent" popLabel="Connect another agent"
      open={open !== undefined} onOpenChange={opens('connect')} at={at}>
      {open === 'token'
        ? <TokenPop onBack={() => state.show(spot.key, 'connect')} onDone={() => state.close(spot.key)} />
        : <ConnectPop kind={undefined} onAct={() => state.lookOut()} onToken={() => state.show(spot.key, 'token')} />}
    </AgentPlace>
  );
}

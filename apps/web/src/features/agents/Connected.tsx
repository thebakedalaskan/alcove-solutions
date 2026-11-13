/*
 * A connected agent's popover: when it was last used, what it can do, and until when. Each chip changes what it can do at
 * once, from the agent's next request, and says Saved; the last one can't go (disconnect it instead). Access ending
 * within three days says so in caution, with Keep it 30 more days. Disconnect asks first, in place.
 */
import { errorMessage, type AgentConnection, type AgentScope } from '@alcove/api';
import { AgentAsked, AgentAction, AgentPermissions, AgentPopFoot, AgentPopHead, AgentSaved, Button, useToast } from '@alcove/ui';
import { useRef, useState } from 'react';
import { useRevokeAgent, useUpdateAgent } from './queries';
import { dayMonth } from '~/lib/time';
import { iconOf, markOf } from './catalogue';
import { CHIPS, inOrder, PERMISSIONS } from './permissions';
import { ending, popLine, until } from './when';

/** A name short enough to say on a button: "Keep Claude", or "Keep it" for a long one. */
const keepLabel = (name: string) => (name.length > 18 ? 'Keep it' : `Keep ${name}`);

export function ConnectedPop({ connection: c, now, asking, onAsk, onKeepIt, onGone }: {
  connection: AgentConnection; now: number;
  /** Disconnect has been pressed: it asks first. */
  asking: boolean;
  onAsk: () => void;
  onKeepIt: () => void;
  /** It's disconnected: its window goes. */
  onGone: () => void;
}) {
  /* Two of them: a mutation speaks only for its latest call, so 30 more days has its own, or a chip pressed after it hushes it. */
  const update = useUpdateAgent();
  const renew = useUpdateAgent();
  const revoke = useRevokeAgent();
  const toast = useToast();
  /** What's been pressed, until it's kept; and which press that was, so only the latest one speaks. */
  const [want, setWant] = useState<AgentScope[] | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const latest = useRef(0);
  const shown = want ?? c.scopes;
  const ends = ending(c, now);

  const press = (id: string, on: boolean) => {
    const scope = PERMISSIONS.find((p) => p.id === id)?.id;
    if (!scope) return;
    const next = inOrder(on ? [...shown, scope] : shown.filter((s) => s !== scope));
    if (!next.length) { toast('An agent needs at least one thing it can do. Disconnect it instead.', { icon: 'alert' }); return; }
    const ticket = ++latest.current;
    setWant(next);
    setSaved(false);
    update.mutate({ id: c.id, scopes: next }, {
      onSuccess: () => { if (ticket === latest.current) { setWant(undefined); setSaved(true); } },
      onError: (e) => { if (ticket === latest.current) { setWant(undefined); toast(errorMessage(e), { icon: 'x' }); } }
    });
  };
  const keep = () => renew.mutate({ id: c.id, renew: true }, {
    onSuccess: (kept) => toast(`${c.name} can use Alcove until ${dayMonth(new Date(kept.expiresAt))}.`, { icon: 'check' }),
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });
  const disconnect = () => revoke.mutate(c.id, {
    onSuccess: () => { toast(`${c.name} is disconnected. It can’t reach Alcove any more.`, { icon: 'check' }); onGone(); },
    onError: (e) => toast(errorMessage(e), { icon: 'x' })
  });

  return (
    <>
      <AgentPopHead icon={iconOf(markOf(c))} title={c.name} sub={popLine(c, now)} caution={ends} />
      {asking ? (
        <AgentAsked title={`Disconnect ${c.name}?`} actions={(
          <>
            <Button variant="primary" size="sm" autoFocus disabled={revoke.isPending} onClick={onKeepIt}>{keepLabel(c.name)}</Button>
            <Button size="sm" loading={revoke.isPending} onClick={disconnect}>{revoke.isPending ? 'Disconnecting' : 'Disconnect'}</Button>
          </>
        )}>It stops working at once. To use it again, connect it again.</AgentAsked>
      ) : (
        <>
          {ends && <AgentAction variant="secondary" loading={renew.isPending} onClick={keep}>Keep it 30 more days</AgentAction>}
          <AgentPermissions permissions={CHIPS} selected={shown} onChange={press} aside={<AgentSaved saved={saved} />} />
          <AgentPopFoot aside={ends ? undefined : until(c)}>
            <Button variant="quiet" size="sm" icon="unplug" onClick={onAsk}>Disconnect</Button>
          </AgentPopFoot>
        </>
      )}
    </>
  );
}

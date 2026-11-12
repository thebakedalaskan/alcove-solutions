/*
 * Agents: the AI assistants you've let into Alcove, standing on the horizon as windows, Team's evening the other way
 * round with the sun low on the right just past the end of the line. The ones you've connected stand first, solid, then
 * half a place, then the ones people use, dashed, and Another agent: each opens a popover with what it can do, or how to
 * connect it. An agent sends you here to be allowed in (`?request=`): the sky grows to ask, with the agent and you on the
 * horizon. Under the water, what your agents did, only for you, and things to ask them. On a phone Agents opens from
 * Settings, so its head has a way back there.
 */
import { AgentAuthorizationIdSchema, errorCode } from '@alcove/api';
import { Button, Evening, Icon, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { TheQuestion, useAsk } from '~/features/agents/Ask';
import type { AgentKind } from '~/features/agents/catalogue';
import { OnTheLine, WaitingLine } from '~/features/agents/OnTheLine';
import { lineOf, OTHER_KEY, sunOf } from '~/features/agents/line';
import { useAgentsLine } from '~/features/agents/open';
import { AskYourAgent, WhatTheyDid } from '~/features/agents/Water';
import { useNow, useOnline } from '~/lib/live';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/agents')({
  /** `request`: an agent's request to use your Alcove, sent here from `/connect` when you're signed in. */
  validateSearch: (s: Record<string, unknown>): { request?: string | undefined } => {
    const request = AgentAuthorizationIdSchema.safeParse(s['request']);
    return { request: request.success ? request.data : undefined };
  },
  /*
   * The connections get a moment, so the line comes up with the page, and no longer: empty windows wait on it until
   * they're here. What they did and Alcove's address load beside them.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    void qc.prefetchQuery(q.agentEndpoint());
    await Promise.race([
      Promise.allSettled([qc.ensureQueryData(q.agents()), qc.ensureInfiniteQueryData(q.agentActivity())]),
      new Promise((r) => setTimeout(r, 1200))
    ]);
  },
  component: AgentsPage
});

/** The line before anything's connected: the agents people use, and Another agent. */
const FIRST_LINE = lineOf([]);

function AgentsPage() {
  const { request } = Route.useSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useQuery(q.session()).data;
  const online = useOnline();
  const now = useNow(60_000);
  const line = useAgentsLine();
  const ask = useAsk(request, session?.ownerId);
  if (!session) return null;

  const me = session.user;
  const connections = line.agents.data;
  const phase = ask.phase;
  const trouble = !online || (!connections && errorCode(line.agents.error) === 'network') ? 'offline' : !connections && line.agents.isError ? 'failed' : undefined;
  const first = connections?.length === 0;
  const full = connections ? lineOf(connections) : FIRST_LINE;
  const sky = phase === 'loading' || phase === 'asking' ? 'ask' : phase === 'allowed' || phase === 'ended' ? 'done' : first && !trouble ? 'first' : undefined;

  /** Back to the page as it was, without the request. */
  const toLine = () => void navigate({ to: '/agents', search: {}, replace: true });
  const showHow = (kind: AgentKind | undefined) => {
    toLine();
    const dashed = kind && full.spots.some((s) => s.type === 'yet' && s.key === kind.id);
    line.show(dashed && kind ? kind.id : OTHER_KEY, 'connect');
  };

  const title = trouble === 'failed' ? 'Your agents didn’t load' : trouble === 'offline' ? 'You’re offline' : first ? 'Connect your agent' : 'Your agents';
  const hero = (
    <section className="ag-hero" aria-labelledby="ag-h">
      <h2 id="ag-h" className="ac-clamp-2">{title}</h2>
      {trouble ? (
        <p className="ag-why"><Icon name={trouble === 'offline' ? 'wifiOff' : 'alert'} size={18} />
          {trouble === 'offline' ? 'Your agents keep working. This page catches up when you’re back.' : 'Alcove couldn’t reach the server.'}</p>
      ) : first && <p className="ag-line">Ask it about your calls, and let it book them. It can do only what you allow.</p>}
      {trouble === 'failed' && <Button icon="retry" loading={line.agents.isFetching} onClick={() => void line.agents.refetch()}>Try again</Button>}
    </section>
  );
  const standing = connections ? <OnTheLine spots={full.spots} state={line} now={now} /> : !trouble && <WaitingLine />;

  return (
    <Evening moment="agents" className="ag" data-sky={sky}
      style={{ '--ag-w': full.width.toFixed(2), '--ag-sun': sunOf(full).toFixed(3) }}>
      <div className="ag-sky" style={{ '--d': 0 }}>
        <header className="dusk-top">
          <Link to="/settings" hash="connections" className="ag-back"><Icon name="chevronLeft" size={18} />Settings</Link>
          <h1 className="dusk-title">Agents</h1>
        </header>
        {phase ? (
          <TheQuestion ask={ask} me={me} ids={connections ? new Set(connections.map((c) => c.id)) : undefined}
            onBack={(before) => { toLine(); if (before) line.wait(before); }}
            onDeclined={(name, redirectUrl) => { toLine(); toast(`Nothing was shared with ${name}.`, { icon: 'check' }); location.assign(redirectUrl); }}
            onShowHow={showHow} />
        ) : hero}
        {/* The agent and you stand on the horizon while it asks; a request that didn't load leaves the line. */}
        {(!phase || phase === 'failed') && standing}
      </div>
      <div className="ag-water" style={{ '--d': 1 }}>
        <WhatTheyDid connections={connections} down={trouble !== undefined && !connections} now={new Date(now)} />
        <AskYourAgent connections={connections ?? []} />
      </div>
    </Evening>
  );
}

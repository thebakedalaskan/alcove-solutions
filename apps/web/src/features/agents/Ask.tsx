/*
 * Allowing an agent, on Agents. The agent sends you here with its request (`?request=`); the sky grows and asks, with the
 * agent's window and your arch standing together on the horizon, joined by a dashed rose line: a decision waiting on you.
 * Each part of Alcove it asked for is a level you can lower, and Allow gives it only what's chosen. Allowed, the line
 * closes and the browser goes back to the agent. Cancel tells the agent no. A request that waited too long, or was
 * answered in another tab, has ended, and Show me how opens that agent's way to connect.
 */
import { errorCode, errorMessage, type AgentAuthorization } from '@alcove/api';
import { AgentDisclosure, AgentLevels, AgentPair, Button, Dots, Icon, type AvatarPerson } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { q, useAgentDecision } from '~/lib/queries';
import { kindNamed, type AgentKind } from './catalogue';
import { choiceFor, picked, rowsOf, scopesOf, switched } from './levels';

/** Hosts on this computer, whatever their port: allowing hands the agent's code to an app here, not to a website. */
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Where allowing sends you back, said as people know it: the website's host, or an app on this computer. */
function backTo(host: string): { app: true } | { app: false; host: string } {
  const lower = host.toLowerCase();
  const bare = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0] ?? lower;
  return LOOPBACK.has(bare) ? { app: true } : { app: false, host };
}

/** How long "Taking you back" shows before the browser goes, and how long after that the page waits to see it gone. */
const HAND_OFF_MS = 1_200;
const STILL_HERE_MS = 4_000;

export type AskPhase = 'loading' | 'asking' | 'allowed' | 'ended' | 'failed';
/** How a request went: allowed, with where the agent waits and the connections there were before, or ended. */
type Outcome = { request: string; how: 'allowed'; redirectUrl: string; before: ReadonlySet<string> | undefined } | { request: string; how: 'ended' };

/** The request an agent sent you here with, and how it's gone so far. */
export function useAsk(request: string | undefined, ownerId: string | undefined) {
  const authorization = useQuery({ ...q.agentAuthorization(request ?? '', ownerId ?? ''), enabled: Boolean(request && ownerId) });
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const now = request && outcome?.request === request ? outcome : undefined;
  const phase: AskPhase | undefined = !request ? undefined : now ? now.how
    : authorization.isError ? (errorCode(authorization.error) === 'not-found' ? 'ended' : 'failed')
      : authorization.data ? 'asking' : 'loading';
  return { request, authorization, phase, outcome: now, settle: setOutcome };
}
export type Ask = ReturnType<typeof useAsk>;

/**
 * The question, on the sky, and the two of you on the horizon. `ids` are the connections there are now. `onBack` is the
 * page as it was, with what's just been connected (from `before`); `onDeclined` hands the agent its no; `onShowHow` opens
 * the agent's way to connect.
 */
export function TheQuestion({ ask, me, ids, onBack, onDeclined, onShowHow }: {
  ask: Ask; me: AvatarPerson & { email: string }; ids: ReadonlySet<string> | undefined;
  onBack: (before: ReadonlySet<string> | undefined) => void;
  onDeclined: (name: string, redirectUrl: string) => void;
  onShowHow: (kind: AgentKind | undefined) => void;
}) {
  const { request, authorization, phase, outcome, settle } = ask;
  const known = authorization.data;
  const name = known?.clientName;
  const kind = name ? kindNamed(name) : undefined;
  const icon = kind?.icon ?? 'agent';
  const pair = (line: string, state: 'asking' | 'joined' | 'ended') => (
    <div className="ag-row is-pair"><AgentPair icon={icon} name={name ?? 'Your agent'} line={line} me={me} email={known?.accountEmail ?? me.email} state={state} /></div>
  );
  if (!request || !phase) return null;
  if (phase === 'asking' && known) {
    return (
      <>
        <Asking key={`${request}:${known.ownerId}`} request={request} authorization={known} ids={ids}
          onAllowed={(redirectUrl, before) => settle({ request, how: 'allowed', redirectUrl, before })} onEnded={() => settle({ request, how: 'ended' })}
          onDeclined={(redirectUrl) => onDeclined(known.clientName, redirectUrl)} />
        {pair('Asking', 'asking')}
      </>
    );
  }
  if (phase === 'allowed' && outcome?.how === 'allowed') {
    return (
      <>
        <Allowed name={name ?? 'your agent'} redirectUrl={outcome.redirectUrl} onStillHere={() => onBack(outcome.before)} />
        {pair('Just connected', 'joined')}
      </>
    );
  }
  if (phase === 'ended') {
    return (
      <>
        <section className="ag-hero" aria-labelledby="ag-ended">
          <h2 id="ag-ended" className="ac-clamp-2">This request ended</h2>
          <p className="ag-line">It waited too long, or was answered in another tab. Start again from {name ?? 'your agent'}.</p>
          <Button onClick={() => onShowHow(kind)}>Show me how</Button>
        </section>
        {pair('Not connected', 'ended')}
      </>
    );
  }
  if (phase === 'failed') {
    return (
      <section className="ag-hero" aria-labelledby="ag-failed">
        <h2 id="ag-failed" className="ac-clamp-2">This request didn’t load</h2>
        <p className="ag-why"><Icon name="alert" size={18} />{errorMessage(authorization.error)}</p>
        <Button icon="retry" loading={authorization.isFetching} onClick={() => void authorization.refetch()}>Try again</Button>
      </section>
    );
  }
  return (
    <>
      <section className="ag-hero"><p role="status"><Dots />Reading the request</p></section>
      {pair('Asking', 'asking')}
    </>
  );
}

/** What it asked for, at levels you can lower; Allow and Cancel. */
function Asking({ request, authorization: a, ids, onAllowed, onDeclined, onEnded }: {
  request: string; authorization: AgentAuthorization; ids: ReadonlySet<string> | undefined;
  onAllowed: (redirectUrl: string, before: ReadonlySet<string> | undefined) => void;
  onDeclined: (redirectUrl: string) => void;
  onEnded: () => void;
}) {
  const head = useId();
  const decision = useAgentDecision(request);
  const [choice, setChoice] = useState(() => choiceFor(a.scopes));
  const [menu, setMenu] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string>();
  const scopes = scopesOf(choice, a.scopes);
  const busy = decision.isPending;
  const decide = async (allow: boolean) => {
    setProblem(undefined);
    setMenu(undefined);
    const before = ids;
    try {
      const { redirectUrl } = await decision.mutateAsync({ allow, scopes: allow ? scopes : [], ownerId: a.ownerId });
      if (allow) onAllowed(redirectUrl, before);
      else onDeclined(redirectUrl);
    } catch (e) {
      if (errorCode(e) === 'not-found') onEnded();
      else setProblem(errorMessage(e));
    }
  };
  return (
    <section className="ag-ask" aria-labelledby={head}>
      <h2 id={head} className="ag-qt">{a.clientName} wants to use your Alcove</h2>
      <AgentLevels rows={rowsOf(choice, a.scopes)} open={menu} onOpen={setMenu} disabled={busy}
        onPick={(row, level) => { setChoice((c) => picked(c, row, level)); setMenu(undefined); }}
        onSwitch={(_, id, on) => setChoice((c) => switched(c, id, on))} />
      <p className="ag-disc"><AgentDisclosure who={a.clientName} /></p>
      <div className="ag-ask-a">
        <Button variant="primary" size="lg" disabled={!scopes.length} loading={busy && decision.variables.allow} onClick={() => void decide(true)}>Allow</Button>
        <Button size="lg" disabled={busy} loading={busy && !decision.variables.allow} onClick={() => void decide(false)}>Cancel</Button>
      </div>
      {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
      <SmallPrint name={a.clientName} host={a.redirectHost} />
    </section>
  );
}

/**
 * Who's asking and where allowing goes, under the answers: any agent can call itself Claude, so the name is said as the
 * one it gave itself, and where its code goes back to is said plainly, a website's host or an app on this computer.
 */
function SmallPrint({ name, host }: { name: string; host: string }) {
  const back = backTo(host);
  return (
    <p className="ag-fine">
      The agent named itself {name}. Allowing sends you back to {back.app ? 'an app on this computer' : <b>{back.host}</b>}.
      {' '}Only allow it if you just added Alcove to {name}. It lasts 30 days.
    </p>
  );
}

/**
 * Allowed: Taking you back, then the browser goes to the agent. An agent that's an app on this computer opens without the
 * page going anywhere: then, a moment later, the page is as it was, with the agent standing on the line.
 */
function Allowed({ name, redirectUrl, onStillHere }: { name: string; redirectUrl: string; onStillHere: () => void }) {
  const back = useRef(onStillHere);
  useEffect(() => { back.current = onStillHere; });
  useEffect(() => {
    const go = setTimeout(() => location.assign(redirectUrl), HAND_OFF_MS);
    const still = setTimeout(() => back.current(), HAND_OFF_MS + STILL_HERE_MS);
    return () => { clearTimeout(go); clearTimeout(still); };
  }, [redirectUrl]);
  return (
    <section className="ag-hero" aria-labelledby="ag-allowed">
      <h2 id="ag-allowed" className="ac-clamp-2">{name} is connected</h2>
      <p className="ag-line" role="status">Taking you back to {name}…</p>
    </section>
  );
}

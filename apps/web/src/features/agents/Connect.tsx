/*
 * Connecting an agent, in its popover: one line of what to do, Alcove's address or a command in a well when it needs
 * one, and one button that does it (copy and open the agent, open the app, copy the command). Pressed, it stays as it was,
 * to press again: there's nothing to wait for here, since the agent asks on a page of its own (14.2). The page notices it
 * once it's connected, and this popover says so then, with something to ask it first.
 */
import { errorMessage, type AgentConnection } from '@alcove/api';
import { AgentAction, AgentLink, AgentPopHead, AgentPopLine, AgentPopMore, AgentWaiting, AgentWell, Button, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { agentQueries } from './queries';
import { connecting, connectingOther, FIRST_QUESTION, iconOf, markOf, OTHER, type AgentKind } from './catalogue';
import { useCopy } from './copy';

/**
 * How to connect `kind`, or any other agent when there's none. `onAct` is its button pressed, so the page looks out for
 * the agent; `onToken` leads on to a token, for a script that can't sign in.
 */
export function ConnectPop({ kind, onAct, onToken }: { kind: AgentKind | undefined; onAct: () => void; onToken?: (() => void) | undefined }) {
  const endpoint = useQuery(agentQueries.agentEndpoint());
  const toast = useToast();
  const { copy, problem } = useCopy();
  const address = endpoint.data?.endpoint;
  const how = address === undefined ? undefined : kind ? connecting(kind, address) : connectingOther(address);
  const what = kind?.how === 'terminal' ? 'command' : 'address';
  const act = () => {
    if (!how) return;
    onAct();
    if (how.copy) void copy(how.copy, how.done, `Copy wasn’t available. Select the ${what} and copy it.`);
    else toast(how.done, { icon: 'check' });
  };
  return (
    <>
      <AgentPopHead icon={kind?.icon ?? OTHER.icon} title={kind ? `Connect ${kind.name}` : 'Connect another agent'} />
      {how ? (
        <>
          <AgentPopLine>{how.line}</AgentPopLine>
          {how.well && <AgentWell value={how.well} />}
          {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
          {how.href ? <AgentLink href={how.href} newTab={how.newTab} autoFocus onClick={act}>{how.action}</AgentLink>
            : <AgentAction autoFocus onClick={act}>{how.action}</AgentAction>}
        </>
      ) : endpoint.isError ? (
        <>
          <p role="alert" className="ac-agent-problem">Alcove’s address didn’t load. {errorMessage(endpoint.error)}</p>
          <Button className="ag-go" icon="retry" loading={endpoint.isFetching} onClick={() => void endpoint.refetch()}>Try again</Button>
        </>
      ) : <AgentWaiting>Looking for Alcove’s address</AgentWaiting>}
      {onToken && <AgentPopMore ask="A script that can’t sign in?" go="Create a token" onClick={onToken} />}
    </>
  );
}

/** A connection that's just appeared after its button was pressed: it's connected, and here's something to ask it first. */
export function JoinedPop({ connection: c }: { connection: AgentConnection }) {
  const { copy, problem } = useCopy();
  return (
    <>
      <AgentPopHead icon={iconOf(markOf(c))} title={`${c.name} is connected`} tick />
      <AgentPopLine>Ask it something in {c.name}, like:</AgentPopLine>
      <AgentWell words value={`“${FIRST_QUESTION}”`} copyLabel="Copy the question" copyFocus
        onCopy={() => void copy(FIRST_QUESTION, `Copied. Paste it into ${c.name}.`, 'Copy wasn’t available. Select the question and copy it.')} />
      {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
    </>
  );
}

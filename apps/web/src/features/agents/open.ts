/*
 * The line's connections, what's open on it, and looking out for an agent. One popover at a time, by its place (`key`: a
 * kind people use, Another agent, or a connection's ID) and what it shows. Pressing a Connect popover's action looks out
 * for the agent, quietly, since nothing on the page waits for it: the connections are read every 3 seconds instead of
 * every minute, and the moment a new one is there, its popover opens saying it's connected. Looking out ends with that,
 * or when the popover closes or turns to something else.
 */
import type { AgentConnection } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { q } from '~/lib/queries';

/** What an open popover shows: how to connect, a token being made, a connection, asking before disconnecting it, or that it's just connected. */
export type View = 'connect' | 'token' | 'conn' | 'off' | 'joined';
export interface Open { key: string; view: View }

const LOOKING_MS = 3_000;
const IDLE_MS = 60_000;

const newest = (a: AgentConnection, b: AgentConnection) => b.createdAt.localeCompare(a.createdAt);

export function useAgentsLine() {
  const [open, setOpen] = useState<Open | undefined>(undefined);
  /** The connections there were when it started looking out, by ID. */
  const [before, setBefore] = useState<ReadonlySet<string> | undefined>(undefined);
  /* The loader has tried it; a list that didn't load waits for Try again. */
  const agents = useQuery({ ...q.agents(), retryOnMount: false, refetchInterval: before ? LOOKING_MS : IDLE_MS });
  const fresh = before && agents.data ? agents.data.filter((c) => !before.has(c.id)).sort(newest)[0] : undefined;
  if (fresh) {
    setBefore(undefined);
    setOpen({ key: fresh.id, view: 'joined' });
  }
  return {
    agents,
    open,
    /** Opens a place's popover at `view`, or turns the open one to it. Looking out for an agent stops. */
    show: (key: string, view: View) => { setBefore(undefined); setOpen({ key, view }); },
    /** Closes a place's popover, never one that has opened since. */
    close: (key: string) => { setBefore(undefined); setOpen((now) => (now?.key === key ? undefined : now)); },
    /** Looks out for a new connection, from the ones there are now (`from`, when they were read before something happened). */
    lookOut: (from?: ReadonlySet<string> | undefined) => { const ids = from ?? (agents.data ? new Set(agents.data.map((c) => c.id)) : undefined); if (ids) setBefore(ids); }
  };
}
export type AgentsLine = ReturnType<typeof useAgentsLine>;

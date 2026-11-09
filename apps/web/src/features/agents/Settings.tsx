/*
 * Agents, the second panel in Connections: each connection on a row of its own, with what it can do, when it was last used
 * and Disconnect, then Connect an agent, which opens in place. It gives Alcove's address to paste into the agent, which
 * then opens Alcove to sign in (routes/connect.tsx); a script that can't sign in gets a token instead, made here and shown
 * once. A token stays in this view only: nothing keeps it, and Done forgets it.
 */
import { AgentScopeSchema, errorMessage, type AgentConnection, type AgentScope, type AgentTokenResult } from '@alcove/api';
import {
  AgentAddress, AgentDisclosure, AgentPermissions, AgentTokenReveal, Button, Field, Segmented, SettingFact, SettingFoot, SettingRow, SettingStep, SettingTile, SettingsPanel,
  Spinner, useToast
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { q, useCreateAgentToken, useRevokeAgent } from '~/lib/queries';
import { dayMonth, pastDay } from '~/lib/time';
import { canDo, PERMISSIONS, READ_SCOPES } from './permissions';

const PANEL = 'agents';

/** What Connect an agent has open: nothing, Alcove's address, or a token being made. */
type Opened = 'nothing' | 'address' | 'token';

/** Words that wrap as one: "Expires 2 Dec" never leaves its date on the next line. */
const together = (words: string) => words.replaceAll(' ', '\u00a0');

/** How long a token lasts. */
type Days = '7' | '30' | '90';
const DAYS: { value: Days; label: string }[] = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }];

/**
 * Focus on what `to` finds, once what's opened or gone in the panel has drawn: the button pressed went with it, or waited
 * while it was asked. Left alone when focus has moved on meanwhile.
 */
function focusSoon(to: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const at = document.activeElement;
    if (at && at !== document.body && at.isConnected) return;
    to()?.focus({ preventScroll: true });
  });
}
/** A connection's row in the panel, by its ID. */
const rowOf = (id: string) => document.getElementById(PANEL)?.querySelector<HTMLElement>(`[data-agent="${id}"]`);

/** Copies a value and says so; when the browser won't, `problem` says what to do instead (`otherwise`). */
function useCopy() {
  const toast = useToast();
  const [problem, setProblem] = useState<string>();
  const copy = async (value: string, said: string, otherwise: string) => {
    try { await navigator.clipboard.writeText(value); setProblem(undefined); toast(said, { icon: 'check' }); }
    catch { setProblem(otherwise); }
  };
  return { copy, problem };
}

export function AgentsPanel() {
  const connections = useQuery(q.agents());
  const revoke = useRevokeAgent();
  const toast = useToast();
  const [opened, setOpened] = useState<Opened>('nothing');
  const connect = useRef<HTMLButtonElement>(null);
  // Closing what was open hands focus back to Connect an agent, which takes its place again.
  const back = useRef(false);
  useEffect(() => {
    if (opened !== 'nothing' || !back.current) return;
    back.current = false;
    connect.current?.focus({ preventScroll: true });
  }, [opened]);
  const close = () => { back.current = true; setOpened('nothing'); };
  const disconnect = async (connection: AgentConnection) => {
    const list = connections.data ?? [];
    const next = list[list.findIndex((c) => c.id === connection.id) + 1];
    try {
      await revoke.mutateAsync(connection.id);
      toast('Agent disconnected.', { icon: 'check' });
      // Its row goes: focus goes on to the next connection, else to Connect an agent.
      focusSoon(() => (next ? rowOf(next.id) : connect.current));
    } catch (e) {
      toast(errorMessage(e), { icon: 'x' });
      // It stays: focus goes back to its Disconnect, which waited while it was asked.
      focusSoon(() => rowOf(connection.id)?.querySelector('button'));
    }
  };
  const none = connections.data?.length === 0;
  return (
    <SettingsPanel id={PANEL} title="Agents">
      {connections.isPending ? <SettingRow label="Looking for connections…" control={<Spinner />} />
        : connections.isError ? <SettingRow label="Connections couldn’t be loaded" problem help={errorMessage(connections.error)}
          control={<Button variant="secondary" size="sm" icon="retry" loading={connections.isFetching} onClick={() => void connections.refetch()}>Try again</Button>} />
          : connections.data.map((c) => (
            // Wide: on a phone, when it was used and Disconnect go under what it can do, which needs the width.
            <SettingRow key={c.id} data-agent={c.id} tabIndex={-1} wide mark={<SettingTile icon={c.kind === 'token' ? 'key' : 'agent'} />} label={c.name}
              help={`${canDo(c.scopes)} · ${c.kind === 'token' ? 'Token' : 'Signed in with Alcove'} · ${together(`Expires ${dayMonth(new Date(c.expiresAt))}`)}`}
              control={
                <div className="set-line">
                  <SettingFact>{c.lastUsedAt ? `Used ${pastDay(c.lastUsedAt)}` : 'Not used yet'}</SettingFact>
                  <Button variant="quiet" size="sm" loading={revoke.isPending && revoke.variables === c.id} disabled={revoke.isPending} onClick={() => void disconnect(c)}>
                    {revoke.isPending && revoke.variables === c.id ? 'Disconnecting' : 'Disconnect'}
                  </Button>
                </div>
              } />
          ))}
      {opened === 'nothing' && (
        <SettingRow label="Connect an agent" help={`${none ? 'None yet. ' : ''}Use Alcove from your AI assistant, with only what you allow.`}
          control={<Button ref={connect} variant="secondary" size="sm" icon="plus" onClick={() => setOpened('address')}>Connect an agent</Button>} />
      )}
      {opened === 'address' && <Address onToken={() => setOpened('token')} onDone={close} />}
      {opened === 'token' && <MakeToken onClose={close} />}
    </SettingsPanel>
  );
}

/** Alcove's address, to paste into an agent's connections: the agent opens Alcove to sign in, and asks for what it can do. */
function Address({ onToken, onDone }: { onToken: () => void; onDone: () => void }) {
  const endpoint = useQuery(q.agentEndpoint());
  const { copy, problem } = useCopy();
  const address = endpoint.data?.endpoint;
  const copyButton = useRef<HTMLButtonElement>(null);
  // Connect an agent went as this opened: focus comes to Copy, once the address is here.
  useEffect(() => { focusSoon(() => copyButton.current); }, [address]);
  return (
    <>
      <SettingStep title="Add Alcove to your agent" help="Paste this address into its connections. It opens Alcove to sign in, and you choose what it can do.">
        {address !== undefined ? <AgentAddress address={address} copyRef={copyButton} onCopy={() => void copy(address, 'Copied. Paste it into your agent’s connections.', 'Copy wasn’t available. Select the address and copy it.')} />
          : endpoint.isError ? <SettingRow label="The address didn’t load" problem help={errorMessage(endpoint.error)}
            control={<Button variant="secondary" size="sm" icon="retry" loading={endpoint.isFetching} onClick={() => void endpoint.refetch()}>Try again</Button>} />
            : <SettingRow label="Looking for the address…" control={<Spinner />} />}
        {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
      </SettingStep>
      <SettingFoot actions={<><Button variant="quiet" size="sm" onClick={onToken}>Create a token</Button><Button variant="secondary" size="sm" onClick={onDone}>Done</Button></>}>
        For a script that can’t sign in, use a token instead.
      </SettingFoot>
    </>
  );
}

/** A token for a script: its name, how long it lasts and what it can do. Made, it shows once, until Done. */
function MakeToken({ onClose }: { onClose: () => void }) {
  const create = useCreateAgentToken();
  const form = useId();
  const [name, setName] = useState('');
  const [days, setDays] = useState<Days>('30');
  const [scopes, setScopes] = useState<AgentScope[]>(READ_SCOPES);
  const [issued, setIssued] = useState<AgentTokenResult | null>(null);
  const [refused, setRefused] = useState<string>();
  const token = useCopy();
  const address = useCopy();
  const copyToken = useRef<HTMLButtonElement>(null);
  // Create token went as the token came: focus goes to its Copy.
  useEffect(() => { if (issued) focusSoon(() => copyToken.current); }, [issued]);
  const valid = name.trim().length > 0 && scopes.length > 0;
  const choose = (id: string, on: boolean) => {
    const scope = AgentScopeSchema.parse(id);
    setScopes((old) => on ? [...old.filter((s) => s !== scope), scope] : old.filter((s) => s !== scope));
  };
  const close = () => { setIssued(null); create.reset(); onClose(); };
  const submit = async () => {
    setRefused(undefined);
    try { setIssued(await create.mutateAsync({ name: name.trim(), scopes, expiresInDays: Number(days) })); create.reset(); }
    catch (e) { setRefused(errorMessage(e)); }
  };
  if (issued) {
    return (
      <>
        <SettingStep title={`${issued.connection.name} can use Alcove until ${dayMonth(new Date(issued.connection.expiresAt))}`} help="This token shows once. Copy it into your script now, with Alcove’s address.">
          <AgentTokenReveal token={issued.token} copyRef={copyToken} onCopy={() => void token.copy(issued.token, 'Token copied.', 'Copy wasn’t available. Try again: the token stays here until Done.')} problem={token.problem} />
          <AgentAddress address={issued.endpoint} onCopy={() => void address.copy(issued.endpoint, 'Address copied.', 'Copy wasn’t available. Select the address and copy it.')} />
          {address.problem && <p role="alert" className="ac-agent-problem">{address.problem}</p>}
        </SettingStep>
        <SettingFoot actions={<Button variant="primary" size="sm" onClick={close}>Done</Button>}>
          Disconnect it here whenever you like. Alcove keeps only a sealed fingerprint of it.
        </SettingFoot>
      </>
    );
  }
  return (
    <>
      <SettingStep title="Create a token" help="A token lets a script use Alcove without signing in. It shows once.">
        <form id={form} className="set-form" onSubmit={(e) => { e.preventDefault(); if (valid && !create.isPending) void submit(); }}>
          <Field label="Name" placeholder="Weekly digest script" maxLength={80} value={name} autoFocus autoComplete="off" disabled={create.isPending} onChange={(e) => setName(e.target.value)} />
          <div className="set-field">
            <span aria-hidden="true">Expires after</span>
            <Segmented<Days> label="Expires after" value={days} options={DAYS} disabled={create.isPending} onChange={setDays} />
          </div>
          <AgentPermissions permissions={PERMISSIONS} selected={scopes} onChange={choose} disabled={create.isPending} />
          {refused && <p role="alert" className="ac-agent-problem">{refused}</p>}
        </form>
      </SettingStep>
      <SettingFoot actions={<><Button variant="quiet" size="sm" disabled={create.isPending} onClick={close}>Cancel</Button><Button type="submit" form={form} variant="primary" size="sm" loading={create.isPending} disabled={!valid}>Create token</Button></>}>
        <AgentDisclosure />
      </SettingFoot>
    </>
  );
}

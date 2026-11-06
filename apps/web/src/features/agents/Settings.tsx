import { AgentScopeSchema, errorMessage, type AgentScope, type AgentTokenResult } from '@alcove/api';
import { AgentDisclosure, AgentPermissions, AgentTokenReveal, Button, EmptyState, Field, SettingRow, SettingsPart, Spinner, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { q, useCreateAgentToken, useRevokeAgent } from '~/lib/queries';
import { PERMISSIONS, READ_SCOPES, scopeLabel } from './permissions';

export function AgentsPart() {
  const connections = useQuery(q.agents());
  const revoke = useRevokeAgent();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const disconnect = async (id: string) => {
    try { await revoke.mutateAsync(id); toast('Agent disconnected.', { icon: 'check' }); }
    catch (e) { toast(errorMessage(e), { icon: 'x' }); }
  };
  return <SettingsPart id="agents" title="Agents">
    <SettingRow label="Connect an agent" help="Use Alcove from your agent with only the permissions you choose."
      control={<Button size="sm" onClick={() => setCreating(true)} disabled={creating}>Create a token</Button>} />
    {creating && <TokenForm onClose={() => setCreating(false)} />}
    {connections.isPending ? <SettingRow label="Loading connections…" control={<Spinner />} /> : connections.isError
      ? <SettingRow label="Connections couldn’t be loaded" problem help={errorMessage(connections.error)} control={<Button size="sm" onClick={() => void connections.refetch()}>Try again</Button>} />
      : connections.data.length === 0 ? <EmptyState title="No agents connected">Connect a client through its Alcove sign-in, or create a token here. You can disconnect it at any time.</EmptyState>
        : connections.data.map((connection) => <SettingRow key={connection.id} label={connection.name}
          help={<>{connection.scopes.map(scopeLabel).join(' · ')}<br />Expires {new Date(connection.expiresAt).toLocaleDateString()}. {connection.lastUsedAt ? `Last used ${new Date(connection.lastUsedAt).toLocaleDateString()}.` : 'Not used yet.'}</>}
          control={<Button size="sm" loading={revoke.isPending && revoke.variables === connection.id} disabled={revoke.isPending} onClick={() => void disconnect(connection.id)}>Disconnect</Button>} />)}
    <AgentDisclosure />
  </SettingsPart>;
}

function TokenForm({ onClose }: { onClose: () => void }) {
  const create = useCreateAgentToken();
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [scopes, setScopes] = useState<AgentScope[]>(READ_SCOPES);
  const [issued, setIssued] = useState<AgentTokenResult | null>(null);
  const [problem, setProblem] = useState<string>();
  const toast = useToast();
  const count = Number(days);
  const valid = name.trim().length > 0 && scopes.length > 0 && Number.isInteger(count) && count >= 1 && count <= 90;
  const choose = (id: string, on: boolean) => {
    const scope = AgentScopeSchema.parse(id);
    setScopes((old) => on ? [...old.filter((s) => s !== scope), scope] : old.filter((s) => s !== scope));
  };
  const close = () => { setIssued(null); create.reset(); onClose(); };
  const submit = async () => {
    setProblem(undefined);
    try { setIssued(await create.mutateAsync({ name: name.trim(), scopes, expiresInDays: count })); create.reset(); }
    catch (e) { setProblem(errorMessage(e)); }
  };
  const copy = async () => {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.token); toast('Agent token copied.', { icon: 'check' }); setProblem(undefined); }
    catch { setProblem('Copy wasn’t available. Select the token and copy it, or try again.'); }
  };
  if (issued) return <AgentTokenReveal token={issued.token} endpoint={issued.endpoint} onCopy={() => void copy()} onDone={close} problem={problem} />;
  return <form className="ac-agent-form" onSubmit={(e) => { e.preventDefault(); if (valid && !create.isPending) void submit(); }}>
    <Field label="Connection name" placeholder="My assistant" maxLength={80} value={name} autoFocus autoComplete="off" disabled={create.isPending} onChange={(e) => setName(e.target.value)} />
    <Field label="Expires after this many days" type="number" min={1} max={90} value={days} disabled={create.isPending} onChange={(e) => setDays(e.target.value)} hint="Choose 1–90 days. Disconnecting ends access sooner." />
    <AgentPermissions permissions={PERMISSIONS} selected={scopes} onChange={choose} disabled={create.isPending} />
    <AgentDisclosure />
    {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
    <div className="ac-agent-actions"><Button type="submit" variant="primary" loading={create.isPending} disabled={!valid}>Create token</Button><Button onClick={close} disabled={create.isPending}>Cancel</Button></div>
  </form>;
}

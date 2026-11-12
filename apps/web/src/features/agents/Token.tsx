/*
 * A token for a script that can't sign in, made in Another agent's popover: its name, how long it lasts and what it can
 * do (reading chosen). Made, it shows once, masked, with Alcove's address, until Done. The token lives in this view only:
 * nothing keeps it, and closing the popover forgets it.
 */
import { errorMessage, type AgentScope, type AgentTokenResult } from '@alcove/api';
import { AgentAction, AgentDisclosure, AgentPermissions, AgentPopHead, AgentPopLine, AgentWell, Field, Segmented } from '@alcove/ui';
import { useId, useState } from 'react';
import { useCreateAgentToken } from '~/lib/queries';
import { dayMonth } from '~/lib/time';
import { useCopy } from './copy';
import { CHIPS, inOrder, PERMISSIONS, READ_SCOPES } from './permissions';

/** How long a token lasts. */
type Days = '7' | '30' | '90';
const DAYS: { value: Days; label: string }[] = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }];

export function TokenPop({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const create = useCreateAgentToken();
  const form = useId();
  const [name, setName] = useState('');
  const [days, setDays] = useState<Days>('30');
  const [scopes, setScopes] = useState<AgentScope[]>(READ_SCOPES);
  const [issued, setIssued] = useState<AgentTokenResult | null>(null);
  const [refused, setRefused] = useState<string>();
  const token = useCopy();
  const address = useCopy();
  const valid = name.trim().length > 0 && scopes.length > 0;

  const choose = (id: string, on: boolean) => {
    const scope = PERMISSIONS.find((p) => p.id === id)?.id;
    if (scope) setScopes((was) => inOrder(on ? [...was, scope] : was.filter((s) => s !== scope)));
  };
  const submit = async () => {
    setRefused(undefined);
    try { setIssued(await create.mutateAsync({ name: name.trim(), scopes, expiresInDays: Number(days) })); create.reset(); }
    catch (e) { setRefused(errorMessage(e)); }
  };

  if (issued) {
    return (
      <>
        <AgentPopHead icon="key" title={issued.connection.name} sub={`Until ${dayMonth(new Date(issued.connection.expiresAt))}`} />
        <AgentPopLine>Copy it into your script now, with Alcove’s address. It won’t show again.</AgentPopLine>
        <AgentWell value={issued.token} hidden copyLabel="Copy the token" copyFocus
          onCopy={() => void token.copy(issued.token, 'Token copied. It won’t show again.', 'Copy wasn’t available. Try again: the token stays here until Done.')} />
        <AgentWell value={issued.endpoint} copyLabel="Copy Alcove’s address" onCopy={() => void address.copy(issued.endpoint, 'Address copied.', 'Copy wasn’t available. Select the address and copy it.')} />
        {(token.problem ?? address.problem) && <p role="alert" className="ac-agent-problem">{token.problem ?? address.problem}</p>}
        <AgentAction onClick={onDone}>Done</AgentAction>
      </>
    );
  }
  return (
    <>
      <AgentPopHead icon="key" title="Create a token" onBack={onBack} />
      <form id={form} className="ag-form" onSubmit={(e) => { e.preventDefault(); if (valid && !create.isPending) void submit(); }}>
        <Field label="Name" placeholder="Weekly digest" maxLength={80} value={name} autoFocus autoComplete="off" disabled={create.isPending} onChange={(e) => setName(e.target.value)} />
        <div className="ag-lasts">
          <span aria-hidden="true">Lasts</span>
          <Segmented<Days> label="Lasts" value={days} options={DAYS} disabled={create.isPending} onChange={setDays} />
        </div>
        <AgentPermissions permissions={CHIPS} selected={scopes} onChange={choose} disabled={create.isPending} />
      </form>
      <p className="ag-small"><AgentDisclosure who="It" maker={false} /></p>
      {refused && <p role="alert" className="ac-agent-problem">{refused}</p>}
      <AgentAction type="submit" form={form} loading={create.isPending} disabled={!valid}>Create token</AgentAction>
    </>
  );
}

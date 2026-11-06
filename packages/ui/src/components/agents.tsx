import type { ReactNode } from 'react';
import { Logo } from './brand';
import { Button, Switch } from './primitives';
import { SettingRow } from './settings';

export interface AgentPermission {
  id: string;
  label: string;
  detail: string;
}

/** The same explicit permission choices in consent and connection settings. */
export function AgentPermissions({ permissions, selected, onChange, disabled = false }: {
  permissions: readonly AgentPermission[];
  selected: readonly string[];
  onChange: (id: string, on: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return <fieldset className="ac-agent-permissions"><legend>Choose what the agent can do</legend>
    {permissions.map((p) => <SettingRow key={p.id} label={p.label} help={p.detail}
      control={<Switch label={p.label} checked={selected.includes(p.id)} disabled={disabled} onChange={(on) => onChange(p.id, on)} />} />)}
  </fieldset>;
}

export function AgentDisclosure() {
  return <p className="ac-agent-disclosure">Your agent can receive readable information from Alcove. Its provider handles that information under its own policies. Disconnect it in Settings at any time.</p>;
}

/** Public consent has one quiet column, with the requesting app and the person's choices together. */
export function AgentConsentFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="ac-agent-connect"><a href="/" aria-label="Alcove home"><Logo /></a>
    <section className="ac-agent-sheet"><h1>{title}</h1>{children}</section>
  </main>;
}

/** A newly issued credential stays in the mounted view only; the input avoids accidental plain-text exposure. */
export function AgentTokenReveal({ token, endpoint, onCopy, onDone, problem }: {
  token: string;
  endpoint: string;
  onCopy: () => void;
  onDone: () => void;
  problem?: string | undefined;
}) {
  return <div className="ac-agent-token" role="region" aria-label="Your new agent token">
    <p className="ac-title">Copy your token now</p>
    <p>Alcove cannot show it again. Keep it in your agent’s credential settings.</p>
    <label className="ac-agent-secret">Agent token<input type="password" value={token} readOnly autoComplete="off" spellCheck={false} /></label>
    <p className="ac-agent-endpoint">MCP server <code>{endpoint}</code></p>
    {problem && <p role="alert">{problem}</p>}
    <div className="ac-agent-actions"><Button variant="primary" icon="copy" onClick={onCopy}>Copy token</Button><Button onClick={onDone}>Done</Button></div>
  </div>;
}

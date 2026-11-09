/*
 * Agents: what one can do (chips you press), Alcove's address to paste into one, a token shown once, and the consent page
 * an agent sends you to. Stateless. Styles in agents.css (ac-agent-).
 */
import { useId, type ReactNode, type Ref } from 'react';
import { cn } from '../cn';
import { Logo } from './brand';
import { Icon } from './icon';
import { Button } from './primitives';

export interface AgentPermission {
  id: string;
  label: string;
  /** What it lets the agent do: said in full with `details`, else when the pointer rests on it. */
  detail: string;
}

/**
 * What an agent can do, chosen explicitly, in consent and in Settings: a chip for each, ticked when it's allowed. With
 * `details` (the consent page, where someone decides what an outside agent may do) each one's detail is said in full under
 * the chips, as text, and each chip is described by it; one that's unticked steps back.
 */
export function AgentPermissions({ permissions, selected, onChange, disabled = false, details = false }: {
  permissions: readonly AgentPermission[];
  selected: readonly string[];
  onChange: (id: string, on: boolean) => void;
  disabled?: boolean | undefined;
  details?: boolean | undefined;
}) {
  const id = useId();
  return (
    <fieldset className="ac-agent-permissions" disabled={disabled}>
      <legend>What it can do</legend>
      <div className="ac-agent-perms">
        {permissions.map((p, i) => {
          const on = selected.includes(p.id);
          return (
            <button key={p.id} type="button" aria-pressed={on} title={details ? undefined : p.detail} aria-describedby={details ? `${id}d${i}` : undefined}
              className="ac-agent-perm" onClick={() => onChange(p.id, !on)}>
              <Icon name="check" size={13} />{p.label}
            </button>
          );
        })}
      </div>
      {details && (
        <dl className="ac-agent-details">
          {permissions.map((p, i) => (
            <div key={p.id} className={cn(!selected.includes(p.id) && 'is-off')}><dt>{p.label}</dt><dd id={`${id}d${i}`}>{p.detail}</dd></div>
          ))}
        </dl>
      )}
    </fieldset>
  );
}

/** What an agent receives, in one line: on the consent page, and at the foot of making a token. */
export function AgentDisclosure() {
  return <span className="ac-agent-disclosure">Your agent receives readable information from Alcove. Its provider handles it under its own policies.</span>;
}

/** Public consent has one quiet column, with the requesting app and the person's choices together. */
export function AgentConsentFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="ac-agent-connect"><a href="/" aria-label="Alcove home"><Logo /></a>
    <section className="ac-agent-sheet"><h1>{title}</h1>{children}</section>
  </main>;
}

/** A value in a box with Copy at its end (`copyRef`, to give it focus). `masked` shows only its first and last four characters. */
function CopyLine({ value, label, masked = false, onCopy, copyRef }: { value: string; label: string; masked?: boolean | undefined; onCopy: () => void; copyRef?: Ref<HTMLButtonElement> | undefined }) {
  const shown = masked ? (value.length > 12 ? `${value.slice(0, 4)}${'•'.repeat(24)}${value.slice(-4)}` : '•'.repeat(value.length)) : value;
  return (
    <div className={cn('ac-agent-copy', masked && 'is-token')} role="group" aria-label={label}>
      <code aria-hidden={masked || undefined}>{shown}</code>
      {masked && <span className="sr-only">Hidden. Copy it to use it.</span>}
      <Button ref={copyRef} size="sm" icon="copy" onClick={onCopy}>Copy</Button>
    </div>
  );
}

/** Alcove's address for agents (MCP), whole, with Copy (`copyRef`): what someone pastes into their agent's connections. */
export function AgentAddress({ address, onCopy, copyRef }: { address: string; onCopy: () => void; copyRef?: Ref<HTMLButtonElement> | undefined }) {
  return <CopyLine value={address} label="Alcove’s address for agents" onCopy={onCopy} copyRef={copyRef} />;
}

/**
 * A token, shown once: hidden but for its first and last four characters, with Copy (`copyRef`). It stays in the mounted
 * view only. `problem` says when copying didn't work.
 */
export function AgentTokenReveal({ token, onCopy, problem, copyRef }: { token: string; onCopy: () => void; problem?: string | undefined; copyRef?: Ref<HTMLButtonElement> | undefined }) {
  return (
    <div className="ac-agent-token">
      <CopyLine value={token} label="Your new token" masked onCopy={onCopy} copyRef={copyRef} />
      {problem && <p role="alert" className="ac-agent-problem">{problem}</p>}
    </div>
  );
}

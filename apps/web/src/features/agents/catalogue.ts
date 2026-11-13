/*
 * The agents people use, in the order they stand on the horizon, and how each connects: Alcove's address to paste as a
 * connector (Claude, ChatGPT), one button that opens the app, which asks to add Alcove (Cursor, VS Code), or one line for
 * the terminal (Claude Code, Codex). Any other agent that works with MCP connects with the address, and a script with a
 * token. A connection's kind is read from its name, here and for display only: the client chooses its name, so nothing
 * Alcove allows or refuses ever depends on it.
 */
import type { AgentConnection } from '@alcove/api';
import type { IconName } from '@alcove/ui';

export type AgentKindId = 'claude' | 'chatgpt' | 'cursor' | 'vscode' | 'claudecode' | 'codex';
/** How it connects: the address to paste (`paste`), a button that opens the app (`app`), or a line for the terminal. */
type How = 'paste' | 'app' | 'terminal';
export interface AgentKind { id: AgentKindId; name: string; icon: IconName; how: How }

/** Their marks are plain icons, never their makers' logos. */
export const KINDS: readonly AgentKind[] = [
  { id: 'claude', name: 'Claude', icon: 'sparkle', how: 'paste' },
  { id: 'chatgpt', name: 'ChatGPT', icon: 'thread', how: 'paste' },
  { id: 'cursor', name: 'Cursor', icon: 'pointer', how: 'app' },
  { id: 'vscode', name: 'VS Code', icon: 'code', how: 'app' },
  { id: 'claudecode', name: 'Claude Code', icon: 'squareTerminal', how: 'terminal' },
  { id: 'codex', name: 'Codex', icon: 'terminal', how: 'terminal' }
];
/** Any agent that works with MCP, at the end of the line. */
export const OTHER = { name: 'Another agent', icon: 'plug' } as const satisfies { name: string; icon: IconName };

/** Claude Code before Claude, since its name has Claude in it. */
const NAMED: readonly (readonly [RegExp, AgentKindId])[] = [
  [/claude code/i, 'claudecode'], [/claude/i, 'claude'], [/chatgpt|openai/i, 'chatgpt'], [/cursor/i, 'cursor'], [/visual studio code|vs ?code/i, 'vscode'], [/codex/i, 'codex']
];
/** The kind people use that a client's name says it is, if any. */
export function kindNamed(name: string): AgentKind | undefined {
  const id = NAMED.find(([pattern]) => pattern.test(name))?.[1];
  return KINDS.find((k) => k.id === id);
}

/** What stands for a connection: a kind people use, a personal token (a key), or any other agent (a bot). */
export type Mark = AgentKindId | 'token' | 'bot';
export const markOf = (c: Pick<AgentConnection, 'name' | 'kind'>): Mark => (c.kind === 'token' ? 'token' : kindNamed(c.name)?.id ?? 'bot');
export const iconOf = (mark: Mark): IconName => (mark === 'token' ? 'key' : mark === 'bot' ? 'agent' : KINDS.find((k) => k.id === mark)?.icon ?? 'agent');
/** Where a mark stands on the line: the kinds in their order, then other agents, then tokens. */
export const markOrder = (mark: Mark): number => (mark === 'token' ? KINDS.length + 1 : mark === 'bot' ? KINDS.length : KINDS.findIndex((k) => k.id === mark));

/**
 * How to connect one, said once: one line of what to do, the address or command in a well when it needs one, and one
 * action. `href` is what the action opens (a page in a new tab with `newTab`, or the app), and `copy` what it copies first.
 * `done` is what a toast says once it has.
 */
export interface Connecting { line: string; well?: string | undefined; action: string; href?: string | undefined; newTab?: boolean | undefined; copy?: string | undefined; done: string }

const CONNECTORS: Record<'claude' | 'chatgpt', string> = { claude: 'https://claude.ai/settings/connectors', chatgpt: 'https://chatgpt.com/#settings/Connectors' };

export function connecting(kind: AgentKind, address: string): Connecting {
  switch (kind.id) {
    case 'claude':
    case 'chatgpt':
      return { line: `Paste this address into ${kind.name}’s connectors.`, well: address, action: `Copy and open ${kind.name}`, href: CONNECTORS[kind.id], newTab: true, copy: address, done: `Copied. ${kind.name} opens in a new tab.` };
    case 'cursor':
      return {
        line: 'Cursor asks to add Alcove. Then you choose what it can do, here.', action: 'Add to Cursor', done: 'Cursor opens.',
        href: `cursor://anysphere.cursor-deeplink/mcp/install?name=alcove&config=${btoa(JSON.stringify({ url: address }))}`
      };
    case 'vscode':
      return {
        line: 'VS Code asks to add Alcove. Then you choose what it can do, here.', action: 'Add to VS Code', done: 'VS Code opens.',
        href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'alcove', type: 'http', url: address }))}`
      };
    case 'claudecode': {
      const command = `claude mcp add --transport http alcove ${address}`;
      return { line: 'Run this in your terminal, then /mcp in Claude Code to sign in.', well: command, action: 'Copy command', copy: command, done: 'Copied. Run it in your terminal.' };
    }
    case 'codex': {
      const command = `codex mcp add alcove --url ${address} && codex mcp login alcove`;
      return { line: 'Run this in your terminal. Codex opens Alcove to sign in.', well: command, action: 'Copy command', copy: command, done: 'Copied. Run it in your terminal.' };
    }
  }
}
export const connectingOther = (address: string): Connecting => ({
  line: 'Any agent that works with MCP connects with this address.', well: address, action: 'Copy address', copy: address, done: 'Address copied. Paste it into your agent’s connections.'
});

/** The first thing to ask a newly connected agent. */
export const FIRST_QUESTION = 'What did we decide about the launch?';

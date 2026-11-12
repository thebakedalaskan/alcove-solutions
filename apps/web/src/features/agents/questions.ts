/*
 * Things to ask an agent, each with the permission it needs, so the page can say which of your agents can do it. The
 * people in them are people you work with, when there are any to name.
 */
import type { AgentConnection, AgentScope } from '@alcove/api';
import { joined } from '~/lib/words';
import { namesInLine } from './line';
import { needs } from './permissions';

export interface Question { id: string; ask: string; needs: AgentScope }

/** The questions, naming up to two of the people you work with (their first names), or nobody. */
export function questionsFor(people: readonly string[]): Question[] {
  const [a, b] = people;
  const two = a && b ? `${a} and ${b}` : a ?? 'my team';
  const one = b ?? a;
  return [
    { id: 'decide', ask: 'What did we decide about the launch?', needs: 'notes:read' },
    { id: 'plate', ask: 'What’s on my plate this week?', needs: 'notes:read' },
    { id: 'book', ask: `Book 45 minutes with ${two} next week.`, needs: 'meetings:write' },
    { id: 'follow', ask: one ? `Add a follow-up for ${one} from my last call.` : 'Add a follow-up from my last call.', needs: 'notes:write' }
  ];
}

/**
 * Who can do it, in the order they stand on the line: the agents you've signed in (tokens are scripts, not something to
 * ask), each name once, whose permissions have what it needs; or what it needs. `can` is the first, to paste it into.
 */
export function whoCan(q: Question, connections: readonly AgentConnection[]): { sub: string; can: string | undefined } {
  const names = namesInLine(connections.filter((c) => c.kind === 'oauth' && c.scopes.includes(q.needs)));
  return names.length ? { sub: `${joined(names)} can do this`, can: names[0] } : { sub: `Needs ${needs(q.needs)}`, can: undefined };
}

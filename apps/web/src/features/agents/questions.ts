/*
 * Things to ask an agent, each with the permission it needs, so the page can say which of your agents can do it, and the
 * tool it leads to, so its mark is the one the row it makes in what your agents did will have. The people in them are
 * people you work with, when there are any to name.
 */
import type { AgentConnection, AgentScope, AgentTool } from '@alcove/api';
import { joined } from '~/lib/words';
import { namesInLine } from './line';
import { needs } from './permissions';

export interface Question { id: string; ask: string; needs: AgentScope; does: AgentTool }

/** The questions, naming up to two of the people you work with (their first names), or nobody. */
export function questionsFor(people: readonly string[]): Question[] {
  const [a, b] = people;
  const two = a && b ? `${a} and ${b}` : a ?? 'my team';
  const one = b ?? a;
  return [
    { id: 'decide', ask: 'What did we decide about the launch?', needs: 'notes:read', does: 'ask_notes' },
    { id: 'plate', ask: 'What’s on my plate this week?', needs: 'notes:read', does: 'get_inbox' },
    { id: 'book', ask: `Book 45 minutes with ${two} next week.`, needs: 'meetings:write', does: 'schedule_call' },
    { id: 'follow', ask: one ? `Add a follow-up for ${one} from my last call.` : 'Add a follow-up from my last call.', needs: 'notes:write', does: 'propose_action' }
  ];
}

/**
 * Who can do it, in the order they stand on the line: the agents you've signed in (tokens are scripts, not something to
 * ask), each name once, whose permissions have what it needs ("Claude can do this"); or what they can't ("Claude can’t
 * book calls"). With none signed in, nothing: there's no one to ask yet. `can` is the first, to paste it into.
 */
export function whoCan(q: Question, connections: readonly AgentConnection[]): { sub: string | undefined; can: string | undefined } {
  const talkers = connections.filter((c) => c.kind === 'oauth');
  const names = namesInLine(talkers.filter((c) => c.scopes.includes(q.needs)));
  if (names.length) return { sub: `${joined(names)} can do this`, can: names[0] };
  const all = namesInLine(talkers);
  const [only] = all;
  if (!only) return { sub: undefined, can: undefined };
  return { sub: `${all.length === 1 ? only : 'Your agents'} can’t ${needs(q.needs)}`, can: undefined };
}

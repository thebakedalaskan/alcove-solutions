/*
 * The line: who stands where on the horizon. Connected agents first, solid, in the order people use them, then other
 * agents and tokens; half a place; the agents people use that aren't connected yet, dashed; then Another agent. It's all
 * in places, not pixels: the stylesheet says how wide a place is at this window's width, and the sun stands just past the
 * end of the line, so it moves only when the line does.
 */
import type { AgentConnection } from '@alcove/api';
import { KINDS, markOf, markOrder, type AgentKind, type Mark } from './catalogue';

export type Spot =
  | { type: 'conn'; key: string; connection: AgentConnection; mark: Mark }
  | { type: 'gap'; key: 'gap' }
  | { type: 'yet'; key: string; kind: AgentKind }
  | { type: 'other'; key: 'other' };

export interface Line { spots: Spot[]; width: number }

/** The key of Another agent's place. */
export const OTHER_KEY = 'other';

const widthOf = (spots: readonly Spot[]) => spots.reduce((w, s) => w + (s.type === 'gap' ? 0.5 : 1), 0);

export function lineOf(connections: readonly AgentConnection[]): Line {
  const conns = connections.map((connection) => ({ connection, mark: markOf(connection) }))
    .sort((a, b) => markOrder(a.mark) - markOrder(b.mark) || a.connection.createdAt.localeCompare(b.connection.createdAt) || a.connection.id.localeCompare(b.connection.id));
  const yet = KINDS.filter((k) => !conns.some((c) => c.mark === k.id));
  const spots: Spot[] = [
    ...conns.map((c): Spot => ({ type: 'conn', key: c.connection.id, ...c })),
    ...(conns.length && yet.length ? [{ type: 'gap', key: 'gap' } as const] : []),
    ...yet.map((kind): Spot => ({ type: 'yet', key: kind.id, kind })),
    { type: 'other', key: OTHER_KEY }
  ];
  return { spots, width: widthOf(spots) };
}

/** The connections' names in the order they stand on the line, each said once: two connections can share a name. */
export const namesInLine = (connections: readonly AgentConnection[]): string[] =>
  [...new Set(lineOf(connections).spots.flatMap((s) => (s.type === 'conn' ? [s.connection.name] : [])))];

/** How far past the end of the line the sun stands, in places. */
const SUN_PAST = 0.62;
/** Where the sun stands from the middle, in places. */
export const sunOf = (line: Line): number => line.width / 2 + SUN_PAST;

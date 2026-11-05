/*
 * Who's on a board outside a call, from its awareness. The server says on every line whose browser it is (`user`), so nobody
 * points under another name, and a browser it doesn't name has no pointer. Each person has a colour of their own, from what
 * they're known by, so it's the same in every browser and holds through their reconnections.
 */
import { DocCaretStateSchema, firstName } from '@alcove/api';
import type { AvatarPerson } from '@alcove/ui';
import { useEffect, useMemo, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { BoardPerson } from './BoardSurface';

/** The colours people have on a board: their pointer, the ring on what they're writing in, and the ring round a view that's theirs. */
const WHO = ['var(--who-1)', 'var(--who-2)', 'var(--who-3)', 'var(--who-4)', 'var(--who-5)', 'var(--who-6)'] as const;

/** Someone's colour on a board, from what they're known by. */
export function colourOf(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return WHO[n % WHO.length] ?? WHO[0];
}

interface Seen { id: string; name: string; clients: number[] }

/** Everyone else's browsers on the board, by who the server says they are. This browser's own state is never stamped back to it. */
function seenOn(awareness: Awareness): Seen[] {
  const by = new Map<string, Seen>();
  for (const [client, state] of awareness.getStates()) {
    if (client === awareness.clientID) continue;
    const user = DocCaretStateSchema.safeParse(state).data?.user;
    if (!user?.id) continue;
    const was = by.get(user.id);
    if (was) was.clients.push(client);
    else by.set(user.id, { id: user.id, name: user.name ?? '', clients: [client] });
  }
  return [...by.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const sameSeen = (a: readonly Seen[], b: readonly Seen[]): boolean =>
  a.length === b.length && a.every((s, i) => { const t = b[i]; return t !== undefined && t.id === s.id && t.name === s.name && t.clients.join() === s.clients.join(); });

/**
 * The people on a board with you, each with their face from `face` (what they're known by, and their name), their colour and
 * their browsers. Drawn again only when someone comes or goes.
 */
export function useBoardPeople(awareness: Awareness, face: (id: string, name: string) => AvatarPerson): BoardPerson[] {
  const [seen, setSeen] = useState<Seen[]>(() => seenOn(awareness));
  useEffect(() => {
    const read = () => { const now = seenOn(awareness); setSeen((was) => (sameSeen(was, now) ? was : now)); };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);
  return useMemo(() => seen.map((s): BoardPerson => ({ id: s.id, person: face(s.id, s.name), name: firstName(s.name || 'Someone'), colour: colourOf(s.id), clients: s.clients })), [seen, face]);
}

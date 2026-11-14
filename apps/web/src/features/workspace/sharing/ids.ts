/*
 * Who's who in a workspace's documents. A tag, a quote or a follow-up names someone by an ID that everyone with the document
 * reads, so it's never their address, nor anything made from it here: the server keys each address under the workspace's own
 * keys, which is the ID a member of it has too. What was written before IDs were keyed, an address or a plain hash of one,
 * still reads: `earlierIds` gives those, for finding a face and for knowing what's yours, and nothing writes them any more.
 */
import type { Person } from '@alcove/api';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { workspaceQueries } from '~/features/workspace/queries';

/** How many addresses one ask can carry: everyone in a call, everyone invited, and a team. */
const MOST_ASKED = 1000;

export interface PersonIds {
  /** Someone's ID here, by their address: undefined until it's known, and for anyone you may not ask about. */
  of: (email: string) => string | undefined;
}
export const NO_IDS: PersonIds = { of: () => undefined };

/** The IDs of everyone at these addresses, asked for the lot at once, and again as it changes. */
export function usePersonIds(workspaceId: string, pass: string | undefined, emails: readonly string[], enabled: boolean): PersonIds {
  const key = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e !== ''))].sort().slice(0, MOST_ASKED).join(' ');
  const asked = useMemo(() => (key ? key.split(' ') : []), [key]);
  /* What's known stays known while a changed lot is asked for: an ID never changes. */
  const { data } = useQuery({ ...workspaceQueries.personIds(workspaceId, asked, pass), enabled: enabled && asked.length > 0, placeholderData: (was) => was });
  return useMemo(() => ({ of: (email: string) => data?.[email.trim().toLowerCase()] }), [data]);
}

/** Someone as a document names them: by their ID here, or, with no address, by the one the call gives them. Undefined while it isn't known. */
export function asNamed(p: Person, ids: PersonIds): Person | undefined {
  if (!p.email) return p;
  const id = ids.of(p.email);
  return id === undefined ? undefined : { ...p, id };
}

/** A short ID for something that's already opaque, a seat in a call, the same each time: never for an address. */
export function hashId(value: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return `p${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** The IDs a document may hold for someone from before IDs were keyed: their address, which quotes used, and its plain hash, which tags did. Only ever read. */
export function earlierIds(email: string): string[] {
  const e = email.trim().toLowerCase();
  return e ? [e, hashId(e)] : [];
}

/** The same people again under their earlier IDs, so what was written before still finds its face. */
export const withEarlier = (people: readonly Person[]): Person[] =>
  people.flatMap((p) => [p, ...earlierIds(p.email).filter((id) => id !== p.id).map((id) => ({ ...p, id }))]);

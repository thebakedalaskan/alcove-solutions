/*
 * Not now, with Undo (the design's 4.4): an invitation put aside leaves the count and moves under Put aside here at once, and
 * Alcove is told once Undo has had its moment (as long as the toast that offers it), so Undo takes it back without asking
 * Alcove anything: Alcove has no way to bring one back. Until then the invitations read from Alcove are said with it put aside
 * (teamQueries.invitations). Joining it meanwhile tells Alcove nothing more than the join. Going elsewhere in Alcove changes
 * nothing; the page going (the tab closed or reloaded) tells Alcove at once, and should that not reach it, the invitation
 * is waiting again next time, which loses nothing. Signing out here tells Alcove first (`tellAside`); signed out in another
 * tab, or the account deleted, what's held is dropped, since Alcove can't be told any more. Kept for this tab only, by the
 * invitations' IDs.
 */
import type { InvitationForYou } from '@alcove/api';
import { onSignedOutElsewhere } from '~/lib/signedOut';

/** How long Undo is offered before Alcove is told: as long as its toast stands. */
export const UNDO_MS = 6000;

const held = new Map<string, { timer: ReturnType<typeof setTimeout>; tell: () => Promise<void> }>();
let listening = false;

/** Tells Alcove at once about everything held here, done once it has answered (or refused, which `tell` says itself). */
export function tellAside(): Promise<void> {
  const told = [...held].map(([id, h]) => { clearTimeout(h.timer); held.delete(id); return h.tell(); });
  return Promise.all(told).then(() => undefined);
}
/** Drops everything held here without telling Alcove: the session it would be told in has ended. */
export function forgetAside(): void {
  for (const h of held.values()) clearTimeout(h.timer);
  held.clear();
}
onSignedOutElsewhere(forgetAside);

/** The invitations as Alcove gave them, with those put aside here and not yet told said as put aside. */
export const withAside = (list: InvitationForYou[]): InvitationForYou[] => (held.size ? list.map((i) => (held.has(i.id) ? { ...i, putAside: true } : i)) : list);

/** `id` is put aside here from now; `tell` tells Alcove once Undo has had its moment, and settles once Alcove has answered. */
export function holdAside(id: string, tell: () => Promise<void>): void {
  if (held.has(id)) return;
  held.set(id, { timer: setTimeout(() => { if (held.delete(id)) void tell(); }, UNDO_MS), tell });
  if (!listening) {
    listening = true;
    addEventListener('pagehide', () => void tellAside());
  }
}

/** Undo, or joining it: `id` isn't put aside after all, and Alcove is never told. Whether it was held here. */
export function takeBack(id: string): boolean {
  const h = held.get(id);
  if (!h) return false;
  clearTimeout(h.timer);
  held.delete(id);
  return true;
}

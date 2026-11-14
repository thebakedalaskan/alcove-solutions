/*
 * Invite links in the demo world (user-flows 10; the team invitations design, 3.4): Art's own, and other people's. A team has
 * one link, its admin's, which everyone on it copies; someone's own link leads nowhere while they're on someone else's team,
 * and makes their team when someone joins from it while they're on none. Priya's is her team's wherever she runs one, and
 * Jonas's asks you to join him while he's on no team. An invitation's own link (from its email) has a secret of its own too.
 * Every secret here is made up: they lead nowhere outside Storybook.
 */
import type { Person } from '@alcove/api';
import type { InviteLinkWorld } from './world';
import { ART, JONAS, PRIYA } from './people';

/** How long a secret after `/invite#` is: 43 characters of letters, digits, `-` and `_`, as the server's are. */
const SECRET_LENGTH = 43;
/**
 * A made-up secret after `/invite#`, from some words and a number, as long as the server's: the start of the words' letters
 * and digits (an address's own part first), then what it's for, then the number.
 */
export function secretOf(words: string, kind: 'InviteLink' | 'Invitation', n: number): string {
  const tail = `${kind}Storybook${String(n).padStart(6, '0')}`;
  const room = SECRET_LENGTH - tail.length;
  return `${words.replace(/[^A-Za-z0-9]/g, '').slice(0, room).padEnd(room, 'x')}${tail}`;
}

/** Art's own invite link's secret, of a generation (one more for each new link): 43 characters, as the server's are. */
export const artsSecret = (generation: number): string => `VandelayArtVandelayInviteLinkStorybook${String(generation).padStart(5, '0')}`;
/** Art's invite link as the stories start: the first. */
export const ART_INVITE_SECRET = artsSecret(0);
/** Priya's invite link: her team's, wherever she runs one, and nowhere while she's on Art's. */
export const PRIYA_INVITE_SECRET = 'VandelayPriyaRamanInviteLinkStorybook000001';
/** Jonas's invite link: Weber Design's where he runs it, and "Jonas asked you to join them on Alcove" while he's on no team. */
export const JONAS_INVITE_SECRET = 'WeberDesignJonasWeberInviteLinkStorybook001';
/** A link nobody has: one copied only in part, or one whose sender has gone. */
export const NOWHERE_INVITE_SECRET = 'VandelayNobodysInviteLinkStorybook000000001';
/** Priya's invitation to art@vandelay.industries, to her Vandelay Industries team: its own link, from its email. */
export const PRIYA_INVITATION_SECRET = 'VandelayPriyaRamanInvitationStorybook000001';
/** An invitation's link that leads nowhere: used, cancelled or run out since its email went. */
export const ENDED_INVITATION_SECRET = 'VandelayEndedInvitationStorybook00000000001';

/** Someone as a link or another team shows them: known by their address, never by their account's ID. */
export const asOthersSee = (p: Person): Person => ({ ...p, id: p.email });

/** Art's own link, the first, from Art at whichever address Art is signed in at. */
export const artsLink = (art: Person = ART): InviteLinkWorld => ({ secret: ART_INVITE_SECRET, generation: 0, from: asOthersSee(art) });
/**
 * Art's link made again, its next generation: a new secret, so the one before leads nowhere, for everybody. What Make a new
 * link does, and taking someone off the team Art runs or deleting it, so a link that went with them stops working.
 */
export const madeAgain = (was: InviteLinkWorld): InviteLinkWorld => ({ ...was, generation: was.generation + 1, secret: artsSecret(was.generation + 1) });
/** Priya's link. */
export const priyasLink = (): InviteLinkWorld => ({ secret: PRIYA_INVITE_SECRET, generation: 0, from: PRIYA });
/** Jonas's link. */
export const jonasLink = (): InviteLinkWorld => ({ secret: JONAS_INVITE_SECRET, generation: 0, from: JONAS });
/** Someone's own link: Priya's and Jonas's are the ones above, anyone else's is made up from their address. */
export function linkOf(p: Person): InviteLinkWorld {
  if (p.email === PRIYA.email) return priyasLink();
  if (p.email === JONAS.email) return jonasLink();
  return { secret: secretOf(p.email, 'InviteLink', 0), generation: 0, from: asOthersSee(p) };
}

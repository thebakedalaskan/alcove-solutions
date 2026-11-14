/*
 * Invite links in the demo world (user-flows 10): Art's own, which Copy invite link copies and every invitation from the Team
 * page carries, and Priya's, which a story opens at /invite. Their secrets are made up: they lead nowhere outside Storybook.
 */
import type { InviteJoined, Person } from '@alcove/api';
import type { InviteLinkWorld } from './world';
import { iso } from './clock';
import { AIKO, ART, MAYA, PRIYA } from './people';

/** Art's own invite link's secret: 43 characters, as the server's are. */
export const ART_INVITE_SECRET = 'VandelayArtVandelayInviteLinkStorybook00001';
/** Priya's, which Art opens, or someone signing in for the first time does. */
export const PRIYA_INVITE_SECRET = 'VandelayPriyaRamanInviteLinkStorybook000001';
/** A link nobody has: one copied only in part, or one whose sender has gone. */
export const NOWHERE_INVITE_SECRET = 'VandelayNobodysInviteLinkStorybook000000001';

/** Someone as an invite link shows them: known by their address, never by their account's ID. */
const asOthersSee = (p: Person): Person => ({ ...p, id: p.email });

/** Aiko joined from Art's link yesterday afternoon, and Maya on Monday morning: newest first. */
export const JOINED_FROM_ART: readonly InviteJoined[] = [{ person: AIKO, at: iso(-1, 14, 20) }, { person: MAYA, at: iso(-2, 9, 45) }];

/** Art's own link, with whoever joined from it. */
export const artsLink = (joined: readonly InviteJoined[] = []): InviteLinkWorld => ({ secret: ART_INVITE_SECRET, from: asOthersSee(ART), joined: [...joined] });

/** Priya's link: nobody has joined from it here. */
export const priyasLink = (): InviteLinkWorld => ({ secret: PRIYA_INVITE_SECRET, from: PRIYA, joined: [] });

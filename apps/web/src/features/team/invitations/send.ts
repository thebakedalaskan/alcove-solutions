/*
 * Inviting people to your team, from anywhere on the Team page (Invite people, Invite on a row or in someone's popover,
 * Invite all): Alcove sends each invitation, and makes your team first when you're on none (named for your company, or for
 * you), which the toast says ("Started Vandelay Industries and invited Diego."). Someone invited already is sent theirs again,
 * as Resend does, when it's yours to send (you invited them, or you're the admin) and Alcove would send it now. At most 50
 * go in one request, the most Alcove takes; past today's limit only the first go, and the toast says how many can be invited
 * tomorrow. Anything refused is said in the toast, in the server's words. Nothing opens a mail app.
 */
import { errorCode, errorMessage, type InvitationsMade, type MyTeam, type Person, type TeamInvitation } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { log } from '~/lib/log';
import { teamQueries, useInviteToTeam, useResendInvitation } from '../queries';
import { invitedSaid, sentAgain } from './words';

const ilog = log.child({ component: 'team-invitations' });
/** The most addresses one request invites: the contract's. */
export const BATCH = 50;

/** Who's invited to `team` already, by address: they're sent theirs again rather than invited anew. */
export const invitationOf = (team: MyTeam | null | undefined, email: string): TeamInvitation | undefined =>
  team?.invitations.find((i) => i.person.email.toLowerCase() === email.toLowerCase());
/** Whether you can send an invitation again now: it's yours to manage, and Alcove has nothing that makes it wait. */
export const resendable = (i: TeamInvitation): boolean => i.manage && i.resendWhy === null;

export function useSendInvitations() {
  const invite = useInviteToTeam();
  const resend = useResendInvitation();
  const toast = useToast();
  const mine = useQuery(teamQueries.myTeam()).data;
  /**
   * Invites `fresh`, 50 at a time, and sends `again` their invitations again (those you can send now). Resolves with what
   * the last request made (null when nothing was invited, or it was refused), once all are done.
   */
  const send = async (fresh: readonly Person[], again: readonly TeamInvitation[] = []): Promise<InvitationsMade | null> => {
    let made: InvitationsMade | null = null;
    if (fresh.length) {
      const started = !mine;
      let invited = 0;
      let already = 0;
      let over = 0;
      for (let at = 0; at < fresh.length; at += BATCH) {
        const rest = Math.max(0, fresh.length - at - BATCH);
        try {
          made = await invite.mutateAsync(fresh.slice(at, at + BATCH).map((p) => p.email));
          invited += made.invited;
          already += made.already;
          over += made.over;
          ilog.info('people invited', { invited: made.invited, already: made.already, over: made.over });
          if (made.over > 0) { over += rest; break; }
        } catch (e) {
          ilog.info('people not invited', { code: errorCode(e), count: Math.min(BATCH, fresh.length - at) });
          // A later request refused, today's limit reached since: the rest wait for tomorrow. The first refused says why.
          if (made) over += fresh.length - at;
          else toast(errorMessage(e), { icon: 'x' });
          break;
        }
      }
      if (made) toast(invitedSaid(fresh, made.team.name || mine?.name || '', { invited, already, over }, started), { icon: 'addUser', ms: over > 0 ? 7000 : undefined });
    }
    for (const i of again.filter(resendable)) {
      try {
        await resend.mutateAsync(i.id);
        toast(sentAgain(i.person), { icon: 'send' });
      } catch (e) {
        ilog.info('an invitation not sent again', { code: errorCode(e) });
        toast(errorMessage(e), { icon: 'x' });
      }
    }
    return made;
  };
  return { send, busy: invite.isPending || resend.isPending };
}

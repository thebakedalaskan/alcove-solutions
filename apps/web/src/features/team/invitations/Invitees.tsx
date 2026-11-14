/*
 * Who's been asked to join the team and hasn't yet (the design's 4.2), under its people, newest first as the page opened
 * (sending one again doesn't move it): each as the directory knows them (or by their address), who invited them and when,
 * when it was last sent again, and in its last week when it runs out. Whoever invited them and the admin can Resend it, as
 * often as Alcove sends one (once a day, 3 times in its 30 days: until then it says Sent today, or Sent 3 times, as Alcove
 * says why), which starts its 30 days again, and Cancel it, asked in place: its link stops working. With nobody invited
 * there's no section.
 */
import { errorCode, errorMessage, type MyTeam, type TeamInvitation } from '@alcove/api';
import { Button, InvitationRow, TeamAsk, TeamRows, TeamSection, useToast } from '@alcove/ui';
import { useRef, useState } from 'react';
import { log } from '~/lib/log';
import { callName } from '~/lib/people';
import { listed } from '../data';
import { useOpen } from '../open';
import { useCancelInvitation, useResendInvitation } from '../queries';
import { invitationLine, resendWaits, sentAgain } from './words';

const ilog = log.child({ component: 'team-invitations' });
/** What's open over the page while an invitation's Cancel is asked, by its ID. */
const ASKING = 'cancel ';

/**
 * The invitations in the order the page first had them, any new since first: so Resend, which makes one the newest, doesn't
 * move it under the pointer, on the list or on the horizon.
 */
export function useSteadyInvitations(list: readonly TeamInvitation[]): TeamInvitation[] {
  const [order, setOrder] = useState<readonly string[]>([]);
  const fresh = list.filter((i) => !order.includes(i.id));
  if (fresh.length) setOrder([...fresh.map((i) => i.id), ...order]);
  const at = new Map([...fresh.map((i) => i.id), ...order].map((id, k) => [id, k]));
  return [...list].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
}

export function Invitees({ team, now }: { team: MyTeam; now: number }) {
  const resend = useResendInvitation();
  const cancel = useCancelInvitation();
  const toast = useToast();
  const list = useSteadyInvitations(team.invitations);
  /* Cancel's question is open over the page, as a popover would be: it has the page's one filled button meanwhile. */
  const { open, setOpen } = useOpen();
  const asking = open !== undefined && open.startsWith(ASKING) ? open.slice(ASKING.length) : null;
  const setAsking = (id: string | null) => setOpen((was) => (id !== null ? `${ASKING}${id}` : was !== undefined && was.startsWith(ASKING) ? undefined : was));
  /* Where the focus goes back to once a question is answered: the row's Cancel, or the next one's once it's gone. */
  const cancels = useRef(new Map<string, HTMLButtonElement>());
  const focusSoon = (id: string | undefined) => requestAnimationFrame(() => { if (id) cancels.current.get(id)?.focus({ preventScroll: true }); });
  if (!list.length) return null;

  const again = (i: TeamInvitation) => resend.mutate(i.id, {
    onSuccess: () => toast(sentAgain(i.person), { icon: 'send' }),
    onError: (e) => { ilog.info('an invitation not sent again', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); }
  });
  const end = (i: TeamInvitation, at: number) => cancel.mutate(i.id, {
    onSuccess: () => {
      setAsking(null);
      toast(`${callName(i.person)}’s invitation is cancelled.`, { icon: 'check' });
      const left = list.filter((x) => x.id !== i.id && x.manage);
      focusSoon((left.find((x) => list.indexOf(x) > at) ?? left.at(-1))?.id);
    },
    // Refused (it ended meanwhile, say): the question closes, and the list is read again, saying what's true.
    onError: (e) => { ilog.info('an invitation not cancelled', { code: errorCode(e) }); setAsking(null); toast(errorMessage(e), { icon: 'x' }); focusSoon(i.id); }
  });

  return (
    <TeamSection title="Invited" className="tq-invited">
      <TeamRows label={`Invited to ${team.name}`}>
        {list.map((i, at) => {
          const who = listed(i.person);
          const first = callName(i.person);
          const waits = resendWaits(i, now);
          const sending = resend.isPending && resend.variables === i.id;
          return (
            <InvitationRow key={i.id} person={i.person} ghost title={who} line={invitationLine(i, now)}
              actions={i.manage && asking !== i.id ? (
                <>
                  <Button variant="quiet" size="sm" disabled={waits !== null || sending} loading={sending}
                    aria-label={waits === null ? `Resend ${who}’s invitation` : `${waits}: ${who}’s invitation can’t be sent again yet`} onClick={() => again(i)}>{waits ?? 'Resend'}</Button>
                  <Button ref={(el) => { if (el) cancels.current.set(i.id, el); else cancels.current.delete(i.id); }} variant="quiet" size="sm"
                    aria-label={`Cancel ${who}’s invitation`} onClick={() => setAsking(i.id)}>Cancel</Button>
                </>
              ) : undefined}>
              {asking === i.id ? (
                <TeamAsk title={`Cancel ${first}’s invitation?`} text="Their link stops working." confirm="Cancel invitation" keep="Keep it"
                  busy={cancel.isPending} onConfirm={() => end(i, at)} onKeep={() => { setAsking(null); focusSoon(i.id); }} />
              ) : null}
            </InvitationRow>
          );
        })}
      </TeamRows>
    </TeamSection>
  );
}

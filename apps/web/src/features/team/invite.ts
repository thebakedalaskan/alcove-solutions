/*
 * Inviting someone to your team (docs: Plans and usage › Team): a one-time link for one person that works for a day, made
 * from the Team page's Invite people and from checkout's Done once a team is bought. Each press makes a new link; the last
 * one made shows with Copy, and isn't kept anywhere, here or on the server, once it's gone from the page.
 *
 * `useInvite()` gives exactly what TeamInvite (@alcove/ui) takes to make and copy links:
 *
 *   <TeamInvite {...useInvite()} />
 */
import { errorCode, errorMessage, type TeamInvite } from '@alcove/api';
import { useToast, type TeamInviteProps } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { log } from '~/lib/log';
import { useTeamInvite } from '~/lib/queries';
import { byWhen } from '~/lib/time';

const ilog = log.child({ component: 'team-invite' });
/** How long Copy says Copied. */
const COPIED_MS = 1600;

/** What `useInvite` gives: the link made (with until when it works, in words), whether one's being made or was just copied, and the two presses. */
export type Invite = Required<Pick<TeamInviteProps, 'made' | 'making' | 'copied' | 'onMake' | 'onCopy'>>;

/** Makes invite links for your team, the team's admin's, and copies the last one made. */
export function useInvite(): Invite {
  const make = useTeamInvite();
  const toast = useToast();
  const [made, setMade] = useState<TeamInvite | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  return {
    made: made && { link: made.link, until: byWhen(made.expiresAt, Date.now()) },
    making: make.isPending,
    copied,
    onMake: () => {
      if (make.isPending) return;
      make.mutate(undefined, {
        onSuccess: (link) => { setMade(link); setCopied(false); },
        onError: (e) => { ilog.info('invite link not made', { code: errorCode(e) }); toast(errorMessage(e), { icon: 'x' }); }
      });
    },
    onCopy: () => {
      if (!made) return;
      const failed = (reason: string) => {
        ilog.info('invite link not copied', { reason });
        toast('Couldn’t copy the link. Select it and copy it yourself.', { icon: 'x' });
      };
      // Without a secure page there's no clipboard to write to.
      const writing: Promise<void> | undefined = navigator.clipboard?.writeText(made.link);
      if (!writing) { failed('no clipboard'); return; }
      void writing.then(() => setCopied(true), (e: unknown) => failed(e instanceof Error ? e.name : 'unknown'));
    }
  };
}

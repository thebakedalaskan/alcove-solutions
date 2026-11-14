/*
 * The Team page with neither a company around you nor a team (docs/design/pages.md › Team, invited), inside the page's one
 * evening (TeamPage.tsx): a card for each invitation to you, newest first, with what you put aside under them. Join puts you
 * on that team, and the page is its own. While the invitations are on their way it waits; if they don't come, it says why,
 * with Try again.
 */
import { errorCode, errorMessage, type InvitationForYou } from '@alcove/api';
import { Button, Dots, EmptyState } from '@alcove/ui';
import type { Ref } from 'react';
import { useOnline } from '~/lib/live';
import { InvitationCardsFor, PutAside, type Joining } from './invitations/ToYou';

export function Invitations({ invitations, joining, now, waiting, failed, onRetry, heading }: {
  invitations: readonly InvitationForYou[];
  joining: Joining;
  now: number;
  /** The invitations are on their way. */
  waiting: boolean;
  /** Why they didn't come, or null. */
  failed: unknown;
  onRetry: () => void;
  /** The page's title, which takes the focus when the page becomes this. */
  heading: Ref<HTMLHeadingElement>;
}) {
  const online = useOnline();
  const offline = failed !== null && (!online || errorCode(failed) === 'network');
  const any = invitations.length > 0;
  return (
    <>
      <header className="dusk-top" style={{ '--d': 0 }}><h1 ref={heading} tabIndex={-1} className="dusk-title">Team</h1></header>
      <div className="ti-page-in" style={{ '--d': 1 }}>
        {any ? (
          <>
            <InvitationCardsFor invitations={invitations} joining={joining} lead />
            <PutAside invitations={invitations} joining={joining} now={now} />
          </>
        ) : waiting ? (
          <p className="tj-wait" role="status"><Dots /> Looking for your invitations</p>
        ) : (
          <EmptyState className="ti-none" title={offline ? 'You’re offline' : 'Your invitations didn’t load'}
            action={<Button variant="primary" icon="retry" onClick={onRetry}>Try again</Button>}>
            {offline ? 'They show here when you’re back.' : errorMessage(failed)}
          </EmptyState>
        )}
      </div>
    </>
  );
}

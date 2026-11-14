import { createFileRoute } from '@tanstack/react-router';
import { InvitedPage } from '~/features/team/Invited';

/* Someone's invite link: its secret is in the fragment, which no server sees. Outside the frame, so it opens signed out too. */
export const Route = createFileRoute('/invite')({ component: InvitedPage });

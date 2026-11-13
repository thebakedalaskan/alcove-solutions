import { createFileRoute } from '@tanstack/react-router';
import { JoinTeamPage } from '~/features/team/Join';

/* A link to join a team: its secret is in the fragment, which no server sees. Outside the frame, so it opens signed out too. */
export const Route = createFileRoute('/team/join')({ component: JoinTeamPage });

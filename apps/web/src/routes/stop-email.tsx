import { createFileRoute } from '@tanstack/react-router';
import { StopEmailsPage } from '~/features/team/invitations/StopEmails';

/* Stopping invitation emails: its token is in the fragment, which no server sees. Outside the frame, so it opens signed out too. */
export const Route = createFileRoute('/stop-email')({ component: StopEmailsPage });

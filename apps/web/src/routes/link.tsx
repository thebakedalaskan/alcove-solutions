import { createFileRoute } from '@tanstack/react-router';
import { NoteLinkPage } from '~/features/notes/NoteLink';

/* A link to a call's notes: its secret is in the fragment, which no server sees. Outside the frame, so it opens signed out too. */
export const Route = createFileRoute('/link')({ component: NoteLinkPage });

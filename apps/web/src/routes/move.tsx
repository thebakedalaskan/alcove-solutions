import { createFileRoute } from '@tanstack/react-router';
import { MovePage } from '~/features/move/MovePage';

/*
 * The new device's side of moving a call here (features/move/MovePage.tsx). The code comes in the link's fragment, which no
 * server sees, and leaves the address bar at once.
 */
export const Route = createFileRoute('/move')({ component: MovePage });

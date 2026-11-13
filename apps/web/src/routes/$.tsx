/*
 * Any address no other route takes: a page saying nothing's there. It's a route like any other, not the root's not-found,
 * so a browser given the prerendered shell for it, as Pages gives every address, hydrates what the shell has and then shows
 * this, as it does for /drive. Workspaces were at /workspace for a while: a link from then lands here, and the Drive is offered.
 * Calls and their notes were at /notes: a link from then lands here too, and Calls is offered.
 */
import { EmptyState, buttonClass } from '@alcove/ui';
import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/$')({ component: NothingHere });

/** Whether the address is one of the old /notes ones: Notes, a note, or a series. */
const wasNotes = (path: string): boolean => path === 'notes' || path.startsWith('notes/');

function NothingHere() {
  const { _splat: path = '' } = Route.useParams();
  const notes = wasNotes(path);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <EmptyState
        title="Nothing here"
        action={<><Link to="/" className={buttonClass()}>Go home</Link>{notes ? <Link to="/calls" className={buttonClass()}>Open Calls</Link> : <Link to="/drive" className={buttonClass()}>Open the Drive</Link>}</>}
      >
        {notes ? 'That page doesn’t exist, or it was deleted. Every call and its notes are in Calls.' : 'That page doesn’t exist, or it was deleted. Workspaces and their documents are in the Drive.'}
      </EmptyState>
    </main>
  );
}

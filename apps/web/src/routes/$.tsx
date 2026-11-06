/*
 * Any address no other route takes: a page saying nothing's there. It's a route like any other, not the root's not-found,
 * so a browser given the prerendered shell for it, as Pages gives every address, hydrates what the shell has and then shows
 * this, as it does for /drive. Workspaces were at /workspace for a while: a link from then lands here, and the Drive is offered.
 */
import { EmptyState, buttonClass } from '@alcove/ui';
import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/$')({ component: NothingHere });

function NothingHere() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <EmptyState
        title="Nothing here"
        action={<><Link to="/" className={buttonClass()}>Go home</Link><Link to="/drive" className={buttonClass()}>Open the Drive</Link></>}
      >
        That page doesn’t exist, or it was deleted. Workspaces and their documents are in the Drive.
      </EmptyState>
    </main>
  );
}

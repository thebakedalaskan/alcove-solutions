/*
 * Plans, as a stand-in on this branch: the side panel's foot and Settings › Plan link here, and the page itself
 * (features/plans/Plans.tsx) takes its place when the branches meet.
 */
import { Evening } from '@alcove/ui';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/plans')({ component: Plans });

function Plans() {
  return (
    <Evening moment="settings">
      <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Plans</h1></header>
    </Evening>
  );
}

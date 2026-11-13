/*
 * The call's workspace, as a test sets one up through the real API: nothing makes one by itself (docs: Calls and recordings ›
 * The call's workspace), so a test of what's kept there has the organizer press New workspace in the call first.
 */
import type { CallSession } from '@alcove/api';

/**
 * The organizer presses New workspace in the call: a workspace made for it, named after it unless it's given a name, with this
 * run's folder at the top and everyone invited in it to edit, and it's the call's from now on. Its ID, as the organizer reads it.
 */
export async function withWorkspace(host: CallSession, name?: string): Promise<string> {
  await host.newWorkspace(name);
  await host.refresh({ call: true, log: false });
  const id = host.getSnapshot().workspace.id;
  if (!id) throw new Error('the call has no workspace after New workspace');
  return id;
}

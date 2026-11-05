/*
 * The name at the top of the list, for the call's organizer: their workspaces, and a new one. Picking another asks once,
 * in place of the menu, and says who in the call can't open it: being the organizer opens a workspace for nobody, so
 * they stay in the call and see that it's private. The call moves for everyone at once, and nothing is moved or copied.
 */
import type { CallWorkspaceSwitch } from '@alcove/api';
import { WsSpacePicker, WsSwitchSheet } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SpaceHead } from '~/features/workspace/context';
import { peopleWords, spaceChoice } from '~/features/workspace/List';
import { q } from '~/lib/queries';
import type { WorkspacePanelState } from './WorkspacePanel';

export function SpacePicker({ head, act }: { head: SpaceHead; act: WorkspacePanelState['act'] }) {
  /* The menu has just read them again, as it opened. */
  const spaces = useQuery(q.workspaces()).data ?? [];
  /** The workspace picked, and what moving the call there would mean, while the question's up. */
  const [asking, setAsking] = useState<{ id: string; is: CallWorkspaceSwitch } | null>(null);
  if (asking) {
    return (
      <WsSwitchSheet name={asking.is.name} current={head.name} cantOpen={asking.is.cantOpen}
        onSwitch={() => { head.close(); act.switchTo(asking.id); }} onKeep={head.close} />
    );
  }
  /* A call can only move to a workspace its organizer can write in. */
  const mine = spaces.filter((w) => w.role === 'admin' || w.role === 'edit').map(spaceChoice);
  const choices = mine.some((s) => s.id === head.workspaceId) ? mine : [{ id: head.workspaceId, name: head.name, sub: peopleWords(head.people) }, ...mine];
  return (
    <WsSpacePicker spaces={choices} current={head.workspaceId} canChoose about={head.about}
      onPick={(id) => {
        if (id === head.workspaceId) { head.close(); return; }
        act.preview(id).then((is) => setAsking({ id, is }), (e: unknown) => { head.close(); act.failed(e); });
      }}
      onNew={() => { head.close(); act.newWorkspace(); }} />
  );
}

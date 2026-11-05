/*
 * The name at the top of the list, for the call's organizer: their workspaces, with the call's home marked, and a new one.
 * Picking another asks once, in place of the menu, and says who in the call can't open it: being the organizer opens a
 * workspace for nobody, so they stay in the call and see that it's private. Everyone views it at once, nothing is moved or
 * copied, and the notes and transcript still go to the home.
 */
import type { CallWorkspaceSwitch } from '@alcove/api';
import { WsSpacePicker, WsSwitchSheet } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SpaceHead } from '~/features/workspace/context';
import { homeChoice, peopleWords, spaceChoice } from '~/features/workspace/List';
import { q } from '~/lib/queries';
import type { WorkspacePanelState } from './WorkspacePanel';

export function SpacePicker({ head, act, home }: { head: SpaceHead; act: WorkspacePanelState['act']; home: string | null }) {
  /* The menu has just read them again, as it opened. */
  const spaces = useQuery(q.workspaces()).data ?? [];
  /** The workspace picked, and what moving the call there would mean, while the question's up. */
  const [asking, setAsking] = useState<{ id: string; is: CallWorkspaceSwitch } | null>(null);
  if (asking) {
    return (
      <WsSwitchSheet name={asking.is.name} current={head.name} home={asking.id === home ? undefined : spaces.find((w) => w.id === home)?.name ?? undefined} cantOpen={asking.is.cantOpen}
        onSwitch={() => { head.close(); act.switchTo(asking.id); }} onKeep={head.close} />
    );
  }
  /* A call can only move to a workspace its organizer can write in. */
  const mine = spaces.filter((w) => w.role === 'admin' || w.role === 'edit').map((w) => homeChoice(spaceChoice(w), home));
  const choices = mine.some((s) => s.id === head.workspaceId) ? mine : [homeChoice({ id: head.workspaceId, name: head.name, sub: peopleWords(head.people) }, home), ...mine];
  return (
    <WsSpacePicker spaces={choices} current={head.workspaceId} canChoose about={head.about}
      onPick={(id) => {
        if (id === head.workspaceId) { head.close(); return; }
        act.preview(id).then((is) => setAsking({ id, is }), (e: unknown) => { head.close(); act.failed(e); });
      }}
      onNew={() => { head.close(); act.newWorkspace(); }} />
  );
}

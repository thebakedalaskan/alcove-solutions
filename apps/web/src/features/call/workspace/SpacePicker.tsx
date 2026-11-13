/*
 * The call's workspace, for its organizer: their workspaces they can edit in, and a new one. From the name at the top of the
 * list, from the frame's menu, and from a call with none yet (`head` null). Picking one asks once, in place of the menu, and
 * says who in the call can't open it: being the organizer opens a workspace for nobody, so they stay in the call and see that
 * it's private. Everyone views it at once, nothing is moved or copied, and the call's notes and transcript go there from now on.
 */
import type { CallWorkspaceSwitch } from '@alcove/api';
import { WsSpacePicker, WsSwitchSheet } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { SpaceHead } from '~/features/workspace/context';
import { namesIn, peopleWords, spaceChoice } from '~/features/workspace/List';
import { q } from '~/lib/queries';
import type { WorkspacePanelState } from './WorkspacePanel';

/** `head`: the call's workspace as the list's name has it, or null while the call has none. `close` puts the menu away. */
export function SpacePicker({ head, close, act }: { head: SpaceHead | null; close: () => void; act: WorkspacePanelState['act'] }) {
  /* Whatever opened it has just read them again. */
  const spaces = useQuery(q.workspaces()).data ?? [];
  /** The workspace picked, and what using it for the call would mean, while the question's up. */
  const [asking, setAsking] = useState<{ id: string; is: CallWorkspaceSwitch } | null>(null);
  if (asking) {
    return (
      <WsSwitchSheet name={asking.is.name} current={head?.name ?? null} cantOpen={asking.is.cantOpen}
        onSwitch={() => { close(); act.switchTo(asking.id); }} onKeep={close} />
    );
  }
  /* A call can only use a workspace its organizer can write in. */
  const named = namesIn(spaces);
  const mine = spaces.filter((w) => w.role === 'admin' || w.role === 'edit').map((w) => spaceChoice(w, named));
  const choices = head === null || mine.some((s) => s.id === head.workspaceId) ? mine : [{ id: head.workspaceId, name: head.name, sub: peopleWords(head.people) }, ...mine];
  return (
    <WsSpacePicker spaces={choices} current={head?.workspaceId ?? null} canChoose about={head?.about ?? []}
      onPick={(id) => {
        if (id === head?.workspaceId) { close(); return; }
        act.preview(id).then((is) => setAsking({ id, is }), (e: unknown) => { close(); act.failed(e); });
      }}
      onNew={() => { close(); act.newWorkspace(); }} />
  );
}

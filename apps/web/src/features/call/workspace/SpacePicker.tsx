/*
 * Switch workspace, in the workspace's name menu, for the call's organizer: their workspaces, with the call's home marked, and
 * a new one. Picking another asks once, in place of the menu, and says who in the call isn't in it: the workspace the call uses
 * opens to everyone in it, so once everyone views it they can open and edit it while they're in the call, all but what's
 * closed to some people. Unless someone else pays for it: then it opens only for its own people, and the question says why.
 * Everyone views it at once, nothing is moved or copied, and the notes and transcript still go to the home.
 */
import type { CallWorkspaceSwitch } from '@alcove/api';
import { WsSpacePicker, WsSwitchSheet } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { homeChoice, namesIn, peopleWords, spaceChoice } from '~/features/workspace/List';
import { q } from '~/lib/queries';
import type { WorkspacePanelState } from './WorkspacePanel';

/** `current`: the workspace everyone views now. `home`: the call's. `onClose` puts the menu away. */
export function SpacePicker({ current, home, act, onClose }: { current: { id: string; name: string }; home: string | null; act: WorkspacePanelState['act']; onClose: () => void }) {
  /* Read again as it opens: a workspace made since, the call's home say, is among them. */
  const spaces = useQuery({ ...q.workspaces(), staleTime: 0 }).data ?? [];
  /** The workspace picked, and what moving the call there would mean, while the question's up. */
  const [asking, setAsking] = useState<{ id: string; is: CallWorkspaceSwitch } | null>(null);
  if (asking) {
    return (
      <WsSwitchSheet name={asking.is.name} home={asking.id === home ? undefined : home === current.id ? current.name : spaces.find((w) => w.id === home)?.name ?? undefined} cantOpen={asking.is.cantOpen} everyone={asking.is.everyone}
        onSwitch={() => { onClose(); act.switchTo(asking.id); }} onKeep={onClose} />
    );
  }
  /* A call can only move to a workspace its organizer can write in. */
  const named = namesIn(spaces);
  const mine = spaces.filter((w) => w.role === 'admin' || w.role === 'edit').map((w) => homeChoice(spaceChoice(w, named), home));
  const choices = mine.some((s) => s.id === current.id) ? mine : [homeChoice({ id: current.id, name: current.name, sub: peopleWords(null) }, home), ...mine];
  return (
    <WsSpacePicker spaces={choices} current={current.id}
      onPick={(id) => {
        if (id === current.id) { onClose(); return; }
        act.preview(id).then((is) => setAsking({ id, is }), (e: unknown) => { onClose(); act.failed(e); });
      }}
      onNew={() => { onClose(); act.newWorkspace(); }} />
  );
}

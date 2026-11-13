/*
 * A workspace's media while it's on screen: its pictures, read for whatever shows them and let go of with it; an upload that
 * outlives the page saying how it went here; and the workspace's media read again once something's stored in it.
 */
import { errorMessage } from '@alcove/api';
import { wsToast, type WsToastData } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useStorageRefusal } from '~/features/plans/storageFull';
import { workspaceKeys } from '~/features/workspace/queryKeys';
import { Pictures } from './pictures';
import { onStored, talkThrough } from './uploads';

export function useWorkspaceMedia({ workspaceId, pass, signedIn, from, say }: {
  workspaceId: string;
  /** The call's pass, for someone reading through a call. */
  pass: string | undefined;
  /** Someone with an account, whose plan can say why storage refused something. */
  signedIn: boolean;
  from: 'page' | 'call';
  say: (toast: WsToastData) => void;
}): Pictures {
  const pictures = useMemo(() => new Pictures(workspaceId, pass), [workspaceId, pass]);
  useEffect(() => () => pictures.close(), [pictures]);
  /* Storage full is said as the doors say it, with what helps; anything else in the server's own words. */
  const refused = useStorageRefusal(signedIn, from);
  useEffect(() => talkThrough(workspaceId, (e, bytes) => {
    void refused(e, bytes).then((r) => say(wsToast.failed(r?.text ?? errorMessage(e), r?.action ?? undefined)));
  }), [workspaceId, say, refused]);
  const qc = useQueryClient();
  useEffect(() => onStored((id) => { if (id === workspaceId) void qc.invalidateQueries({ queryKey: workspaceKeys.workspaceMedia(id) }); }), [qc, workspaceId]);
  return pictures;
}

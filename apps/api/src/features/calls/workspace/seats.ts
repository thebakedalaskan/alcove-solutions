/*
 * People seated in a call, as the workspaces it reaches know them (docs: Privacy, keys and sessions › Who can open a workspace).
 * A workspace keeps rows that name a call and a seat, and asks the call the rest: whose seat a pass is, whether a seat is still
 * taken, who else is in the call, and what someone in it may ask AI to do there (`workspaceCalls`, features/workspaces/calls.ts).
 * Also what the call gives seats in its home: the home itself, settled for the server to work in, and one document at a time.
 */
import type { DocumentRole } from '@alcove/api';
import type { Deps } from '../../../platform/context';
import { tx } from '../../../platform/db';
import { notFound } from '../../../platform/errors';
import { grant, readerWith, serverWorkspace, type CallRef, type Grant, type HeldWorkspace, type Reader, type Seat, type Workspace } from '../../workspaces/access';
import type { Calls } from '../../workspaces/calls';
import { tellCall } from '../attention/notifications';
import { roomsOfCalls, workedOn } from '../boards/room-boards';
import { mayAskInCall, maySortInCall } from '../notes/insights';
import { addressIn, addressesIn, inSeat, seatOfViewer, seated, seatedIn, viewerOf, type Viewer } from '../participants';
import { settledHome } from './workspace-actions';

/** Someone's seat in their call, as a workspace has it: what their pass says, and the call answering for itself. */
export function seatFor(v: Viewer): Seat {
  return {
    callId: v.pass.callId, seat: seatOfViewer(v), name: v.pass.name, workspace: v.workspace, person: v.pass.person, identity: v.pass.identity, organizerId: v.pass.ownerId,
    call: {
      seated: () => seated(v),
      addresses: () => addressesIn(v),
      addressOf: (seat) => addressIn(v, seat),
      workedOn: (at, by) => workedOn(v, at, by),
      mayAsk: (model) => mayAskInCall(v, model),
      maySort: () => maySortInCall(v)
    }
  };
}

/**
 * Who someone in a call is to a workspace, from what the call already knows: what their session gives them and, once
 * they're let in, their seat. The same as `readerOf` says for that browser, so what the call tells them is what opens.
 */
export const readerInCall = async (v: Viewer): Promise<Reader> => readerWith(v.organizer, await v.session(), v.inCall ? seatFor(v) : undefined);

/** What a workspace asks of calls, answered here. */
export const workspaceCalls: Calls = {
  seatOf: async (d, pass, account) => {
    const viewer = await viewerOf(d, pass, () => Promise.resolve(account));
    return viewer.inCall ? seatFor(viewer) : undefined;
  },
  stillIn: (d, at) => inSeat(d, at),
  tell: (d, callId) => tellCall(d, callId),
  roomsOf: (d, calls, db) => roomsOfCalls(d, calls, db)
};

/**
 * The call's home, for the server to work in, and the call's folder at the top of it (`folderId`): what the server makes for
 * the call, such as its board, goes in that folder. The meeting's, else a new one made for the call, settled the first time
 * it's asked for. It opens nothing for anyone.
 */
export async function workspaceForCall(d: Deps, call: CallRef): Promise<HeldWorkspace & { folderId: string }> {
  const { workspaceId, folderId } = await settledHome(call.organizer, call.callId);
  const w = await serverWorkspace(d, workspaceId);
  if (!w) throw notFound('That workspace', { workspaceId });
  return { ...w, folderId };
}

/**
 * Gives one document to everyone in a call now or, with `place`, in that part of it: a seat each, which ends with the call or
 * when they're removed from it. Being in the call gives nothing until this says so, and someone who joins after isn't given it.
 */
export async function grantDocumentToCall(d: Deps, workspace: Pick<Workspace, 'workspaceId'>, documentId: string, call: CallRef, opts: { role: DocumentRole; place?: string | undefined }): Promise<void> {
  const people = await seatedIn(call.organizer, call.callId, opts.place);
  await tx(d.pool, async (c) => {
    const w = await serverWorkspace(d, workspace.workspaceId, c, 'change');
    const item = w?.state.items[documentId];
    if (!w || !item || item.kind === 'folder') throw notFound('That document', { workspaceId: workspace.workspaceId, documentId });
    await grant(w, c, documentId, [...people].map(([seat, name]): Grant => ({ kind: 'seat', callId: call.callId, seat, name, role: opts.role })));
  });
  await tellCall(d, call.callId);
}

/*
 * Getting a call ready before it starts (docs: Calls and recordings › The call's home): its organizer, or someone invited,
 * adds an agenda, a board or a document to upload files into, from the call's page. The home is settled as the
 * call itself settles it the first time anyone opens Workspace: the workspace its organizer chose, while they can still make
 * things there, else a new one made for it, named after it and its day, with everyone invited let in to edit. That's done
 * under the meeting's own row, so everyone pressing at once gets the same home. What's made goes at the top of the home, as
 * whoever made it, and is brought to the call (an agenda as its agenda), so it opens for everyone invited, before the call and
 * in it. The call's own folder comes when it starts. Nothing here says anything readable to a log or an error.
 */
import type { CallAheadBody, CallAheadHome } from '@alcove/api';
import type { Owner } from '../../context';
import { tx } from '../../db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors';
import { log } from '../../log';
import { findItem, getItem, lockItem } from '../../vault';
import { profile } from '../account/account';
import { locateInvited } from '../meetings/access';
import { zoneOf } from '../meetings/repeats';
import { MeetingManifest, updateManifest } from '../meetings/service';
import { accountReader, serverWorkspace } from '../workspaces/access';
import { writeDocument } from '../workspaces/documents';
import { createItem, makeHome } from '../workspaces/service';
import * as space from './workspace';

const alog = log.child({ component: 'call-ahead' });

/** How many times the meeting can change under a home being settled before it's refused. */
const TRIES = 3;

/** Whose call it is and what it is now: your own, or one you're invited to that isn't over. Anyone else: not found. */
async function callOf(viewer: Owner, meetingId: string) {
  const own = await findItem(viewer, viewer.pool, 'meeting', meetingId, MeetingManifest);
  return own ? { organizer: viewer, meeting: own } : locateInvited(viewer, meetingId);
}

/**
 * The call's home, settled in its organizer's vault: the one the meeting names while its organizer can still make things
 * there, else a new one, made under the meeting's row and named on it, with everyone invited let in once that row is let go.
 */
async function settle(o: Owner, meetingId: string, timeZone: string | undefined, tries = 1): Promise<{ workspaceId: string; made: boolean }> {
  const organizer = (await profile(o)).email;
  const m = await getItem(o, o.pool, 'meeting', meetingId, MeetingManifest, 'That meeting');
  const chosen = m.manifest.workspaceId;
  if (chosen && await space.usableHome(o, organizer, chosen)) return { workspaceId: chosen, made: false };
  const zone = timeZone ?? (m.manifest.seriesId ? await zoneOf(o, m.manifest.seriesId) : undefined) ?? 'UTC';
  const taken = await tx(o.pool, async (c) => {
    await lockItem(o, c, meetingId);
    const now = await getItem(o, c, 'meeting', meetingId, MeetingManifest, 'That meeting');
    if (now.manifest.workspaceId !== chosen) return { again: true } as const;
    if (now.manifest.status !== 'scheduled') throw new ConflictError('This call has started. Its workspace opens in the call.', { context: { meetingId, status: now.manifest.status } });
    const startsAt = new Date(now.manifest.startsAt);
    const { id } = await makeHome(o, c, { name: space.homeName(now.manifest.title, startsAt, zone), madeFor: space.madeForCall(now, startsAt) });
    await updateManifest(o, c, meetingId, (x) => ({ ...x, workspaceId: id }));
    return { again: false, id, guests: now.manifest.guests } as const;
  });
  if (taken.again) {
    if (tries >= TRIES) throw new ConflictError('This call changed while its workspace was being made. Try again.', { context: { meetingId, tries } });
    return settle(o, meetingId, timeZone, tries + 1);
  }
  alog.info('call home made before the call', { meetingId, workspaceId: taken.id });
  // Everyone invited comes in now the meeting's row is let go, and later calls of its series that had the old home follow.
  await space.followHome(o, meetingId, { add: taken.guests });
  await space.carryForward(o, meetingId, chosen, taken.id);
  return { workspaceId: taken.id, made: true };
}

/**
 * Gets a call ready before it starts, for its organizer or someone invited (`calls.ready`). What's made is made as the person
 * asking, who has to be able to change the home: everyone invited is, in a home made for the call, but a workspace the
 * organizer chose keeps its own people, and someone not among them can't add to it.
 */
export async function ready(viewer: Owner, meetingId: string, body: CallAheadBody): Promise<CallAheadHome> {
  const { organizer, meeting } = await callOf(viewer, meetingId);
  if (meeting.manifest.status !== 'scheduled') throw new ConflictError('This call has started. Its workspace opens in the call.', { context: { meetingId, status: meeting.manifest.status } });
  const home = await settle(organizer, meetingId, body.timeZone);
  const reader = await accountReader(viewer);
  const made = body.make === 'board' ? { kind: 'board', name: 'Board' } as const : { kind: 'document', name: body.make === 'agenda' ? 'Agenda' : body.name } as const;
  let itemId: string;
  try {
    ({ id: itemId } = await createItem(viewer, reader, home.workspaceId, { ...made, parent: null }));
  } catch (e) {
    // A home its organizer chose that this person isn't in, or can only read: they can't add to it, and it says so plainly.
    if (e instanceof NotFoundError || e instanceof ForbiddenError) throw new ForbiddenError('You can’t add to this call’s workspace.', { cause: e, context: { meetingId, workspaceId: home.workspaceId } });
    throw e;
  }
  if (body.make === 'agenda') {
    const w = await serverWorkspace(organizer, home.workspaceId);
    // Its title is on the page before anyone opens it; a page that couldn't have it still opens, with the seed's.
    if (w) await writeDocument(w, itemId, 'writeAgenda', { title: 'Agenda', open: [] }).catch((e: unknown) => alog.warn('an agenda made before the call wasn’t titled', { meetingId, workspaceId: home.workspaceId, documentId: itemId, err: e }));
  }
  await tx(organizer.pool, (c) => updateManifest(organizer, c, meetingId, (m) => space.withMadeAhead(m, home.workspaceId, itemId, body.make === 'agenda')));
  alog.info('made for a call before it starts', { meetingId, workspaceId: home.workspaceId, itemId, kind: body.make, home: home.made ? 'new' : 'there', organizer: organizer.ownerId === viewer.ownerId });
  return { workspaceId: home.workspaceId, itemId };
}

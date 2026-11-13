/*
 * A call's home follows its invite (docs: Calls and recordings › The call's workspace): a workspace made for a call, or for its
 * series, lets in whoever the invite puts on it and takes out whoever it takes off, as the invite changes, whether that's
 * scheduling the call again or someone let into it. Taking someone out can strand what only they could open, which asks the
 * calls about their rooms' boards (`calls`, features/workspaces/calls.ts).
 */
import type { Owner } from '../../platform/context';
import { tx } from '../../platform/db';
import { log } from '../../platform/log';
import { findItem, type Loaded } from '../../keys/vault';
import { profile } from '../profile/profile';
import { serverWorkspace, type MadeFor } from '../workspaces/access';
import type { Calls } from '../workspaces/calls';
import { followInvite, type InviteChange } from '../workspaces/service';
import { MeetingManifest, all as allMeetings } from './service';

const wlog = log.child({ component: 'call-workspace' });

/** Whether a home was made for this call, or for its series, so who's in it follows the call's invite. */
export const homeOf = (made: MadeFor | null, m: Loaded<MeetingManifest>): boolean =>
  made !== null && (made.meetingId === m.itemId || (made.seriesId !== null && made.seriesId === (m.manifest.seriesId ?? null)));

/**
 * Who's on the invite as far as a call's home goes: the call's own, and, for a call in a series, every call of it that hasn't
 * ended and has the same home. Lower-cased.
 */
async function invitedTo(o: Owner, m: Loaded<MeetingManifest>, home: string): Promise<Set<string>> {
  const series = m.manifest.seriesId;
  const calls = series ? (await allMeetings(o)).filter((x) => x.manifest.seriesId === series && x.manifest.workspaceId === home && x.manifest.status !== 'ended') : [];
  return new Set([m, ...calls].flatMap((x) => x.manifest.guests.map((e) => e.trim().toLowerCase())));
}

/**
 * Who's in the call's home follows its invite, one change at a time, when it was made for the call or its series
 * (`followInvite`): whoever the change put on the invite is let in, if they're on it still, and whoever it took off is
 * taken out, unless the series still invites them to a call to come. So does who's in each workspace made in the call
 * (`made`), by the call's own invite. It never throws: the call goes on, and the next change, or the next call's start,
 * tries again.
 */
export async function followHome(o: Owner, meetingId: string, change: InviteChange, calls: Calls, made: readonly string[] = []): Promise<void> {
  if (!change.add?.length && !change.gone?.length) return;
  try {
    const m = await findItem(o, o.pool, 'meeting', meetingId, MeetingManifest);
    if (!m) return;
    const home = m.manifest.workspaceId;
    const own = new Set(m.manifest.guests.map((e) => e.trim().toLowerCase()));
    const spaces = new Map<string, Set<string>>(made.map((x) => [x, own]));
    if (home) spaces.set(home, await invitedTo(o, m, home));
    let organizer: string | undefined;
    for (const [workspaceId, invited] of spaces) {
      const add = (change.add ?? []).filter((e) => invited.has(e.trim().toLowerCase()));
      const gone = (change.gone ?? []).filter((e) => !invited.has(e.trim().toLowerCase()));
      if (!add.length && !gone.length) continue;
      const by = (organizer ??= (await profile(o)).email);
      await tx(o.pool, async (c) => {
        const w = await serverWorkspace(o, workspaceId, c, 'change');
        if (w && homeOf(w.state.madeFor, m)) await followInvite(w, c, by, { add, gone }, calls);
      });
    }
  } catch (e) {
    wlog.warn('a call’s home didn’t follow its invite', { meetingId, err: e });
  }
}

/**
 * Who each call a change to `meetingId` can reach invites, as they are: that call's, and the rest of its series' that haven't
 * ended. Asked before the change, for the calls' homes to follow it afterwards (`followInvites`).
 */
export async function invitesOf(o: Owner, meetingId: string, m: Pick<MeetingManifest, 'guests' | 'seriesId'>): Promise<Map<string, string[]>> {
  const series = m.seriesId;
  const calls = series ? (await allMeetings(o)).filter((x) => x.manifest.seriesId === series && x.itemId !== meetingId && x.manifest.status !== 'ended') : [];
  return new Map([[meetingId, m.guests], ...calls.map((x): [string, string[]] => [x.itemId, x.manifest.guests])]);
}
/**
 * A change to scheduled calls' invites reaches the homes made for them as a change in the call does (`followHome`): who it
 * put on an invite is let in, and who it took off is taken out. `before`: the invites as they were (`invitesOf`). Never throws.
 */
export async function followInvites(o: Owner, before: Map<string, string[]>, calls: Calls): Promise<void> {
  try {
    const now = new Map((await allMeetings(o)).map((x) => [x.itemId, x]));
    const lower = (xs: string[]) => new Set(xs.map((e) => e.trim().toLowerCase()));
    const homes = new Map<string, { meetingId: string; add: Set<string>; gone: Set<string> }>();
    for (const [meetingId, was] of before) {
      const m = now.get(meetingId);
      const home = m?.manifest.workspaceId;
      if (!m || !home) continue;
      const then = lower(was);
      const after = lower(m.manifest.guests);
      const at = homes.get(home) ?? { meetingId, add: new Set<string>(), gone: new Set<string>() };
      for (const e of after) if (!then.has(e)) at.add.add(e);
      for (const e of then) if (!after.has(e)) at.gone.add(e);
      homes.set(home, at);
    }
    for (const { meetingId, add, gone } of homes.values()) await followHome(o, meetingId, { add: [...add], gone: [...gone] }, calls);
  } catch (e) {
    wlog.warn('calls’ homes didn’t follow their invites', { calls: before.size, err: e });
  }
}

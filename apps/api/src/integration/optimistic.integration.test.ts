/** The production query mutation options driven through real signed-in HTTP flows, never React or a fake API. */
import { errorCode, OPERATION_HEADER, type Inbox, type Meeting, type Note, type Patch, type Preferences, type WorkspaceSummary } from '@alcove/api';
import { MutationObserver, onlineManager, QueryClient } from '@tanstack/query-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { answerCallOptions, interactiveWrites, preferenceOptions, readMeeting, readNote, readPreferences, readWorkspaces, renameWorkspaceOptions, updateActionOptions, updateDecisionOptions, type PreferenceChange } from '../../../web/src/lib/queryWrites';
import { TreeChanges } from '../../../web/src/features/workspace/changes';
import { speechWav } from '../testing/fake-near';
import { startHarness, type Browser, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
afterEach(() => { h.closeCalls(); });
let sequence = 0;
const email = () => `optimistic.${Date.now().toString(36)}.${++sequence}@tests.example`;
const keys = {
  session: ['session'] as const,
  meeting: (id: string) => ['meetings', 'one', id] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  prefs: ['prefs'] as const, workspaces: ['workspaces'] as const,
  note: (id: string) => ['notes', 'one', id] as const,
  inbox: ['notes', 'inbox'] as const, allSeries: ['series'] as const
};
const queryClient = () => new QueryClient({ defaultOptions: { mutations: interactiveWrites, queries: { retry: false } } });
const patch = (v: PreferenceChange) => v;
/** Hold one actual HTTP request or acknowledgement. Other requests and responses still use the real server. */
function hold(browser: Browser, method: string, ending: string, mode: 'before' | 'dispatch' | 'after' | 'lost') {
  let claimed = false;
  let reached = false;
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const delayed = h.browser({ fetch: async (input, init) => {
    const first = !claimed && init?.method === method && String(input).endsWith(ending);
    if (!first) return browser.fetch(input, init);
    claimed = true;
    if (mode === 'before') { reached = true; await waiting; throw new TypeError('The connection closed before dispatch.'); }
    if (mode === 'dispatch') { reached = true; await waiting; return browser.fetch(input, init); }
    const response = await browser.fetch(input, init);
    reached = true;
    await waiting;
    if (mode === 'lost') throw new TypeError('The acknowledgement was lost.');
    return response;
  } });
  return { api: delayed.api, reached: () => reached, release };
}
async function until(check: () => boolean, what: string) {
  const end = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('immediate query actions through the real API', () => {
  it('retains a newer confirmed RSVP when an older real HTTP acknowledgement is lost afterwards', async () => {
    const organizer = h.browser();
    const invited = h.browser();
    const address = email();
    await organizer.api.auth.signIn('sso', { email: email() });
    await invited.api.auth.signIn('sso', { email: address });
    const meeting = await organizer.api.meetings.create({
      title: 'Launch review', guests: [address], startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, notes: 'off'
    });
    let firstOperation: string | null = null;
    let acknowledged = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const delayed = h.browser({ fetch: async (input, init) => {
      const response = await invited.fetch(input, init);
      if (init?.method !== 'POST' || !String(input).endsWith('/answer')) return response;
      const operation = new Headers(init.headers).get(OPERATION_HEADER);
      firstOperation ??= operation;
      if (operation !== firstOperation) return response;
      acknowledged = true;
      await held;
      // The real server has committed this response. Losing it must not undo a later confirmed choice.
      throw new TypeError('The older response was lost on the connection.');
    } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const read = await invited.api.meetings.get(meeting.id);
    client.setQueryData(keys.session, await invited.api.auth.getSession());
    client.setQueryData(keys.meeting(meeting.id), read);
    const older = new MutationObserver(client, answerCallOptions(delayed.api, client, keys)).mutate({ id: meeting.id, answer: 'yes' }).then(() => false, () => true);
    try {
      await until(() => acknowledged, 'the first committed RSVP response');
      // Another signed-in window can confirm a newer answer while this acknowledgement is missing.
      await invited.api.meetings.answer(meeting.id, 'no');
      await client.fetchQuery({ queryKey: keys.meeting(meeting.id), queryFn: () => readMeeting(delayed.api, client, meeting.id) });
      release();
      expect(await older).toBe(true);
      expect((await invited.api.meetings.get(meeting.id)).rsvp).toBe('no');
      expect(client.getQueryData<Meeting>(keys.meeting(meeting.id))?.rsvp).toBe('no');
    } finally { release(); await older; client.clear(); }
  });

  it('projects a repeated preference choice over two older serial answers and refreshes unrelated fields', async () => {
    const browser = h.browser();
    const address = email();
    await browser.api.auth.signIn('sso', { email: address });
    const initial = await browser.api.account.preferences();
    const delayed = hold(browser, 'PATCH', '/account/preferences', 'lost');
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(delayed.api, client, keys, patch);
    const first = new MutationObserver(client, options).mutate({ notesLanguage: 'es' }).then(() => false, () => true);
    try {
      await until(delayed.reached, 'the first preference request');
      const middle = new MutationObserver(client, options).mutate({ notesLanguage: 'en' });
      const last = new MutationObserver(client, options).mutate({ notesLanguage: 'es' });
      await until(() => client.isMutating() === 3 && client.getQueryData<Preferences>(keys.prefs)?.notesLanguage === 'es', 'all three requested choices');
      // A read while the first acknowledgement is held must retain the last queued command.
      const other = h.browser();
      await other.api.auth.signIn('sso', { email: address });
      await other.api.account.updatePreferences({ recordOffline: !initial.recordOffline });
      await client.fetchQuery({ queryKey: keys.prefs, queryFn: () => readPreferences(delayed.api, client) });
      expect(client.getQueryData<Preferences>(keys.prefs)).toMatchObject({ notesLanguage: 'es', recordOffline: !initial.recordOffline });
      delayed.release();
      expect(await first).toBe(true);
      expect(client.getQueryData<Preferences>(keys.prefs)?.notesLanguage).toBe('es');
      await Promise.all([middle, last]);
      expect(await browser.api.account.preferences()).toMatchObject({ notesLanguage: 'es', recordOffline: !initial.recordOffline });
      expect(client.getQueryData<Preferences>(keys.prefs)).toMatchObject({ notesLanguage: 'es', recordOffline: !initial.recordOffline });
    } finally { delayed.release(); await first; client.clear(); }
  });

  it('preserves another client’s confirmed switches within pending sound and notification groups', async () => {
    const browser = h.browser();
    const other = h.browser();
    const address = email();
    const signed = await browser.api.auth.signIn('sso', { email: address });
    await other.api.auth.signIn('sso', { email: address });
    const initial = await browser.api.account.preferences();
    const held = hold(browser, 'PATCH', '/account/preferences', 'after');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.prefs, initial);
    const older = new MutationObserver(client, preferenceOptions(held.api, client, keys, patch)).mutate({
      sounds: { hands: !initial.sounds.hands },
      notifications: { tagged: !initial.notifications.tagged }
    });
    try {
      await until(held.reached, 'the committed grouped-preference acknowledgement');
      const current = await other.api.account.preferences();
      await other.api.account.updatePreferences({
        sounds: { ...current.sounds, questions: !initial.sounds.questions },
        notifications: { ...current.notifications, notesReady: !initial.notifications.notesReady }
      });
      await client.fetchQuery({ queryKey: keys.prefs, queryFn: () => readPreferences(browser.api, client) });
      const pending = client.getQueryData<Preferences>(keys.prefs);
      held.release();
      await older;
      const settled = client.getQueryData<Preferences>(keys.prefs);
      const persisted = await browser.api.account.preferences();
      expect(persisted).toMatchObject({ sounds: { hands: !initial.sounds.hands, questions: !initial.sounds.questions }, notifications: { tagged: !initial.notifications.tagged, notesReady: !initial.notifications.notesReady } });
      expect(pending).toMatchObject({ sounds: { questions: !initial.sounds.questions }, notifications: { notesReady: !initial.notifications.notesReady } });
      expect(settled).toMatchObject({ sounds: { questions: !initial.sounds.questions }, notifications: { notesReady: !initial.notifications.notesReady } });
    } finally { held.release(); await older; client.clear(); }
  });

  it('does not resurrect a failed earlier switch when another grouped switch was queued behind it', async () => {
    const browser = h.browser();
    const signed = await browser.api.auth.signIn('sso', { email: email() });
    const initial = await browser.api.account.preferences();
    const refused = hold(browser, 'PATCH', '/account/preferences', 'before');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(refused.api, client, keys, patch);
    const first = new MutationObserver(client, options).mutate({ sounds: { hands: !initial.sounds.hands }, notifications: { tagged: !initial.notifications.tagged } }).catch(errorCode);
    let last: Promise<Preferences> | undefined;
    try {
      await until(refused.reached, 'the first grouped request before server receipt');
      last = new MutationObserver(client, options).mutate({ sounds: { questions: !initial.sounds.questions }, notifications: { notesReady: !initial.notifications.notesReady } });
      await until(() => client.isMutating() === 2 && client.getQueryData<Preferences>(keys.prefs)?.sounds.questions === !initial.sounds.questions, 'the queued independent switches');
      refused.release();
      expect(await first).toBe('network');
      await last;
      const expected = { sounds: { hands: initial.sounds.hands, questions: !initial.sounds.questions }, notifications: { tagged: initial.notifications.tagged, notesReady: !initial.notifications.notesReady } };
      expect(await browser.api.account.preferences()).toMatchObject(expected);
      expect(client.getQueryData<Preferences>(keys.prefs)).toMatchObject(expected);
    } finally { refused.release(); await first; await last; client.clear(); }
  });

  it('owns repeated grouped leaves by command identity and keeps another client’s switch through A to B to A', async () => {
    const browser = h.browser();
    const other = h.browser();
    const address = email();
    const signed = await browser.api.auth.signIn('sso', { email: address });
    await other.api.auth.signIn('sso', { email: address });
    const initial = await browser.api.account.preferences();
    const held = hold(browser, 'PATCH', '/account/preferences', 'lost');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(held.api, client, keys, patch);
    const input: PreferenceChange = { sounds: { hands: !initial.sounds.hands } };
    const first = new MutationObserver(client, options).mutate(input).catch(errorCode);
    let middle: Promise<Preferences> | undefined;
    let last: Promise<Preferences> | undefined;
    try {
      await until(held.reached, 'the first committed grouped acknowledgement');
      if (input.sounds) input.sounds.hands = initial.sounds.hands;
      middle = new MutationObserver(client, options).mutate(input);
      await until(() => client.isMutating() === 2 && client.getQueryData<Preferences>(keys.prefs)?.sounds.hands === initial.sounds.hands, 'the repeated middle switch');
      if (input.sounds) input.sounds.hands = !initial.sounds.hands;
      last = new MutationObserver(client, options).mutate(input);
      await until(() => client.isMutating() === 3 && client.getQueryData<Preferences>(keys.prefs)?.sounds.hands === !initial.sounds.hands, 'the repeated last switch');
      if (input.sounds) input.sounds.hands = initial.sounds.hands;
      const current = await other.api.account.preferences();
      await other.api.account.updatePreferences({ sounds: { ...current.sounds, questions: !initial.sounds.questions } });
      await client.fetchQuery({ queryKey: keys.prefs, queryFn: () => readPreferences(browser.api, client) });
      expect(client.getQueryData<Preferences>(keys.prefs)?.sounds).toMatchObject({ hands: !initial.sounds.hands, questions: !initial.sounds.questions });
      held.release();
      expect(await first).toBe('network');
      await Promise.all([middle, last]);
      expect((await browser.api.account.preferences()).sounds).toMatchObject({ hands: !initial.sounds.hands, questions: !initial.sounds.questions });
      expect(client.getQueryData<Preferences>(keys.prefs)?.sounds).toMatchObject({ hands: !initial.sounds.hands, questions: !initial.sounds.questions });
    } finally { held.release(); await first; await middle; await last; client.clear(); }
  });

  it('rechecks the actual original session after grouped materialization and refuses a replacement cookie session', async () => {
    const browser = h.browser();
    const address = email();
    const signed = await browser.api.auth.signIn('sso', { email: address });
    const initial = await browser.api.account.preferences();
    let writes = 0;
    const counted = h.browser({ fetch: (input, init) => {
      if (init?.method === 'PATCH' && String(input).endsWith('/account/preferences')) writes++;
      return browser.fetch(input, init);
    } });
    const held = hold(counted, 'GET', '/account/preferences', 'after');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.prefs, initial);
    const pending = new MutationObserver(client, preferenceOptions(held.api, client, keys, patch)).mutate({ sounds: { hands: !initial.sounds.hands } }).catch(errorCode);
    try {
      await until(held.reached, 'the grouped authoritative read before PATCH');
      await browser.api.auth.signOut();
      const replacement = await browser.api.auth.signIn('sso', { email: address });
      expect(replacement.session.createdAt).not.toBe(signed.session.createdAt);
      // The local query deliberately still names the old session: only the extra actual-session check can refuse this.
      held.release();
      expect(await pending).toBe('forbidden');
      expect(writes).toBe(0);
      expect((await browser.api.account.preferences()).sounds).toEqual(initial.sounds);
      expect(client.getQueryData<Preferences>(keys.prefs)?.sounds).toEqual(initial.sounds);
    } finally { held.release(); await pending; client.clear(); }
  });

  it('rolls two refused preference writes back to confirmed data and permits a deliberate retry', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const initial = await browser.api.account.preferences();
    let refusing = true;
    let writes = 0;
    const unreliable = h.browser({ fetch: (input, init) => {
      if (init?.method === 'PATCH' && String(input).endsWith('/account/preferences')) {
        writes++;
        if (refusing) return Promise.reject(new TypeError('The connection is unavailable.'));
      }
      return browser.fetch(input, init);
    } });
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(unreliable.api, client, keys, patch);
    try {
      const a = new MutationObserver(client, options).mutate({ notesLanguage: 'es' }).catch(errorCode);
      const b = new MutationObserver(client, options).mutate({ notesLanguage: 'en' }).catch(errorCode);
      expect(await Promise.all([a, b])).toEqual(['network', 'network']);
      expect(client.getQueryData<Preferences>(keys.prefs)).toEqual(initial);
      expect(await browser.api.account.preferences()).toEqual(initial);
      expect(writes).toBe(2);
      refusing = false;
      await new MutationObserver(client, options).mutate({ notesLanguage: 'es' });
      expect((await browser.api.account.preferences()).notesLanguage).toBe('es');
      expect(client.getQueryData<Preferences>(keys.prefs)?.notesLanguage).toBe('es');
    } finally { client.clear(); }
  });

  it('shows pausing notifications and resuming them at once, and puts the pause back when resuming is refused', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const initial = await browser.api.account.preferences();
    const ends = new Date(Date.now() + 60 * 60_000).toISOString();
    const held = hold(browser, 'PATCH', '/account/preferences', 'dispatch');
    let refusing = false;
    const unreliable = h.browser({ fetch: (input, init) => refusing && init?.method === 'PATCH' && String(input).endsWith('/account/preferences')
      ? Promise.reject(new TypeError('The connection is unavailable.')) : browser.fetch(input, init) });
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, initial);
    // As the app's usePauseNotifications asks: a time, or null to resume.
    const pause = ({ until: at }: { until: string | null }): PreferenceChange => ({ notificationsPausedUntil: at });
    const paused = () => client.getQueryData<Preferences>(keys.prefs)?.notificationsPausedUntil;
    try {
      const pausing = new MutationObserver(client, preferenceOptions(held.api, client, keys, pause)).mutate({ until: ends });
      await until(held.reached, 'the pause on its way');
      expect(paused()).toBe(ends);
      expect((await browser.api.account.preferences()).notificationsPausedUntil).toBeNull();
      held.release();
      expect((await pausing).notificationsPausedUntil).toBe(ends);
      expect(await browser.api.account.preferences()).toEqual({ ...initial, notificationsPausedUntil: ends });
      refusing = true;
      const resuming = new MutationObserver(client, preferenceOptions(unreliable.api, client, keys, pause)).mutate({ until: null }).catch(errorCode);
      await until(() => paused() === null, 'resuming shown');
      expect(await resuming).toBe('network');
      expect(paused()).toBe(ends);
      expect((await browser.api.account.preferences()).notificationsPausedUntil).toBe(ends);
      refusing = false;
      await new MutationObserver(client, preferenceOptions(unreliable.api, client, keys, pause)).mutate({ until: null });
      expect(paused()).toBeNull();
      expect(await browser.api.account.preferences()).toEqual(initial);
    } finally { held.release(); client.clear(); }
  });

  it.each(['different account', 'same account'] as const)('refuses queued old-session writes and cache settlement after signing in to the %s', async (mode) => {
    const browser = h.browser();
    const oldAddress = email();
    await browser.api.auth.signIn('sso', { email: oldAddress });
    const initial = await browser.api.account.preferences();
    const delayed = hold(browser, 'PATCH', '/account/preferences', 'after');
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(delayed.api, client, keys, patch);
    const first = new MutationObserver(client, options).mutate({ notesLanguage: 'es' });
    let queued: Promise<string | Preferences> | undefined;
    try {
      await until(delayed.reached, 'the old account request');
      queued = new MutationObserver(client, options).mutate({ recordOffline: !initial.recordOffline }).catch(errorCode);
      await until(() => client.isMutating() === 2, 'the queued preference');
      await browser.api.auth.signOut();
      const signed = await browser.api.auth.signIn('sso', { email: mode === 'same account' ? oldAddress : email() });
      if (mode === 'different account') client.clear();
      client.setQueryData(keys.session, signed.session);
      const fresh = await browser.api.account.preferences();
      client.setQueryData(keys.prefs, fresh);
      const painted: Preferences[] = [];
      const stop = client.getQueryCache().subscribe(() => { const prefs = client.getQueryData<Preferences>(keys.prefs); if (prefs) painted.push(prefs); });
      delayed.release();
      try { await first; expect(await queued).toBe('forbidden'); }
      finally { stop(); }
      expect(painted.every((prefs) => JSON.stringify(prefs) === JSON.stringify(fresh))).toBe(true);
      expect(client.getQueryData(keys.prefs)).toEqual(fresh);
      expect(await browser.api.account.preferences()).toEqual(fresh);
      const old = h.browser();
      await old.api.auth.signIn('sso', { email: oldAddress });
      expect(await old.api.account.preferences()).toMatchObject({ notesLanguage: 'es', recordOffline: initial.recordOffline });
    } finally { delayed.release(); await first; await queued; client.clear(); }
  });

  it('dispatches rapid RSVPs in intent order even when the first request has not reached the server', async () => {
    const organizer = h.browser();
    const invited = h.browser();
    const other = h.browser();
    const address = email();
    const otherAddress = email();
    await organizer.api.auth.signIn('sso', { email: email() });
    await invited.api.auth.signIn('sso', { email: address });
    await other.api.auth.signIn('sso', { email: otherAddress });
    const meeting = await organizer.api.meetings.create({ title: 'Design review', guests: [address, otherAddress], startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30, notes: 'off' });
    const delayed = hold(invited, 'POST', '/answer', 'dispatch');
    const client = queryClient();
    client.setQueryData(keys.session, await invited.api.auth.getSession());
    client.setQueryData(keys.meeting(meeting.id), await invited.api.meetings.get(meeting.id));
    const options = answerCallOptions(delayed.api, client, keys);
    const first = new MutationObserver(client, options).mutate({ id: meeting.id, answer: 'yes' });
    try {
      await until(delayed.reached, 'the held RSVP');
      await other.api.meetings.answer(meeting.id, 'yes');
      await organizer.api.meetings.update(meeting.id, { title: 'Final design review' });
      const middle = new MutationObserver(client, options).mutate({ id: meeting.id, answer: 'no' });
      const last = new MutationObserver(client, options).mutate({ id: meeting.id, answer: 'yes' });
      await until(() => client.isMutating() === 3, 'all rapid RSVP intents');
      await client.fetchQuery({ queryKey: keys.meeting(meeting.id), queryFn: () => readMeeting(delayed.api, client, meeting.id) });
      delayed.release();
      await Promise.all([first, middle, last]);
      expect(client.getQueryData<Meeting>(keys.meeting(meeting.id))).toMatchObject({ title: 'Final design review', rsvp: 'yes', rsvps: { yes: 2, no: 0, waiting: 0 } });
      expect(await invited.api.meetings.get(meeting.id)).toMatchObject({ title: 'Final design review', rsvp: 'yes', rsvps: { yes: 2, no: 0, waiting: 0 } });
    } finally { delayed.release(); await first; client.clear(); }
  });

  it('shows workspace renames before their response and keeps a newer saved name after an older lost response', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const space = await browser.api.workspaces.create('Planning');
    const delayed = hold(browser, 'PATCH', `/workspaces/${space.id}`, 'lost');
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.workspaces, await browser.api.workspaces.list());
    const options = renameWorkspaceOptions(delayed.api, client, keys);
    const first = new MutationObserver(client, options).mutate({ id: space.id, name: 'Draft plan' }).catch(errorCode);
    try {
      await until(delayed.reached, 'the held workspace response');
      expect(client.getQueryData<WorkspaceSummary[]>(keys.workspaces)?.find((w) => w.id === space.id)?.name).toBe('Draft plan');
      const last = new MutationObserver(client, options).mutate({ id: space.id, name: 'Final plan' });
      await until(() => client.getQueryData<WorkspaceSummary[]>(keys.workspaces)?.find((w) => w.id === space.id)?.name === 'Final plan', 'the latest pending workspace name');
      delayed.release();
      expect(await first).toBe('network');
      await last;
      expect((await browser.api.workspaces.get(space.id)).name).toBe('Final plan');
      await client.fetchQuery({ queryKey: keys.workspaces, queryFn: () => readWorkspaces(delayed.api, client) });
      expect(client.getQueryData<WorkspaceSummary[]>(keys.workspaces)?.find((w) => w.id === space.id)?.name).toBe('Final plan');
    } finally { delayed.release(); await first; client.clear(); }
  });

  it('projects a real follow-up tick in note and inbox, then preserves a newer untick and unrelated follow-up', async () => {
    const browser = h.browser();
    const signed = await browser.api.auth.signIn('sso', { email: email() });
    const call = await browser.api.calls.join((await browser.api.calls.startNow({ notes: 'on', guests: [] })).code, { mic: true, cam: false });
    await call.transcribe({ data: new Blob([speechWav('We reviewed the launch plan.')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 }, call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    for await (const progress of browser.api.notes.progress(noteId)) if (progress.ready) break;
    await browser.api.notes.proposeAction(noteId, { text: 'Send the plan', owner: signed.session.user.email });
    const note = await browser.api.notes.proposeAction(noteId, { text: 'Update the checklist', owner: signed.session.user.email });
    const action = note.actions.find((a) => a.text === 'Send the plan');
    const other = note.actions.find((a) => a.text === 'Update the checklist');
    if (!action || !other) throw new Error('The API did not create both follow-ups.');
    const delayed = hold(browser, 'PATCH', `/notes/${noteId}/actions/${action.id}`, 'lost');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.note(noteId), note);
    client.setQueryData(keys.inbox, await browser.api.notes.inbox());
    const options = updateActionOptions(delayed.api, client, keys);
    const first = new MutationObserver(client, options).mutate({ noteId, actionId: action.id, patch: { done: true } }).catch(errorCode);
    try {
      await until(delayed.reached, 'the held follow-up acknowledgement');
      expect(client.getQueryData<Note>(keys.note(noteId))?.actions.find((a) => a.id === action.id)?.done).toBe(true);
      expect(client.getQueryData<Inbox>(keys.inbox)?.followUps.find((a) => a.id === action.id)?.done).toBe(true);
      await browser.api.notes.updateAction(noteId, action.id, { text: 'Send the final plan' });
      await browser.api.notes.updateAction(noteId, action.id, { done: false });
      await browser.api.notes.updateAction(noteId, other.id, { done: true });
      await client.fetchQuery({ queryKey: keys.note(noteId), queryFn: () => readNote(delayed.api, client, noteId) });
      delayed.release();
      expect(await first).toBe('network');
      const projected = client.getQueryData<Note>(keys.note(noteId));
      expect(projected?.actions.find((a) => a.id === action.id)).toMatchObject({ text: 'Send the final plan', done: false });
      expect(projected?.actions.find((a) => a.id === other.id)?.done).toBe(true);
      const persisted = await browser.api.notes.get(noteId);
      expect(persisted.actions.find((a) => a.id === action.id)).toMatchObject({ text: 'Send the final plan', done: false });
      expect(persisted.actions.find((a) => a.id === other.id)?.done).toBe(true);
      const waiting = hold(browser, 'PATCH', `/notes/${noteId}/actions/${action.id}`, 'dispatch');
      const queuedOptions = updateActionOptions(waiting.api, client, keys);
      const tick = new MutationObserver(client, queuedOptions).mutate({ noteId, actionId: action.id, patch: { done: true } });
      await until(waiting.reached, 'the follow-up request before server receipt');
      const untick = new MutationObserver(client, queuedOptions).mutate({ noteId, actionId: action.id, patch: { done: false } });
      await until(() => client.isMutating() === 2 && client.getQueryData<Note>(keys.note(noteId))?.actions.find((a) => a.id === action.id)?.done === false, 'the queued untick');
      waiting.release();
      await Promise.all([tick, untick]);
      expect((await browser.api.notes.get(noteId)).actions.find((a) => a.id === action.id)?.done).toBe(false);
      await new MutationObserver(client, options).mutate({ noteId, actionId: other.id, patch: { due: 'Friday' } });
      expect(client.getQueryData<Note>(keys.note(noteId))?.actions.find((a) => a.id === other.id)).toMatchObject({ done: true, due: 'Friday' });
    } finally { delayed.release(); await first; client.clear(); }
  });

  it('keeps a newer confirmed follow-up tick when an older decision acknowledgement returns a stale whole-note snapshot', async () => {
    const browser = h.browser();
    const signed = await browser.api.auth.signIn('sso', { email: email() });
    const call = await browser.api.calls.join((await browser.api.calls.startNow({ notes: 'on', guests: [] })).code, { mic: true, cam: false });
    await call.transcribe({ data: new Blob([speechWav('We agreed to keep the launch plan.')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 }, call.ticket.identity);
    const noteId = (await call.leave())?.pendingNoteId ?? '';
    for await (const progress of browser.api.notes.progress(noteId)) if (progress.ready) break;
    const note = await browser.api.notes.proposeAction(noteId, { text: 'Send the launch plan', owner: signed.session.user.email });
    const action = note.actions.find((a) => a.text === 'Send the launch plan');
    const decision = note.decisions.find((d) => d.text.includes('keep the launch plan'));
    if (!action || !decision) throw new Error('The real call did not create its decision and follow-up.');
    const held = hold(browser, 'PATCH', `/notes/${noteId}/decisions/${decision.id}`, 'after');
    const client = queryClient();
    client.setQueryData(keys.session, signed.session);
    client.setQueryData(keys.note(noteId), note);
    const older = new MutationObserver(client, updateDecisionOptions(held.api, client, keys)).mutate({ noteId, decisionId: decision.id, patch: { state: 'confirmed', seen: { text: decision.text } } });
    try {
      await until(held.reached, 'the older committed decision acknowledgement');
      expect(client.getQueryData<Note>(keys.note(noteId))?.decisions.find((d) => d.id === decision.id)?.state).toBe('proposed');
      await new MutationObserver(client, updateActionOptions(browser.api, client, keys)).mutate({ noteId, actionId: action.id, patch: { done: true } });
      expect(client.getQueryData<Note>(keys.note(noteId))?.actions.find((a) => a.id === action.id)?.done).toBe(true);
      expect((await browser.api.notes.get(noteId)).actions.find((a) => a.id === action.id)?.done).toBe(true);
      held.release();
      await older;
      const persisted = await browser.api.notes.get(noteId);
      expect(persisted.decisions.find((d) => d.id === decision.id)?.state).toBe('confirmed');
      expect(persisted.actions.find((a) => a.id === action.id)?.done).toBe(true);
      expect(client.getQueryData<Note>(keys.note(noteId))?.decisions.find((d) => d.id === decision.id)?.state).toBe('confirmed');
      expect(client.getQueryData<Note>(keys.note(noteId))?.actions.find((a) => a.id === action.id)?.done).toBe(true);
    } finally { held.release(); await older; client.clear(); }
  });

  it('captures queued nested preference commands when the caller reuses and later changes its variables object', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const initial = await browser.api.account.preferences();
    const delayed = hold(browser, 'PATCH', '/account/preferences', 'dispatch');
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, initial);
    const options = preferenceOptions(delayed.api, client, keys, patch);
    const input: Patch<Preferences> = { notesLanguage: 'es', notifications: { ...initial.notifications, tagged: false } };
    const first = new MutationObserver(client, options).mutate(input);
    let last: Promise<Preferences> | undefined;
    try {
      await until(delayed.reached, 'the first immutable command');
      input.notesLanguage = 'en';
      if (input.notifications) input.notifications.tagged = true;
      last = new MutationObserver(client, options).mutate(input);
      await until(() => client.getQueryData<Preferences>(keys.prefs)?.notesLanguage === 'en', 'the second immutable command');
      input.notesLanguage = 'es';
      if (input.notifications) input.notifications.tagged = false;
      delayed.release();
      await Promise.all([first, last]);
      expect(await browser.api.account.preferences()).toMatchObject({ notesLanguage: 'en', notifications: { tagged: true } });
      expect(client.getQueryData<Preferences>(keys.prefs)).toMatchObject({ notesLanguage: 'en', notifications: { tagged: true } });
    } finally { delayed.release(); await first; await last; client.clear(); }
  });

  it('keeps a newer confirmed document name over an older pending command while the real workspace stream advances', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const space = await browser.api.workspaces.create('Working files');
    const item = await browser.api.workspaces.items.create(space.id, { kind: 'document', name: 'Original' });
    const stream = browser.api.workspaces.live(space.id);
    await until(() => !!stream.getSnapshot().tree?.items.some((i) => i.id === item.id), 'the real workspace stream');
    const owner = new TreeChanges(stream);
    const stop = owner.subscribe(() => {});
    const delayed = hold(browser, 'PATCH', `/workspaces/${space.id}/items/${item.id}`, 'lost');
    const first = owner.change({ kind: 'name', id: item.id, name: 'Earlier' }, () => delayed.api.workspaces.items.rename(space.id, item.id, 'Earlier')).catch(errorCode);
    try {
      await until(delayed.reached, 'the earlier real rename acknowledgement');
      const last = owner.change({ kind: 'name', id: item.id, name: 'Latest' }, () => browser.api.workspaces.items.rename(space.id, item.id, 'Latest'));
      // Last intent is already visible while its ordered request waits for the earlier acknowledgement.
      await new Promise<void>((resolve) => setTimeout(resolve, 2100));
      expect(owner.getSnapshot().find((i) => i.id === item.id)?.name).toBe('Latest');
      delayed.release();
      expect(await first).toBe('network');
      await last;
      await until(() => stream.getSnapshot().tree?.items.find((i) => i.id === item.id)?.name === 'Latest', 'the latest confirmed stream name');
      expect(owner.getSnapshot().find((i) => i.id === item.id)?.name).toBe('Latest');
      expect((await browser.api.workspaces.get(space.id)).items.find((i) => i.id === item.id)?.name).toBe('Latest');
    } finally { delayed.release(); await first; stop(); owner.close(); stream.close(); }
  });

  it('ignores a canceled old HTTP read after a newer authoritative read and a later failed change', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, await browser.api.account.preferences());
    const options = preferenceOptions(browser.api, client, keys, patch);
    await new MutationObserver(client, options).mutate({ notesLanguage: 'es' });
    const old = hold(browser, 'GET', '/account/preferences', 'after');
    let readFinished = false;
    const read = client.fetchQuery({ queryKey: keys.prefs, queryFn: async () => {
      try { return await readPreferences(old.api, client); } finally { readFinished = true; }
    } }).catch(() => undefined);
    let failed: Promise<string | Preferences> | undefined;
    const refused = hold(browser, 'PATCH', '/account/preferences', 'before');
    try {
      await until(old.reached, 'the old real HTTP read');
      await new MutationObserver(client, options).mutate({ notesLanguage: 'en' });
      await client.fetchQuery({ queryKey: keys.prefs, queryFn: () => readPreferences(browser.api, client) });
      failed = new MutationObserver(client, preferenceOptions(refused.api, client, keys, patch)).mutate({ notesLanguage: 'es' }).catch(errorCode);
      await until(refused.reached, 'the unconfirmed later preference');
      old.release();
      await until(() => readFinished, 'the canceled read to finish without changing confirmed data');
      refused.release();
      expect(await failed).toBe('network');
      expect(client.getQueryData<Preferences>(keys.prefs)?.notesLanguage).toBe('en');
      expect((await browser.api.account.preferences()).notesLanguage).toBe('en');
    } finally { old.release(); refused.release(); await read; await failed; client.clear(); }
  });

  it('keeps the same command when a rendered hook replaces mutation options during optimistic publication', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const client = queryClient();
    client.setQueryData(keys.session, await browser.api.auth.getSession());
    client.setQueryData(keys.prefs, await browser.api.account.preferences());
    const observer = new MutationObserver(client, preferenceOptions(browser.api, client, keys, patch));
    let replaced = false;
    const stop = client.getQueryCache().subscribe(() => {
      if (replaced || client.getQueryData<Preferences>(keys.prefs)?.notesLanguage !== 'es') return;
      replaced = true;
      observer.setOptions(preferenceOptions(browser.api, client, keys, patch));
    });
    try {
      await observer.mutate({ notesLanguage: 'es' });
      expect(replaced).toBe(true);
      expect((await browser.api.account.preferences()).notesLanguage).toBe('es');
      expect(client.getQueryData<Preferences>(keys.prefs)?.notesLanguage).toBe('es');
    } finally { stop(); client.clear(); }
  });

  it('refuses an offline protected delete without pausing or replaying, and still enforces access on explicit retry', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const stranger = h.browser();
    await stranger.api.auth.signIn('sso', { email: email() });
    const space = await browser.api.workspaces.create('Deletion review');
    const item = await browser.api.workspaces.items.create(space.id, { kind: 'document', name: 'To remove' });
    await browser.api.workspaces.items.trash(space.id, item.id);
    let attempts = 0;
    const disconnected = h.browser({ fetch: (input, init) => {
      if (init?.method === 'DELETE' && String(input).endsWith(`/items/${item.id}`)) { attempts++; return Promise.reject(new TypeError('The connection is unavailable.')); }
      return browser.fetch(input, init);
    } });
    const client = queryClient();
    const remove = new MutationObserver(client, { mutationFn: () => disconnected.api.workspaces.items.deleteForever(space.id, item.id) });
    try {
      onlineManager.setOnline(false);
      expect(await remove.mutate().catch(errorCode)).toBe('network');
      expect(remove.getCurrentResult().isPaused).toBe(false);
      expect((await browser.api.workspaces.get(space.id)).items.some((i) => i.id === item.id)).toBe(true);
      onlineManager.setOnline(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(attempts).toBe(1);
      remove.setOptions({ mutationFn: () => stranger.api.workspaces.items.deleteForever(space.id, item.id) });
      expect(await remove.mutate().catch(errorCode)).toBe('not-found');
      expect((await browser.api.workspaces.get(space.id)).items.some((i) => i.id === item.id)).toBe(true);
      remove.setOptions({ mutationFn: () => browser.api.workspaces.items.deleteForever(space.id, item.id) });
      await remove.mutate();
      expect((await browser.api.workspaces.get(space.id)).items.some((i) => i.id === item.id)).toBe(false);
    } finally { onlineManager.setOnline(true); client.clear(); }
  });

  it('revokes old queued tree work when switching workspace stores while a real acknowledgement is held', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: email() });
    const oldSpace = await browser.api.workspaces.create('Original workspace');
    const newSpace = await browser.api.workspaces.create('Next workspace');
    const oldItem = await browser.api.workspaces.items.create(oldSpace.id, { kind: 'document', name: 'Original document' });
    const newItem = await browser.api.workspaces.items.create(newSpace.id, { kind: 'document', name: 'Next document' });
    const oldStream = browser.api.workspaces.live(oldSpace.id);
    const newStream = browser.api.workspaces.live(newSpace.id);
    await until(() => !!oldStream.getSnapshot().tree && !!newStream.getSnapshot().tree, 'both real workspace stores');
    const oldOwner = new TreeChanges(oldStream);
    const newOwner = new TreeChanges(newStream);
    const stopOld = oldOwner.subscribe(() => {});
    const stopNew = newOwner.subscribe(() => {});
    const held = hold(browser, 'PATCH', `/workspaces/${oldSpace.id}/items/${oldItem.id}`, 'after');
    const first = oldOwner.change({ kind: 'name', id: oldItem.id, name: 'Confirmed original edit' }, () => held.api.workspaces.items.rename(oldSpace.id, oldItem.id, 'Confirmed original edit'));
    let queued: Promise<string | void> | undefined;
    let dispatched = 0;
    try {
      await until(held.reached, 'the old workspace acknowledgement');
      queued = oldOwner.change({ kind: 'name', id: oldItem.id, name: 'Canceled old edit' }, () => { dispatched++; return browser.api.workspaces.items.rename(oldSpace.id, oldItem.id, 'Canceled old edit'); }).catch(errorCode);
      oldOwner.close(); oldStream.close();
      await newOwner.change({ kind: 'name', id: newItem.id, name: 'New workspace edit' }, () => browser.api.workspaces.items.rename(newSpace.id, newItem.id, 'New workspace edit'));
      held.release();
      await first;
      expect(await queued).toBe('forbidden');
      expect(dispatched).toBe(0);
      expect((await browser.api.workspaces.get(oldSpace.id)).items.find((i) => i.id === oldItem.id)?.name).toBe('Confirmed original edit');
      expect((await browser.api.workspaces.get(newSpace.id)).items.find((i) => i.id === newItem.id)?.name).toBe('New workspace edit');
    } finally { held.release(); await first; await queued; stopOld(); stopNew(); oldOwner.close(); newOwner.close(); oldStream.close(); newStream.close(); }
  });
});

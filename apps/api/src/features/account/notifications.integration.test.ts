import { PreferencesSchema } from '@alcove/api';
import { z } from 'zod';
import { openOwner } from '../../owners';
import { listItems, saveRevision } from '../../vault';
import { Profile } from './account';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

describe('browser notification preferences', () => {
  it('refuses incomplete previous-release preference groups instead of applying stored upgrade defaults to an explicit request', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `old-input.${Date.now()}@tests.example` });
    const initial = await browser.api.account.preferences();
    expect(initial.notifications.enabled).toBe(false);
    const oldNotifications = { beforeCall: 1, notesReady: false, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true };
    const notificationResponse = await browser.fetch(`${h.baseUrl}/v1/account/preferences`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notifications: oldNotifications })
    });
    expect(notificationResponse.status).toBe(400);
    expect(await browser.api.account.preferences()).toEqual(initial);
    // The release before the Alert ticks sent its own switches and no ringing: a tab still open on it can't save a group.
    const previousGroup = {
      enabled: false, privateMessages: false, replies: false, replyAlerts: true, chatMentions: false, mentionAlerts: true, hands: false, questions: false,
      admissions: false, timers: false, beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true
    };
    const previousResponse = await browser.fetch(`${h.baseUrl}/v1/account/preferences`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notifications: previousGroup })
    });
    expect(previousResponse.status).toBe(400);
    expect(await browser.api.account.preferences()).toEqual(initial);
    const soundResponse = await browser.fetch(`${h.baseUrl}/v1/account/preferences`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sounds: { enabled: false } })
    });
    expect(soundResponse.status).toBe(400);
    expect(await browser.api.account.preferences()).toEqual(initial);
  });
  it('opens a previous release’s sealed notification choices without losing its explicit category settings', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `upgrade.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    const previous = Profile.extend({ preferences: PreferencesSchema.extend({ notifications: z.object({
      beforeCall: z.union([z.literal(0), z.literal(1), z.literal(5)]), notesReady: z.boolean(), sharedWithYou: z.boolean(),
      notesRequested: z.boolean(), followUpDue: z.boolean(), tagged: z.boolean()
    }) }) });
    const [item] = await listItems(owner, h.pool, 'profile', previous);
    if (!item) throw new Error('No profile to upgrade');
    const choices = { beforeCall: 0, notesReady: false, sharedWithYou: true, notesRequested: false, followUpDue: true, tagged: false };
    await saveRevision(owner, h.pool, item.itemId, item.revisionId, { ...item.manifest, preferences: { ...item.manifest.preferences, notifications: choices } });
    const prefs = await browser.api.account.preferences();
    // Its reply and mention alerts were on (they had no switch yet), so their Alert ticks are; rings reach it too.
    expect(prefs.notifications).toEqual({ ...choices, enabled: true, privateMessages: false, replies: true, chatMentions: true, hands: false, questions: false, admissions: false, timers: false, ringing: true, plan: true });
    const saved = await browser.api.account.updatePreferences({ notifications: { ...prefs.notifications, enabled: false } });
    expect(saved.notifications).toMatchObject({ ...choices, enabled: false });
    expect((await browser.api.account.preferences()).notifications).toEqual(saved.notifications);
  });
  it('keeps writing and sending the summary length a profile had, for the release before', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `summary.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    // The release before opens a profile, and parses the preferences it's sent, only with a summary length.
    const previousPreferences = PreferencesSchema.extend({ summaryLength: z.enum(['short', 'detailed']) });
    const previous = Profile.extend({ preferences: previousPreferences });
    const [fresh] = await listItems(owner, h.pool, 'profile', previous);
    if (!fresh) throw new Error('No profile to read');
    expect(fresh.manifest.preferences.summaryLength).toBe('short');
    await saveRevision(owner, h.pool, fresh.itemId, fresh.revisionId, { ...fresh.manifest, preferences: { ...fresh.manifest.preferences, summaryLength: 'detailed' } });
    // It isn't a choice any more, but a tab on the release before (open since, or served while the API deploys) reads
    // preferences only with it, so both answers still carry it, as the profile has it. It goes from the wire in the next
    // release, together with the stored field.
    const read = await browser.fetch(`${h.baseUrl}/v1/account/preferences`);
    expect(read.status).toBe(200);
    expect(previousPreferences.parse(await read.json()).summaryLength).toBe('detailed');
    const saved = await browser.fetch(`${h.baseUrl}/v1/account/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notesLanguage: 'fr', summaryLength: 'short' }) });
    expect(saved.status).toBe(200);
    // What that tab sends for it changes nothing: the answer says what the profile still has.
    expect(previousPreferences.parse(await saved.json())).toMatchObject({ notesLanguage: 'fr', summaryLength: 'detailed' });
    // This release's client doesn't declare it, so it never reaches the app.
    expect(await browser.api.account.preferences()).not.toHaveProperty('summaryLength');
    // Saved after the change, the profile still opens for the release before, with what it said.
    const [after] = await listItems(owner, h.pool, 'profile', previous);
    expect(after?.manifest.preferences).toMatchObject({ notesLanguage: 'fr', summaryLength: 'detailed' });
  });
  it('folds a previous release’s call alert switches into their Alert ticks, then saves the record without them', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `folded.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    const stored = z.object({ preferences: z.object({ notifications: z.record(z.string(), z.unknown()) }) });
    const [item] = await listItems(owner, h.pool, 'profile', Profile);
    if (!item) throw new Error('No profile to upgrade');
    // Reply alerts on with the browser's replies off; mention alerts off with its mentions off; the browser's hands on.
    const choices = { enabled: true, privateMessages: false, replies: false, replyAlerts: true, chatMentions: false, mentionAlerts: false, hands: true, questions: false,
      admissions: false, timers: true, beforeCall: 1, notesReady: false, sharedWithYou: true, notesRequested: true, followUpDue: true, tagged: false };
    await saveRevision(owner, h.pool, item.itemId, item.revisionId, { ...item.manifest, preferences: { ...item.manifest.preferences, notifications: choices } });
    const prefs = await browser.api.account.preferences();
    expect(prefs.notifications).toEqual({ enabled: true, privateMessages: false, replies: true, chatMentions: false, hands: true, questions: false, admissions: false,
      timers: true, ringing: true, beforeCall: 1, notesReady: false, sharedWithYou: true, notesRequested: true, followUpDue: true, tagged: false, plan: true });
    // Reading alone doesn't write: the sealed record keeps the previous release's shape until something is saved.
    expect((await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences.notifications).toMatchObject({ replyAlerts: true, mentionAlerts: false });
    await browser.api.account.updatePreferences({ notesLanguage: 'fr' });
    const written = (await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences.notifications;
    expect(written).toEqual(prefs.notifications);
    expect(written).not.toHaveProperty('replyAlerts'); expect(written).not.toHaveProperty('mentionAlerts');
    // Written in the new shape, an Alert turned off stays off: nothing is folded in again.
    const quiet = await browser.api.account.updatePreferences({ notifications: { ...prefs.notifications, replies: false, ringing: false } });
    expect(quiet.notifications).toMatchObject({ replies: false, chatMentions: false, ringing: false });
    expect((await browser.api.account.preferences()).notifications).toEqual(quiet.notifications);
  });
  it('keeps a previous release’s call alerts that were off, and the browser categories that were on, through the fold', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `kept.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    const seal = async (notifications: Record<string, unknown>) => {
      const [item] = await listItems(owner, h.pool, 'profile', Profile);
      if (!item) throw new Error('No profile to upgrade');
      await saveRevision(owner, h.pool, item.itemId, item.revisionId, { ...item.manifest, preferences: { ...item.manifest.preferences, notifications } });
    };
    const kept = { beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true };
    // From before the browser's categories: both call alerts turned off, and no replies or chatMentions at all.
    await seal({ ...kept, replyAlerts: false, mentionAlerts: false });
    expect((await browser.api.account.preferences()).notifications).toEqual({ ...kept, enabled: true, privateMessages: false, replies: false, chatMentions: false,
      hands: false, questions: false, admissions: false, timers: false, ringing: true, plan: true });
    // The browser's replies and mentions on, the call's alerts for them off: the Alert ticks stay on.
    await seal({ ...kept, enabled: true, privateMessages: false, replies: true, replyAlerts: false, chatMentions: true, mentionAlerts: false, hands: false, questions: false, admissions: false, timers: false });
    expect((await browser.api.account.preferences()).notifications).toMatchObject({ replies: true, chatMentions: true });
  });
  it('starts opted out, remembers categories independently of sound, and disables globally without losing choices', async () => {
    const browser = h.browser();
    const email = `notifications.${Date.now()}@tests.example`;
    await browser.api.auth.signIn('sso', { email });
    const initial = await browser.api.account.preferences();
    expect(initial.notifications).toEqual({
      enabled: false, privateMessages: true, replies: true, chatMentions: true, hands: true, questions: false, admissions: true, timers: true, ringing: true,
      beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true, plan: true
    });
    const notifications = { ...initial.notifications, enabled: true, privateMessages: false, questions: true, ringing: false };
    await browser.api.account.updatePreferences({ notifications });
    const anotherTab = h.browser();
    await anotherTab.api.auth.signIn('sso', { email });
    const saved = await anotherTab.api.account.preferences();
    expect(saved.notifications).toEqual(notifications);
    expect(saved.sounds).toEqual(initial.sounds);
    const disabled = { ...saved.notifications, enabled: false };
    await anotherTab.api.account.updatePreferences({ notifications: disabled });
    expect((await browser.api.account.preferences()).notifications).toEqual(disabled);
    const other = h.browser();
    await other.api.auth.signIn('sso', { email: `other.${Date.now()}@tests.example` });
    expect((await other.api.account.preferences()).notifications).toMatchObject({ enabled: false, privateMessages: true, questions: false, ringing: true });
  });
  it('pauses notifications for the account until a time, keeps the pause through other changes, and resumes', async () => {
    const browser = h.browser();
    const email = `paused.${Date.now()}@tests.example`;
    await browser.api.auth.signIn('sso', { email });
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBeNull();
    const until = new Date(Date.now() + 60 * 60_000).toISOString();
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: until })).notificationsPausedUntil).toBe(until);
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBe(until);
    // The pause is the account's, so every device signed in has it; a change that leaves it out, from any of them, keeps it.
    const anotherDevice = h.browser();
    await anotherDevice.api.auth.signIn('sso', { email });
    expect((await anotherDevice.api.account.preferences()).notificationsPausedUntil).toBe(until);
    expect(await anotherDevice.api.account.updatePreferences({ notesLanguage: 'fr' })).toMatchObject({ notesLanguage: 'fr', notificationsPausedUntil: until });
    expect(await browser.api.account.preferences()).toMatchObject({ notesLanguage: 'fr', notificationsPausedUntil: until });
    // Only a date-time with its offset is taken. Anything else is refused and changes nothing.
    const patchRaw = async (body: unknown) => (await browser.fetch(`${h.baseUrl}/v1/account/preferences`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    })).status;
    for (const refused of ['tomorrow', '2026-11-13', '2026-11-13T09:00:00', Date.now() + 60_000]) expect(await patchRaw({ notificationsPausedUntil: refused })).toBe(400);
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBe(until);
    // Whatever time it's given is kept as given: another device's own offset, or a time already past (which pauses nothing).
    const theirs = '2026-11-13T09:00:00+01:00';
    expect((await anotherDevice.api.account.updatePreferences({ notificationsPausedUntil: theirs })).notificationsPausedUntil).toBe(theirs);
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: '2020-01-01T09:00:00Z' })).notificationsPausedUntil).toBe('2020-01-01T09:00:00Z');
    // Null resumes, everywhere.
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: null })).notificationsPausedUntil).toBeNull();
    expect((await anotherDevice.api.account.preferences()).notificationsPausedUntil).toBeNull();
    // Someone else's account was never paused.
    const other = h.browser();
    await other.api.auth.signIn('sso', { email: `unpaused-other.${Date.now()}@tests.example` });
    expect((await other.api.account.preferences()).notificationsPausedUntil).toBeNull();
  });
  it('refuses a pause whose end is longer than any date-time needs, and keeps the pause it had', async () => {
    const browser = h.browser();
    await browser.api.auth.signIn('sso', { email: `long-pause.${Date.now()}@tests.example` });
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: until })).notificationsPausedUntil).toBe(until);
    // An ISO date-time takes any number of fractions of a second, and what's taken is sealed into every revision of the profile.
    const tooLong = `2026-11-13T09:00:00.${'1'.repeat(100_000)}Z`;
    const refused = await browser.fetch(`${h.baseUrl}/v1/account/preferences`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notificationsPausedUntil: tooLong })
    });
    expect(refused.status).toBe(400);
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBe(until);
    // One to the nanosecond, with its offset, is as long as any needs to be, and is kept as given.
    const precise = '2026-11-13T09:00:00.123456789+01:00';
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: precise })).notificationsPausedUntil).toBe(precise);
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBe(precise);
  });
  it('opens a profile sealed before notifications could be paused as not paused, and saves it with the pause', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `before-pause.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    const stored = z.object({ preferences: z.record(z.string(), z.unknown()) });
    const [item] = await listItems(owner, h.pool, 'profile', Profile);
    if (!item) throw new Error('No profile to upgrade');
    // The release before wrote preferences without the field.
    const { notificationsPausedUntil, ...previous } = item.manifest.preferences;
    expect(notificationsPausedUntil).toBeNull();
    await saveRevision(owner, h.pool, item.itemId, item.revisionId, { ...item.manifest, preferences: previous });
    expect((await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences).not.toHaveProperty('notificationsPausedUntil');
    expect((await browser.api.account.preferences()).notificationsPausedUntil).toBeNull();
    // Saved for anything else, it's written in the new shape, not paused.
    expect(await browser.api.account.updatePreferences({ notesLanguage: 'de' })).toMatchObject({ notesLanguage: 'de', notificationsPausedUntil: null });
    expect((await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences).toMatchObject({ notesLanguage: 'de', notificationsPausedUntil: null });
    // It pauses like any other, and the release before still opens the profile, paused or not.
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await browser.api.account.updatePreferences({ notificationsPausedUntil: until })).notificationsPausedUntil).toBe(until);
    const [opened] = await listItems(owner, h.pool, 'profile', Profile.extend({ preferences: PreferencesSchema.omit({ notificationsPausedUntil: true }) }));
    expect(opened?.manifest.preferences.notesLanguage).toBe('de');
  });
  it('opens a profile sealed before Upcoming could show your own events as not showing them, and saves it with the choice', async () => {
    const browser = h.browser();
    const { session } = await browser.api.auth.signIn('sso', { email: `before-own-events.${Date.now()}@tests.example` });
    const owner = await openOwner(h.deps, session.ownerId, undefined);
    const stored = z.object({ preferences: z.record(z.string(), z.unknown()) });
    const [item] = await listItems(owner, h.pool, 'profile', Profile);
    if (!item) throw new Error('No profile to upgrade');
    // The release before wrote preferences without the field.
    const { showSoloEvents, ...previous } = item.manifest.preferences;
    expect(showSoloEvents).toBe(false);
    await saveRevision(owner, h.pool, item.itemId, item.revisionId, { ...item.manifest, preferences: previous });
    expect((await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences).not.toHaveProperty('showSoloEvents');
    expect((await browser.api.account.preferences()).showSoloEvents).toBe(false);
    // Saved for anything else, it's written in the new shape, not showing them.
    expect(await browser.api.account.updatePreferences({ notesLanguage: 'de' })).toMatchObject({ notesLanguage: 'de', showSoloEvents: false });
    expect((await listItems(owner, h.pool, 'profile', stored))[0]?.manifest.preferences).toMatchObject({ notesLanguage: 'de', showSoloEvents: false });
    // Shown, then hidden again, and the release before still opens the profile while they're shown.
    expect((await browser.api.account.updatePreferences({ showSoloEvents: true })).showSoloEvents).toBe(true);
    const [opened] = await listItems(owner, h.pool, 'profile', Profile.extend({ preferences: PreferencesSchema.omit({ showSoloEvents: true }) }));
    expect(opened?.manifest.preferences.notesLanguage).toBe('de');
    expect((await browser.api.account.updatePreferences({ showSoloEvents: false })).showSoloEvents).toBe(false);
    expect((await browser.api.account.preferences()).showSoloEvents).toBe(false);
  });
});

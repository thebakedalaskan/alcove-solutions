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
    expect(prefs.notifications).toMatchObject({ ...choices, enabled: true, privateMessages: false, replies: false, chatMentions: false, hands: false, questions: false, admissions: false, timers: false });
    const saved = await browser.api.account.updatePreferences({ notifications: { ...prefs.notifications, enabled: false } });
    expect(saved.notifications).toMatchObject({ ...choices, enabled: false });
    expect((await browser.api.account.preferences()).notifications).toEqual(saved.notifications);
  });
  it('starts opted out, remembers categories independently of sound, and disables globally without losing choices', async () => {
    const browser = h.browser();
    const email = `notifications.${Date.now()}@tests.example`;
    await browser.api.auth.signIn('sso', { email });
    const initial = await browser.api.account.preferences();
    expect(initial.notifications).toMatchObject({ enabled: false, privateMessages: false, replies: false, chatMentions: false, hands: false, questions: false, admissions: false, timers: false });
    const notifications = { ...initial.notifications, enabled: true, privateMessages: true, replies: true, admissions: true };
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
    expect((await other.api.account.preferences()).notifications).toMatchObject({ enabled: false, privateMessages: false, admissions: false });
  });
});

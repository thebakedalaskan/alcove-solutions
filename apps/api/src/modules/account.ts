import { PreferencesSchema, type Patch, type Passkey, type Person, type PortraitStyle, type Preferences, type Session, type SetupStep } from '@alcove/api';
import type { AddPasskeyFinishBodySchema, RegisterFinishBodySchema, StepUpFinishBodySchema, UnlockFinishBodySchema } from '@alcove/api';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { H, b64u, equalBytes, fromUtf8, openKey, passkeyWrapKey, random, rootCheck, sealKey, stateKey, unb64u, utf8, openRecord, sealRecord } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx } from '../db';
import { AuthError, ConflictError, ForbiddenError, InternalError, KeyError, NotFoundError, ValidationError } from '../errors';
import { log } from '../log';

const alog = log.child({ component: 'account' });
/** A credential ID's first characters: enough to tell passkeys apart in a log, not to look one up elsewhere. */
const cid = (id: string) => id.slice(0, 8);
import { createItem, getItem, listItems, saveRevision } from '../vault';
import { Challenges, asTransports, assertionJSON, registrationJSON } from '../webauthn';
import { openAccount } from './billing';

export const challenges = new Challenges();
const Profile = z.object({ name: z.string(), preferences: PreferencesSchema });
type FinishReg = z.infer<typeof RegisterFinishBodySchema>;

const scopeOf = (credentialId: string) => `passkey:${credentialId}`;
const ownerIdFor = (publicKey: Uint8Array) => b64u(H('MVP/owner/v1', publicKey));

/* ---------- portraits: a stable illustrated avatar per owner ---------- */
const SKINS = ['#F2D3BA', '#EDC7A6', '#E3B996', '#C99572', '#B9835A', '#A86F4C', '#7A4A30'];
const HAIRS = ['#1F1A17', '#2A1C14', '#4A2E1E', '#B5562B', '#D9A95B', '#26211E'];
const BGS = ['#F3D9C4', '#CFE3D6', '#E6D4EC', '#D3DEEC', '#EFE2C2', '#D6E0E6'];
const SHIRTS = ['#C2623A', '#2F5D4B', '#6E3F80', '#34507A', '#A07A2C', '#4F6B8A'];
const STYLES = ['short', 'swept', 'curly', 'long', 'bob', 'afro', 'bun'] as const;
const ROOMS: [string, string, string][] = [['#C98A5E', '#5D3F31', '#E8C29C'], ['#5F8C76', '#26352D', '#A8C2A4'], ['#9A6FA8', '#35263F', '#D7B3C6'], ['#6F8DB3', '#24324A', '#B7C6DC']];
function portraitFor(seed: string): PortraitStyle {
  const h = H('MVP/portrait/v1', utf8(seed));
  const pick = <T,>(xs: readonly T[], i: number): T => { const v = xs[(h[i] ?? 0) % xs.length]; if (v === undefined) throw new Error('empty palette'); return v; };
  return { bg: pick(BGS, 0), skin: pick(SKINS, 1), hair: pick(HAIRS, 2), shirt: pick(SHIRTS, 3), style: pick(STYLES, 4), glasses: (h[5] ?? 0) % 4 === 0, room: pick(ROOMS, 6) };
}
export async function me(o: Owner): Promise<Person> {
  const p = await profile(o);
  return { id: o.ownerId, name: p.manifest.name, email: '', portrait: portraitFor(o.ownerId) };
}
async function profile(o: Owner) {
  const [p] = await listItems(o, o.pool, 'profile', Profile);
  if (!p) throw new NotFoundError('Your profile is missing.');
  return p;
}
export async function sessionFor(o: Owner): Promise<Session> {
  const created = await maybeOne(o.pool, z.object({ created_at: timestamp }), 'SELECT created_at FROM owners WHERE owner_id = $1', [o.ownerId]);
  return { user: await me(o), ownerId: o.ownerId, rootSource: o.session.rootSource, createdAt: (created?.created_at ?? new Date()).toISOString(), expiresAt: o.sessions.expiresAt(o.session).toISOString() };
}
export const ownerOf = (d: Deps, s: Owner['session']): Owner => ({ ...d, session: s, ownerId: s.ownerId, root: s.root.slice(), wrapKey: s.wrapKey.slice() });

/* ---------- passkey secrets ---------- */
/** Picks the secret this passkey was registered with. The client can't change a passkey's mode. */
function secretFor(usesPrf: boolean, body: { prf?: string | undefined; deviceSecret?: string | undefined }): Uint8Array {
  const s = usesPrf ? body.prf : body.deviceSecret;
  if (!s) throw new KeyError(usesPrf ? 'This browser didn’t return your passkey’s key (PRF). Unlock in Chrome, Edge or Safari with the same passkey provider you used to create it.' : 'This passkey keeps its key in the browser where it was created. Unlock there, or use another passkey.',
    { context: { usesPrf, sentPrf: Boolean(body.prf), sentDeviceSecret: Boolean(body.deviceSecret) } });
  return unb64u(s, 32);
}
function newSecret(body: { prf?: string | undefined; deviceSecret?: string | undefined }): { secret: Uint8Array; usesPrf: boolean } {
  if (body.prf) return { secret: unb64u(body.prf, 32), usesPrf: true };
  if (body.deviceSecret) return { secret: unb64u(body.deviceSecret, 32), usesPrf: false };
  throw new ValidationError('A new passkey needs a key from PRF or the device.', { level: 'warn', context: { sentPrf: false, sentDeviceSecret: false } });
}

/* ---------- create account ---------- */
export async function registerStart(d: Deps, name: string) {
  const userId = random(16);
  const options = await generateRegistrationOptions({
    rpName: 'Alcove', rpID: d.cfg.RP_ID, userName: name, userDisplayName: name, userID: userId, attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }
  });
  return { challengeId: challenges.issue({ kind: 'register', challenge: options.challenge, userId, name }), options };
}

async function verifyNew(d: Deps, body: FinishReg, expectedChallenge: string) {
  const v = await verifyRegistrationResponse({ response: registrationJSON(body.credential), expectedChallenge, expectedOrigin: d.cfg.WEB_ORIGIN, expectedRPID: d.cfg.RP_ID, requireUserVerification: true })
    .catch((e: unknown) => { throw new ValidationError('That passkey couldn’t be verified.', { cause: e, level: 'warn', context: { step: 'verify-registration', credential: cid(body.credential.id) } }); });
  if (!v.verified) throw new ValidationError('That passkey couldn’t be verified.', { level: 'warn', context: { step: 'verify-registration', credential: cid(body.credential.id) } });
  alog.debug('registration verified', { credential: cid(v.registrationInfo.credential.id), transports: v.registrationInfo.credential.transports ?? [], deviceType: v.registrationInfo.credentialDeviceType, backedUp: v.registrationInfo.credentialBackedUp });
  return v.registrationInfo.credential;
}
function sealLabel(root: Uint8Array, ownerId: string, credentialId: string, label: string) {
  return sealRecord(stateKey(root, ownerId, scopeOf(credentialId)), { v: 1, kind: 'passkey-label', ownerId, credentialId }, utf8(label || 'Passkey'));
}

export async function registerFinish(d: Deps, body: FinishReg): Promise<Owner> {
  const ch = challenges.take(body.challengeId, 'register');
  const cred = await verifyNew(d, body, ch.challenge);
  const { secret, usesPrf } = newSecret(body);
  const ownerId = ownerIdFor(cred.publicKey);
  const root = random(32);
  const session = d.sessions.open(ownerId, root.slice(), usesPrf ? 'prf' : 'device');
  const o = ownerOf(d, session);
  try {
    await tx(d.pool, async (c) => {
      await exec(c, 'INSERT INTO owners (owner_id, auth_public_key, webauthn_user_id, root_check) VALUES ($1,$2,$3,$4)', [ownerId, cred.publicKey, ch.userId, rootCheck(root, ownerId)]);
      await exec(c, `INSERT INTO passkeys (credential_id, owner_id, public_key, counter, transports, root_envelope, uses_prf, label_ciphertext, last_used_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [cred.id, ownerId, cred.publicKey, cred.counter, cred.transports ?? [], sealKey(passkeyWrapKey(secret, cred.id), ownerId, scopeOf(cred.id), root), usesPrf, sealLabel(o.root, ownerId, cred.id, body.deviceName)]);
      const prefs: Preferences = { notesDefault: 'ask', keep: 'full' };
      await createItem(o, c, 'profile', { name: ch.name, preferences: prefs });
      await openAccount(d, c, ownerId);
    });
  } catch (e) {
    d.sessions.close(session.id, 'lock');
    alog.error('account creation failed after verification', { ownerId, err: e });
    throw e;
  } finally {
    root.fill(0); secret.fill(0);
  }
  alog.info('account created', { ownerId, credential: cid(cred.id), usesPrf });
  return o;
}

/* ---------- unlock ---------- */
export async function unlockStart(d: Deps) {
  const options = await generateAuthenticationOptions({ rpID: d.cfg.RP_ID, userVerification: 'required' });
  return { challengeId: challenges.issue({ kind: 'unlock', challenge: options.challenge }), options };
}
const PasskeyRow = z.object({ credential_id: z.string(), owner_id: z.string(), public_key: bytea, counter: z.union([z.string(), z.number()]).transform(Number), transports: z.array(z.string()), root_envelope: bytea, uses_prf: z.boolean() });

/** Verifies an assertion against a stored passkey and advances its counter. */
async function verifyAssertion(d: Deps, credential: z.infer<typeof UnlockFinishBodySchema>['credential'], expectedChallenge: string) {
  const pk = await maybeOne(d.pool, PasskeyRow, 'SELECT credential_id, owner_id, public_key, counter, transports, root_envelope, uses_prf FROM passkeys WHERE credential_id = $1', [credential.id]);
  if (!pk) throw new AuthError('That passkey doesn’t belong to an Alcove account on this server. It may be for another app, or for an account that no longer exists here. Create a new account instead.', { context: { step: 'find-passkey', credential: cid(credential.id) } });
  const v = await verifyAuthenticationResponse({
    response: assertionJSON(credential), expectedChallenge, expectedOrigin: d.cfg.WEB_ORIGIN, expectedRPID: d.cfg.RP_ID,
    credential: { id: pk.credential_id, publicKey: pk.public_key, counter: pk.counter, transports: asTransports(pk.transports) }, requireUserVerification: true
  }).catch((e: unknown) => { throw new AuthError('That passkey couldn’t be verified.', { cause: e, level: 'warn', context: { step: 'verify-assertion', ownerId: pk.owner_id, credential: cid(pk.credential_id) } }); });
  if (!v.verified) throw new AuthError('That passkey couldn’t be verified.', { level: 'warn', context: { step: 'verify-assertion', ownerId: pk.owner_id, credential: cid(pk.credential_id) } });
  await exec(d.pool, 'UPDATE passkeys SET counter = $2, last_used_at = now() WHERE credential_id = $1', [pk.credential_id, v.authenticationInfo.newCounter]);
  return pk;
}

export async function unlockFinish(d: Deps, body: z.infer<typeof UnlockFinishBodySchema>): Promise<Owner> {
  const ch = challenges.take(body.challengeId, 'unlock');
  const pk = await verifyAssertion(d, body.credential, ch.challenge);
  const secret = secretFor(pk.uses_prf, body);
  const root = openKey(passkeyWrapKey(secret, pk.credential_id), pk.owner_id, scopeOf(pk.credential_id), pk.root_envelope);
  secret.fill(0);
  const check = await maybeOne(d.pool, z.object({ root_check: bytea }), 'SELECT root_check FROM owners WHERE owner_id = $1', [pk.owner_id]);
  if (!check || !equalBytes(check.root_check, rootCheck(root, pk.owner_id))) {
    root.fill(0);
    throw new KeyError('This passkey can’t unlock your notes on this device.', { context: { step: 'root-check', ownerId: pk.owner_id, credential: cid(pk.credential_id), usesPrf: pk.uses_prf, ownerFound: Boolean(check) } });
  }
  alog.info('unlocked', { ownerId: pk.owner_id, credential: cid(pk.credential_id), usesPrf: pk.uses_prf });
  return ownerOf(d, d.sessions.open(pk.owner_id, root, pk.uses_prf ? 'prf' : 'device'));
}

/* ---------- step-up: fresh proof with an existing passkey before changing passkeys ---------- */
export const STEP_UP_MS = 2 * 60_000;
export async function stepUpStart(o: Owner) {
  const existing = await rows(o.pool, z.object({ credential_id: z.string(), transports: z.array(z.string()) }), 'SELECT credential_id, transports FROM passkeys WHERE owner_id = $1', [o.ownerId]);
  const options = await generateAuthenticationOptions({ rpID: o.cfg.RP_ID, userVerification: 'required', allowCredentials: existing.map((e) => ({ id: e.credential_id, transports: asTransports(e.transports) })) });
  return { challengeId: challenges.issue({ kind: 'step-up', challenge: options.challenge, ownerId: o.ownerId }), options };
}
export async function stepUpFinish(o: Owner, body: z.infer<typeof StepUpFinishBodySchema>): Promise<void> {
  const ch = challenges.take(body.challengeId, 'step-up');
  if (ch.ownerId !== o.ownerId) throw new ForbiddenError('That prompt belongs to another account.');
  const pk = await verifyAssertion(o, body.credential, ch.challenge);
  if (pk.owner_id !== o.ownerId) throw new ForbiddenError('Use one of this account’s passkeys.', { context: { credential: cid(pk.credential_id) } });
  o.session.stepUpUntil = Date.now() + STEP_UP_MS;
  alog.info('step-up confirmed', { credential: cid(pk.credential_id) });
}
function requireStepUp(o: Owner) {
  if ((o.session.stepUpUntil ?? 0) < Date.now()) throw new ForbiddenError('Confirm with one of your passkeys first.');
  o.session.stepUpUntil = 0;
}

/* ---------- more passkeys ---------- */
export async function addPasskeyStart(o: Owner) {
  if ((o.session.stepUpUntil ?? 0) < Date.now()) throw new ForbiddenError('Confirm with one of your passkeys first.');
  const owner = await maybeOne(o.pool, z.object({ webauthn_user_id: bytea }), 'SELECT webauthn_user_id FROM owners WHERE owner_id = $1', [o.ownerId]);
  if (!owner) throw new NotFoundError('Account missing.');
  const existing = await rows(o.pool, z.object({ credential_id: z.string(), transports: z.array(z.string()) }), 'SELECT credential_id, transports FROM passkeys WHERE owner_id = $1', [o.ownerId]);
  const name = (await profile(o)).manifest.name;
  const options = await generateRegistrationOptions({
    rpName: 'Alcove', rpID: o.cfg.RP_ID, userName: name, userDisplayName: name, userID: owner.webauthn_user_id, attestationType: 'none',
    excludeCredentials: existing.map((e) => ({ id: e.credential_id, transports: asTransports(e.transports) })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }
  });
  return { challengeId: challenges.issue({ kind: 'add', challenge: options.challenge, ownerId: o.ownerId }), options };
}
export async function addPasskeyFinish(o: Owner, body: z.infer<typeof AddPasskeyFinishBodySchema>): Promise<Passkey> {
  const ch = challenges.take(body.challengeId, 'add');
  if (ch.ownerId !== o.ownerId) throw new ForbiddenError('That prompt belongs to another account.');
  requireStepUp(o);
  const cred = await verifyNew(o, body, ch.challenge);
  const { secret, usesPrf } = newSecret(body);
  await exec(o.pool, `INSERT INTO passkeys (credential_id, owner_id, public_key, counter, transports, root_envelope, uses_prf, label_ciphertext)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [cred.id, o.ownerId, cred.publicKey, cred.counter, cred.transports ?? [], sealKey(passkeyWrapKey(secret, cred.id), o.ownerId, scopeOf(cred.id), o.root), usesPrf, sealLabel(o.root, o.ownerId, cred.id, body.deviceName)]);
  secret.fill(0);
  const added = (await passkeys(o)).find((p) => p.id === cred.id);
  if (!added) throw new InternalError('Passkey was not saved.', { context: { credential: cid(cred.id) } });
  alog.info('passkey added', { credential: cid(cred.id), usesPrf });
  return added;
}
/** Removes a passkey (after step-up). The last passkey can't be removed: it's the only way in. */
export async function removePasskey(o: Owner, credentialId: string): Promise<void> {
  requireStepUp(o);
  await tx(o.pool, async (c) => {
    const n = await maybeOne(c, z.object({ n: z.coerce.number() }), 'SELECT count(*) AS n FROM passkeys WHERE owner_id = $1', [o.ownerId]);
    if ((n?.n ?? 0) <= 1) throw new ConflictError('You can’t remove your only passkey.');
    const gone = await exec(c, 'DELETE FROM passkeys WHERE owner_id = $1 AND credential_id = $2', [o.ownerId, credentialId]);
    if (gone !== 1) throw new NotFoundError('That passkey doesn’t exist.', { context: { credential: cid(credentialId) } });
  });
  alog.info('passkey removed', { credential: cid(credentialId) });
}
export async function passkeys(o: Owner): Promise<Passkey[]> {
  const r = await rows(o.pool, z.object({ credential_id: z.string(), label_ciphertext: bytea, created_at: timestamp, last_used_at: timestamp.nullable(), uses_prf: z.boolean() }),
    'SELECT credential_id, label_ciphertext, created_at, last_used_at, uses_prf FROM passkeys WHERE owner_id = $1 ORDER BY created_at', [o.ownerId]);
  return r.map((p) => ({
    id: p.credential_id,
    deviceName: fromUtf8(openRecord(stateKey(o.root, o.ownerId, scopeOf(p.credential_id)), { v: 1, kind: 'passkey-label', ownerId: o.ownerId, credentialId: p.credential_id }, p.label_ciphertext)),
    createdAt: p.created_at.toISOString(), lastUsedAt: p.last_used_at?.toISOString() ?? null, usesPrf: p.uses_prf
  }));
}

/* ---------- profile and preferences ---------- */
export async function preferences(o: Owner): Promise<Preferences> { return (await profile(o)).manifest.preferences; }
export async function updateProfile(o: Owner, patch: { name?: string | undefined; preferences?: Patch<Preferences> | undefined }) {
  return tx(o.pool, async (c) => {
    const [p] = await listItems(o, c, 'profile', Profile);
    if (!p) throw new NotFoundError('Your profile is missing.');
    const prefs = p.manifest.preferences;
    const next = { name: patch.name?.trim() || p.manifest.name, preferences: { notesDefault: patch.preferences?.notesDefault ?? prefs.notesDefault, keep: patch.preferences?.keep ?? prefs.keep } };
    await saveRevision(o, c, p.itemId, p.revisionId, next);
    return next;
  });
}
export async function setupSteps(o: Owner): Promise<SetupStep[]> {
  const counts = await maybeOne(o.pool, z.object({ keys: z.coerce.number(), calls: z.coerce.number() }),
    `SELECT (SELECT count(*) FROM passkeys WHERE owner_id = $1) AS keys, (SELECT count(*) FROM calls WHERE owner_id = $1 AND state = 'ended') AS calls`, [o.ownerId]);
  return [
    { id: 'passkey', label: 'Passkey created', done: true },
    { id: 'first-call', label: 'Have your first call', done: (counts?.calls ?? 0) > 0 },
    { id: 'second-passkey', label: 'Add a passkey on a second device', done: (counts?.keys ?? 0) > 1 }
  ];
}
export { getItem };

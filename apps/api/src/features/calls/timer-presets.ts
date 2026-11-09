import { CallTimerPresetSchema, type CallTimerPreset, type CallTimerPresetInput, type CallTimerPresetUpdate } from '@alcove/api';
import { z } from 'zod';
import { type Owner } from '../../context';
import { id128, openJson, sealJson, stateKey, toJson } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { ConflictError, notFound } from '../../errors';
import { log } from '../../log';

const tlog = log.child({ component: 'timer-presets' });
const Row = z.object({ preset_id: z.string(), ciphertext: bytea });
const key = (o: Owner, id: string) => stateKey(o.root, o.ownerId, `timer-preset:${id}`);
const header = (o: Owner, id: string) => ({ v: 1 as const, kind: 'timer-preset', ownerId: o.ownerId, presetId: id });
const sealed = (o: Owner, p: CallTimerPreset) => sealJson(key(o, p.id), header(o, p.id), toJson(p));
async function locked(o: Owner, db: Db, id: string): Promise<CallTimerPreset> {
  const row = await maybeOne(db, Row, 'SELECT preset_id, ciphertext FROM timer_presets WHERE owner_id = $1 AND preset_id = $2 FOR UPDATE', [o.ownerId, id]);
  if (!row) throw notFound('That timer preset');
  return openJson(key(o, id), header(o, id), row.ciphertext, CallTimerPresetSchema);
}
export async function list(o: Owner): Promise<CallTimerPreset[]> {
  const found = await rows(o.pool, Row, 'SELECT preset_id, ciphertext FROM timer_presets WHERE owner_id = $1 ORDER BY created_at, preset_id', [o.ownerId]);
  return found.map((r) => openJson(key(o, r.preset_id), header(o, r.preset_id), r.ciphertext, CallTimerPresetSchema));
}
export async function create(o: Owner, input: CallTimerPresetInput): Promise<CallTimerPreset> {
  const now = new Date().toISOString();
  const preset = { ...input, id: id128(), revision: 0, createdAt: now, updatedAt: now };
  await exec(o.pool, 'INSERT INTO timer_presets (owner_id, preset_id, ciphertext) VALUES ($1, $2, $3)', [o.ownerId, preset.id, sealed(o, preset)]);
  tlog.info('timer preset created', { presetId: preset.id });
  return preset;
}
export async function update(o: Owner, id: string, input: CallTimerPresetUpdate): Promise<CallTimerPreset> {
  const preset = await tx(o.pool, async (db) => {
    const current = await locked(o, db, id);
    if (current.revision !== input.expectedRevision) throw new ConflictError('This timer preset has changed. Review it and try again.', { context: { presetId: id } });
    const next = { ...current, name: input.name, segments: input.segments, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    await exec(db, 'UPDATE timer_presets SET ciphertext = $3 WHERE owner_id = $1 AND preset_id = $2', [o.ownerId, id, sealed(o, next)]);
    return next;
  });
  tlog.info('timer preset updated', { presetId: id });
  return preset;
}
export async function remove(o: Owner, id: string): Promise<void> {
  if (!(await exec(o.pool, 'DELETE FROM timer_presets WHERE owner_id = $1 AND preset_id = $2', [o.ownerId, id]))) throw notFound('That timer preset');
  tlog.info('timer preset deleted', { presetId: id });
}

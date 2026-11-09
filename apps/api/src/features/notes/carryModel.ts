/** Records sealed before `screenModel` became `model` still hold the old key: its value carries over, and the next save writes the new one. */
export function carryModel(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  if ('model' in v || !('screenModel' in v)) return v;
  return { ...v, model: v.screenModel };
}

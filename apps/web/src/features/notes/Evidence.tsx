/*
 * Which models transcribed a note, wrote it and read its shared screens (docs: notes-and-inference › Verified private
 * inference). The page says in a few words, under the title, whether the notes were written in confidential compute;
 * one click shows when the hardware was checked and the model for each task: verified, with a way to check it, or
 * marked unencrypted. Only the notes as they are now: any other unencrypted model the call was sent to (for earlier
 * versions, or notes that were stopped or failed) is said once, at the foot.
 */
import type { InferenceEvidence, Note, NoteKind } from '@alcove/api';
import { Dots, Icon, Popover, SealedButton, Unencrypted } from '@alcove/ui';
import { useState } from 'react';
import { isUnencrypted } from '~/lib/aiModels';
import { useAiModels } from '~/lib/queries';
import { daysFromToday, hm, shortDay } from '~/lib/time';

/** The tasks in the order they happen, and what each one did. */
const TASKS = [
  { task: 'transcript', label: 'Transcribed the speech' },
  { task: 'notes', label: 'Wrote the notes' },
  { task: 'screens', label: 'Read the shared screens' }
] as const satisfies readonly { task: InferenceEvidence['task']; label: string }[];

/** One task's model: verified when it was checked, or unencrypted. */
interface Row { task: InferenceEvidence['task']; label: string; model: string; verifiedAt: string | null }

const listed = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1) ?? ''}`);

/**
 * Where a note was written, under its title, and behind it each task's model. `model` is the organizer's choice for the
 * notes (the default when null): unencrypted, the notes and screens rows are that model's, marked so. `writing`: they're
 * being written, the first time or again, and it says so. Nothing when no model was used.
 */
export function Provenance({ evidence, kind, unencrypted, model, writing }: { evidence: InferenceEvidence[]; kind: NoteKind; unencrypted: Note['unencrypted']; model: string | null; writing?: 'first' | 'again' | undefined }) {
  const [open, setOpen] = useState(false);
  const models = useAiModels();
  const nameOf = (id: string) => models.data?.models.find((m) => m.id === id)?.name ?? id;
  const plain = isUnencrypted(models.data, model);
  // One model per task: an older note holds several checks of the same one, so the latest is the one that counts.
  const latest = (task: InferenceEvidence['task']) => evidence.filter((e) => e.task === task).reduce<InferenceEvidence | undefined>((best, e) => (best && best.verifiedAt >= e.verifiedAt ? best : e), undefined);
  const rows = TASKS.flatMap(({ task, label }): Row[] => {
    if (task !== 'transcript' && plain) return unencrypted.some((u) => u.task === task && u.model === model) && model ? [{ task, label, model, verifiedAt: null }] : [];
    const e = latest(task);
    return e ? [{ task, label, model: e.model, verifiedAt: e.verifiedAt }] : [];
  });
  // Other unencrypted models the call was sent to, for notes kept or not: what they were sent stays sent.
  const earlier = [...new Set(unencrypted.filter((u) => !(plain && u.model === model)).map((u) => nameOf(u.model)))];
  const wrote = rows.some((r) => r.task === 'notes');
  const verified = rows.flatMap((r) => (r.verifiedAt ? [r.verifiedAt] : []));
  const checked = verified.length ? new Date(verified.reduce((last, at) => (at > last ? at : last), '')) : null;
  const when = checked ? (daysFromToday(checked) === 0 ? `at ${hm(checked)}` : `on ${shortDay(checked)} at ${hm(checked)}`) : null;
  const busy = !writing ? undefined : plain ? 'Being written by an unencrypted model' : writing === 'again' ? 'Being written again in confidential compute' : 'Being written in confidential compute';
  if (!rows.length) {
    return busy ? <span className={plain ? 'cd-seal is-plain text-caution' : 'cd-seal is-plain'} role="status"><Icon name={plain ? 'shieldOff' : 'sealed'} size={15} />{busy}<Dots /></span> : null;
  }
  const anchor = plain ? (
    <button type="button" className="ac-sealed is-button cd-seal is-caution">
      <span className="ic"><Icon name="shieldOff" size={18} /></span>
      <span className="min-w-0"><b>{busy ?? 'Written by an unencrypted model'}</b>{busy && <small><Dots /></small>}</span>
      <Icon name="down" size={16} className="chev" />
    </button>
  ) : <SealedButton className="cd-seal" title={busy ?? (wrote ? 'Written in confidential compute' : 'Transcribed in confidential compute')} detail={busy ? <Dots /> : undefined} />;
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="Which models worked on these notes" className="proof-pop" anchor={anchor}>
      <div className="proof">
        <div className="proof-h">
          {plain ? (
            <>
              <b>Not written in confidential compute</b>
              <p>The notes were written by a model NEAR AI doesn’t run in a secure enclave, so the transcript went to it unencrypted. The speech was transcribed in confidential compute, checked before anything was sent.</p>
            </>
          ) : (
            <>
              <b>Checked before anything was sent</b>
              <p>Before sending this {kind === 'room' ? 'recording’s' : 'call’s'} speech{wrote ? ' and transcript' : ''} to a model on NEAR AI, Alcove checked its hardware evidence, then sealed everything to the key that evidence vouches for.{when ? ` The hardware was last checked ${when}.` : ''}</p>
            </>
          )}
        </div>
        {rows.map((r) => (
          <section key={r.task} className="proof-m" aria-label={r.label}>
            <div className="proof-mh">
              <span className="ac-eyebrow">{r.label}</span>
              <span className="proof-model">{nameOf(r.model)}{!r.verifiedAt && <> <Unencrypted compact /></>}</span>
            </div>
            {r.verifiedAt && (
              <a className="lk proof-link" href={`https://cloud.near.ai/verify?model=${encodeURIComponent(r.model)}`} target="_blank" rel="noreferrer noopener">
                Check this model at NEAR AI<Icon name="external" size={14} />
              </a>
            )}
          </section>
        ))}
        {earlier.length > 0 && <p className="proof-near">This call was also sent unencrypted to {listed(earlier)}.</p>}
        {verified.length > 0 && <p className="proof-near">“Check this model” opens NEAR AI’s site, which sees your visit and checks fresh evidence for the model, not this note.</p>}
      </div>
    </Popover>
  );
}

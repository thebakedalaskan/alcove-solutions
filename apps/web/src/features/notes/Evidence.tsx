/*
 * Which verified private models transcribed a note and wrote it, and what Alcove checked about each
 * before sending it anything (docs: notes-and-inference › Verified private inference). The note keeps
 * this evidence sealed with it; the page says where it was written, and when the hardware was checked,
 * under the title, with the evidence one click away. Only checks that ran are listed.
 */
import type { InferenceEvidence, NoteKind } from '@alcove/api';
import { Checklist, Icon, Popover, SealedButton, type Checked } from '@alcove/ui';
import { useState } from 'react';
import { daysFromToday, hm, shortDay } from '~/lib/time';

/** The start and end of a hash or key: enough to compare, the whole value on hover. */
const short = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex);
/** Intel's TCB status, as a person reads it. */
const firmware = (status: string) => (status === 'UpToDate' ? 'firmware up to date' : status === 'SWHardeningNeeded' ? 'firmware up to date, software hardening expected' : `TCB ${status}`);
const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const when = (iso: string) => { const d = new Date(iso); return `${shortDay(d)}, ${hm(d)}`; };

/** What was checked about one model, in the order it was checked. */
function checks(e: InferenceEvidence): Checked[] {
  return [
    { label: 'Intel TDX confidential VM', detail: `Signed by Intel, ${firmware(e.tdx.status)}`, value: short(e.tdx.quote), title: `TDX quote, SHA-256 ${e.tdx.quote}` },
    { label: `Booted ${e.os}`, detail: 'Measured as the published dstack image builds' },
    { label: 'The configuration it started with', detail: 'As its quote measures it', value: short(e.compose), title: `App compose, SHA-256 ${e.compose}` },
    { label: `${e.gpu.count} NVIDIA ${word(e.gpu.arch)} GPU${e.gpu.count === 1 ? '' : 's'} in confidential mode`, detail: 'Confirmed by NVIDIA’s attestation service, for the same challenge' },
    { label: 'Its key', detail: 'Bound in the quote to a fresh challenge from Alcove', value: short(e.key), title: `Ed25519 key ${e.key}` },
    { label: 'Sealed to that key with Oblivious HTTP', detail: 'At the model’s own endpoint. Its reply came back sealed the same way' }
  ];
}

/** "Written in confidential compute", when the hardware was checked, and behind it what was checked about each model the note used. Nothing when no model was. */
export function Provenance({ evidence, kind }: { evidence: InferenceEvidence[]; kind: NoteKind }) {
  const [open, setOpen] = useState(false);
  if (!evidence.length) return null;
  const ordered = [...evidence.filter((e) => e.task === 'notes'), ...evidence.filter((e) => e.task === 'transcript')];
  const wrote = ordered.some((e) => e.task === 'notes');
  const gateways = [...new Map(evidence.map((e) => [e.gateway.compose, e.gateway])).values()];
  const checked = new Date(ordered[0]?.verifiedAt ?? '');
  const at = daysFromToday(checked) === 0 ? hm(checked) : `${shortDay(checked)}, ${hm(checked)}`;
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="What Alcove checked" className="proof-pop"
      anchor={<SealedButton title={wrote ? 'Written in confidential compute' : 'Transcribed in confidential compute'} detail={`hardware verified ${at} · Alcove can’t read it`} />}>
      <div className="proof">
        <div className="proof-h">
          <b>Checked before anything was sent</b>
          <p>Before sending this {kind === 'room' ? 'recording’s' : 'call’s'} speech{wrote ? ' and transcript' : ''} to a model on NEAR AI, Alcove checked its hardware evidence, then sealed everything to the key that evidence vouches for.</p>
        </div>
        {ordered.map((e) => (
          <section key={`${e.task}-${e.key}-${e.verifiedAt}`} className="proof-m" aria-label={e.task === 'notes' ? 'The notes model' : 'The speech model'}>
            <div className="proof-mh">
              <span className="ac-eyebrow">{e.task === 'notes' ? 'Wrote the notes' : 'Transcribed the speech'}</span>
              <span className="proof-model">{e.model}</span>
              <span className="proof-when" title={e.verifiedAt}>Verified {when(e.verifiedAt)}</span>
            </div>
            <Checklist items={checks(e)} label={`What was checked about ${e.model}`} />
            <a className="lk proof-link" href={`https://cloud.near.ai/verify?model=${encodeURIComponent(e.model)}`} target="_blank" rel="noreferrer noopener">
              Check this model at NEAR AI<Icon name="external" size={14} />
            </a>
          </section>
        ))}
        {gateways.map((g) => (
          <div key={g.compose} className="proof-gw" title={`Gateway app compose, SHA-256 ${g.compose}`}>
            <span>NEAR AI’s gateway, which sent this evidence, was checked the same way: Intel TDX, {firmware(g.status)}, {g.os}.</span><code>{short(g.compose)}</code>
          </div>
        ))}
        <p className="proof-near">“Check this model” opens NEAR AI’s site, which sees your visit and checks fresh evidence for the model, not this note.</p>
      </div>
    </Popover>
  );
}

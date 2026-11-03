/*
 * Which verified private models transcribed a note and wrote it, and what Alcove checked about each
 * before sending it anything (docs: notes-and-inference › Verified private inference). The note keeps
 * this evidence sealed with it; the page says so at the top, with the evidence one click away.
 */
import type { InferenceEvidence, NoteKind } from '@alcove/api';
import { Button, Checklist, Icon, Popover, type Checked } from '@alcove/ui';
import { useState } from 'react';
import { hm, shortDay } from '~/lib/time';

/** The start and end of a hash or key: enough to compare, the whole value on hover. */
const short = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 4)}…${hex.slice(-4)}` : hex);
/** Intel's TCB status, as a person reads it. */
const firmware = (status: string) => (status === 'UpToDate' ? 'firmware up to date' : status === 'SWHardeningNeeded' ? 'firmware up to date, software hardening expected' : `TCB ${status}`);
const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const when = (iso: string) => { const d = new Date(iso); return `${shortDay(d)}, ${hm(d)}`; };

/**
 * NEAR AI's Verification Center for the model, with the model's signed receipt for the reply when there
 * is one. The receipt goes in the fragment, which the browser doesn't send; it holds hashes, not content.
 */
function nearLink(e: InferenceEvidence): string {
  const page = `https://cloud.near.ai/verify?model=${encodeURIComponent(e.model)}`;
  if (!e.receipt) return page;
  const receipt = {
    completionId: e.receipt.completionId, model: e.model, signatureKind: 'provider_tee', signingAlgo: 'ed25519', signingAddress: e.key,
    signedText: e.receipt.signedText, signature: e.receipt.signature, verifiedAt: e.verifiedAt
  };
  return `${page}#receipt=${btoa(JSON.stringify(receipt)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** What was checked about one model, in the order it was checked. */
function checks(e: InferenceEvidence): Checked[] {
  return [
    { label: 'Intel TDX confidential VM', detail: `Signed by Intel, ${firmware(e.tdx.status)}`, value: short(e.tdx.quote), title: `TDX quote, SHA-256 ${e.tdx.quote}` },
    { label: `${e.gpu.count} NVIDIA ${word(e.gpu.arch)} GPU${e.gpu.count === 1 ? '' : 's'} in confidential mode`, detail: 'Confirmed by NVIDIA’s attestation service' },
    { label: 'The software its quote measures', detail: 'Matches the configuration it reported', value: short(e.compose), title: `App compose, SHA-256 ${e.compose}` },
    { label: 'Its own key, made inside it', detail: 'Bound to a fresh challenge from Alcove', value: short(e.key), title: `Ed25519 key ${e.key}` },
    e.encryption === 'e2ee'
      ? { label: 'Encrypted end to end to that key', detail: e.reply === 'signed' ? 'Its reply was signed with the same key' : 'Its reply came back encrypted' }
      : { label: 'Sealed to that key with Oblivious HTTP', detail: 'Its reply came back sealed the same way' }
  ];
}

/** "Written by a verified private model", and behind it what was checked about each model the note used. Nothing when no model was. */
export function Provenance({ evidence, kind }: { evidence: InferenceEvidence[]; kind: NoteKind }) {
  const [open, setOpen] = useState(false);
  if (!evidence.length) return null;
  const ordered = [...evidence.filter((e) => e.task === 'notes'), ...evidence.filter((e) => e.task === 'transcript')];
  const wrote = ordered.some((e) => e.task === 'notes');
  const gateways = [...new Map(evidence.map((e) => [e.gateway.compose, e.gateway])).values()];
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" label="What Alcove checked" className="proof-pop"
      anchor={<Button variant="quiet" size="sm" icon="sealed" iconRight="down" className="proof-btn">{wrote ? 'Written by a verified private model' : 'Transcribed by a verified private model'}</Button>}>
      <div className="proof">
        <div className="proof-h">
          <b>Checked before anything was sent</b>
          <p>Alcove sent this {kind === 'room' ? 'recording’s' : 'call’s'} speech{wrote ? ' and transcript' : ''} only to models on NEAR AI whose hardware evidence checked out, each encrypted to a key that only the model’s confidential VM holds.</p>
        </div>
        {ordered.map((e) => (
          <section key={`${e.task}-${e.key}-${e.verifiedAt}`} className="proof-m" aria-label={e.task === 'notes' ? 'The notes model' : 'The speech model'}>
            <div className="proof-mh">
              <span className="ac-eyebrow">{e.task === 'notes' ? 'Wrote the notes' : 'Transcribed the speech'}</span>
              <span className="proof-model">{e.model}</span>
              <span className="proof-when" title={e.verifiedAt}>Verified {when(e.verifiedAt)}</span>
            </div>
            <Checklist items={checks(e)} label={`What was checked about ${e.model}`} />
            <a className="lk proof-link" href={nearLink(e)} target="_blank" rel="noreferrer noopener">
              {e.receipt ? 'Check this reply at NEAR AI' : 'Check this model at NEAR AI'}<Icon name="external" size={14} />
            </a>
          </section>
        ))}
        {gateways.map((g) => (
          <div key={g.compose} className="proof-gw" title={`Gateway app compose, SHA-256 ${g.compose}`}>
            <span>NEAR AI’s gateway was checked the same way: Intel TDX, {firmware(g.status)}.</span><code>{short(g.compose)}</code>
          </div>
        ))}
      </div>
    </Popover>
  );
}

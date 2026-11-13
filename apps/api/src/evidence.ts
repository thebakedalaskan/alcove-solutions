/*
 * Verified private inference (docs: notes-and-inference › Verified private inference). Nothing with
 * content goes to NEAR AI until its evidence for the model has been fetched with a fresh nonce from its
 * gateway (NEAR_AI_BASE_URL, the only request this module sends NEAR AI) and checked here, for the
 * gateway's report and for every model report it returns:
 *
 *  - the Intel TDX quote: its signature chain to INTEL_ROOT_CA, checked against Intel's collateral from
 *    INTEL_PCS_URL (revocation lists, TCB info, QE identity) with dcap-qvl; an accepted TCB status; debug off;
 *  - the OS it booted: MRTD and RTMR0–2 must be exactly those of a published dstack image on NEAR AI's
 *    machines (dstack-images.ts), and the os-image-hash event that image's digest;
 *  - the quote's report data: the reported signing key, then our nonce;
 *  - what that OS measured after boot: the event log replays to RTMR3, and MRCONFIGID (and the
 *    compose-hash event) is the hash of the app compose the report shows;
 *  - a model's GPUs: NVIDIA's Remote Attestation Service (NVIDIA_NRAS_URL) checks the GPU evidence, which
 *    carries our nonce, and its signed verdict must chain to NVIDIA_ROOT_CA;
 *  - the model's OHTTP key, which every request is sealed to: signed by the attested signing key.
 *
 * Some things these checks can't show, and the docs say so: the app compose runs NEAR AI's compose
 * manager, which starts the model code NEAR AI chooses; the GPU evidence is tied to the VM only by the
 * nonce; the model name is the report's word; and the OHTTP key's signature doesn't cover the nonce.
 *
 * A verification is used for ten minutes at most (sooner when NVIDIA's verdict runs out), or until NEAR AI
 * stops taking the key it vouched for; a refusal is kept for 30 seconds, so retries don't each fetch new
 * evidence. Log lines carry the model, a result code, the duration and hashes: never evidence, keys or
 * anything sent.
 */
import type { InferenceEvidence } from '@alcove/api';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { Quote, QuoteVerifier, intel, utils as dcap, type Collateral, type TDReport10 } from '@phala/dcap-qvl';
import { decodeProtectedHeader, errors as jose, jwtVerify } from 'jose';
import { X509Certificate } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config';
import { concat, equalBytes, random, utf8 } from './crypto';
import { DSTACK_IMAGES, type DstackImage } from './dstack-images';
import { UnverifiedError } from './errors';
import { log } from './log';
import { parseKeyConfig, type KeyConfig } from './ohttp';

const elog = log.child({ component: 'evidence' });

export type Task = InferenceEvidence['task'];
/** What every check can conclude, as logged and as the error's context says. */
export type Check =
  | 'report-unavailable' | 'malformed' | 'no-model-evidence' | 'model-mismatch' | 'tdx-quote' | 'tcb-status' | 'debug' | 'collateral-unavailable'
  | 'os-image' | 'expired' | 'nonce' | 'signing-key' | 'rtmr3' | 'compose' | 'gpu' | 'gpu-unavailable' | 'ohttp-key';
/** Couldn't be checked, as opposed to checked and refused. */
const UNAVAILABLE = new Set<Check>(['report-unavailable', 'collateral-unavailable', 'gpu-unavailable']);

/** How long a verification is used before the next request checks again. */
const TTL_MS = 10 * 60_000;
/** How long a refusal stands before the next request checks again. */
const REFUSED_MS = 30_000;
/** Intel's collateral changes monthly; it's fetched again after this, or when Intel says it's due. */
const COLLATERAL_MS = 30 * 60_000;
/** Up to date, or up to date with software hardening Intel expects the TD's own software to provide. */
const ACCEPTED_TCB = new Set(['UpToDate', 'SWHardeningNeeded']);
/**
 * How far NVIDIA's clock may be from this server's, in seconds, when its verdict and its signing chain are checked. A
 * verdict holds from the moment NVIDIA issues it, and Confidential Space's VMs ran 7–9.5 s behind on 2026-11-13 (gcp.ts
 * logs it as `clock offset`), so with no allowance no model checked out. The verdict answers this server's own nonce, so
 * allowing for the clocks lets nothing old through.
 */
const CLOCK_SKEW_S = 60;

export const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
/** Strict hex, with or without 0x: null for anything else. */
export function unhex(s: string): Uint8Array | null {
  const t = /^0x/i.test(s) ? s.slice(2) : s;
  return t.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(t) ? new Uint8Array(Buffer.from(t, 'hex')) : null;
}
/** A short, stable name for a key or a blob in a log line. */
export const fingerprint = (b: Uint8Array): string => hex(sha256(b)).slice(0, 16);

class Refusal extends Error {
  constructor(readonly check: Check, readonly reason: string) { super(reason); }
}
function refuse(check: Check, reason: string): never { throw new Refusal(check, reason); }
/** Library messages can quote measurements; logs keep the sentence, not the values. */
const scrub = (s: string) => s.replace(/[0-9a-fA-F]{16,}/g, '[hex]').slice(0, 160);
const why = (e: unknown) => scrub(e instanceof Error ? e.message : String(e));

/* ---------- what NEAR AI's attestation report looks like ---------- */

const EventLog = z.array(z.object({ imr: z.number(), event_type: z.number(), event: z.string(), digest: z.string().default(''), event_payload: z.string().default('') }));
const TcbInfo = z.object({ app_compose: z.string() });
/** A report as dstack produces it, for the gateway and each model. `event_log` and `tcb_info` may be JSON text. */
const Signed = z.object({
  signing_address: z.string(), signing_algo: z.string(), intel_quote: z.string(), request_nonce: z.string(),
  report_data: z.string().optional(), event_log: z.unknown(), info: z.object({ tcb_info: z.unknown() })
});
const OhttpAttestation = z.object({ signing_algo: z.string(), signing_key: z.string(), key_config: z.string(), signature: z.string() });
const ModelReport = Signed.extend({
  model_name: z.string().optional(), signing_public_key: z.string().optional(), nvidia_payload: z.string().optional(), ohttp_attestation: OhttpAttestation.nullish()
});
const Report = z.object({ gateway_attestation: Signed, model_attestations: z.array(z.unknown()).optional() });
const jsonish = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
};

/* ---------- the TDX quote and its measurements ---------- */

interface Tdx { status: string; advisories: string[]; quoteHash: string; image: DstackImage; compose: string; key: Uint8Array }

const collaterals = new Map<string, { until: number; collateral: Collateral }>();

async function fetched(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`${new URL(url).pathname} answered ${res.status}`); }
  return res;
}
const header = (res: Response, ...names: string[]): string => {
  for (const n of names) { const v = res.headers.get(n); if (v) return decodeURIComponent(v); }
  throw new Error(`Intel's answer has no ${names[0] ?? 'issuer chain'}`);
};
/** The exact text of a top-level JSON object member: what Intel signed, byte for byte. */
function rawMember(text: string, key: string): string | null {
  const at = text.indexOf(`"${key}"`);
  const open = text.indexOf('{', at + key.length + 2);
  if (at < 0 || open < 0 || !/^\s*:\s*$/.test(text.slice(at + key.length + 2, open))) return null;
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}
const Signature = z.object({ signature: z.string() });
const Dated = z.object({ nextUpdate: z.string() });

/** Intel's collateral for a quote's platform: revocation lists, TCB info and QE identity, each with its signing chain. */
async function collateral(cfg: Config, quote: Quote): Promise<Collateral> {
  let fmspc: string;
  let ca: string;
  try {
    fmspc = hex(intel.getFmspc(quote)).toUpperCase();
    ca = intel.getCa(quote);
  } catch (e) { return refuse('tdx-quote', `the quote names no platform: ${why(e)}`); }
  const pcs = cfg.INTEL_PCS_URL.replace(/\/$/, '');
  const id = `${pcs}|${fmspc}|${ca}`;
  const hit = collaterals.get(id);
  if (hit && hit.until > Date.now()) return hit.collateral;
  const rootCrl = dcap.extractCrlUrl(new X509Certificate(cfg.INTEL_ROOT_CA).raw);
  if (!rootCrl) return refuse('collateral-unavailable', 'the Intel root names no revocation list');
  try {
    const [pck, tcb, qe, root] = await Promise.all([
      fetched(`${pcs}/sgx/certification/v4/pckcrl?ca=${ca}&encoding=der`),
      fetched(`${pcs}/tdx/certification/v4/tcb?fmspc=${fmspc}`),
      fetched(`${pcs}/tdx/certification/v4/qe/identity?update=standard`),
      fetched(rootCrl)
    ]);
    const [tcbText, qeText] = [await tcb.text(), await qe.text()];
    const tcbInfo = rawMember(tcbText, 'tcbInfo');
    const qeIdentity = rawMember(qeText, 'enclaveIdentity');
    if (!tcbInfo || !qeIdentity) return refuse('collateral-unavailable', 'Intel’s collateral has an unexpected shape');
    const c: Collateral = {
      pck_crl_issuer_chain: header(pck, 'sgx-pck-crl-issuer-chain'), pck_crl: hex(new Uint8Array(await pck.arrayBuffer())), root_ca_crl: hex(new Uint8Array(await root.arrayBuffer())),
      tcb_info_issuer_chain: header(tcb, 'tcb-info-issuer-chain', 'sgx-tcb-info-issuer-chain'), tcb_info: tcbInfo, tcb_info_signature: Signature.parse(JSON.parse(tcbText)).signature,
      qe_identity_issuer_chain: header(qe, 'sgx-enclave-identity-issuer-chain'), qe_identity: qeIdentity, qe_identity_signature: Signature.parse(JSON.parse(qeText)).signature
    };
    const due = Math.min(Date.parse(Dated.parse(JSON.parse(tcbInfo)).nextUpdate), Date.parse(Dated.parse(JSON.parse(qeIdentity)).nextUpdate));
    collaterals.set(id, { until: Math.min(Date.now() + COLLATERAL_MS, Number.isFinite(due) ? due : 0), collateral: c });
    return c;
  } catch (e) {
    if (e instanceof Refusal) throw e;
    return refuse('collateral-unavailable', why(e));
  }
}

/** Intel's verdict on a quote: the signature chain to the configured root, the collateral, and Intel's TCB status for the platform. */
async function verifiedQuote(cfg: Config, bytes: Uint8Array): Promise<{ status: string; advisories: string[]; td: TDReport10 }> {
  let quote: Quote;
  try { quote = Quote.parse(bytes); } catch (e) { return refuse('tdx-quote', why(e)); }
  if (quote.header.isSgx()) return refuse('tdx-quote', 'an SGX quote, not TDX');
  const c = await collateral(cfg, quote);
  let status: string;
  let advisories: string[];
  let td: TDReport10 | null;
  try {
    const v = QuoteVerifier.newWithRootCa(new X509Certificate(cfg.INTEL_ROOT_CA).raw).verify(bytes, c, Math.floor(Date.now() / 1000));
    ({ status } = v);
    advisories = v.advisory_ids;
    td = v.report.asTd10();
  } catch (e) {
    const reason = why(e);
    return refuse(/expired|not yet valid|in the future/i.test(reason) ? 'expired' : /debug/i.test(reason) ? 'debug' : 'tdx-quote', reason);
  }
  if (!td) return refuse('tdx-quote', 'not a TD report');
  if (((td.tdAttributes[0] ?? 0) & 1) !== 0) return refuse('debug', 'TDX debug mode is on');
  if (!ACCEPTED_TCB.has(status)) return refuse('tcb-status', `Intel gives the platform TCB status ${status}`);
  return { status, advisories, td };
}

/** The published dstack image whose firmware, machine, kernel and initrd measure exactly what this TD booted. */
const imageOf = (td: TDReport10): DstackImage | undefined =>
  DSTACK_IMAGES.find((i) => i.mrtd === hex(td.mrTd) && i.rtmr0 === hex(td.rtMr0) && i.rtmr1 === hex(td.rtMr1) && i.rtmr2 === hex(td.rtMr2));

/** RTMR3 as the event log says it was extended, or null if an event's digest doesn't match what it records. */
function rtmr3(events: z.infer<typeof EventLog>): Uint8Array | null {
  let rtmr: Uint8Array = new Uint8Array(48);
  for (const e of events) {
    if (e.imr !== 3) continue;
    const payload = unhex(e.event_payload);
    if (!payload) return null;
    const type = new Uint8Array(4);
    new DataView(type.buffer).setUint32(0, e.event_type >>> 0, true);
    const digest = sha384(concat(type, utf8(':'), utf8(e.event), utf8(':'), payload));
    const said = unhex(e.digest);
    if (!said || (said.length && !equalBytes(said, digest))) return null;
    rtmr = sha384(concat(rtmr, digest));
  }
  return rtmr;
}

/**
 * One dstack report, the gateway's or a model's: Intel's verdict, the OS it booted, then what the verified
 * quote binds and measures. The fields the report echoes are only compared with the quote; the gateway
 * must echo its report data.
 */
async function checkTdx(cfg: Config, r: z.infer<typeof Signed>, nonce: Uint8Array, echoes: 'report-data' | 'nonce-only'): Promise<Tdx> {
  const key = unhex(r.signing_address);
  if (r.signing_algo !== 'ed25519' || !key || key.length !== 32) return refuse('signing-key', 'not an Ed25519 signing key');
  if (r.request_nonce.toLowerCase() !== hex(nonce)) return refuse('nonce', 'the report answers another nonce');
  const quote = unhex(r.intel_quote);
  if (!quote) return refuse('tdx-quote', 'the quote isn’t hex');
  const { status, advisories, td } = await verifiedQuote(cfg, quote);
  const image = imageOf(td);
  if (!image) return refuse('os-image', 'MRTD and RTMR0–2 aren’t a published dstack image on NEAR AI’s machines');
  // Report data: the signing key (32 bytes), then the nonce we sent.
  if (!equalBytes(td.reportData.slice(32), nonce)) return refuse('nonce', 'the quote doesn’t carry our nonce');
  if (!equalBytes(td.reportData.slice(0, 32), key)) return refuse('signing-key', 'the quote doesn’t bind the reported signing key');
  if (echoes === 'report-data' ? r.report_data?.toLowerCase() !== hex(td.reportData) : r.report_data !== undefined && r.report_data.toLowerCase() !== hex(td.reportData)) {
    return refuse('malformed', 'the report data the report echoes isn’t the quote’s');
  }
  const events = EventLog.safeParse(jsonish(r.event_log));
  const replayed = events.success ? rtmr3(events.data) : null;
  if (!events.success || !replayed || !equalBytes(replayed, td.rtMr3)) return refuse('rtmr3', 'the event log doesn’t replay to RTMR3');
  const said = (name: string) => events.data.find((e) => e.imr === 3 && e.event === name)?.event_payload.toLowerCase();
  if (said('os-image-hash') !== image.osImageHash) return refuse('os-image', 'the OS says it’s another image than it measures');
  const tcb = TcbInfo.safeParse(jsonish(r.info.tcb_info));
  if (!tcb.success) return refuse('compose', 'the report has no app compose');
  const compose = sha256(utf8(tcb.data.app_compose));
  if (!equalBytes(td.mrConfigId, concat(new Uint8Array([1]), compose, new Uint8Array(15)))) return refuse('compose', 'MRCONFIGID isn’t the app compose’s hash');
  if (said('compose-hash') !== hex(compose)) return refuse('compose', 'the compose-hash event isn’t the app compose’s hash');
  return { status, advisories, quoteHash: hex(sha256(quote)), image, compose: hex(compose), key };
}

/* ---------- the GPUs, through NVIDIA's attestation service ---------- */

const GpuPayload = z.object({ nonce: z.string(), arch: z.string(), evidence_list: z.array(z.unknown()).min(1) });
const NrasAnswer = z.tuple([z.tuple([z.literal('JWT'), z.string()])], z.unknown());
const Jwks = z.object({ keys: z.array(z.object({ kid: z.string(), x5c: z.array(z.string()).min(1) })) });
const Verdict = z.object({ 'x-nvidia-overall-att-result': z.boolean(), eat_nonce: z.string(), exp: z.number(), submods: z.record(z.string(), z.unknown()) });

const keysets = new Map<string, { until: number; keys: z.infer<typeof Jwks>['keys'] }>();
async function nrasKeys(cfg: Config, kid: string): Promise<z.infer<typeof Jwks>['keys'][number] | undefined> {
  const url = `${cfg.NVIDIA_NRAS_URL.replace(/\/$/, '')}/.well-known/jwks.json`;
  const hit = keysets.get(url);
  const found = hit && hit.until > Date.now() ? hit.keys.find((k) => k.kid === kid) : undefined;
  if (found) return found;
  let keys: z.infer<typeof Jwks>['keys'];
  try { keys = Jwks.parse(await (await fetched(url)).json()).keys; } catch (e) { return refuse('gpu-unavailable', `NRAS’s signing keys couldn’t be fetched: ${why(e)}`); }
  keysets.set(url, { until: Date.now() + 60 * 60_000, keys });
  return keys.find((k) => k.kid === kid);
}
/**
 * True when `chain` (leaf first) ends at `root`, every certificate current (allowing for the clocks, CLOCK_SKEW_S) and each
 * one signed by the next, a CA.
 */
function chainsTo(chain: X509Certificate[], root: X509Certificate, now: Date): boolean {
  const path = chain.at(-1)?.fingerprint256 === root.fingerprint256 ? chain.slice(0, -1) : chain;
  const skew = CLOCK_SKEW_S * 1000;
  const current = (c: X509Certificate) => Date.parse(c.validFrom) - skew <= now.getTime() && now.getTime() <= Date.parse(c.validTo) + skew;
  return path.length > 0 && current(root) && path.every((c, i) => {
    const issuer = path[i + 1] ?? root;
    return current(c) && (i === 0 || c.ca) && issuer.ca && c.checkIssued(issuer) && c.verify(issuer.publicKey);
  });
}

/** NVIDIA's verdict on a model's GPU evidence: how many GPUs, which architecture, and until when the verdict holds. */
async function checkGpu(cfg: Config, payloadText: string | undefined, nonce: Uint8Array): Promise<{ count: number; arch: string; until: number }> {
  const payload = GpuPayload.safeParse(jsonish(payloadText));
  if (!payloadText || !payload.success) return refuse('gpu', 'the model has no GPU evidence');
  if (payload.data.nonce.toLowerCase() !== hex(nonce)) return refuse('nonce', 'the GPU evidence answers another nonce');
  let token: string;
  try {
    const res = await fetch(`${cfg.NVIDIA_NRAS_URL.replace(/\/$/, '')}/v3/attest/gpu`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: payloadText, signal: AbortSignal.timeout(30_000)
    });
    if (res.status >= 400 && res.status < 500 && res.status !== 429) { await res.body?.cancel(); return refuse('gpu', `NVIDIA’s attestation service refused the GPU evidence (${res.status})`); }
    if (!res.ok) { await res.body?.cancel(); return refuse('gpu-unavailable', `NVIDIA’s attestation service answered ${res.status}`); }
    [[, token]] = NrasAnswer.parse(await res.json());
  } catch (e) {
    if (e instanceof Refusal) throw e;
    return refuse('gpu-unavailable', why(e));
  }
  let claims: z.infer<typeof Verdict>;
  try {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== 'ES384' || !kid) return refuse('gpu', 'NVIDIA’s verdict isn’t signed the way NRAS signs');
    const jwk = await nrasKeys(cfg, kid);
    if (!jwk) return refuse('gpu', 'NVIDIA’s verdict is signed by a key NRAS doesn’t publish');
    const chain = jwk.x5c.map((c) => new X509Certificate(Buffer.from(c, 'base64')));
    const leaf = chain[0];
    if (!leaf || !chainsTo(chain, new X509Certificate(cfg.NVIDIA_ROOT_CA), new Date())) return refuse('gpu', 'NRAS’s signing key doesn’t chain to NVIDIA’s root');
    const { payload: verdict } = await jwtVerify(token, leaf.publicKey, { algorithms: ['ES384'], issuer: new URL(cfg.NVIDIA_NRAS_URL).origin, clockTolerance: CLOCK_SKEW_S });
    claims = Verdict.parse(verdict);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    if (e instanceof jose.JWTExpired) return refuse('expired', 'NVIDIA’s verdict has expired');
    return refuse('gpu', why(e));
  }
  if (claims.eat_nonce.toLowerCase() !== hex(nonce)) return refuse('nonce', 'NVIDIA’s verdict is for another nonce');
  if (!claims['x-nvidia-overall-att-result']) return refuse('gpu', 'NVIDIA found the GPUs aren’t in confidential-computing mode as attested');
  if (Object.keys(claims.submods).length !== payload.data.evidence_list.length) return refuse('gpu', 'NVIDIA’s verdict doesn’t cover every GPU');
  return { count: payload.data.evidence_list.length, arch: payload.data.arch, until: claims.exp * 1000 };
}

/* ---------- a model ---------- */

interface Candidate { tdx: Tdx; gpu: { count: number; arch: string; until: number }; ohttp: KeyConfig }

async function checkModel(cfg: Config, raw: unknown, nonce: Uint8Array, model: string): Promise<Candidate> {
  const r = ModelReport.safeParse(raw);
  if (!r.success) return refuse('malformed', 'a model report with an unexpected shape');
  const m = r.data;
  if (m.model_name !== undefined && m.model_name !== model) return refuse('model-mismatch', 'a report for another model');
  if (m.signing_public_key !== undefined && m.signing_public_key.toLowerCase() !== m.signing_address.toLowerCase()) return refuse('signing-key', 'the public key isn’t the signing address');
  const tdx = await checkTdx(cfg, m, nonce, 'nonce-only');
  const gpu = await checkGpu(cfg, m.nvidia_payload, nonce);
  // Every request is sealed to this key; it's the model's because the attested key signed it.
  const o = m.ohttp_attestation;
  const config = o ? unhex(o.key_config) : null;
  const signature = o ? unhex(o.signature) : null;
  const signer = o ? unhex(o.signing_key) : null;
  if (!o || !config || !signature || signature.length !== 64 || o.signing_algo !== 'ed25519' || !signer || !equalBytes(signer, tdx.key)) return refuse('ohttp-key', 'the model’s OHTTP key isn’t signed by its attested key');
  if (!ed25519.verify(signature, config, tdx.key)) return refuse('ohttp-key', 'the OHTTP key’s signature doesn’t verify');
  const ohttp = parseKeyConfig(config);
  if (!ohttp) return refuse('ohttp-key', 'the OHTTP key doesn’t offer X25519 with AES-128-GCM');
  return { tdx, gpu, ohttp };
}

/** A model whose evidence checked out, and the key its requests are sealed to. */
export interface Verified {
  model: string;
  task: Task;
  /** The model's attested Ed25519 key, hex, which signed its OHTTP key. */
  key: string;
  /** The model's attested OHTTP key: every request is sealed to it. */
  ohttp: KeyConfig;
  /** What was checked, as a note keeps it. */
  evidence: InferenceEvidence;
  /** Until when this verification is used. */
  until: number;
}

async function verify(cfg: Config & { NEAR_AI_API_KEY: string }, model: string, task: Task): Promise<Verified> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const nonce = random(32);
  try {
    let res: Response;
    try {
      const q = new URLSearchParams({ model, provider: 'near', signing_algo: 'ed25519', include_tls_fingerprint: 'false', nonce: hex(nonce) });
      res = await fetch(`${cfg.NEAR_AI_BASE_URL.replace(/\/$/, '')}/attestation/report?${q}`, {
        headers: { authorization: `Bearer ${cfg.NEAR_AI_API_KEY}`, accept: 'application/json', 'x-no-aliasing': 'true' }, signal: AbortSignal.timeout(20_000)
      });
    } catch (e) { return refuse('report-unavailable', why(e)); }
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); return refuse('report-unavailable', `NEAR AI answered ${res.status}`); }
    const report = Report.safeParse(await res.json().catch(() => null));
    if (!report.success) return refuse('malformed', 'a report with an unexpected shape');
    const gateway = await checkTdx(cfg, report.data.gateway_attestation, nonce, 'report-data');
    const candidates = report.data.model_attestations ?? [];
    if (!candidates.length) return refuse('no-model-evidence', 'NEAR AI sent no model evidence');
    // Every candidate is checked; only those that pass may be used.
    const passed: Candidate[] = [];
    let first: Refusal | undefined;
    for (const [i, c] of candidates.entries()) {
      try { passed.push(await checkModel(cfg, c, nonce, model)); } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        first ??= e;
        elog.warn('model report refused', { model, task, code: e.check, reason: e.reason, candidate: i, candidates: candidates.length });
      }
    }
    const chosen = passed[0];
    if (!chosen) throw first ?? new Refusal('no-model-evidence', 'no model report passed');
    const until = Math.min(Date.now() + TTL_MS, chosen.gpu.until);
    const evidence: InferenceEvidence = {
      model, task, verifiedAt: new Date().toISOString(), key: hex(chosen.tdx.key), tdx: { status: chosen.tdx.status, quote: chosen.tdx.quoteHash }, os: chosen.tdx.image.image,
      gpu: { count: chosen.gpu.count, arch: chosen.gpu.arch }, compose: chosen.tdx.compose, gateway: { status: gateway.status, os: gateway.image.image, compose: gateway.compose }
    };
    elog.info('model verified', {
      model, task, code: 'verified', ms: ms(), tcb: chosen.tdx.status, gatewayTcb: gateway.status, os: chosen.tdx.image.image, gatewayOs: gateway.image.image,
      advisories: [...new Set([...gateway.advisories, ...chosen.tdx.advisories])], gpus: chosen.gpu.count, arch: chosen.gpu.arch, keyHash: fingerprint(chosen.tdx.key),
      quoteHash: chosen.tdx.quoteHash, compose: chosen.tdx.compose, gatewayCompose: gateway.compose, candidates: candidates.length, passed: passed.length,
      validS: Math.round((until - Date.now()) / 1000)
    });
    return { model, task, key: hex(chosen.tdx.key), ohttp: chosen.ohttp, evidence, until };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    const unavailable = UNAVAILABLE.has(e.check);
    elog.at(unavailable ? 'warn' : 'error', 'model evidence refused', { model, task, code: e.check, reason: e.reason, ms: ms() });
    throw new UnverifiedError(unavailable ? 'We couldn’t check NEAR AI’s private model right now, so nothing was sent. Try again in a moment.'
      : 'We couldn’t verify NEAR AI’s private model, so nothing was sent. Try again in a moment.', { context: { model, task, check: e.check }, level: unavailable ? 'warn' : 'error' });
  } finally {
    nonce.fill(0);
  }
}

/* ---------- kept verifications ---------- */

const kept = new Map<string, Verified>();
const refused = new Map<string, { until: number; error: UnverifiedError }>();
const running = new Map<string, Promise<Verified>>();
const idOf = (cfg: Config, model: string, task: Task) => `${cfg.NEAR_AI_BASE_URL}|${model}|${task}`;

/**
 * The model's current verification: the one kept, while it holds, or a new one. Requests that arrive
 * while one is being made wait for it, so a model is verified once however many clips come in; a
 * refusal stands for 30 seconds before the next request checks again.
 */
export async function verified(cfg: Config & { NEAR_AI_API_KEY: string }, model: string, task: Task): Promise<Verified> {
  const id = idOf(cfg, model, task);
  const hit = kept.get(id);
  if (hit && hit.until > Date.now()) return hit;
  const no = refused.get(id);
  if (no && no.until > Date.now()) throw no.error;
  const inFlight = running.get(id);
  if (inFlight) return inFlight;
  const made = verify(cfg, model, task)
    .then((v) => { kept.set(id, v); refused.delete(id); return v; }, (e: unknown) => {
      if (e instanceof UnverifiedError) refused.set(id, { until: Date.now() + REFUSED_MS, error: e });
      throw e;
    })
    .finally(() => running.delete(id));
  running.set(id, made);
  return made;
}

/** Stops using a verification whose key NEAR AI no longer accepts, so the next request verifies again. */
export function forget(cfg: Config, v: Verified): void {
  const id = idOf(cfg, v.model, v.task);
  if (kept.get(id)?.key === v.key) kept.delete(id);
}

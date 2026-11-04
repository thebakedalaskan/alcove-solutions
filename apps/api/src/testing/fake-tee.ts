/*
 * Stand-ins for the services that vouch for NEAR AI's hardware, for integration tests: Intel's
 * Provisioning Certification Service, with TDX quotes signed the way Intel's quoting enclave signs them
 * under a test SGX root, and NVIDIA's Remote Attestation Service, signing GPU verdicts under a test NVIDIA
 * root. Quotes, collateral and verdicts have the real formats, so the API checks them with the same code
 * it checks the real ones with; only the roots it's configured with differ.
 */
import { SignJWT } from 'jose';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { crl, der, issue, rawPublicKey, signRaw } from './pki';

export interface Answer { status: number; headers: Record<string, string>; body: Buffer }
const json = (v: unknown, headers: Record<string, string> = {}): Answer => ({ status: 200, headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(v)) });
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const YEAR = 365 * 86_400_000;
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

/* ---------- Intel ---------- */

/** The platform the test quotes come from, at TCB levels Intel's collateral calls up to date. */
const FMSPC = '90C06F000000';
const CPUSVN = [4, 4, 2, 2, 4, 1, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0];
const PCESVN = 13;
const TEE_TCB_SVN = [5, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const QE_MRSIGNER = 'dc9e2a7c6f948f17474e34a7fc43ed030f7c1563f1babddf6340c82e0e54a8c5';
const SGX = '1.2.840.113741.1.13.1';
const INTEL_QE_VENDOR = Buffer.from('939a7233f79c4ca9940a0db3957f0607', 'hex');
/** TD attributes as a production TD has them: no debug, SEPT_VE_DISABLE set. */
const TD_ATTRIBUTES = Buffer.from([0, 0, 0, 0x10, 0, 0, 0, 0]);

/** What a TD measured: the OS it booted (MRTD, RTMR0–2), what it ran (MRCONFIGID, RTMR3) and its report data. */
export interface Measured { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; mrConfigId: Uint8Array; rtmr3: Uint8Array; reportData: Uint8Array }

export interface FakeIntel {
  /** The test root, as INTEL_ROOT_CA. */
  rootPem: string;
  /** Where its collateral is, as INTEL_PCS_URL. */
  pcsUrl: string;
  /** A TDX quote of a TD that measured exactly this. */
  quote(td: Measured): Buffer;
  /** When set, Intel's TCB information has passed its next update, as when collateral is stale. */
  expired: boolean;
  /** The TCB status Intel's collateral gives the platform. */
  status: 'UpToDate' | 'OutOfDate';
  /** When set, Intel's service answers 503. */
  down: boolean;
  /** When set, quotes carry a PCK certificate without Intel's SGX extension, so they name no platform. */
  unnamed: boolean;
  answer(path: string, query: URLSearchParams): Answer | undefined;
}

/** Intel's side, served under `${origin}/intel`. */
export function fakeIntel(origin: string): FakeIntel {
  const base = `${origin}/intel`;
  const org = 'Alcove Tests (Intel stand-in)';
  const root = issue({ commonName: 'Alcove Test SGX Root CA', organization: org, curve: 'P-256', ca: true, crl: `${base}/IntelSGXRootCA.der`, notAfter: new Date(Date.now() + 10 * YEAR) });
  const platform = issue({ commonName: 'Alcove Test SGX PCK Platform CA', organization: org, curve: 'P-256', issuer: root, ca: true });
  const sgxExtension = der.sequence(
    der.sequence(der.oid(`${SGX}.1`), der.octets(randomBytes(16))),
    der.sequence(der.oid(`${SGX}.2`), der.sequence(
      ...CPUSVN.map((svn, i) => der.sequence(der.oid(`${SGX}.2.${i + 1}`), der.integer(svn))),
      der.sequence(der.oid(`${SGX}.2.17`), der.integer(PCESVN)),
      der.sequence(der.oid(`${SGX}.2.18`), der.octets(Buffer.from(CPUSVN)))
    )),
    der.sequence(der.oid(`${SGX}.3`), der.octets(Buffer.from([0, 0]))),
    der.sequence(der.oid(`${SGX}.4`), der.octets(Buffer.from(FMSPC, 'hex'))),
    der.sequence(der.oid(`${SGX}.5`), der.enumerated(1))
  );
  const pck = issue({ commonName: 'Alcove Test SGX PCK Certificate', organization: org, curve: 'P-256', issuer: platform, ca: false, extensions: [{ oid: SGX, der: sgxExtension }] });
  const unnamedPck = issue({ commonName: 'Alcove Test SGX PCK Certificate', organization: org, curve: 'P-256', issuer: platform, ca: false });
  const tcbSigner = issue({ commonName: 'Alcove Test SGX TCB Signing', organization: org, curve: 'P-256', issuer: root, ca: false });
  const attestation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const qeAuth = randomBytes(32);
  const measured = { mrSeam: randomBytes(48), mrEnclave: randomBytes(32) };
  const issuerChain = (...pems: string[]) => encodeURIComponent(pems.join(''));

  const self: FakeIntel = {
    rootPem: root.pem, pcsUrl: base, expired: false, status: 'UpToDate', down: false, unnamed: false,
    quote(td) {
      const header = Buffer.concat([u16(4), u16(2), u32(0x81), u16(0), u16(0), INTEL_QE_VENDOR, Buffer.alloc(20)]);
      const mr = (h: string) => Buffer.from(h, 'hex');
      const report = Buffer.concat([
        Buffer.from(TEE_TCB_SVN), measured.mrSeam, Buffer.alloc(48), Buffer.alloc(8), TD_ATTRIBUTES, Buffer.from('e702060000000000', 'hex'),
        mr(td.mrtd), Buffer.from(td.mrConfigId), Buffer.alloc(48), Buffer.alloc(48), mr(td.rtmr0), mr(td.rtmr1), mr(td.rtmr2), Buffer.from(td.rtmr3), Buffer.from(td.reportData)
      ]);
      const key = rawPublicKey(attestation.publicKey);
      const qeReport = Buffer.concat([
        Buffer.from(CPUSVN), u32(0), Buffer.alloc(28), Buffer.from('11000000000000000000000000000000', 'hex'), measured.mrEnclave, Buffer.alloc(32),
        Buffer.from(QE_MRSIGNER, 'hex'), Buffer.alloc(96), u16(2), u16(6), Buffer.alloc(60), sha256(Buffer.concat([key, qeAuth])), Buffer.alloc(32)
      ]);
      const leaf = self.unnamed ? unnamedPck : pck;
      const chain = Buffer.from(leaf.pem + platform.pem + root.pem);
      const certification = Buffer.concat([qeReport, signRaw(leaf.key, qeReport), u16(qeAuth.length), qeAuth, u16(5), u32(chain.length), chain]);
      const signed = Buffer.concat([header, report]);
      const auth = Buffer.concat([signRaw(attestation.privateKey, signed), key, u16(6), u32(certification.length), certification]);
      return Buffer.concat([signed, u32(auth.length), auth]);
    },
    answer(path, query) {
      if (!path.startsWith('/intel/')) return undefined;
      if (self.down) return { status: 503, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Service unavailable') };
      const now = Date.now();
      // Stale collateral was due a day ago; current collateral is due in a month, as Intel's is.
      const dates = { issueDate: iso(now - (self.expired ? 31 : 1) * 86_400_000), nextUpdate: iso(self.expired ? now - 86_400_000 : now + 30 * 86_400_000) };
      const signedJson = (member: string, value: unknown) => {
        const text = JSON.stringify(value);
        return Buffer.from(`{"${member}":${text},"signature":"${signRaw(tcbSigner.key, Buffer.from(text)).toString('hex')}"}`);
      };
      if (path === '/intel/IntelSGXRootCA.der') return { status: 200, headers: { 'content-type': 'application/pkix-crl' }, body: crl(root) };
      if (path === '/intel/sgx/certification/v4/pckcrl' && query.get('ca') === 'platform') {
        return { status: 200, headers: { 'content-type': 'application/pkix-crl', 'SGX-PCK-CRL-Issuer-Chain': issuerChain(platform.pem, root.pem) }, body: crl(platform) };
      }
      if (path === '/intel/tdx/certification/v4/tcb' && query.get('fmspc') === FMSPC) {
        const tcbInfo = {
          id: 'TDX', version: 3, ...dates, fmspc: FMSPC, pceId: '0000', tcbType: 0, tcbEvaluationDataNumber: 20,
          tdxModule: { mrsigner: '0'.repeat(96), attributes: '0000000000000000', attributesMask: 'FFFFFFFFFFFFFFFF' }, tdxModuleIdentities: [],
          tcbLevels: [{ tcb: { sgxtcbcomponents: CPUSVN.map((svn) => ({ svn })), pcesvn: PCESVN, tdxtcbcomponents: TEE_TCB_SVN.map((svn) => ({ svn })) }, tcbDate: '2025-08-13T00:00:00Z', tcbStatus: self.status }]
        };
        return { status: 200, headers: { 'content-type': 'application/json', 'TCB-Info-Issuer-Chain': issuerChain(tcbSigner.pem, root.pem) }, body: signedJson('tcbInfo', tcbInfo) };
      }
      if (path === '/intel/tdx/certification/v4/qe/identity') {
        const identity = {
          id: 'TD_QE', version: 2, ...dates, tcbEvaluationDataNumber: 20, miscselect: '00000000', miscselectMask: 'FFFFFFFF',
          attributes: '11000000000000000000000000000000', attributesMask: 'FBFFFFFFFFFFFFFF0000000000000000', mrsigner: QE_MRSIGNER.toUpperCase(), isvprodid: 2,
          tcbLevels: [{ tcb: { isvsvn: 4 }, tcbDate: '2025-08-13T00:00:00Z', tcbStatus: 'UpToDate' }]
        };
        return { status: 200, headers: { 'content-type': 'application/json', 'SGX-Enclave-Identity-Issuer-Chain': issuerChain(tcbSigner.pem, root.pem) }, body: signedJson('enclaveIdentity', identity) };
      }
      return undefined;
    }
  };
  return self;
}

/* ---------- NVIDIA ---------- */

/** Which key signs NRAS's verdicts: NVIDIA's, or one whose chain is wrong in a particular way. */
export type NrasSigner = 'nvidia' | 'other-root' | 'expired-intermediate' | 'intermediate-not-ca';

export interface FakeNvidia {
  /** The test root, as NVIDIA_ROOT_CA. */
  rootPem: string;
  /** Where its attestation service is, as NVIDIA_NRAS_URL. */
  nrasUrl: string;
  /** GPU evidence for eight Hopper GPUs, bound to `nonce`, as NEAR AI's model reports carry it (JSON text). */
  payload(nonce: string): string;
  /** What NRAS concludes: the GPUs check out, or they don't. */
  verdict: 'pass' | 'fail';
  /** How long a verdict holds, in seconds (NRAS gives an hour). */
  lifetime: number;
  signer: NrasSigner;
  /** When set, the verdict is for another nonce than the evidence's, as a replayed one would be. */
  stale: boolean;
  /** When set, NRAS (or only its published keys) answers 503. */
  down: 'no' | 'attest' | 'keys';
  answer(path: string, method: string, body: Buffer): Promise<Answer | undefined>;
}

/** NVIDIA's side, served under `${origin}/nvidia`. */
export function fakeNvidia(origin: string): FakeNvidia {
  const base = `${origin}/nvidia`;
  const org = 'Alcove Tests (NVIDIA stand-in)';
  const root = issue({ commonName: 'Alcove Test NVIDIA Attestation Service CA', organization: org, curve: 'P-384', ca: true, notAfter: new Date(Date.now() + 10 * YEAR) });
  const otherRoot = issue({ commonName: 'Alcove Test Someone Else’s CA', organization: 'Somewhere else', curve: 'P-384', ca: true });
  const chained = (name: string, rootOf: typeof root, intermediate: { ca: boolean; notBefore?: Date; notAfter?: Date }) => {
    const middle = issue({ commonName: `Alcove Test NVIDIA ${name} Intermediate`, organization: org, curve: 'P-384', issuer: rootOf, ...intermediate });
    const leaf = issue({ commonName: `Alcove Test NVIDIA ${name} Signing`, organization: org, curve: 'P-384', issuer: middle, ca: false });
    return { kid: `nv-eat-kid-test-${name}-${randomUUID()}`, middle, leaf };
  };
  const signers: Record<NrasSigner, ReturnType<typeof chained>> = {
    nvidia: chained('GPU', root, { ca: true }),
    'other-root': chained('Elsewhere', otherRoot, { ca: true }),
    'expired-intermediate': chained('Expired', root, { ca: true, notBefore: new Date(Date.now() - 2 * 86_400_000), notAfter: new Date(Date.now() - 86_400_000) }),
    'intermediate-not-ca': chained('Not-CA', root, { ca: false })
  };
  const sign = (claims: Record<string, unknown>, lifetime: number) => {
    const s = signers[self.signer];
    return new SignJWT(claims).setProtectedHeader({ alg: 'ES384', kid: s.kid }).setIssuer(base.replace(/\/nvidia$/, ''))
      .setIssuedAt().setNotBefore('0s').setExpirationTime(`${lifetime}s`).setJti(randomUUID()).sign(s.leaf.key);
  };
  const Payload = (v: unknown): { nonce: string; arch: string; evidence_list: { nonce?: string }[] } | null => {
    if (typeof v !== 'object' || v === null || !('nonce' in v) || !('arch' in v) || !('evidence_list' in v)) return null;
    const { nonce, arch, evidence_list: list } = v;
    return typeof nonce === 'string' && typeof arch === 'string' && Array.isArray(list) ? { nonce, arch, evidence_list: list.map((e: unknown) => (typeof e === 'object' && e !== null && 'nonce' in e && typeof e.nonce === 'string' ? { nonce: e.nonce } : {})) } : null;
  };
  const self: FakeNvidia = {
    rootPem: root.pem, nrasUrl: base, verdict: 'pass', lifetime: 3600, signer: 'nvidia', stale: false, down: 'no',
    payload: (nonce) => JSON.stringify({
      nonce, arch: 'HOPPER',
      evidence_list: Array.from({ length: 8 }, () => ({ arch: 'HOPPER', certificate: randomBytes(48).toString('base64'), evidence: randomBytes(96).toString('base64'), nonce }))
    }),
    async answer(path, method, body) {
      if (!path.startsWith('/nvidia/')) return undefined;
      const unavailable: Answer = { status: 503, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Service unavailable') };
      if (path === '/nvidia/.well-known/jwks.json') {
        if (self.down === 'keys') return unavailable;
        return json({ keys: Object.values(signers).map((s) => ({ ...s.leaf.publicKey.export({ format: 'jwk' }), kid: s.kid, alg: 'ES384', use: 'sig', x5c: [s.leaf.der.toString('base64'), s.middle.der.toString('base64')] })) });
      }
      if (path !== '/nvidia/v3/attest/gpu' || method !== 'POST') return undefined;
      if (self.down === 'attest') return unavailable;
      let parsed: unknown = null;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { /* answered below */ }
      const p = Payload(parsed);
      if (!p) return { status: 400, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"message":"Invalid evidence"}') };
      const each = await Promise.all(p.evidence_list.map((e) => sign({
        'x-nvidia-gpu-attestation-report-nonce-match': e.nonce === p.nonce, 'x-nvidia-gpu-arch-check': p.arch === 'HOPPER', measres: self.verdict === 'pass' ? 'success' : 'fail',
        dbgstat: 'disabled', hwmodel: 'GH100', eat_nonce: p.nonce
      }, self.lifetime)));
      const overall = await sign({
        sub: 'NVIDIA-PLATFORM-ATTESTATION', 'x-nvidia-ver': '2.0', 'x-nvidia-overall-att-result': self.verdict === 'pass' && p.evidence_list.every((e) => e.nonce === p.nonce),
        submods: Object.fromEntries(each.map((t, i) => [`GPU-${i}`, ['DIGEST', ['SHA-256', sha256(Buffer.from(t)).toString('hex')]]])), eat_nonce: self.stale ? randomBytes(32).toString('hex') : p.nonce
      }, self.lifetime);
      return json([['JWT', overall], Object.fromEntries(each.map((t, i) => [`GPU-${i}`, t]))]);
    }
  };
  return self;
}

/*
 * Certificates and revocation lists for the stand-in attestation services: test roots, intermediates
 * and leaves made at the start of a run, in DER exactly as the verifiers parse it. They play Intel's and
 * NVIDIA's roles in tests; the API is pointed at these roots and checks them the same way as the real ones.
 * They play Google's Confidential Space root (RSA) and an ACME CA too, which certifies a key it's given.
 */
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  AlgorithmIdentifier, AttributeTypeAndValue, AttributeValue, BasicConstraints, CRLDistributionPoints, Certificate, CertificateList, DistributionPoint,
  DistributionPointName, Extension, Extensions, GeneralName, KeyUsage, KeyUsageFlags, Name, RelativeDistinguishedName, SubjectAlternativeName, SubjectPublicKeyInfo,
  TBSCertList, TBSCertificate, Time, Validity, Version, id_ce_basicConstraints, id_ce_cRLDistributionPoints, id_ce_keyUsage, id_ce_subjectAltName
} from '@peculiar/asn1-x509';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** The key a certificate is for: an EC curve, or RSA (2048 bits, signing with SHA-256, as Google's Confidential Space chain does). */
export type Curve = 'P-256' | 'P-384' | 'RSA';
const ALG = {
  'P-256': { oid: '1.2.840.10045.4.3.2', hash: 'sha256' }, 'P-384': { oid: '1.2.840.10045.4.3.3', hash: 'sha384' }, RSA: { oid: '1.2.840.113549.1.1.11', hash: 'sha256' }
} as const;
/** How a certificate says what signed it: RSA's algorithm takes a NULL parameter, ECDSA's none. */
const algorithm = (curve: Curve) => new AlgorithmIdentifier(curve === 'RSA' ? { algorithm: ALG.RSA.oid, parameters: null } : { algorithm: ALG[curve].oid });
const keyPair = (curve: Curve) => (curve === 'RSA' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: curve === 'P-256' ? 'prime256v1' : 'secp384r1' }));

/** A certificate this run issued, with its private key. */
export interface Issued { der: Buffer; pem: string; name: Name; key: KeyObject; publicKey: KeyObject; curve: Curve }

export const pemOf = (der: Uint8Array, label = 'CERTIFICATE') => `-----BEGIN ${label}-----\n${(Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;
const ab = (b: Uint8Array): ArrayBuffer => new Uint8Array(b).buffer;
/** Whole seconds: certificate times don't keep milliseconds. */
const seconds = (d: Date) => new Date(Math.floor(d.getTime() / 1000) * 1000);
const DAY = 86_400_000;

function nameOf(commonName: string, organization: string): Name {
  const rdn = (type: string, value: string) => new RelativeDistinguishedName([new AttributeTypeAndValue({ type, value: new AttributeValue({ utf8String: value }) })]);
  return new Name([rdn('2.5.4.3', commonName), rdn('2.5.4.10', organization)]);
}
const ext = (extnID: string, critical: boolean, value: ArrayBuffer | Uint8Array) => new Extension({ extnID, critical, extnValue: new OctetString(value instanceof Uint8Array ? ab(value) : value) });

/**
 * Issues a certificate: self-signed without an issuer. CAs may sign certificates and revocation lists;
 * `extensions` adds raw ones (Intel's SGX extension), `crl` names where the issuer's revocation list is.
 */
export function issue(o: {
  commonName: string; organization: string; curve: Curve; issuer?: Issued | undefined; ca: boolean;
  notBefore?: Date | undefined; notAfter?: Date | undefined; crl?: string | undefined; extensions?: { oid: string; der: Uint8Array }[] | undefined;
}): Issued {
  const { privateKey, publicKey } = keyPair(o.curve);
  const name = nameOf(o.commonName, o.organization);
  const der = certificate({ ...o, name, publicKey, signer: o.issuer ?? { name, key: privateKey, curve: o.curve } });
  return { der, pem: pemOf(der), name, key: privateKey, publicKey, curve: o.curve };
}

/** A leaf for a key someone else holds (as a CA certifies the key in a request), naming `hosts`, signed by `issuer`. */
export function certify(publicKey: KeyObject, o: { hosts: string[]; issuer: Issued; notBefore?: Date | undefined; notAfter?: Date | undefined }): { der: Buffer; pem: string } {
  const [first = 'localhost'] = o.hosts;
  const san = AsnConvert.serialize(new SubjectAlternativeName(o.hosts.map((dNSName) => new GeneralName({ dNSName }))));
  const der = certificate({ ...o, name: nameOf(first, 'Alcove Tests'), publicKey, signer: o.issuer, ca: false, extensions: [{ oid: id_ce_subjectAltName, der: new Uint8Array(san) }] });
  return { der, pem: pemOf(der) };
}

function certificate(o: {
  name: Name; publicKey: KeyObject; signer: { name: Name; key: KeyObject; curve: Curve }; ca: boolean;
  notBefore?: Date | undefined; notAfter?: Date | undefined; crl?: string | undefined; extensions?: { oid: string; der: Uint8Array }[] | undefined;
}): Buffer {
  const { name, publicKey, signer } = o;
  const alg = ALG[signer.curve];
  const extensions = [
    ...(o.ca ? [
      ext(id_ce_basicConstraints, true, AsnConvert.serialize(new BasicConstraints({ cA: true }))),
      ext(id_ce_keyUsage, true, AsnConvert.serialize(new KeyUsage(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign)))
    ] : []),
    ...(o.crl ? [ext(id_ce_cRLDistributionPoints, false, AsnConvert.serialize(new CRLDistributionPoints([
      new DistributionPoint({ distributionPoint: new DistributionPointName({ fullName: [new GeneralName({ uniformResourceIdentifier: o.crl })] }) })
    ])))] : []),
    ...(o.extensions ?? []).map((e) => ext(e.oid, false, e.der))
  ];
  const tbs = new TBSCertificate({
    version: Version.v3,
    // A positive serial: a leading 0x01, then random bytes.
    serialNumber: ab(new Uint8Array([1, ...randomBytes(15)])),
    signature: algorithm(signer.curve),
    issuer: signer.name,
    validity: new Validity({ notBefore: seconds(o.notBefore ?? new Date(Date.now() - DAY)), notAfter: seconds(o.notAfter ?? new Date(Date.now() + 365 * DAY)) }),
    subject: name,
    subjectPublicKeyInfo: AsnConvert.parse(publicKey.export({ type: 'spki', format: 'der' }), SubjectPublicKeyInfo),
    extensions: new Extensions(extensions)
  });
  const signature = sign(alg.hash, Buffer.from(AsnConvert.serialize(tbs)), signer.key);
  return Buffer.from(AsnConvert.serialize(new Certificate({ tbsCertificate: tbs, signatureAlgorithm: algorithm(signer.curve), signatureValue: ab(signature) })));
}

/** An empty revocation list from `issuer`, current from `thisUpdate` to `nextUpdate`. */
export function crl(issuer: Issued, o: { thisUpdate?: Date; nextUpdate?: Date } = {}): Buffer {
  const alg = ALG[issuer.curve];
  const tbs = new TBSCertList({
    version: Version.v2, signature: algorithm(issuer.curve), issuer: issuer.name,
    thisUpdate: new Time(seconds(o.thisUpdate ?? new Date(Date.now() - DAY))), nextUpdate: new Time(seconds(o.nextUpdate ?? new Date(Date.now() + 30 * DAY)))
  });
  const signature = sign(alg.hash, Buffer.from(AsnConvert.serialize(tbs)), issuer.key);
  return Buffer.from(AsnConvert.serialize(new CertificateList({ tbsCertList: tbs, signatureAlgorithm: algorithm(issuer.curve), signature: ab(signature) })));
}

/** An ECDSA signature as Intel's quotes and collateral carry it: r and s, 32 bytes each. */
export const signRaw = (key: KeyObject, data: Uint8Array) => sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
/** A P-256 public key as Intel's quotes carry it: x and y, 32 bytes each. */
export function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from(jwk.x ?? '', 'base64url'), Buffer.from(jwk.y ?? '', 'base64url')]);
}

/* ---------- a little DER, for Intel's SGX extension ---------- */

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, content: Uint8Array) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
export const der = {
  sequence: (...items: Uint8Array[]) => tlv(0x30, Buffer.concat(items)),
  octets: (b: Uint8Array) => tlv(0x04, b),
  integer: (n: number) => { const b: number[] = []; for (let v = n; v > 0 || !b.length; v = Math.floor(v / 256)) b.unshift(v % 256); return tlv(0x02, Buffer.from((b[0] ?? 0) & 0x80 ? [0, ...b] : b)); },
  enumerated: (n: number) => tlv(0x0a, Buffer.from([n])),
  oid(dotted: string) {
    const [a = 0, b = 0, ...rest] = dotted.split('.').map(Number);
    const body: number[] = [a * 40 + b];
    for (const arc of rest) {
      const groups: number[] = [];
      for (let v = arc; ; v = Math.floor(v / 128)) { groups.unshift(v % 128); if (v < 128) break; }
      body.push(...groups.map((g, i) => (i < groups.length - 1 ? g | 0x80 : g)));
    }
    return tlv(0x06, Buffer.from(body));
  }
};

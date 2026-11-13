/*
 * Ordering a certificate (docs: system-architecture › The edge): one certificate naming every TLS host, for the TLS key
 * (tls-keys.ts), from an ACME CA (Let's Encrypt), asked for by the account whose key the master makes. Each host is proved with
 * a dns-01 challenge: its _acme-challenge TXT record goes up in Cloudflare's DNS, the CA is told once a public resolver sees
 * it, and it comes down again however the order ends. No request to the CA waits more than 30 seconds, so an order that
 * stalls ends, and with it the lock the instance ordering holds (certificates.ts).
 */
import { Client, axios as acmeHttp, crypto as acmeCrypto } from 'acme-client';
import { X509Certificate } from 'node:crypto';
import { UnavailableError } from '../platform/errors';
import { log } from '../platform/log';
import { untilVisible, type DnsServices, type Zone } from './dns';

const alog = log.child({ component: 'edge' });

export interface Ordered { chainPem: string; notAfter: Date; accountUri: string }

/** The longest one request to the CA may take. */
const CA_MS = 30_000;
acmeHttp.defaults.timeout = CA_MS;

export interface Order {
  hosts: readonly string[];
  /** The ACME directory: Let's Encrypt's, or its staging one. */
  directory: string;
  accountKeyPem: string;
  tlsKeyPem: string;
  zone: Zone;
  dns: DnsServices;
}

/** Orders a certificate for every host in `o.hosts`. */
export async function orderCertificate(o: Order): Promise<Ordered> {
  const t0 = performance.now();
  const [commonName] = o.hosts;
  if (!commonName) throw new UnavailableError('A certificate names at least one host.');
  const client = new Client({ directoryUrl: o.directory, accountKey: o.accountKeyPem });
  await client.createAccount({ termsOfServiceAgreed: true });
  // The account the master's key makes: a CAA record naming it lets nothing else get a certificate for these hosts.
  const accountUri = client.getAccountUrl();
  alog.info('acme account', { accountUri });
  const order = await client.createOrder({ identifiers: o.hosts.map((value) => ({ type: 'dns', value })) });
  const authorizations = await client.getAuthorizations(order);
  const up: { id: string; name: string }[] = [];
  try {
    const pending: { challenge: (typeof authorizations)[number]['challenges'][number]; name: string; value: string }[] = [];
    for (const authz of authorizations.filter((a) => a.status !== 'valid')) {
      const challenge = authz.challenges.find((c) => c.type === 'dns-01');
      if (!challenge) throw new UnavailableError('The CA offered no dns-01 challenge for a host.', { context: { status: authz.status } });
      const name = `_acme-challenge.${authz.identifier.value}`;
      const value = await client.getChallengeKeyAuthorization(challenge);
      const cleared = await o.zone.clear(name);
      if (cleared) alog.info('old challenge records taken down', { records: cleared });
      up.push({ id: await o.zone.add(name, value), name });
      pending.push({ challenge, name, value });
    }
    await untilVisible(pending, o.dns);
    for (const p of pending) await client.completeChallenge(p.challenge);
    for (const p of pending) await client.waitForValidStatus(p.challenge);
    const [, csr] = await acmeCrypto.createCsr({ commonName, altNames: [...o.hosts] }, o.tlsKeyPem);
    const chainPem = await client.getCertificate(await client.finalizeOrder(order, csr));
    const notAfter = new Date(new X509Certificate(chainPem).validTo);
    alog.info('tls certificate issued', { hosts: o.hosts.length, notAfter: notAfter.toISOString(), ms: Math.round(performance.now() - t0) });
    return { chainPem, notAfter, accountUri };
  } finally {
    for (const r of up) await o.zone.remove(r.id).catch((e: unknown) => alog.warn('a challenge record wasn’t taken down', { err: e }));
  }
}

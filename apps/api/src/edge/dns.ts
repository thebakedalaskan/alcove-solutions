/*
 * The TXT records ACME's dns-01 challenges are answered with (_acme-challenge.<host>), in the Cloudflare zone the TLS hosts
 * are in, through Cloudflare's API, and the wait until a public resolver sees them, which is when the CA can.
 */
import { z } from 'zod';
import { UnavailableError } from '../errors';
import { log } from '../log';

const dlog = log.child({ component: 'edge' });

/** Where Cloudflare's API and the resolver that's asked whether records are up are: Cloudflare's own, or a test's stand-ins, chosen in start.ts › OUTSIDE. */
export interface DnsServices { cloudflare: string; resolver: string }
export const CLOUDFLARE: DnsServices = { cloudflare: 'https://api.cloudflare.com/client/v4', resolver: 'https://cloudflare-dns.com/dns-query' };

const TIMEOUT_MS = 15_000;
/** How long records have to show up before the order is given up on, and how often the resolver is asked meanwhile. */
const VISIBLE_MS = 180_000;
const LOOK_EVERY_MS = 2_000;

const Answer = <S extends z.ZodType>(result: S) => z.object({ success: z.boolean(), errors: z.array(z.object({ code: z.number() })).default([]), result: result.nullable().optional() });
const Records = z.array(z.object({ id: z.string() }));
const Zones = z.array(z.object({ id: z.string() }));
const Resolved = z.object({ Status: z.number(), Answer: z.array(z.object({ type: z.number(), data: z.string() })).default([]) });

/** A zone's TXT records, as far as dns-01 challenges need them. */
export interface Zone {
  /** Puts a TXT record up, and says its ID, to take it down by. */
  add(name: string, value: string): Promise<string>;
  remove(id: string): Promise<void>;
  /** Takes every TXT record called `name` down: what an order that stopped part way left behind. How many there were. */
  clear(name: string): Promise<number>;
}

/** Cloudflare's zone `zone` (its ID, or its name, which is looked up), edited with `token`. */
export async function cloudflareZone(zone: string, token: string, at: DnsServices): Promise<Zone> {
  const ask = async <S extends z.ZodType>(what: string, path: string, result: S, init: RequestInit = {}): Promise<z.infer<S> | null | undefined> => {
    let res: Response;
    try {
      res = await fetch(`${at.cloudflare}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new UnavailableError('Cloudflare couldn’t be reached.', { cause: e, context: { what } });
    }
    const answer = Answer(result).safeParse(await res.json().catch(() => undefined));
    if (!res.ok || !answer.success || !answer.data.success) {
      throw new UnavailableError('Cloudflare refused a change to the DNS.', { context: { what, status: res.status, codes: answer.success ? answer.data.errors.map((e) => e.code) : [] } });
    }
    return answer.data.result;
  };
  let id = zone;
  if (!/^[0-9a-f]{32}$/.test(zone)) {
    const found = await ask('find zone', `/zones?name=${encodeURIComponent(zone)}`, Zones);
    const first = found?.[0];
    if (!first) throw new UnavailableError('Cloudflare has no zone by that name for this token.', { context: { what: 'find zone' } });
    id = first.id;
  }
  const records = `/zones/${id}/dns_records`;
  return {
    async add(name, value) {
      const made = await ask('add record', records, z.object({ id: z.string() }), { method: 'POST', body: JSON.stringify({ type: 'TXT', name, content: value, ttl: 60 }) });
      if (!made) throw new UnavailableError('Cloudflare made a record it didn’t say the ID of.', { context: { what: 'add record' } });
      return made.id;
    },
    async remove(record) {
      await ask('remove record', `${records}/${record}`, z.object({ id: z.string() }), { method: 'DELETE' });
    },
    async clear(name) {
      const found = (await ask('list records', `${records}?type=TXT&name=${encodeURIComponent(name)}`, Records)) ?? [];
      for (const r of found) await ask('remove record', `${records}/${r.id}`, z.object({ id: z.string() }), { method: 'DELETE' });
      return found.length;
    }
  };
}

/** What a TXT record says, as a resolver gives it: in quotes, possibly as several strings. */
const unquote = (data: string) => [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? '').join('') || data;

/** Waits until a public resolver gives every one of `records`, which is when the CA can see them too. */
export async function untilVisible(records: { name: string; value: string }[], at: DnsServices): Promise<void> {
  const by = Date.now() + VISIBLE_MS;
  const seen = async ({ name, value }: { name: string; value: string }) => {
    const res = await fetch(`${at.resolver}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => undefined);
    const answer = Resolved.safeParse(await res?.json().catch(() => undefined));
    return answer.success && answer.data.Answer.some((a) => a.type === 16 && unquote(a.data) === value);
  };
  for (;;) {
    const shown = await Promise.all(records.map(seen));
    if (shown.every(Boolean)) return;
    if (Date.now() > by) throw new UnavailableError('The challenge records didn’t show up in DNS in time.', { context: { records: records.length, shown: shown.filter(Boolean).length } });
    dlog.debug('waiting for the challenge records', { records: records.length, shown: shown.filter(Boolean).length });
    await new Promise((r) => setTimeout(r, LOOK_EVERY_MS));
  }
}

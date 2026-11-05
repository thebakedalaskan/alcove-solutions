/*
 * Reads what's pasted into Who: addresses separated by commas, semicolons, spaces or lines, with names as mail
 * programs write them (`Priya Shah <priya@harbourline.co>`). Each address once, whatever its case. What can't be read is
 * flagged, with a fix when the rest of the list gives one away.
 */
import { isEmail } from '~/lib/people';

export interface Address { email: string; name?: string | undefined }
/** Something in a list that isn't an address, and the address it probably is. */
export interface Unread { raw: string; fix?: string | undefined }
export interface AddressList { addresses: Address[]; unread: Unread[] }

/** `Name <address>`, with the name as far back as the last line or semicolon. */
const ANGLED = /([^<>;\n]*)<([^<>]*)>/g;
const clean = (s: string) => s.trim().replace(/^mailto:/i, '').replace(/^[("'[{]+|[)"'\]},.:]+$/g, '');

export function readAddresses(text: string): AddressList {
  const seen = new Map<string, Address>();
  const unread = new Map<string, Unread>();
  const read = (chunk: string, name?: string | undefined) => {
    const raw = clean(chunk);
    if (!raw) return;
    const email = raw.toLowerCase();
    if (isEmail(email)) {
      if (!seen.has(email)) seen.set(email, { email, ...(name ? { name } : {}) });
    } else if (!unread.has(email)) unread.set(email, { raw });
  };

  /* A segment with one address: any other words are the name it was pasted with. */
  const segment = (text: string) => {
    const words = text.trim().split(/\s+/).filter((w) => clean(w));
    if (!words.length) return;
    const addresses = words.filter((w) => w.includes('@'));
    if (!addresses.length) { read(words.join(' ')); return; }
    if (addresses.length === 1) {
      const rest = words.filter((w) => !w.includes('@')).map(clean).join(' ');
      read(addresses[0] ?? '', rest || undefined);
      return;
    }
    for (const w of words) read(w);
  };

  const rest = text.replace(ANGLED, (_, before: string, address: string) => {
    const parts = before.replace(/^[\s,;]+/, '').split(',');
    const named = parts.filter((p) => !p.includes('@'));
    for (const p of parts) if (p.includes('@')) segment(p);
    read(address, clean(named.join(',').replace(/\s+/g, ' ')) || undefined);
    return '\n';
  });
  for (const s of rest.split(/[\n;,]+/)) segment(s);

  const addresses = [...seen.values()];
  const domains = [...new Set(addresses.map((a) => a.email.slice(a.email.indexOf('@') + 1)))];
  return { addresses, unread: [...unread.values()].map((u) => ({ ...u, ...fixFor(u.raw, domains) })) };
}

/** The address `raw` probably is, from the domains of the addresses around it: only when there's one answer. */
function fixFor(raw: string, domains: readonly string[]): { fix?: string } {
  const at = raw.indexOf('@');
  if (at <= 0) return {};
  const local = raw.slice(0, at);
  const typed = raw.slice(at + 1).replace(/^@+/, '').toLowerCase();
  const matches = typed ? domains.filter((d) => d.startsWith(`${typed}.`)) : domains;
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ? { fix: `${local.toLowerCase()}@${only}` } : {};
}

/** What's wrong with `u`, in a sentence. */
export function unreadLine(u: Unread): string {
  if (!u.fix) return `Alcove can’t read ${u.raw} as an address.`;
  const typed = u.raw.slice(u.raw.indexOf('@') + 1).replace(/^@+/, '').toLowerCase();
  const domain = u.fix.slice(u.fix.indexOf('@') + 1);
  return typed && domain.startsWith(typed) ? `${u.raw} needs its ending. Did you mean ${domain.slice(typed.length)}?` : `${u.raw} isn’t finished. Did you mean ${u.fix}?`;
}

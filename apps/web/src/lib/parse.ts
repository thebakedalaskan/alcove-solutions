/*
 * Reads a sentence like "Design review with Priya tomorrow 3pm for 45 min" into a call: who is
 * invited, when it is, how long it runs and whether it has notes. Whatever isn't understood stays
 * in the title.
 */

/** Someone a first name can stand for: colleagues and people you've had calls with. */
export interface Known { name: string; email: string }
/** A guest is an email address, or a name typed without one that still needs an address. */
export type Guest = { kind: 'email'; email: string } | { kind: 'name'; name: string };
export interface ParsedCall {
  title: string;
  /** Present when a day or a time was typed: the call is scheduled instead of starting now. */
  when?: { start: Date; minutes: number } | undefined;
  /** A length that was typed ("for 45 min"), whether or not a time was. */
  duration?: number | undefined;
  guests: Guest[];
  /** The sentence says "no notes" or "without notes". */
  notesOff: boolean;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
/** Words after "with" that aren't people. */
const NOT_PEOPLE = new Set(['the', 'a', 'an', 'my', 'our', 'your', 'their', 'team', 'everyone', 'them', 'us', 'me', 'notes']);

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseCall(raw: string, now: Date, known: Known[]): ParsedCall {
  let t = ` ${raw} `;
  const cut = (s: string) => { t = t.replace(s, ' '); };
  const guests: Guest[] = [];
  const add = (g: Guest) => {
    const dup = guests.some((x) => (x.kind === 'email' && g.kind === 'email' && x.email === g.email) || (x.kind === 'name' && g.kind === 'name' && fold(x.name) === fold(g.name)));
    if (!dup) guests.push(g);
  };

  // Email addresses first: each becomes a token the rest of the parser steps around.
  const mails: string[] = [];
  t = t.replace(/[^\s,;<>()]+@[^\s,;<>()]+\.[a-z]{2,}/gi, (e) => { mails.push(e.toLowerCase()); return ` §${mails.length - 1}§ `; });
  const mailAt = (i: string | undefined) => mails[Number(i)] ?? '';

  let notesOff = false;
  const noNotes = t.match(/\b(?:no|without) notes\b/i);
  if (noNotes) { notesOff = true; cut(noNotes[0]); }

  let minutes: number | undefined;
  const dur = t.match(/\bfor (?:an? )?(\d+(?:\.\d+)?)?\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
  if (dur) {
    const n = dur[1] ? Number.parseFloat(dur[1]) : 1;
    minutes = Math.max(5, Math.min(480, Math.round(/^h/i.test(dur[2] ?? '') ? n * 60 : n)));
    cut(dur[0]);
  }

  let time: { h: number; m: number } | undefined;
  const tm = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i) ?? t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (tm) {
    let h = Number.parseInt(tm[1] ?? '', 10);
    const m = tm[2] ? Number.parseInt(tm[2], 10) : 0;
    const ap = (tm[3] ?? '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (!ap && h < 8) h += 12;
    if (h < 24 && m < 60) { time = { h, m }; cut(tm[0]); }
  } else {
    const noon = t.match(/\b(?:at\s+)?noon\b/i);
    if (noon) { time = { h: 12, m: 0 }; cut(noon[0]); }
  }

  let dayOffset: number | undefined;
  const dm = t.match(/\b(today|tonight|tomorrow|(?:next\s+)?(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?)\b/i);
  if (dm) {
    const word = (dm[1] ?? '').toLowerCase();
    const w = word.replace(/^next\s+/, '');
    if (w === 'today' || w === 'tonight') dayOffset = 0;
    else if (w === 'tomorrow') dayOffset = 1;
    else {
      const i = WEEKDAYS.findIndex((d) => d.startsWith(w.slice(0, 3)));
      if (i >= 0) {
        let off = (i - now.getDay() + 7) % 7;
        if (off === 0) off = 7;
        if (word.startsWith('next') && off < 7) off += 7;
        dayOffset = off;
      }
    }
    if (dayOffset !== undefined) cut(dm[0]);
  }

  // "with Priya, Kofi and jamie@harbourline.co"
  const NAME = "(?:§\\d+§|[a-zà-ÿ'-]+)";
  const wm = t.match(new RegExp(`\\bwith\\s+(${NAME}(?:\\s*(?:,|\\band\\b|&)\\s*${NAME})*)`, 'i'));
  const names = wm ? (wm[1] ?? '').split(/\s*(?:,|\band\b|&)\s*/i).filter(Boolean) : [];
  if (wm && names.length && !names.some((n) => NOT_PEOPLE.has(n.toLowerCase()))) {
    for (const n of names) {
      const tok = n.match(/^§(\d+)§$/);
      if (tok) { add({ kind: 'email', email: mailAt(tok[1]) }); continue; }
      const k = known.find((p) => fold(firstOf(p.name)) === fold(n));
      add(k ? { kind: 'email', email: k.email } : { kind: 'name', name: capital(n) });
    }
    cut(wm[0]);
  }
  // Addresses typed anywhere else in the sentence.
  t = t.replace(/§(\d+)§/g, (_, i: string) => { add({ kind: 'email', email: mailAt(i) }); return ' '; });

  const title = capital(t.replace(/\s+/g, ' ').replace(/^\s*(?:a|an)\s+/i, '').replace(/\s+(?:with|and|&)\s*$/i, '').trim());

  let when: ParsedCall['when'];
  if (time || dayOffset !== undefined) {
    const start = new Date(now);
    start.setSeconds(0, 0);
    if (dayOffset !== undefined) start.setDate(start.getDate() + dayOffset);
    if (time) {
      start.setHours(time.h, time.m);
      // A time on its own is the next one: later today, or tomorrow once it has passed.
      if (dayOffset === undefined && start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
    } else if (dayOffset === 0) start.setHours(now.getHours(), Math.ceil((now.getMinutes() + 1) / 30) * 30);
    else start.setHours(10, 0);
    when = { start, minutes: minutes ?? 30 };
  }
  return { title, when, duration: minutes, guests, notesOff };
}

/** Takes one guest back out of the sentence: their name, their address, and the "and" before it. */
export function dropFromSentence(raw: string, word: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = isEmail(word) ? esc : `\\b${esc}\\b`;
  return raw.replace(new RegExp(`(,\\s*|\\s+and\\s+)?${pat}`, 'i'), '').replace(/\bwith\s*(?=\s|$)/i, '').replace(/\s+/g, ' ').trimStart();
}

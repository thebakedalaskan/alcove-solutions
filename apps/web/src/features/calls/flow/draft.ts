/*
 * A call being scheduled, as it's put together in the scheduler on the Calls page. It lives while the scheduler is open:
 * closing drops it, and opening it again starts clean.
 */
import { DEFAULT_NOTES_CHOICES, type Document, type NotesChoices, type NotesSetting, type Person, type Preferences, type RepeatInput, type RepeatRule } from '@alcove/api';
import { byEmail, callName, someNames } from '~/lib/people';
import { timeZone } from '~/lib/time';
import type { Unread } from '../scheduling/addresses';
import { expandRepeat, localDay, localWeekday, monthlyRule, untilForCalls } from '../scheduling/times';

/**
 * Who a call is with, as the Who field shows them. A group, everyone, or a pasted list is one token however many
 * people it stands for, and tokens can overlap: `guestsOf` counts each person once.
 */
export type Token =
  | { kind: 'person'; id: string; person: Person }
  | { kind: 'group'; id: string; name: string; people: Person[] }
  | { kind: 'everyone'; id: string; name: string; people: Person[] }
  | { kind: 'list'; id: string; people: Person[] };

/** The people on a call being put together, and what couldn't be read of a pasted list. */
export interface Guests { tokens: Token[]; unread: Unread[] }

export type RepeatKind = 'none' | 'week' | 'two-weeks' | 'month' | 'days';
export interface Repeating {
  kind: RepeatKind;
  /** The other days picked for `days`, 0 is Sunday. The first call's own day always counts, whichever it turns out to be. */
  days: number[];
  /** How many calls it runs for, once someone has said. Until then it runs for a few. */
  calls: number | null;
}

/** Everything about a call being put together but when it is: the scheduler keeps that. */
export interface Draft extends Guests {
  repeat: Repeating;
  title: string;
  /** Someone typed the title: it stops following who's invited. */
  titled: boolean;
  notes: NotesSetting;
  choices: NotesChoices;
  /** Set for a big call; null means it was never touched, and the size of the call decides. */
  joinMuted: boolean | null;
  documents: Document[];
  /** The call's home, where its notes and transcript go: one of your workspaces, or null for a new one made for the call. */
  home: { id: string; name: string } | null;
}

export const NOT_REPEATING: Repeating = { kind: 'none', days: [], calls: null };
/** How long a call is until someone says otherwise: the scheduler's, and the outline pressing the Calls page's week shows. */
export const FIRST_LENGTH = 45;
/** How many calls a repeat runs for until someone sets an end date. */
const CALLS_TO_START_WITH = 4;
/** Past this many people, Details offers big-call settings, already on. */
export const BIG_CALL = 25;

export function newDraft(prefs: Preferences | undefined, preset: { people: readonly Person[]; name?: string | undefined; documents?: readonly Document[] | undefined }): Draft {
  return {
    tokens: tokensFor(preset.people, preset.name), unread: [], repeat: NOT_REPEATING, title: '', titled: false,
    notes: prefs?.notesDefault ?? 'on', choices: DEFAULT_NOTES_CHOICES, joinMuted: null, documents: [...(preset.documents ?? [])], home: null
  };
}

/** The tokens for people who came from somewhere else: a group's, under its name, or each person's own. */
export function tokensFor(people: readonly Person[], name?: string | undefined): Token[] {
  if (name) return [{ kind: 'group', id: `group:${name}`, name, people: [...people] }];
  return people.map((person) => ({ kind: 'person', id: person.email.toLowerCase(), person }));
}

const peopleIn = (t: Token): Person[] => (t.kind === 'person' ? [t.person] : t.people);
/** Everyone the tokens reach, each person once, leaving out you. */
export function guestsOf(tokens: readonly Token[], me: string | undefined): Person[] {
  const seen = new Set(me ? [me.toLowerCase()] : []);
  const out: Person[] = [];
  for (const t of tokens) {
    for (const p of peopleIn(t)) {
      const key = p.email.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
  }
  return out;
}

/** Whether these people are in the tokens already. */
export const reaches = (tokens: readonly Token[], email: string): boolean => tokens.some((t) => peopleIn(t).some((p) => p.email.toLowerCase() === email.toLowerCase()));
const tokenName = (t: Token) => (t.kind === 'person' ? callName(t.person) : t.kind === 'list' ? 'a pasted list' : t.name);

/** Adds addresses to the one pasted list, so a second paste doesn't make a second token. */
export function withList(tokens: readonly Token[], people: readonly Person[]): Token[] {
  const list = tokens.find((t) => t.kind === 'list');
  if (!list) return [...tokens, { kind: 'list', id: 'list', people: [...people] }];
  return tokens.map((t) => (t.kind === 'list' ? { ...t, people: [...t.people, ...people.filter((p) => !reaches([t], p.email))] } : t));
}

/** "Theo", "Theo and Product", "Theo, Priya and Product" */
const inOrder = (names: readonly string[]) => (names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);

/** A name for a call nobody has named yet, ready to type over. */
export function titleFor(tokens: readonly Token[], guests: readonly Person[]): string {
  if (!guests.length) return 'New call';
  if (tokens.some((t) => t.kind === 'list') || tokens.length > 3) return `Call with ${someNames([...guests], 2)}`;
  return `Call with ${inOrder(tokens.map(tokenName))}`;
}

/** The People row: who, then how many or who else. */
export function peopleLine(tokens: readonly Token[], guests: readonly Person[]): { title: string; sub: string } {
  const [first] = guests;
  if (!first) return { title: 'Just you', sub: 'Anyone with the link can ask to join' };
  const [only] = tokens;
  if (guests.length === 1) return { title: first.name === first.email ? first.email : first.name, sub: first.name === first.email ? 'Guest' : first.email };
  const everyone = tokens.find((t) => t.kind === 'everyone');
  if (everyone) {
    const others = guests.length - everyone.people.length;
    return { title: `${guests.length} people`, sub: others > 0 ? `${everyone.name} and ${others} ${others === 1 ? 'guest' : 'guests'}` : everyone.name };
  }
  if (tokens.length === 1 && only?.kind === 'list') return { title: `${guests.length} people`, sub: 'From a pasted list' };
  if (tokens.length <= 3 && !tokens.some((t) => t.kind === 'list')) return { title: inOrder(tokens.map(tokenName)), sub: `${guests.length} people` };
  return { title: `${guests.length} people`, sub: someNames([...guests], 3) };
}

/** The rule for a repeat from this time, or null when it doesn't repeat. */
export function ruleOf(r: Repeating, at: Date, zone = timeZone()): RepeatRule | null {
  const day = localWeekday(at, zone);
  switch (r.kind) {
    case 'none': return null;
    case 'week': return { every: 'week', weeks: 1, days: [day] };
    case 'two-weeks': return { every: 'week', weeks: 2, days: [day] };
    case 'month': return monthlyRule(at, zone);
    case 'days': return { every: 'week', weeks: 1, days: [...new Set([...r.days, day])].sort((a, b) => a - b) };
  }
}

/** Every call of a repeat, and the day it ends: as many calls as it was set to run for, at most the most it can have. */
export function repeatInput(r: Repeating, at: Date, zone = timeZone()): RepeatInput | null {
  const rule = ruleOf(r, at, zone);
  if (!rule) return null;
  const calls = r.calls ?? (rule.every === 'week' ? CALLS_TO_START_WITH * rule.days.length : CALLS_TO_START_WITH);
  const occurrences = expandRepeat(rule, at, untilForCalls(rule, at, zone, calls), zone).slice(0, calls);
  return { rule, until: localDay(new Date(occurrences.at(-1) ?? at), zone), timeZone: zone, occurrences };
}

/** Someone from a list of addresses, under the name it gave them. */
export const personFrom = (a: { email: string; name?: string | undefined }): Person => (a.name ? { ...byEmail(a.email), name: a.name } : byEmail(a.email));

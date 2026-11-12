/*
 * A call being scheduled, as it's put together step by step. It lives while the modal is open: Back and forth keep it,
 * closing drops it, and reopening starts clean.
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
  /** The last day a call can fall on (`YYYY-MM-DD`), once someone has said. Until then the repeat runs for a few calls. */
  until: string | null;
}

export interface Draft extends Guests {
  /** The time picked. Null until one is: the best suggestion stands in. */
  at: Date | null;
  minutes: number;
  repeat: Repeating;
  /** The times offered to a guest, when letting them pick. */
  offer: Date[] | null;
  title: string;
  /** Someone typed the title: it stops following who's invited. */
  titled: boolean;
  notes: NotesSetting;
  choices: NotesChoices;
  /** Set for a big call; null means it was never touched, and the size of the call decides. */
  joinMuted: boolean | null;
  documents: Document[];
  /**
   * The call's workspace, where its notes and transcript go: none until someone picks one in the call (the default), a new one
   * made as it's scheduled, or one of yours.
   */
  space: SpaceChoice;
}

/** Where a call's notes go, as it's scheduled. */
export type SpaceChoice = { kind: 'none' } | { kind: 'new' } | { kind: 'pick'; id: string; name: string };

export const NOT_REPEATING: Repeating = { kind: 'none', days: [], until: null };
/** How long a call runs until someone says otherwise. */
const DEFAULT_MINUTES = 45;
/** How many calls a repeat runs for until someone sets an end date. */
const CALLS_TO_START_WITH = 4;
/** Past this many people, Details offers big-call settings, already on. */
export const BIG_CALL = 25;

export function newDraft(prefs: Preferences | undefined, preset: { people: readonly Person[]; name?: string | undefined; documents?: readonly Document[] | undefined }): Draft {
  return {
    tokens: tokensFor(preset.people, preset.name), unread: [], at: null, minutes: DEFAULT_MINUTES, repeat: NOT_REPEATING, offer: null, title: '', titled: false,
    notes: prefs?.notesDefault ?? 'on', choices: DEFAULT_NOTES_CHOICES, joinMuted: null, documents: [...(preset.documents ?? [])], space: { kind: 'none' }
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

/** Every call of a repeat, and the day it ends: as far as it was set to run, or the last of the calls it can have. */
export function repeatInput(r: Repeating, at: Date, zone = timeZone()): RepeatInput | null {
  const rule = ruleOf(r, at, zone);
  if (!rule) return null;
  const set = r.until && r.until >= localDay(at, zone) ? r.until : null;
  const until = set ?? untilForCalls(rule, at, zone, rule.every === 'week' ? CALLS_TO_START_WITH * rule.days.length : CALLS_TO_START_WITH);
  const occurrences = expandRepeat(rule, at, until, zone);
  return { rule, until: localDay(new Date(occurrences.at(-1) ?? at), zone), timeZone: zone, occurrences };
}

/** Someone from a list of addresses, under the name it gave them. */
export const personFrom = (a: { email: string; name?: string | undefined }): Person => (a.name ? { ...byEmail(a.email), name: a.name } : byEmail(a.email));

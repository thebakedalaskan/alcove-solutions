/*
 * Who transcribes each breakout room (docs: Calls and recordings › Breakout rooms). The host's browser hears only the
 * main room, so each room has a scribe of its own: one browser in the room, which already holds the room's keys, hears
 * the room's voices and sends them for the room's section of the call's notes, as the host's browser does for the main
 * room. The server picks it and keeps who it was when; it takes a room's speech only from whoever was the room's scribe
 * when the speech began, so two browsers never send the same room, and speech still on its way when the scribe changes
 * lands once. Kept apart from who commits for each group (places.ts). A room's lines are only as trustworthy as its
 * scribe's browser, which says who spoke each clip, as the host's does in the main room: the server checks that whoever
 * it names was in the room then, not that it was their voice.
 */
import type { z } from 'zod';
import { groupOf, placeOf, readerOf, type Joined, type Placing, type ScribeTerm } from './places';

type Term = z.infer<typeof ScribeTerm>;

/**
 * Who may be a room's scribe: someone on the invite (only they are sent to rooms, and never a guest with the link), in
 * the call, placed in the room and in its group, so their browser hears the room. Never whoever hosts, the organizer's
 * connection or a stand-in's in that room: the host's browser hears the main room for the notes (mainScribeOf).
 */
const mayScribe = (s: Placing, room: string) => (j: Joined): boolean =>
  j.role === 'invited' && j.identity !== s.host && j.status === 'in' && placeOf(s, j) === room && groupOf(s, j) === room;

/**
 * The call with each open room's record brought up to date at `now` (ms). Everyone in a room now is among those who
 * were in it. Its scribe stays the same connection for as long as it may be one; otherwise a new term goes to whoever
 * may and has been in the room longest, or the room has none until someone may. Called whenever the call's state is
 * saved, so every change of who is where, or who holds which room's keys, is seen.
 */
export function keepRooms<S extends Placing>(s: S, now: number): S {
  const open = s.breakouts.open;
  if (!open) return s;
  const rooms = open.rooms.map((r) => {
    const seen = [...new Set([...r.seen, ...s.people.filter((j) => j.status === 'in' && placeOf(s, j) === r.id).map(readerOf)])];
    const current = r.scribes.at(-1);
    const lasting = current?.until === null ? current : undefined;
    const holder = lasting ? s.people.find((j) => j.identity === lasting.identity) : undefined;
    if (holder && mayScribe(s, r.id)(holder)) return seen.length === r.seen.length ? r : { ...r, seen };
    // Ties go by what the server made (when they came in, and their seat's random person), never the ID a browser chose.
    const next = s.people.filter(mayScribe(s, r.id)).sort((a, b) => a.placedAt - b.placedAt || a.since - b.since || a.person.localeCompare(b.person))[0];
    if (!lasting && !next) return seen.length === r.seen.length ? r : { ...r, seen };
    const ended: Term[] = lasting ? [...r.scribes.slice(0, -1), { ...lasting, until: now }] : r.scribes;
    return { ...r, seen, scribes: next ? [...ended, { identity: next.identity, term: (current?.term ?? 0) + 1, from: now, until: null }] : ended };
  });
  return { ...s, breakouts: { ...s.breakouts, open: { ...open, rooms } } };
}

/** A room's scribe terms: the open room's, or a closed room's, kept in the call's sealed state with the rest of it. */
const termsOf = (s: Placing, room: string): Term[] =>
  (s.breakouts.open?.rooms.find((r) => r.id === room) ?? s.breakouts.held.flatMap((h) => h.rooms).find((r) => r.id === room))?.scribes ?? [];

/** When a room had a scribe (ms), in order: the stretches what's said there could be heard. */
export const scribedIn = (s: Placing, room: string): { from: number; until: number | null }[] => termsOf(s, room).map((x) => ({ from: x.from, until: x.until }));
/** Who was a room's scribe at `t` (ms), and in which term: the only connection whose speech for the room then is taken. */
export function scribeAt(s: Placing, room: string, t: number): Term | undefined {
  return termsOf(s, room).find((x) => x.from <= t && (x.until === null || t < x.until));
}

/** An open room's scribe now (a participant ID), or none. */
export const scribeOf = (s: Placing, room: string): string | null => {
  const last = s.breakouts.open?.rooms.find((r) => r.id === room)?.scribes.at(-1);
  return last && last.until === null ? last.identity : null;
};

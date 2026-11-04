/*
 * Who may do what with a note's decisions and follow-ups (docs: Notes and inference › Decisions and follow-ups). One
 * rule, which the server enforces and the app reads to offer only what will work. It all happens inside the note: having
 * it is what lets anyone in, and that's checked first, on every request.
 *
 * Anyone who has the note adds to it: they propose, confirm and dispute. Taking something away belongs to the organizer,
 * whose note it is, or to the person concerned: whoever proposed a decision, whoever confirmed it, whoever a follow-up is
 * for. A correction to the transcript works the same way. So nobody given the notes afterwards can cross out what the
 * call agreed, and nobody commits anyone else.
 */
import type { ActionItem, Change, Decision } from './types';

/** Someone reading a note: whether it's theirs, and the address they're signed in with. */
export interface NoteReader { organizer: boolean; email: string }

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const madeBy = (c: Change | undefined, r: NoteReader) => !!c && sameAddress(c.by.email, r.email);
const lastOf = (changes: Change[], what: Change['what']) => changes.findLast((c) => c.what === what);

type Changes = Pick<Decision, 'changes'>;
/** Who proposed a decision or follow-up the notes didn't hear. Absent on what the notes wrote. */
export const proposerOf = (x: Changes): Change['by'] | undefined => (x.changes[0]?.what === 'proposed' ? x.changes[0].by : undefined);
const proposedBy = (x: Changes, r: NoteReader) => { const p = proposerOf(x); return !!p && sameAddress(p.email, r.email); };
/** Whoever stood behind a decision last: the latest to confirm it. */
const confirmedBy = (d: Changes, r: NoteReader) => madeBy(lastOf(d.changes, 'confirmed'), r);

type Decided = Pick<Decision, 'state' | 'changes'>;

/**
 * Whether someone may move a decision to `to`. Anyone but its proposer confirms what's proposed, so a proposal takes two
 * people unless the organizer says so. Saying it wasn't decided is the organizer's, or a proposer's about their own.
 * Whoever confirmed a decision can take that back, or say it stopped holding.
 */
export function mayDecide(d: Decided, to: Decision['state'], r: NoteReader): boolean {
  if (r.organizer) return true;
  switch (d.state) {
    case 'proposed': return to === 'confirmed' ? !proposedBy(d, r) : to === 'rejected' && proposedBy(d, r);
    case 'confirmed': return (to === 'proposed' || to === 'superseded') && confirmedBy(d, r);
    case 'superseded': return (to === 'proposed' || to === 'confirmed') && confirmedBy(d, r);
    case 'rejected': return to === 'proposed' && madeBy(lastOf(d.changes, 'rejected'), r);
  }
}

/** Whether someone may reword a decision. What's only proposed, anyone; once it's settled, whoever settled it may. */
export const mayRewordDecision = (d: Decided, r: NoteReader): boolean => r.organizer || d.state === 'proposed' || (d.state === 'confirmed' && confirmedBy(d, r));

/**
 * Whether someone can say a decision wasn't decided without rejecting it: anyone but the organizer, who rejects it, and
 * the people who proposed or confirmed it, who take that back instead.
 */
export const mayDispute = (d: Decided, r: NoteReader): boolean =>
  !r.organizer && (d.state === 'proposed' || d.state === 'confirmed') && !proposedBy(d, r) && !(d.state === 'confirmed' && confirmedBy(d, r));

type Owned = Pick<ActionItem, 'owner' | 'takenOn'>;

/**
 * Whether a follow-up is for this person: who can say "I'll do it" or "Not mine". An owner the notes could only name,
 * or a guest with no address, can't answer, so nobody counts as having it.
 */
export const isAssignee = (a: Owned, r: NoteReader): boolean => !!a.owner?.person?.email && sameAddress(a.owner.person.email, r.email);
const assigned = (a: Owned) => !!a.owner?.person?.email;

/** Whether someone may say who a follow-up is for: the organizer, or the person it's with. Anyone can while nobody has it. */
export const mayAssign = (a: Owned, r: NoteReader): boolean => r.organizer || !assigned(a) || isAssignee(a, r);

/** Whether someone may reword, date or tick a follow-up. Anyone until it's taken on; then its owner, or the organizer. */
export const mayChangeAction = (a: Owned, r: NoteReader): boolean => r.organizer || !a.takenOn || isAssignee(a, r);

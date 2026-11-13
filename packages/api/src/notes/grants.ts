import { type ActionItem, type Decision } from './entries';
import { type Change, type RecipientRole } from './transcript';
/** Someone reading a note: their account, the address they're signed in with, and how they have the note. */
export interface NoteReader { id: string; email: string; role: RecipientRole }


const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const isOrganizer = (r: NoteReader) => r.role === 'organizer';

/**
 * Whether a change was this person's: by account, since an address can change hands or be replaced, or by address on a
 * change from before it kept the account.
 */
export const isBy = (by: Change['by'] | undefined, r: NoteReader): boolean => !!by && (by.id ? by.id === r.id : sameAddress(by.email, r.email));

const lastOf = (changes: Change[], what: Change['what']) => changes.findLast((c) => c.what === what);


type Changes = Pick<Decision, 'changes'>;

/** Who proposed a decision, open question or follow-up the notes didn't hear. Absent on what the notes wrote. */
export const proposerOf = (x: Changes): Change['by'] | undefined => (x.changes[0]?.what === 'proposed' ? x.changes[0].by : undefined);

/** Whether this person proposed it. */
export const isProposer = (x: Changes, r: NoteReader): boolean => isBy(proposerOf(x), r);

/** Whoever stood behind a decision last: the latest to confirm it. */
const confirmedBy = (d: Changes, r: NoteReader) => isBy(lastOf(d.changes, 'confirmed')?.by, r);

/** Whoever wrote the words it has now. */
const rewordedBy = (d: Changes, r: NoteReader) => isBy(lastOf(d.changes, 'reworded')?.by, r);


type Decided = Pick<Decision, 'state' | 'changes'>;


/**
 * Whether someone may move a decision to `to`. Confirming what's proposed takes someone invited to the call who didn't
 * write its words, so an agreement is never one person's own: not whoever proposed it, and not whoever last reworded it.
 * The organizer can, since it's their note. Saying it wasn't decided is the organizer's, or a proposer's about their own.
 * Whoever confirmed a decision can take that back, or say it stopped holding.
 */
export function mayDecide(d: Decided, to: Decision['state'], r: NoteReader): boolean {
  if (isOrganizer(r)) return true;
  switch (d.state) {
    case 'proposed': return to === 'confirmed' ? r.role === 'invited' && !isProposer(d, r) && !rewordedBy(d, r) : to === 'rejected' && isProposer(d, r);
    case 'confirmed': return (to === 'proposed' || to === 'superseded') && confirmedBy(d, r);
    case 'superseded': return (to === 'proposed' || to === 'confirmed') && confirmedBy(d, r);
    case 'rejected': return to === 'proposed' && isBy(lastOf(d.changes, 'rejected')?.by, r);
  }
}


/**
 * Whether someone may say a later call didn't replace a decision, or take that back. The notes only suggested it, and
 * saying so settles that for everyone with both notes, so it's for whoever answers for where the decision stands: who
 * could say it stopped holding, or that it still does, and while it's only proposed, who could settle it.
 */
export const maySayNotReplaced = (d: Decided, r: NoteReader): boolean =>
  (d.state === 'proposed' ? mayDecide(d, 'confirmed', r) || mayDecide(d, 'rejected', r) : mayDecide(d, d.state === 'superseded' ? 'confirmed' : 'superseded', r));


/**
 * Whether someone may reword a decision. Someone's proposal is theirs to reword; what the notes heard, anyone's who was
 * invited. Once it's settled, whoever settled it may, and it goes back to proposed for someone else to confirm.
 */
export function mayRewordDecision(d: Decided, r: NoteReader): boolean {
  if (isOrganizer(r)) return true;
  if (d.state === 'confirmed') return confirmedBy(d, r);
  if (d.state !== 'proposed') return false;
  return proposerOf(d) ? isProposer(d, r) : r.role === 'invited';
}


/**
 * Whether someone can say a decision wasn't decided without rejecting it: anyone but the organizer, who rejects it.
 * Whoever proposed one takes it back instead while it's only proposed, and whoever confirmed one takes that back.
 */
export const mayDispute = (d: Decided, r: NoteReader): boolean =>
  !isOrganizer(r) && ((d.state === 'proposed' && !isProposer(d, r)) || (d.state === 'confirmed' && !confirmedBy(d, r)));


type Owned = Pick<ActionItem, 'owner' | 'takenOn' | 'changes'>;


/**
 * Whether a follow-up is for this person: who can say "I'll do it" or "Not mine". An owner the notes could only name,
 * or a guest with no address, can't answer, so nobody counts as having it.
 */
export const isAssignee = (a: Pick<Owned, 'owner'>, r: Pick<NoteReader, 'email'>): boolean => !!a.owner?.person?.email && sameAddress(a.owner.person.email, r.email);

const assigned = (a: Owned) => !!a.owner?.person?.email;


/** Whether someone may say who a follow-up is for: the organizer, or the person it's with. Anyone can while nobody has it. */
export const mayAssign = (a: Owned, r: NoteReader): boolean => isOrganizer(r) || !assigned(a) || isAssignee(a, r);


/**
 * Whether someone may reword, date or tick a follow-up. Once it's taken on, its owner or the organizer. Until then,
 * anyone invited, and someone given the notes afterwards only what they added themselves.
 */
export const mayChangeAction = (a: Owned, r: NoteReader): boolean =>
  isOrganizer(r) || isAssignee(a, r) || (!a.takenOn && (r.role === 'invited' || isProposer(a, r)));

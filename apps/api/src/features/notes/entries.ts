/*
 * What a note's notes say (docs: notes-and-inference › Decisions and follow-ups): confirming, changing and reviewing its
 * decisions, questions and follow-ups, and adding to them, by whoever may. Each change is kept with who made it, and a
 * change to something that changed since it was read is refused.
 */
import {
  ACCEPTED_FOLLOW_UP, isAcceptedFollowUp, type FollowUpReview, isAssignee, isBy, isProposer, mayAssign, mayChangeAction, mayDecide, mayDispute, mayRewordDecision, maySayNotReplaced, type ActionItem,
  type ActionPatch, type ActionProposal, type Change, type Decision, type DecisionPatch, type DecisionProposal, type Note, type NoteReader, type Person, type Question, type QuestionPatch,
  type QuestionProposal, type RecipientRole, type RevisitPatch, type RoomNote, type Speaker, type TranscriptLine
} from '@alcove/api';
import type { Owner } from '../../platform/context';
import { b64u, id128 } from '../../keys/crypto';
import { tx } from '../../platform/db';
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError, notFound } from '../../platform/errors';
import { log } from '../../platform/log';
import { lockItem } from '../../keys/vault';
import { me, profile } from '../profile/profile';
import { actionTarget } from './writing/follow-up-proposals';
import { nameOf, personOf } from '../profile/portraits';
import { type Located, locate, holders } from './access';
import { same, updateNote, decisionsOf, emailIndex, actionsOf, allActionsOf, NoteManifest } from './manifest';
import { get } from './service';

const nlog = log.child({ component: 'notes' });

/* ---------- confirming what the notes say ---------- */

/** How someone has a note, as a change to it records. */
export const roleIn = (l: Located): RecipientRole => (l.mine ? 'organizer' : l.note.manifest.shared.some((x) => same(x.email, l.as)) ? 'shared' : 'invited');

/** A note that's written, located for someone who has it, and who they are for its history and its grants. */
export async function writtenNote(o: Owner, noteId: string) {
  const l = await locate(o, noteId);
  if (l.note.manifest.status !== 'ready') throw new ConflictError('These notes are still being written.', { context: { noteId, status: l.note.manifest.status } });
  const p = await profile(o);
  const role = roleIn(l);
  const by: Change['by'] = { id: o.ownerId, name: p.name, email: p.email, as: role };
  const reader: NoteReader = { id: o.ownerId, email: p.email, role };
  return { ...l, by, reader, at: new Date().toISOString() };
}

/** The most changes a decision, open question or follow-up keeps in the note (`kept`). Nothing reads the note's earlier revisions, so past this they're out of the history. */
const ENTRY_HISTORY = 40;
/** The most decisions, open questions or follow-ups one part of a note can hold: the notes write 12, 12 and 20, and every change copies the note. */
const MAX_ENTRIES = 60;

/** Entries in the order of their moments, as the notes write them; ones without a moment last. */
const inOrder = <T extends { at?: number | undefined }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));

/** Why someone can't move a decision where they asked to. Refusals name nobody, so no name reaches a log line. */
function decisionRefusal(d: Decision, to: Decision['state'], r: NoteReader): string {
  if (to === 'rejected') return 'Only the organizer can say a decision wasn’t decided. You can say you don’t think it was.';
  if (to === 'confirmed' && r.role === 'shared') return 'Only the organizer and people invited to the call can confirm a decision. You can say you don’t think it was decided.';
  if (to === 'confirmed' && d.state === 'proposed') return 'Someone else has to confirm words you wrote.';
  if (to === 'confirmed' && d.state === 'rejected') return 'Only the organizer can confirm what they said wasn’t decided.';
  return 'Only the organizer, or whoever confirmed this decision, can change where it stands.';
}
/** Refused when it isn't what they read: someone may have changed it since, and that isn't what they'd be agreeing to. */
const CHANGED = 'This changed after you opened it, so nothing was saved. Read it again.';

/**
 * Moves a decision, the call's or a breakout room's, along (`grants.ts` says who may), rewords it, or says it wasn't
 * decided as someone who can't reject it. New words on a confirmed decision put it back to proposed, since what people
 * confirmed was the words before, and only the organizer can confirm new words of their own in the same change: anyone
 * else's words take someone else. Confirming says what was read, and is refused if it says something else by now. A
 * dispute stands until whoever raised it takes it back, or the organizer settles the decision; their confirming again is
 * how a confirmed one is settled.
 */
export async function updateDecision(o: Owner, noteId: string, decisionId: string, patch: DecisionPatch): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const d = decisionsOf(n).find((x) => x.id === decisionId);
    if (!d) throw new NotFoundError('That decision doesn’t exist.', { context: { noteId, decisionId } });
    const context = { noteId, decisionId, state: d.state };
    if (patch.seen && patch.seen.text !== d.text) throw new ConflictError(CHANGED, { context });
    const changes = [...d.changes];
    let next: Decision = d;
    const text = patch.text;
    const reworded = text !== undefined && text !== d.text;
    if (reworded) {
      if (!mayRewordDecision(d, reader)) throw new ForbiddenError('Only the organizer, or whoever wrote or confirmed this decision, can reword it now.', { context });
      changes.push({ by, at, what: 'reworded', before: d.text, after: text });
      next = { ...next, text };
    }
    const to = patch.state ?? (reworded && d.state === 'confirmed' ? 'proposed' : d.state);
    // Confirming what's confirmed means something only when it stands behind new words, or settles a dispute: the organizer's, either way.
    const settling = patch.state === 'confirmed' && d.state === 'confirmed' && reader.role === 'organizer' && (reworded || d.disputes.length > 0);
    if (reworded && to === 'confirmed' && d.state === 'confirmed' && !settling) throw new ForbiddenError('Someone else has to confirm words you wrote.', { context });
    if (to !== d.state || settling) {
      // Only something that was decided can stop holding; what nobody confirmed is reopened or said not to be decided.
      if (to === 'superseded' && d.state !== 'confirmed') throw new ConflictError('Only a confirmed decision can stop holding.', { context });
      // Asked with the words as they are after this change, so writing them and confirming them is one person doing both.
      if (to !== d.state && !mayDecide({ state: d.state, changes }, to, reader)) throw new ForbiddenError(decisionRefusal(d, to, reader), { context });
      changes.push({ by, at, what: to === 'proposed' ? 'reopened' : to });
      const settled = reader.role === 'organizer' && (to === 'confirmed' || to === 'rejected');
      next = { ...next, state: to, disputes: settled ? [] : to === 'confirmed' ? next.disputes.filter((x) => !isBy(x.by, reader)) : next.disputes };
    }
    if (patch.dispute !== undefined) {
      const had = next.disputes.some((x) => isBy(x.by, reader));
      if (patch.dispute && !had) {
        if (!mayDispute({ state: next.state, changes }, reader)) throw new ForbiddenError('You can’t dispute this decision: it’s yours to change, or it’s settled.', { context });
        changes.push({ by, at, what: 'disputed' });
        next = { ...next, disputes: [...next.disputes, { by, at }] };
      } else if (!patch.dispute && had) {
        changes.push({ by, at, what: 'undisputed' });
        next = { ...next, disputes: next.disputes.filter((x) => !isBy(x.by, reader)) };
      }
    }
    made = changes.slice(d.changes.length).map((x) => x.what);
    // Item IDs are the note's own, so the one list that has it changes, the call's or a room's.
    const swap = (xs: Decision[]) => xs.map((x) => (x.id === decisionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
    return made.length ? { ...n, decisions: swap(n.decisions), rooms: n.rooms.map((r) => ({ ...r, decisions: swap(r.decisions) })) } : n;
  }));
  nlog.info('decision changed', { noteId, decisionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Says an open question, the call's or a breakout room's, was answered, opens it again, or rewords it. Anyone who has the notes can, and everyone sees who did. */
export async function updateQuestion(o: Owner, noteId: string, questionId: string, patch: QuestionPatch): Promise<Note> {
  const { owner, by, at } = await writtenNote(o, noteId);
  let made: Change['what'][] = [];
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const q = [...n.questions, ...n.rooms.flatMap((r) => r.questions)].find((x) => x.id === questionId);
    if (!q) throw new NotFoundError('That question doesn’t exist.', { context: { noteId, questionId } });
    const changes = [...q.changes];
    let next: Question = q;
    if (patch.text !== undefined && patch.text !== q.text) { changes.push({ by, at, what: 'reworded', before: q.text, after: patch.text }); next = { ...next, text: patch.text }; }
    if (patch.state !== undefined && patch.state !== q.state) { changes.push({ by, at, what: patch.state === 'answered' ? 'answered' : 'reopened' }); next = { ...next, state: patch.state }; }
    made = changes.slice(q.changes.length).map((x) => x.what);
    const swap = (xs: Question[]) => xs.map((x) => (x.id === questionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
    return made.length ? { ...n, questions: swap(n.questions), rooms: n.rooms.map((r) => ({ ...r, questions: swap(r.questions) })) } : n;
  }));
  nlog.info('question changed', { noteId, questionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Who a follow-up can go to, by address: the organizer, or someone who has the notes now, so whoever it's for can see it. */
function assignable(email: string, organizer: Person, holding: Set<string>, owner: Owner, context: Record<string, string>): Speaker {
  if (!same(email, organizer.email) && !holding.has(b64u(emailIndex(owner, email)))) throw new ValidationError('Share the notes with them first: follow-ups go to people who have the notes.', { context });
  const person = same(email, organizer.email) ? organizer : personOf(email);
  return { name: nameOf(person), person };
}

/**
 * Changes a follow-up, the call's or a breakout room's, as far as `grants.ts` lets this person: `takeOn` is the person
 * it's for saying they'll do it, and nobody else can, since the notes only ever suggest. Taking it on, or giving it to
 * yourself, says what was read, and is refused if it says something else by now. Taking the owner off is that person
 * saying it isn't theirs, or the organizer deciding it isn't. Whatever someone took on stays as they agreed to it: the
 * organizer changing its words or its date asks them again.
 */
export async function updateAction(o: Owner, noteId: string, actionId: string, patch: ActionPatch): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Change['what'][] = [];
  await tx(owner.pool, async (c) => {
    // Who has the notes, read under the note's lock as the change is made: someone who removed them isn't given a follow-up.
    await lockItem(owner, c, noteId);
    const holding = await holders(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const a = actionsOf(n).find((x) => x.id === actionId);
      if (!a) throw new NotFoundError('That follow-up doesn’t exist.', { context: { noteId, actionId } });
      const context = { noteId, actionId };
      const taking = patch.takeOn === true || (typeof patch.owner === 'string' && same(patch.owner, by.email) && !isAssignee(a, reader));
      if (taking && !patch.seen) throw new ValidationError('Say what you read.', { context });
      if (patch.seen && (patch.seen.text !== a.text || patch.seen.due !== (a.due ?? null))) throw new ConflictError(CHANGED, { context });
      const changing = () => { if (!mayChangeAction(a, reader)) throw new ForbiddenError('Only the organizer, or whoever took this on, can change it now.', { context }); };
      const assigning = () => { if (!mayAssign(a, reader)) throw new ForbiddenError('Only the organizer, or the person it’s for, can say who this is for.', { context }); };
      const changes = [...a.changes];
      let next: ActionItem = a;
      let agreedTo = false;
      if (patch.text !== undefined && patch.text !== a.text) {
        changing();
        changes.push({ by, at, what: 'reworded', before: a.text, after: patch.text });
        next = { ...next, text: patch.text };
        agreedTo = true;
      }
      if (patch.owner === null && next.owner) {
        assigning();
        // From the person it's for, that's their answer: not mine. From the organizer, it's taking it away.
        changes.push({ by, at, what: isAssignee(a, reader) ? 'declined' : 'reassigned', before: next.owner.name });
        const { owner: _gone, ...rest } = next;
        void _gone;
        next = { ...rest, takenOn: false };
      } else if (typeof patch.owner === 'string' && !(next.owner?.person && same(next.owner.person.email, patch.owner))) {
        assigning();
        const to = assignable(patch.owner, organizer, holding, owner, context);
        // Giving it to yourself is taking it on; anyone else has to say yes themselves.
        const self = same(patch.owner, by.email);
        changes.push({ by, at, what: self ? 'took-on' : 'reassigned', ...(next.owner ? { before: next.owner.name } : {}), after: to.name });
        next = { ...next, owner: to, takenOn: self };
      }
      if (patch.takeOn) {
        if (!isAssignee(next, reader)) throw new ForbiddenError('Only the person a follow-up is for can take it on. You can give it to yourself.', { context });
        if (!next.takenOn) { changes.push({ by, at, what: 'took-on' }); next = { ...next, takenOn: true }; }
      }
      // Taking back a yes (Undo): it's suggested for them again, and the record says they reopened it.
      if (patch.takeOn === false) {
        if (!isAssignee(next, reader)) throw new ForbiddenError('Only whoever took this on can take that back.', { context });
        if (next.takenOn) { changes.push({ by, at, what: 'reopened' }); next = { ...next, takenOn: false }; }
      }
      if (patch.due !== undefined) {
        const due = patch.due || undefined;
        if (due !== next.due) {
          changing();
          changes.push({ by, at, what: 'due', ...(next.due ? { before: next.due } : {}), ...(due ? { after: due } : {}) });
          const { due: _old, ...rest } = next;
          void _old;
          next = due ? { ...rest, due } : rest;
          agreedTo = true;
        }
      }
      // What someone took on, changed by someone else: it's not what they said they'd do any more, so they say again.
      if (agreedTo && a.takenOn && next.takenOn && !isAssignee(a, reader) && !isAssignee(next, reader)) {
        changes.push({ by, at, what: 'reopened' });
        next = { ...next, takenOn: false };
      }
      if (patch.done !== undefined && patch.done !== next.done) {
        changing();
        changes.push({ by, at, what: patch.done ? 'done' : 'undone' });
        next = { ...next, done: patch.done };
      }
      made = changes.slice(a.changes.length).map((x) => x.what);
      const swap = (xs: ActionItem[]) => xs.map((x) => (x.id === actionId ? { ...next, revision: id128(), changes: kept(changes, ENTRY_HISTORY) } : x));
      return made.length ? { ...n, actions: swap(n.actions), rooms: n.rooms.map((r) => ({ ...r, actions: swap(r.actions) })) } : n;
    });
  });
  nlog.info('follow-up changed', { noteId, actionId, changes: made.join(',') || 'none', mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}

/** Review is shared and locked, and never claims that the proposed owner agreed to the task. */
export async function reviewAction(o: Owner, noteId: string, decision: FollowUpReview): Promise<Note> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  await tx(owner.pool, async (c) => {
    await lockItem(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const proposal = allActionsOf(n).find((a) => a.id === decision.id);
      if (!proposal) throw new NotFoundError('That suggestion doesn’t exist.', { context: { noteId } });
      const target = proposal.changeOf ? actionsOf(n).find((a) => a.id === proposal.changeOf) : undefined;
      if (!mayChangeAction(target ?? proposal, reader)) throw new ForbiddenError('You can’t review this suggestion.', { context: { noteId } });
      if (proposal.revision !== decision.revision) throw new ConflictError('This suggestion changed. Review it again.', { context: { noteId } });
      const review = decision.decision === 'accept' ? 'accepted' : 'dismissed';
      if (proposal.review !== 'suggested') {
        if (proposal.review === review) return n;
        throw new ConflictError('Someone already reviewed this suggestion.', { context: { noteId } });
      }
      const part = n.rooms.find((r) => r.actions.some((a) => a.id === proposal.id)) ?? n;
      if (review === 'accepted' && proposal.changeOf === null && part.actions.filter(isAcceptedFollowUp).length >= MAX_ENTRIES) throw new ConflictError('These notes have as many follow-ups as they can keep.', { context: { noteId } });
      if (review === 'accepted' && proposal.changeOf && (!target || JSON.stringify(actionTarget(target)) !== JSON.stringify(proposal.target))) throw new ConflictError('The task changed. Review a new suggestion for it.', { context: { noteId } });
      if (review === 'accepted' && target && (target.owner?.person?.email ?? null) !== (proposal.owner?.person?.email ?? null) && !mayAssign(target, reader)) throw new ForbiddenError('Only the organizer, or the person it’s for, can change who this is for.', { context: { noteId } });
      const swap = (xs: ActionItem[]): ActionItem[] => xs.map((a) => {
        if (a.id === proposal.id) return { ...a, review, reviewed: { by, at, decision: decision.decision }, changes: kept([...a.changes, { by, at, what: decision.decision === 'accept' ? 'accepted' : 'dismissed' }], ENTRY_HISTORY) };
        if (review !== 'accepted' || !target || a.id !== target.id) return a;
        const { owner: _owner, due: _due, ...rest } = a;
        const mine = isAssignee(a, reader);
        const ownerChanged = (a.owner?.person?.email ?? a.owner?.name ?? null) !== (proposal.owner?.person?.email ?? proposal.owner?.name ?? null);
        const dueChanged = (a.due ?? null) !== (proposal.due ?? null);
        const textChanged = a.text !== proposal.text;
        const takenOn = a.takenOn && !ownerChanged && (mine || (!textChanged && !dueChanged));
        const events: Change[] = [];
        if (textChanged) events.push({ by, at, what: 'reworded', before: a.text, after: proposal.text });
        if (ownerChanged) events.push({ by, at, what: 'reassigned', ...(a.owner ? { before: a.owner.name } : {}), ...(proposal.owner ? { after: proposal.owner.name } : {}) });
        if (dueChanged) events.push({ by, at, what: 'due', ...(a.due ? { before: a.due } : {}), ...(proposal.due ? { after: proposal.due } : {}) });
        if (a.takenOn && !takenOn) events.push({ by, at, what: 'reopened' });
        return { ...rest, text: proposal.text, ...(proposal.owner ? { owner: proposal.owner } : {}), ...(proposal.due ? { due: proposal.due } : {}), lines: proposal.lines, sourceId: proposal.sourceId, sourceVersion: proposal.sourceVersion, revision: id128(), takenOn, changes: kept([...a.changes, ...events], ENTRY_HISTORY) };
      });
      return { ...n, actions: swap(n.actions), rooms: n.rooms.map((r) => ({ ...r, actions: swap(r.actions) })) };
    });
  });
  nlog.info('follow-up suggestion reviewed', { noteId, suggestionId: decision.id, decision: decision.decision });
  return get(o, noteId);
}

/* ---------- adding to what the notes say ---------- */

/** The part of a note a proposal goes in: the call's, or a breakout room's section. A room that isn't in the note is refused. */
function partOf(n: NoteManifest, noteId: string, room: string | undefined) {
  if (room === undefined) {
    return { lines: n.transcript ?? [], decisions: n.decisions, questions: n.questions, actions: n.actions, put: (x: Partial<Pick<NoteManifest, 'decisions' | 'questions' | 'actions'>>): NoteManifest => ({ ...n, ...x }) };
  }
  const r = n.rooms.find((x) => x.id === room);
  if (!r) throw new NotFoundError('That breakout room isn’t in these notes.', { context: { noteId, room } });
  return { lines: r.transcript, decisions: r.decisions, questions: r.questions, actions: r.actions, put: (x: Partial<Pick<RoomNote, 'decisions' | 'questions' | 'actions'>>): NoteManifest => ({ ...n, rooms: n.rooms.map((y) => (y.id === room ? { ...y, ...x } : y)) }) };
}

/** The lines someone says a proposal rests on, and the moment of the first, from that part of the note alone. */
function linesOf(part: TranscriptLine[], ids: string[] | undefined, noteId: string): { lines: string[]; at?: number } {
  const lines = [...new Set(ids ?? [])];
  const found = lines.map((id) => part.find((l) => l.id === id));
  if (found.some((l) => !l)) throw new ValidationError('That line isn’t in this part of the notes.', { context: { noteId } });
  const first = found[0];
  return { lines, ...(first ? { at: Math.round(first.at) } : {}) };
}

/**
 * What adding to a note did, from the write itself: the entry with those words in that part (`id`: the one made, or the
 * one already there, since the same words again add nothing), whether this added it, and whether it's theirs (they
 * proposed it, now or before; one just made always is). An agent is handed an entry's ID back only when it's theirs.
 */
export interface Added { id: string; added: boolean; theirs: boolean }
/** An entry already in that part with the same words, as adding it again finds it. */
const already = (x: Decision | Question | ActionItem, reader: NoteReader): Added => ({ id: x.id, added: false, theirs: isProposer(x, reader) });
/** Thrown should a write not say what it did, though every way through it does. */
const unsaid = (noteId: string) => new InternalError('Adding to the notes didn’t say what it added.', { context: { noteId } });

/**
 * Adds a decision the notes didn't hear, in the words of someone who has them, the call's or a breakout room's. It
 * starts proposed, with who proposed it as its first change, and takes someone else confirming it. This is someone
 * saying the call decided something: what they add from their own notes is `additions.ts`, which says only who added it.
 * The same words again add nothing, so a retry can't add it twice. The lines it rests on are checked first, so lines from
 * nowhere are refused whether or not the words are there already.
 */
export async function proposeDecision(o: Owner, noteId: string, p: DecisionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Added | undefined;
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const part = partOf(n, noteId, p.room);
    const grounds = linesOf(part.lines, p.lines, noteId);
    const there = part.decisions.find((x) => x.text === p.text);
    if (there) { made = already(there, reader); return n; }
    if (part.decisions.length >= MAX_ENTRIES) throw new ConflictError('There are too many decisions here to add another.', { context: { noteId } });
    const d: Decision = { id: id128(), text: p.text, ...grounds, state: 'proposed', against: [], disputes: [], changes: [{ by, at, what: 'proposed' }] };
    made = { id: d.id, added: true, theirs: true };
    return part.put({ decisions: inOrder([...part.decisions, d]) });
  }));
  if (!made) throw unsaid(noteId);
  nlog.info('decision proposed', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Adds an open question the notes didn't hear to their Still open, the call's or a breakout room's, as `proposeDecision`
 * adds a decision: it starts open, with who added it as its first change (`proposed`), which also keeps it when the notes
 * are written again, and anyone who has the notes can say it was answered (`updateQuestion`). It's what an agent's
 * `add_question` does: the app has no way to add one. The same words again add nothing, so a retry can't add it twice, and
 * the lines are checked first, as for a decision. It says what it did, as `Added`, and reads nothing back.
 */
export async function addQuestion(o: Owner, noteId: string, p: QuestionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  let made: Added | undefined;
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => {
    const part = partOf(n, noteId, p.room);
    const grounds = linesOf(part.lines, p.lines, noteId);
    const there = part.questions.find((x) => x.text === p.text);
    if (there) { made = already(there, reader); return n; }
    if (part.questions.length >= MAX_ENTRIES) throw new ConflictError('There are too many open questions here to add another.', { context: { noteId } });
    const q: Question = { id: id128(), text: p.text, ...grounds, state: 'open', against: [], changes: [{ by, at, what: 'proposed' }] };
    made = { id: q.id, added: true, theirs: true };
    return part.put({ questions: inOrder([...part.questions, q]) });
  }));
  if (!made) throw unsaid(noteId);
  nlog.info('question added', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Adds a follow-up the notes didn't hear, as `proposeDecision` does: straight onto the checklist, from Add a follow-up in
 * Alcove and from an agent's `add_follow_up` alike. Who it's for and when it's due are only suggestions until that person
 * takes it on, even when it's for whoever added it. Only the checklist counts as the same words: a suggestion waiting for
 * review, or one dismissed, with these words stays as it is beside the one added.
 */
export async function proposeAction(o: Owner, noteId: string, p: ActionProposal): Promise<Added> {
  const { owner, by, at, reader } = await writtenNote(o, noteId);
  const organizer = await me(owner);
  let made: Added | undefined;
  await tx(owner.pool, async (c) => {
    await lockItem(owner, c, noteId);
    const holding = await holders(owner, c, noteId);
    await updateNote(owner, c, noteId, (n) => {
      const part = partOf(n, noteId, p.room);
      const to = p.owner === undefined ? undefined : assignable(p.owner, organizer, holding, owner, { noteId });
      const grounds = linesOf(part.lines, p.lines, noteId);
      const checklist = part.actions.filter(isAcceptedFollowUp);
      const there = checklist.find((x) => x.text === p.text);
      if (there) { made = already(there, reader); return n; }
      if (checklist.length >= MAX_ENTRIES) throw new ConflictError('There are too many follow-ups here to add another.', { context: { noteId } });
      const a: ActionItem = {
        ...ACCEPTED_FOLLOW_UP, revision: id128(), id: id128(), text: p.text, ...(to ? { owner: to } : {}), takenOn: false, ...(p.due ? { due: p.due } : {}), done: false,
        ...grounds, against: [], changes: [{ by, at, what: 'proposed' }], from: null
      };
      made = { id: a.id, added: true, theirs: true };
      return part.put({ actions: inOrder([...part.actions, a]) });
    });
  });
  if (!made) throw unsaid(noteId);
  nlog.info('follow-up proposed', { noteId, added: made.added, lines: p.lines?.length ?? 0, inRoom: p.room !== undefined, assigned: p.owner !== undefined, mine: owner.ownerId === o.ownerId });
  return made;
}

/**
 * Says the notes got it wrong, this later call didn't replace that decision or answer that question, or takes that back.
 * Everyone with both notes sees who said so. Whoever is shown a revisit has both, so only they can: having this one
 * alone says nothing about the earlier call, and finds nothing here. For a decision it goes as far as the grants on
 * that decision do, in the earlier note (`maySayNotReplaced`): it settles the suggestion for all of them. Saying it
 * twice changes nothing.
 */
export async function updateRevisit(o: Owner, noteId: string, revisitId: string, patch: RevisitPatch): Promise<Note> {
  const { owner, note, by, reader, at } = await writtenNote(o, noteId);
  const r = note.manifest.revisits.find((x) => x.id === revisitId);
  if (!r) throw notFound('That later call', { noteId, revisitId });
  const earlier = await locate(o, r.noteId);
  if (r.kind === 'replaced') {
    const d = decisionsOf(earlier.note.manifest).find((x) => x.id === r.itemId);
    if (!d) throw notFound('That decision', { noteId, revisitId });
    if (!maySayNotReplaced(d, { ...reader, role: roleIn(earlier) })) {
      throw new ForbiddenError('Only the organizer, or whoever confirmed this decision, can say a later call didn’t replace it.', { context: { noteId, revisitId } });
    }
  }
  await tx(owner.pool, (c) => updateNote(owner, c, noteId, (n) => (
    n.revisits.some((x) => x.id === revisitId && Boolean(x.dismissed) !== patch.dismissed)
      ? { ...n, revisits: n.revisits.map((x) => (x.id === revisitId ? { ...x, dismissed: patch.dismissed ? { by, at } : null } : x)) } : n
  )));
  nlog.info('revisit changed', { noteId, revisitId, kind: r.kind, dismissed: patch.dismissed, mine: owner.ownerId === o.ownerId });
  return get(o, noteId);
}
/**
 * Changes kept within a limit: the first, which says what something was to begin with; the latest of every kind, since
 * who may do what and what the note says are read from them (who proposed it, who confirmed it, who said it wasn't
 * theirs); and then as many of the latest as fit. Saying something and taking it back can't push those out.
 */
export function kept(changes: Change[], limit: number): Change[] {
  if (changes.length <= limit) return changes;
  const keep = new Set<number>([0, ...new Map(changes.map((c, i) => [c.what, i])).values()]);
  for (let i = changes.length - 1; i >= 0 && keep.size < limit; i--) keep.add(i);
  return changes.filter((_, i) => keep.has(i));
}

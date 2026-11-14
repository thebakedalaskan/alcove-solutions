/*
 * Notes, as the stand-in answers for them (packages/api-http/src/notes/api.ts is the real client's): a note and what's
 * changed in it, its audio and shared screens, sharing it and links to it, your own notes and what you add from them,
 * what's waiting on you, searching and asking (asking.ts), a series, and the models that write notes.
 */
import {
  ACCEPTED_FOLLOW_UP, NOTE_LINK_DAYS, type ActionPatch, type ActionProposal, type AlcoveApi, type AudienceTeam, type Change, type DecisionPatch, type DecisionProposal,
  type FollowUpReview, type FollowUpTarget, type ID, type Inbox, type LinePatch, type NewNoteLink, type Note, type NoteAction, type NoteLink, type NoteLinkClaimed, type NoteLinkPeek,
  type NoteProgress, type PromoteBody, type PromotionPreview, type QuestionPatch, type RecipientRole, type Series, type SeriesAnswerPart, type SeriesNote, type SharedAudience,
  type SharedWrite
} from '@alcove/api';
import { changer } from '../../world/build';
import { personAt } from '../../world/people';
import { isLive } from '../../world/plans/teams';
import type { World } from '../../world/world';
import { licensed, teamNoteIn, teamNotesFor } from '../account/teams';
import { answer, refused, stream } from '../answer';
import { AI_MODELS } from '../call/script';
import { pause } from '../live';
import { audioUrlFor, quietAudio, screenImage } from '../media';
import { current, me, nextId } from '../state';
import { answerAbout, answerAcross, asWritten, found, mayAsk } from './asking';
import { personalFor } from './personal';

/** A note in the world, or what the server says when it isn't there. */
export const noteIn = (w: World, id: string): Note => {
  const n = w.notes.find((x) => x.id === id);
  if (!n) throw refused('not-found', 'Those notes aren’t there any more.');
  return n;
};
/** Changes a note in the world and answers with it as it is now. */
const changeNote = (id: string, change: (n: Note, w: World) => Note) => answer((w) => {
  const next = change(noteIn(w, id), w);
  w.notes = w.notes.map((n) => (n.id === id ? next : n));
  return next;
});
const roleIn = (n: Note): RecipientRole => n.recipients.find((r) => r.person.email === me().email)?.role ?? 'shared';
const reviewedActions = new WeakMap<World, Map<string, FollowUpReview>>();
const taskTarget = (a: NoteAction): FollowUpTarget => ({ id: a.id, revision: a.revision, text: a.text, owner: a.owner?.person?.email ?? null, due: a.due ?? null });
const changeBy = (n: Note, what: Change['what'], extra: Partial<Change> = {}): Change => ({ by: changer(me(), roleIn(n)), at: new Date().toISOString(), what, ...extra });
/** The links to a note that still work, newest first. */
const linksTo = (w: World, noteId: string): NoteLink[] => (w.noteLinks ?? []).filter((x) => x.noteId === noteId && Date.parse(x.link.expiresAt) > Date.now()).map((x) => x.link).reverse();
/**
 * The team a note is visible to, as whoever adds to it is shown: Art's own notes are visible to Art's team when he says so, and
 * everyone live-licensed on it reads them, `people` of them not on the note already.
 */
const teamReading = (w: World, n: Note): AudienceTeam | null => {
  const t = w.myTeam;
  return n.teamVisible && t ? { name: t.name, people: t.members.filter((m) => isLive(m) && !n.people.some((p) => sameAddress(p.email, m.person.email))).length } : null;
};
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** What holds a box for writing into the shared notes to who had the notes when it opened, and the team they were visible to: if either changes, it's refused. */
const audienceSeal = (n: Note) => `shared:${n.people.map((p) => p.email.toLowerCase()).sort().join(' ')}${n.teamVisible ? ':team' : ''}`;

/* ---------- what's waiting on you, worked out from the notes ---------- */

function inboxOf(w: World): Inbox {
  const followUps: Inbox['followUps'] = [];
  const decisions: Inbox['decisions'] = [];
  for (const n of w.notes) {
    if (n.status !== 'ready') continue;
    const from = { noteId: n.id, noteTitle: n.title, noteStartedAt: n.startedAt, role: roleIn(n) };
    for (const a of n.actions) if (!a.done && a.owner?.person?.email === me().email) followUps.push({ ...a, ...from });
    for (const d of n.decisions) {
      const mine = d.changes.some((c) => c.by.email === me().email && (c.what === 'proposed' || c.what === 'disputed'));
      // On your own notes, a confirmed decision someone says wasn't decided is yours to settle.
      const settle = d.state === 'confirmed' && d.disputes.length > 0 && from.role === 'organizer';
      if ((d.state === 'proposed' && !mine) || settle) decisions.push({ ...d, ...from });
    }
  }
  return { followUps, decisions };
}

/* ---------- series ---------- */

/** A series as the API answers it: its calls' notes, what's still open across them, and its next call. */
export function seriesIn(w: World, id: string): Series {
  const notes = w.notes.filter((n) => n.seriesId === id && n.status !== 'recording');
  const latest = notes[0];
  if (!latest) throw refused('not-found', 'That series isn’t there any more.');
  const next = w.meetings.filter((m) => m.seriesId === id && m.status === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const later = (noteId: string) => notes.findIndex((n) => n.id === noteId);
  return {
    id, title: next?.title ?? latest.title, organizer: latest.recipients[0]?.person ?? me(), isOrganizer: latest.recipients[0]?.person.email === me().email,
    ...(next ? { next } : {}), recurring: false, ...(next?.repeat ? { repeat: next.repeat } : {}),
    notes: notes.map((n): SeriesNote => ({ id: n.id, title: n.title, startedAt: n.startedAt, duration: n.duration, status: n.status, ...(n.meetingId ? { meetingId: n.meetingId } : {}), ...(n.received ? { received: n.received } : {}) })),
    older: 0,
    decisions: notes.flatMap((n) => n.decisions.filter((d) => d.state !== 'rejected').map((d) => ({ ...d, noteId: n.id }))),
    questions: notes.flatMap((n) => n.questions.filter((q) => q.state === 'open').map((q) => ({ ...q, noteId: n.id, later: later(n.id), stale: later(n.id) >= 2 }))),
    answered: [],
    actions: notes.flatMap((n) => n.actions.filter((a) => !a.done).map((a) => ({ ...a, noteId: n.id, later: later(n.id), stale: later(n.id) >= 2 })))
  };
}

/* ---------- the notes ---------- */

export const notesApi: Pick<AlcoveApi, 'notes' | 'series' | 'models'> = {
  notes: {
    list: (query) => answer((w) => found(w, query?.kind, query?.text, query?.by)),
    // A note of the team's opens for a licensed member: to read and ask about.
    get: (id: ID) => answer((w) => teamNoteIn(w, id) ?? noteIn(w, id)),
    progress: (id: ID): AsyncIterable<NoteProgress> => progressOf(id),
    audioUrl: (id: ID, segment: number) => {
      const seconds = current().notes.find((n) => n.id === id)?.audio.find((a) => a.index === segment)?.seconds ?? 60;
      return audioUrlFor(`${id}:${segment}`, seconds);
    },
    audio: (id: ID, segment: number) => answer((w) => noteIn(w, id).audio.find((a) => a.index === segment)?.seconds ?? 60).then(quietAudio),
    // The stand-in keeps no video of a share: it answers with silence as long as the share's part of the recording, which
    // the replay loads, goes along and plays in step as it would a video, on a dark stage with no picture.
    screenVideoUrl: (id: ID, share: ID, segment: number) => {
      const part = current().notes.find((n) => n.id === id)?.shares.find((s) => s.id === share)?.segments.find((g) => g.segment === segment);
      return audioUrlFor(`${id}:${share}:${segment}`, part ? part.until - part.at : 60);
    },
    screenUrl: (id: ID, frameId: ID) => screenImage(current().notes.find((n) => n.id === id)?.screens.find((s) => s.id === frameId)),
    proposeDecision: (noteId: ID, p: DecisionProposal) => changeNote(noteId, (n) => ({
      ...n, decisions: [...n.decisions, { id: nextId('d'), text: p.text, state: 'proposed', lines: p.lines ?? [], against: [], disputes: [], changes: [changeBy(n, 'proposed')], evidence: { moments: [], flags: p.lines?.length ? [] : ['missing'] } }]
    })),
    proposeAction: (noteId: ID, p: ActionProposal) => changeNote(noteId, (n) => {
      const owner = p.owner ? personAt(p.owner) : undefined;
      return {
        ...n, totalActions: n.totalActions + 1, openActions: n.openActions + 1,
        actions: [...n.actions, {
          ...ACCEPTED_FOLLOW_UP, revision: nextId('revision'), id: nextId('a'), text: p.text, ...(owner ? { owner: { name: owner.name, person: owner } } : {}), takenOn: false, ...(p.due ? { due: p.due } : {}),
          done: false, lines: p.lines ?? [], against: [], changes: [changeBy(n, 'proposed')], from: null, evidence: { moments: [], flags: p.lines?.length ? [] : ['missing'] }
        }]
      };
    }),
    reviewAction: (noteId: ID, review: FollowUpReview) => changeNote(noteId, (n, w) => {
      let history = reviewedActions.get(w);
      if (!history) { history = new Map(); reviewedActions.set(w, history); }
      const key = `${noteId}:${review.id}`;
      const previous = history.get(key);
      if (previous) {
        if (previous.revision === review.revision && previous.decision === review.decision) return n;
        throw refused('conflict', 'That suggestion has already been reviewed.');
      }
      const room = n.rooms.find((r) => r.suggestions.some((a) => a.id === review.id));
      const suggestions = room?.suggestions ?? n.suggestions;
      const actions = room?.actions ?? n.actions;
      const proposal = suggestions.find((a) => a.id === review.id);
      if (!proposal || proposal.revision !== review.revision) throw refused('conflict', 'That suggestion changed. Close review and open it again.');
      const target = proposal.target;
      const actual = target ? actions.find((a) => a.id === target.id) : undefined;
      if (target && (!actual || JSON.stringify(taskTarget(actual)) !== JSON.stringify(target))) throw refused('conflict', 'That follow-up changed. Close review and open it again.');
      const pending = suggestions.filter((a) => a.id !== review.id);
      const accepted: NoteAction = { ...proposal, ...ACCEPTED_FOLLOW_UP, id: target?.id ?? proposal.id, revision: nextId('revision'), takenOn: false, done: actual?.done ?? false, reviewed: { by: changer(me(), roleIn(n)), at: new Date().toISOString(), decision: review.decision }, changes: [...proposal.changes, changeBy(n, 'accepted')] };
      const next = review.decision === 'dismiss' ? actions : target ? actions.map((a) => a.id === target.id ? accepted : a) : [...actions, accepted];
      history.set(key, review);
      return {
        ...n,
        ...(room ? { rooms: n.rooms.map((r) => r.id === room.id ? { ...r, actions: next, suggestions: pending } : r) } : { actions: next, suggestions: pending }),
        ...(!room ? { totalActions: next.length, openActions: next.filter((a) => !a.done).length } : {})
      };
    }),
    updateDecision: (noteId: ID, decisionId: ID, p: DecisionPatch) => changeNote(noteId, (n) => ({
      ...n, decisions: n.decisions.map((d) => {
        if (d.id !== decisionId) return d;
        const state = p.state ?? (p.text !== undefined && d.state === 'confirmed' ? 'proposed' : d.state);
        const changes = [...d.changes, ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: d.text, after: p.text })] : []), ...(p.state ? [changeBy(n, p.state)] : []),
          ...(p.dispute !== undefined ? [changeBy(n, p.dispute ? 'disputed' : 'undisputed')] : [])];
        const disputes = p.dispute === true ? [...d.disputes, { by: changer(me(), roleIn(n)), at: new Date().toISOString() }] : p.dispute === false ? d.disputes.filter((x) => x.by.email !== me().email) : d.disputes;
        return { ...d, text: p.text ?? d.text, state, changes, disputes };
      })
    })),
    updateAction: (noteId: ID, actionId: ID, p: ActionPatch) => changeNote(noteId, (n) => {
      const actions = n.actions.map((a) => {
        if (a.id !== actionId) return a;
        const owner = p.owner === null ? undefined : p.owner ? personAt(p.owner) : a.owner?.person;
        const changes = [...a.changes, ...(p.takeOn ? [changeBy(n, 'took-on')] : []), ...(p.takeOn === false && a.takenOn ? [changeBy(n, 'reopened')] : []), ...(p.done !== undefined ? [changeBy(n, p.done ? 'done' : 'undone')] : []),
          ...(p.owner !== undefined ? [changeBy(n, p.owner === null ? 'declined' : 'reassigned')] : []), ...(p.due !== undefined ? [changeBy(n, 'due', { after: p.due ?? '' })] : []),
          ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: a.text, after: p.text })] : [])];
        const { owner: _was, due: _due, ...rest } = a;
        const due = p.due === null ? undefined : p.due ?? a.due;
        return {
          ...rest, revision: nextId('revision'), text: p.text ?? a.text, done: p.done ?? a.done, takenOn: p.takeOn ? true : p.takeOn === false ? false : p.owner !== undefined || (a.owner?.person?.email !== me().email && (p.text !== undefined || p.due !== undefined)) ? false : a.takenOn,
          ...(owner ? { owner: { name: owner.name, person: owner } } : {}), ...(due ? { due } : {}), changes
        };
      });
      return { ...n, actions, openActions: actions.filter((a) => !a.done).length };
    }),
    updateQuestion: (noteId: ID, questionId: ID, p: QuestionPatch) => changeNote(noteId, (n) => ({
      ...n, questions: n.questions.map((q) => (q.id !== questionId ? q : {
        ...q, text: p.text ?? q.text, state: p.state ?? q.state,
        changes: [...q.changes, ...(p.state ? [changeBy(n, p.state === 'answered' ? 'answered' : 'reopened')] : []), ...(p.text !== undefined ? [changeBy(n, 'reworded', { before: q.text, after: p.text })] : [])]
      }))
    })),
    updateRevisit: (noteId: ID) => answer((w) => noteIn(w, noteId)),
    inbox: () => answer(inboxOf),
    correctLine: (noteId: ID, lineId: ID, p: LinePatch) => changeNote(noteId, (n) => ({
      ...n, transcript: n.transcript?.map((l) => {
        if (l.id !== lineId) return l;
        const speaker = p.speaker === null ? undefined : p.speaker ? n.people.find((x) => x.id === p.speaker) : l.speaker?.person;
        const { unsure: _unsure, speaker: _speaker, ...rest } = l;
        return {
          ...rest, text: p.text ?? l.text, ...(speaker ? { speaker: { name: speaker.name, person: speaker } } : {}),
          changes: [...(l.changes ?? []), changeBy(n, p.confirm ? 'confirmed' : p.text !== undefined ? 'reworded' : 'reassigned', p.text !== undefined ? { before: l.text, after: p.text } : {})]
        };
      }) ?? null
    })),
    rewrite: (noteId: ID, o?: { model?: string | null | undefined }) => changeNote(noteId, (n, w) => {
      w.writing = {
        id: noteId, seconds: 5,
        written: () => {
          const was = noteIn(current(), noteId);
          return { ...was, writingAgain: false, writtenAt: new Date().toISOString(), model: o?.model === undefined ? was.model : o.model };
        }
      };
      return { ...n, writingAgain: true };
    }),
    cancelRewrite: (noteId: ID) => changeNote(noteId, (n, w) => {
      if (n.status !== 'ready') throw refused('conflict', 'The first notes are still being written.');
      if (w.writing?.id === noteId) w.writing = null;
      return { ...n, writingAgain: false };
    }),
    ask: (noteId: ID, question: string) => stream((w) => {
      const n = teamNoteIn(w, noteId) ?? noteIn(w, noteId);
      mayAsk(w);
      return asWritten(answerAbout(n, question));
    }),
    // Your notes, the ones shared with you and your team's; the ones @-referenced first, and one you can't open refused.
    // With written notes to answer from and none of your notes left this period, it's refused before anything is written.
    askAll: (question: string, refs?: ID[]) => stream((w) => {
      const team = teamNotesFor(w).filter((n) => n.received?.role === 'team');
      const all = [...w.notes, ...team];
      const named = (refs ?? []).slice(0, 5).map((id) => {
        const n = all.find((x) => x.id === id);
        if (!n) throw refused('not-found', 'One of the notes you referred to isn’t there, or you can’t open it.');
        return n;
      });
      if (all.some((n) => n.status === 'ready')) mayAsk(w);
      const about = named.filter((n) => n.status === 'ready').flatMap((n) => answerAbout(n, question));
      return asWritten([...about, ...(about.length ? [] : answerAcross({ ...w, notes: all }, question))]);
    }),
    setTeamVisible: (id: ID, visible: boolean) => answer((w) => {
      const n = noteIn(w, id);
      if (n.received) throw refused('forbidden', 'Only the note’s organizer can make it visible to their team.');
      if (visible && !licensed(w)) throw refused('forbidden', 'You need a team license to make a note visible to your team.');
      w.notes = w.notes.map((x) => (x.id === id ? { ...x, teamVisible: visible } : x));
    }),
    share: (id: ID, to: { emails: string[]; group?: string | undefined }) => changeNote(id, (n) => {
      const at = new Date().toISOString();
      const fresh = to.emails.map(personAt).filter((p) => !n.people.some((x) => x.email === p.email));
      return {
        ...n, people: [...n.people, ...fresh], sharedWith: [...n.sharedWith, ...fresh.map((p) => p.email)],
        recipients: [...n.recipients, ...fresh.map((person) => ({ person, role: 'shared' as const, by: me(), ...(to.group ? { group: to.group } : {}), at }))],
        groupShares: to.group ? [{ by: me(), group: to.group, at }, ...n.groupShares.filter((g) => !(g.by.email === me().email && g.group === to.group))] : n.groupShares
      };
    }),
    personal: (id: ID) => personalFor(id),
    previewAddition: (id: ID, entryId: ID) => answer((w): PromotionPreview => {
      const n = noteIn(w, id);
      const e = (w.personal[id] ?? []).find((x) => x.id === entryId);
      if (!e) throw refused('not-found', 'That isn’t in your notes any more.');
      const text = e.kind === 'note' ? e.text : e.kind === 'bookmark' ? e.label : e.answer;
      const moments = e.kind === 'bookmark' ? (e.moment ? [e.moment] : []) : e.kind === 'answer' ? e.moments : [];
      return { entryId, text, moments, destination: { noteId: id, title: n.title }, audience: n.people, team: teamReading(w, n), seal: `seal-${entryId}` };
    }),
    addToShared: (id: ID, entryId: ID, body: PromoteBody) => changeNote(id, (n, w) => {
      const e = (w.personal[id] ?? []).find((x) => x.id === entryId);
      const additionId = nextId('x');
      const at = new Date().toISOString();
      const moments = e?.kind === 'bookmark' ? (e.moment ? [e.moment] : []) : e?.kind === 'answer' ? e.moments : [];
      w.personal[id] = (w.personal[id] ?? []).map((x) => (x.id === entryId ? { ...x, shared: { additionId, at } } : x));
      return { ...n, additions: [...n.additions, { id: additionId, text: body.text, by: me(), at, moments, removable: true }] };
    }),
    links: (id: ID) => answer((w) => { noteIn(w, id); return linksTo(w, id); }),
    createLink: (id: ID) => answer((w): NewNoteLink => {
      const n = noteIn(w, id);
      if (n.status === 'recording') throw refused('invalid', 'These notes can be shared once the call ends.');
      const at = new Date();
      const link: NoteLink = { id: nextId('link'), by: me(), at: at.toISOString(), expiresAt: new Date(at.getTime() + NOTE_LINK_DAYS * 86_400_000).toISOString(), revocable: true };
      // 22 letters and digits, as a real secret is, and made up: it opens nothing outside Storybook.
      const secret = `Vandelay${String(Date.now()).slice(-6)}${link.id.replace(/\D/g, '').padStart(8, '0')}`.slice(0, 22).padEnd(22, '0');
      w.noteLinks = [...(w.noteLinks ?? []), { link, noteId: id, secret }];
      return { link, secret };
    }),
    revokeLink: (id: ID, linkId: ID) => answer((w) => {
      noteIn(w, id);
      w.noteLinks = (w.noteLinks ?? []).filter((x) => x.link.id !== linkId);
      return linksTo(w, id);
    }),
    // Until when a link opens, before it's opened: nothing joins Art's notes yet.
    peekLink: (secret: string) => answer((w): NoteLinkPeek => {
      const found = (w.noteLinks ?? []).find((x) => x.secret === secret && Date.parse(x.link.expiresAt) > Date.now());
      if (!found) throw refused('not-found', 'This link has run out or been revoked. Ask whoever sent it for a new one.');
      return { expiresAt: found.link.expiresAt };
    }),
    claimLink: (secret: string) => answer((w): NoteLinkClaimed => {
      const found = (w.noteLinks ?? []).find((x) => x.secret === secret && Date.parse(x.link.expiresAt) > Date.now());
      if (!found) throw refused('not-found', 'This link has run out or been revoked. Ask whoever sent it for a new one.');
      // Notes you don't have yet join yours, as shared by whoever made the link.
      if (found.note && !w.notes.some((n) => n.id === found.noteId)) w.notes = [found.note, ...w.notes];
      return { noteId: found.noteId };
    }),
    sharedAudience: (id: ID) => answer((w): SharedAudience => {
      const n = noteIn(w, id);
      if (n.status !== 'ready') throw refused('conflict', 'These notes are still being written. You can add this once they are.');
      return { audience: n.people, team: teamReading(w, n), seal: audienceSeal(n) };
    }),
    writeShared: (id: ID, body: SharedWrite) => changeNote(id, (n) => {
      if (n.status !== 'ready') throw refused('conflict', 'These notes are still being written. You can add this once they are.');
      if (body.seal !== audienceSeal(n)) throw refused('conflict', 'Someone got these notes since you started writing. Look at who reads it now, then post it.');
      return { ...n, additions: [...n.additions, { id: nextId('x'), text: body.text, by: me(), at: new Date().toISOString(), moments: [], removable: true }] };
    }),
    takeBack: (id: ID, additionId: ID) => changeNote(id, (n, w) => {
      w.personal[id] = (w.personal[id] ?? []).map((x) => (x.shared?.additionId === additionId ? { ...x, shared: null } : x));
      return { ...n, additions: n.additions.filter((a) => a.id !== additionId) };
    }),
    delete: (id: ID) => answer((w) => { noteIn(w, id); w.notes = w.notes.filter((n) => n.id !== id); }),
    // The stand-in keeps no video of a share: what's saved is silence as long as its part of the recording, as replay plays.
    screenVideo: (id: ID, share: ID, segment: number) => answer((w) => {
      const part = noteIn(w, id).shares.find((s) => s.id === share)?.segments.find((g) => g.segment === segment);
      return part ? part.until - part.at : 60;
    }).then(quietAudio)
  },
  series: {
    get: (id: ID) => answer((w) => seriesIn(w, id)),
    ask: (id: ID, question: string): AsyncIterable<SeriesAnswerPart> => stream((w) => {
      const s = seriesIn(w, id);
      mayAsk(w);
      const parts = answerAcross({ ...w, notes: w.notes.filter((n) => n.seriesId === id) }, question);
      return parts.flatMap((p): SeriesAnswerPart[] => {
        if (p.type === 'text') return [p];
        if (p.type !== 'cite') return [];
        const n = s.notes.find((x) => x.id === p.noteId);
        return n ? [{ type: 'source', noteId: n.id, title: n.title, startedAt: n.startedAt, at: p.at }] : [];
      });
    })
  },
  models: { list: () => answer(() => AI_MODELS) }
};

/** How a note's writing is going: its steps as they're done, and then it's ready, as the note in the world now is. */
async function* progressOf(id: string): AsyncIterable<NoteProgress> {
  const first = await answer((w) => noteIn(w, id));
  const w = current();
  const writing = w.writing?.id === id ? w.writing : null;
  const room = first.kind === 'room';
  const steps = (done: number, ready: boolean): NoteProgress => ({
    noteId: id, title: first.title, ready,
    steps: [
      { label: room ? 'Recording stopped' : 'Call ended', done: done > 0 },
      { label: `${Math.max(1, Math.round(first.duration / 60))} min of audio saved, encrypted`, done: done > 1 },
      { label: first.transcript?.length ? `Transcript of ${first.transcript.length} lines` : 'Nothing was transcribed', done: done > 2 },
      { label: ready ? 'Notes written' : 'Writing the summary, decisions and follow-ups', done: ready }
    ]
  });
  if (!writing) { yield steps(4, first.status === 'ready'); return; }
  const each = (writing.seconds * 1000) / 4;
  for (let done = 1; done <= 3; done++) {
    yield steps(done, false);
    await pause(each);
    if (w.writing !== writing) { yield steps(4, true); return; }
  }
  const written = writing.written();
  w.notes = w.notes.map((n) => (n.id === id ? written : n));
  w.writing = null;
  yield steps(4, true);
}

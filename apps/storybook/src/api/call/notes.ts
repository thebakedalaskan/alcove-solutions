/*
 * What's heard while notes are on (the transcript), the live notes written from it a few seconds later, follow-ups (the
 * notes' suggestions, those added by hand, and reviewing them), catching up, and Hear it.
 */
import { ACCEPTED_FOLLOW_UP, AlcoveApiError, type AudioPiece, type CallAnswer, type CallFollowUp, type CallFollowUps, type CallMoment, type CallState, type CaptionLanguage, type CaptionTranslation, type CatchUp, type CatchUpRange, type CatchUpWindow, type DocFollowUpTick, type FollowUpCreate, type FollowUpPatch, type FollowUpReview, type FollowUpTarget, type LineAudio, type LiveFollowUp, type Person, type SeriesAnswerPart, type TranscriptClip, type TranscriptLine } from '@alcove/api';
import { changer } from '../../world/build';
import { Pushed } from '../live';
import { quietAudio } from '../media';
import { nextId } from '../state';
import { CallWithCapture } from './capture';
import type { Line } from './script';

/** How long Hear it takes to fetch a line of the recording, so pressing it shows it working. */
const HEAR_MS = 900;

export abstract class CallWithNotes extends CallWithCapture {
  /** Lines Hear it has asked for already. */
  private asked = new Set<string>();
  /** What's been heard while notes were on, with what the notes take from it. */
  protected heard: { line: Line; id: string; at: number }[] = [];
  /** Resolved proposals stay here when notes refresh, so dismissed evidence never returns. */
  protected inferred = new Map<string, LiveFollowUp>();
  private reviewed = new Map<string, FollowUpReview>();
  private watching = 0;
  protected notesFor = -1;
  private writing = false;
  private followWatchers = 0;
  readonly followUps = new Pushed<CallFollowUps | null>(null);

  /** Whoever's showing the call's follow-ups hears every change to the call that changes them. */
  protected override push(next: CallState): void {
    super.push(next);
    if (this.followWatchers > 0) this.tellFollowUps();
  }

  /** A line into the transcript, if notes are on where it was said and you're there to read it. */
  protected heardLine(l: Line, at: number): void {
    const s = this.getSnapshot();
    const here = s.capture.room ? s.capture.room.mode : s.capture.mode;
    const who = l.who === 'me' ? s.participants.find((p) => p.isMe) : this.find(l.who);
    const c = this.crypto.getSnapshot();
    if (!who || here !== 'on' || c.status === 'waiting' || c.status === 'denied' || (!who.isMe && c.status === 'in' && !c.members.includes(who.id))) return;
    const id = l.id ?? nextId('line');
    const room = s.capture.room ? s.breakouts.open?.rooms.find((r) => r.id === s.capture.room?.id) : undefined;
    const t: TranscriptLine = { id, at, speaker: { name: who.person.name, person: who.person }, text: l.text, ...(room ? { room: { id: room.id, name: room.name } } : {}) };
    this.heard.push({ line: l, id, at });
    this.push({ ...s, transcript: [...s.transcript, t] });
    this.writeNotesSoon();
  }

  /* ---------- the live notes ---------- */

  /** While anyone's watching, the notes are written again a few seconds after something new is said. */
  private writeNotesSoon(): void {
    if (this.watching < 1 || this.writing || this.heard.length === this.notesFor) return;
    this.writing = true;
    this.after(2500, () => {
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, writing: true } }));
      this.after(1500, () => {
        this.writing = false;
        this.notesFor = this.heard.length;
        this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes: this.notesNow(), suggestions: this.suggestionsNow(), writing: false, error: this.notesError() } }));
        this.writeNotesSoon();
      });
    });
  }
  protected suggestionsNow(): LiveFollowUp[] { return [...this.inferred.values()].filter((f) => f.review === 'suggested'); }
  /** Where the call has got to, from what's been said so far. */
  protected notesNow(): NonNullable<CallState['liveNotes']['notes']> {
    const s = this.getSnapshot();
    const evidence = (h: { id: string; at: number }) => [{ kind: 'transcript' as const, lineId: h.id, said: h.at }];
    const decided = this.heard.flatMap((h) => (h.line.decides ? [{ text: h.line.decides, evidence: evidence(h) }] : []));
    for (const h of this.heard) {
      const hands = h.line.hands;
      const id = `fu-${h.id}`;
      if (!hands || this.inferred.has(id)) continue;
      const who = hands.owner ?? h.line.who;
      const ownerPerson = who === 'me' ? this.me.person : who;
      this.inferred.set(id, {
        ...ACCEPTED_FOLLOW_UP, review: 'suggested', revision: `${id}-v1`, id, text: hands.text,
        owner: ownerPerson.name, ownerPerson, ...(hands.due ? { due: hands.due } : {}), evidence: evidence(h), done: false
      });
    }
    return {
      summary: this.summaryNow() || decided.map((d) => d.text).join(' '),
      decided,
      proposed: [], open: [],
      next: [...this.inferred.values()].filter((f) => f.review === 'accepted' && f.changeOf === null),
      read: { from: 0, to: s.elapsed, lines: s.transcript.length, through: s.transcript.at(-1)?.at ?? null, gaps: s.capture.gaps, missed: [], whileHere: false, skipped: null, asOf: s.elapsed }
    };
  }
  /** What the live notes say went wrong: the server's words, while the script has them not written again just now. */
  protected notesError(): string | null {
    return this.script.notesStale ? 'The notes couldn’t be updated just now. Alcove tries again on its own.' : null;
  }
  /** The script's summary as far as the conversation has got: each sentence once its share of the call has been said. */
  private summaryNow(): string {
    const sentences = (this.script.summary ?? '').match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
    if (!this.heard.length || !sentences.length) return '';
    const total = (this.script.earlier?.length ?? 0) + (this.script.talk?.lines.length ?? 0);
    const shown = total ? Math.floor((sentences.length * this.heard.length) / total) : sentences.length;
    return sentences.slice(0, shown).join('').trim();
  }
  /** The call's follow-ups as you may read them: the live notes' and the ones added by hand. */
  private tellFollowUps(): void {
    const s = this.getSnapshot();
    const mode = s.capture.room ? s.capture.room.mode : s.capture.mode;
    const items: CallFollowUp[] = [
      ...(s.liveNotes.notes?.next ?? []).map((n): CallFollowUp => ({ ...n, from: 'notes' })),
      ...s.liveNotes.added.map((a): CallFollowUp => ({ ...a, from: 'added' }))
    ];
    const next: CallFollowUps = { items, suggestions: s.liveNotes.suggestions, notes: mode === 'off' ? 'off' : mode === 'paused' ? 'paused' : 'on' };
    if (JSON.stringify(next) !== JSON.stringify(this.followUps.getSnapshot())) this.followUps.set(next);
  }
  watchFollowUps(): () => void {
    this.followWatchers += 1;
    this.tellFollowUps();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.followWatchers -= 1; } };
  }
  tickDocumentFollowUp(_tick: DocFollowUpTick): Promise<void> { return Promise.resolve(); }
  translate(lineIds: string[], _language: CaptionLanguage): Promise<CaptionTranslation[]> {
    const lines = this.getSnapshot().transcript;
    return Promise.resolve(lineIds.flatMap((id) => { const l = lines.find((x) => x.id === id); return l ? [{ id, text: l.text }] : []; }));
  }
  /**
   * Hear it, as the call plays it: a line in your own transcript, which is only what you were there for, as a few quiet
   * seconds of the recording around it, after a moment's fetching. Anything else isn't there, as the API says it, and so is
   * whatever the script says Hear it gets (`CallScript.hear`).
   */
  hear(note: string, line: string): Promise<LineAudio> {
    const s = this.getSnapshot();
    const l = s.transcript.find((x) => x.id === line);
    const missing = () => new AlcoveApiError('not-found', 'That moment of the call doesn’t exist, or you don’t have access to it.');
    if (s.notes.noteId !== note || !l || l.room || !s.notes.keepsRecording) return Promise.reject(missing());
    const answer = this.script.hear ?? 'plays';
    if (answer === 'waits') return new Promise<LineAudio>(() => undefined);
    return new Promise<LineAudio>((resolve, reject) => this.after(HEAR_MS, () => {
      if (answer === 'not-found') { reject(missing()); return; }
      // The recording has the line the second time it's asked for: its piece has gone up by then.
      if (answer === 'not-yet' && !this.asked.has(line)) { this.asked.add(line); reject(new AlcoveApiError('conflict', 'The recording doesn’t have this line yet. Try again in a few seconds.')); return; }
      resolve({ audio: answer === 'unplayable' ? new Blob([new Uint8Array(64)], { type: 'audio/webm' }) : quietAudio(5), from: 1, seconds: 3 });
    }));
  }
  appendAudio(_piece: AudioPiece): Promise<void> { return Promise.resolve(); }
  transcribe(_clip: TranscriptClip, _speaker: string): Promise<void> { return Promise.resolve(); }
  watchNotes(): () => void {
    this.watching += 1;
    this.writeNotesSoon();
    let stopped = false;
    return () => { if (!stopped) { stopped = true; this.watching -= 1; } };
  }
  private followUpTarget(row: LiveFollowUp): FollowUpTarget {
    return { id: row.id, revision: row.revision, text: row.text, owner: row.ownerPerson?.email ?? null, due: row.due ?? null };
  }
  private refreshFollowUps(): void {
    const notes = this.notesNow();
    this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, notes, suggestions: this.suggestionsNow() } }));
  }
  private followUpOwner(email: string | null): Person | null {
    if (email === null) return null;
    const owner = [this.meeting.organizer, ...this.meeting.guests, ...this.getSnapshot().participants.map((p) => p.person)].find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (!owner) throw new AlcoveApiError('invalid', 'Choose someone invited to the call.');
    return owner;
  }
  tickFollowUp(id: string, done: boolean): Promise<void> {
    const row = this.inferred.get(id);
    if (row?.review === 'accepted') this.inferred.set(id, { ...row, done, revision: nextId('revision') });
    this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, added: s.liveNotes.added.map((a) => a.id === id ? { ...a, done, revision: nextId('revision') } : a) } }));
    this.refreshFollowUps();
    return Promise.resolve();
  }
  /** Manual tasks are actual immediately; choosing an owner never claims their agreement. */
  addFollowUp(input: FollowUpCreate): Promise<void> {
    const s = this.getSnapshot();
    if (!s.notes.everOn || s.role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can add follow-ups.'));
    const words = input.text.replace(/\s+/g, ' ').trim();
    if (!words || s.liveNotes.added.some((a) => a.text === words)) return Promise.resolve();
    try {
      const ownerPerson = this.followUpOwner(input.owner);
      const at = Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000));
      this.change((now) => ({ ...now, liveNotes: { ...now.liveNotes, added: [...now.liveNotes.added, {
        ...ACCEPTED_FOLLOW_UP, revision: nextId('revision'), id: nextId('added'), text: words, ownerPerson, ...(ownerPerson ? { owner: ownerPerson.name } : {}), ...(input.due ? { due: input.due } : {}), evidence: [], done: false, at
      }] } }));
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  updateFollowUp(id: string, patch: FollowUpPatch): Promise<void> {
    const s = this.getSnapshot();
    const row = this.inferred.get(id) ?? s.liveNotes.added.find((a) => a.id === id);
    if (s.role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can edit follow-ups.'));
    if (!row || row.review !== 'accepted' || JSON.stringify(this.followUpTarget(row)) !== JSON.stringify({ id, ...patch.seen })) return Promise.reject(new AlcoveApiError('conflict', 'That follow-up changed. Open it again.'));
    try {
      const ownerPerson = patch.owner === undefined ? row.ownerPerson : this.followUpOwner(patch.owner);
      const { owner: _owner, due: _due, ...rest } = row;
      const due = patch.due === undefined ? row.due : patch.due;
      const next: LiveFollowUp = { ...rest, revision: nextId('revision'), text: patch.text ?? row.text, ownerPerson, ...(ownerPerson ? { owner: ownerPerson.name } : {}), ...(due ? { due } : {}) };
      if (this.inferred.has(id)) this.inferred.set(id, next);
      this.change((now) => ({ ...now, liveNotes: { ...now.liveNotes, added: now.liveNotes.added.map((a) => a.id === id ? { ...next, at: a.at } : a) } }));
      this.refreshFollowUps();
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  reviewFollowUp(review: FollowUpReview): Promise<void> {
    if (this.getSnapshot().role === 'guest') return Promise.reject(new AlcoveApiError('forbidden', 'Only someone invited can review follow-ups.'));
    const previous = this.reviewed.get(review.id);
    if (previous?.revision === review.revision && previous.decision === review.decision) return Promise.resolve();
    const proposal = this.inferred.get(review.id);
    if (previous || !proposal || proposal.review !== 'suggested' || proposal.revision !== review.revision) return Promise.reject(new AlcoveApiError('conflict', 'That suggestion changed or has already been reviewed.'));
    const target = proposal.target;
    const actual = target ? this.inferred.get(target.id) ?? this.getSnapshot().liveNotes.added.find((a) => a.id === target.id) : undefined;
    if (target && (!actual || JSON.stringify(this.followUpTarget(actual)) !== JSON.stringify(target))) return Promise.reject(new AlcoveApiError('conflict', 'That follow-up changed. Close review and open it again.'));
    this.reviewed.set(review.id, review);
    const reviewed = { by: changer(this.me.person, this.me.isOrganizer ? 'organizer' : 'invited'), at: new Date().toISOString(), decision: review.decision };
    if (review.decision === 'dismiss') this.inferred.set(proposal.id, { ...proposal, review: 'dismissed', reviewed });
    else if (target) {
      const accepted: LiveFollowUp = { ...proposal, ...ACCEPTED_FOLLOW_UP, id: target.id, reviewed, done: actual?.done ?? false, revision: nextId('revision') };
      this.inferred.set(proposal.id, { ...proposal, review: 'accepted', reviewed });
      if (this.inferred.has(target.id)) this.inferred.set(target.id, accepted);
      this.change((s) => ({ ...s, liveNotes: { ...s.liveNotes, added: s.liveNotes.added.map((a) => a.id === target.id ? { ...accepted, at: a.at } : a) } }));
    } else this.inferred.set(proposal.id, { ...proposal, review: 'accepted', reviewed, revision: nextId('revision') });
    this.refreshFollowUps();
    return Promise.resolve();
  }
  catchUp(_range: CatchUpRange): Promise<CatchUp> {
    const n = this.notesNow();
    return Promise.resolve({ ...n, next: n.next.map(({ text, owner, due, evidence }) => ({ text, ...(owner ? { owner } : {}), ...(due ? { due } : {}), evidence })) });
  }
  askSoFar(_question: string, _range: CatchUpRange): Promise<CallAnswer> {
    const n = this.notesNow();
    return Promise.resolve({ text: n.summary || 'Nothing’s been said yet while notes were on.', evidence: n.decided.flatMap((d) => d.evidence).slice(0, 2), read: n.read });
  }
  catchUpWindow(): Promise<CatchUpWindow> {
    const s = this.getSnapshot();
    return Promise.resolve({ now: s.elapsed, joined: this.script.since ?? 0, away: null, here: null, gaps: s.capture.gaps });
  }
  moment(lineId: string): Promise<CallMoment> {
    const lines = this.getSnapshot().transcript;
    const k = lines.findIndex((l) => l.id === lineId);
    return Promise.resolve({ lineId, lines: lines.slice(Math.max(0, k - 2), k + 3).map((l) => ({ ...l, said: l.at })) });
  }
  askEarlier(_question: string, _timeZone: string): Promise<SeriesAnswerPart[]> { return Promise.resolve([{ type: 'text', text: 'There’s nothing from earlier calls in this series yet.' }]); }
}

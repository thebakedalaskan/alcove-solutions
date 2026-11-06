/*
 * A recording in the room, played out: the clock runs while it records, and what's said arrives a line at a time from a
 * script (a walk round a warehouse floor), whatever the microphone hears. Stopping it leaves a note that's written a few
 * seconds later; discarding it leaves nothing.
 */
import type { AudioPiece, RecordingStopResult, RoomRecording, RoomRecordingInput, RoomRecordingState, TranscriptClip, TranscriptLine } from '@alcove/api';
import { writeNote } from '../world/build';
import { Snapshots } from './live';
import { current, me, nextId } from './state';

/** What's said in the room, in order, a line every few seconds. */
const SAID = [
  'Morning. This is the cold store, and the alarm went off twice last night, both before four.',
  'The handover sheet says the door was shut both times, so it’s the sensor, not the door.',
  'We’ll keep a paper log until Friday, then check it against the sensor’s own record.',
  'Next is loading bay two. The new racking goes in on Monday.',
  'Can we keep the handover in Portuguese? Half the night shift reads it first thing.',
  'Anything else before we walk the floor?'
];
const EVERY_MS = 6500;

export class ScriptedRecording extends Snapshots<RoomRecordingState> implements RoomRecording {
  private said = 0;

  constructor(input: RoomRecordingInput) {
    const id = nextId('rec');
    const noteId = nextId('room');
    const startedAt = input.startedAt ?? new Date().toISOString();
    super({ id, noteId, title: input.title ?? '', startedAt, elapsed: 0, status: 'recording', recording: { segment: 0, pieces: 0, seconds: 0 }, transcript: [] });
    current().notes.unshift(writeNote({ id: noteId, kind: 'room', status: 'recording', title: input.title ?? '', startedAt, minutes: 0, organizer: me(), excerpt: '' }, me()));
    this.every(1000, () => {
      if (this.getSnapshot().status !== 'recording') return;
      this.change((s) => ({ ...s, elapsed: s.elapsed + 1, recording: { ...s.recording, seconds: s.recording.seconds + 1, pieces: Math.floor((s.recording.seconds + 1) / 5) } }));
    });
    this.every(EVERY_MS, () => this.hear());
  }

  /** The next line of the script, said now. */
  private hear(): void {
    const s = this.getSnapshot();
    const text = SAID[this.said];
    if (s.status !== 'recording' || text === undefined) return;
    this.said += 1;
    const line: TranscriptLine = { id: `${s.id}-l${this.said}`, at: s.elapsed, text };
    this.push({ ...s, transcript: [...s.transcript, line] });
  }

  rename(title: string): Promise<void> {
    this.change((s) => ({ ...s, title }));
    for (const n of current().notes) if (n.id === this.getSnapshot().noteId) n.title = title;
    return Promise.resolve();
  }
  pause(): Promise<void> { this.change((s) => ({ ...s, status: 'paused' })); return Promise.resolve(); }
  resume(): Promise<void> { this.change((s) => ({ ...s, status: 'recording' })); return Promise.resolve(); }
  appendAudio(_piece: AudioPiece): Promise<void> { return Promise.resolve(); }
  transcribe(_clip: TranscriptClip): Promise<void> { return Promise.resolve(); }

  stop(): Promise<RecordingStopResult> {
    const s = this.getSnapshot();
    this.push({ ...s, status: 'stopped' });
    this.halt();
    const w = current();
    const title = s.title || 'Notes from the room';
    const spec = {
      id: s.noteId, kind: 'room' as const, title, startedAt: s.startedAt, minutes: Math.max(1, Math.round(s.elapsed / 60)), organizer: me(),
      excerpt: 'The cold store alarm stays on paper until Friday. The handover stays in Portuguese.',
      summary: 'A walk round the floor: the cold store alarm is the sensor, not the door, so a paper log runs until Friday. The new racking goes into loading bay two on Monday, and the handover stays in Portuguese for the night shift.',
      said: s.transcript.map((l) => ({ at: `${Math.floor(l.at / 60)}:${String(Math.floor(l.at % 60)).padStart(2, '0')}`, text: l.text })),
      actions: [{ id: `${s.noteId}-a1`, text: 'Check the paper log against the sensor’s record', owner: me(), due: 'Friday' }]
    };
    const who = me();
    w.notes = w.notes.map((n) => (n.id === s.noteId ? writeNote({ ...spec, status: 'pending' }, who) : n));
    w.writing = { id: s.noteId, seconds: 6, written: () => writeNote(spec, who) };
    return Promise.resolve({ pendingNoteId: s.noteId, duration: s.elapsed });
  }

  /** The story moved on: its clock and its script stop. */
  forget(): void { this.halt(); }

  discard(): Promise<void> {
    const s = this.getSnapshot();
    this.push({ ...s, status: 'stopped' });
    this.halt();
    const w = current();
    w.notes = w.notes.filter((n) => n.id !== s.noteId);
    return Promise.resolve();
  }
}

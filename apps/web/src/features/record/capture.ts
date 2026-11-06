/*
 * What the microphone records in the room, for the stage recorder (stage.ts): the recording itself, in 5-second
 * pieces (NotesRecorder), and clips of speech for the live transcript (SpeechClips), from one microphone. A room
 * recording has one segment. The stage says what should happen (record, pause, finish, discard); this keeps the two
 * in step: pausing resolves once everything said so far has gone (or been kept), finishing once the last piece and
 * clip have, and discarding drops what hasn't.
 *
 * Pieces and clips go to the recording through `sink`; given `keep`, whatever can't be sent is kept on this device
 * instead, to upload later (offline.ts).
 */
import type { AudioPiece, RoomRecording, RoomRecordingState, TranscriptClip } from '@alcove/api';
import { NotesRecorder } from '~/features/call/notes/recorder';
import { SpeechClips } from '~/features/call/notes/speech';

/** Where a room recording's audio and speech go. */
export type RoomSink = Pick<RoomRecording, 'appendAudio' | 'transcribe'>;
/** Where they're kept when they can't go yet. */
export interface RoomKeep { piece: (p: AudioPiece) => Promise<void>; clip: (c: TranscriptClip) => Promise<void> }

/** Finishing waits this long for the last clips to be sent; any still waiting are kept and sent later (when keeping). */
const LAST_CLIPS_MS = 5000;

export class RoomCapture {
  private readonly audio: NotesRecorder;
  private readonly speech: SpeechClips;
  private readonly keeping: boolean;

  /**
   * `lost` hears, in a sentence, that a piece of the recording couldn't be saved. `heard` hears why the live
   * transcript is behind, or null once clips get through again.
   */
  constructor(sink: RoomSink, on: { lost: (message: string) => void; heard: (problem: string | null) => void }, keep: RoomKeep | null = null) {
    this.audio = new NotesRecorder((p) => sink.appendAudio(p), on.lost, undefined, keep ? (p) => keep.piece(p) : null);
    this.speech = new SpeechClips((c) => sink.transcribe(c), on.heard, null, keep ? (c) => keep.clip(c) : null);
    this.keeping = keep !== null;
  }

  /** Follows the recording: it records from `mic` while recording (another microphone carries on in the same recording), and holds while paused. */
  follow(mic: MediaStreamTrack, status: RoomRecordingState['status']): void {
    if (status === 'recording') { this.audio.start([{ identity: 'microphone', track: mic }], 0); this.speech.start(mic, 0); }
    if (status === 'paused') { void this.audio.pause(); this.speech.pause(); }
  }

  /** Stops hearing, and resolves once everything recorded and said until now has been sent (or kept): the recording can pause then. */
  async pause(): Promise<void> {
    this.speech.pause();
    await Promise.all([this.audio.pause(), this.speech.flush()]);
  }

  /**
   * Resolves once the last piece and clip have been sent, or kept, and hears nothing more: the recording can stop then.
   * When keeping, no clip is left behind: the last ones are sent, or kept to send later.
   */
  async finish(): Promise<void> {
    await Promise.all([this.audio.flush(), this.keeping ? this.speech.drain(LAST_CLIPS_MS) : this.speech.flush()]);
    this.speech.stop();
  }

  /** Stops at once. Whatever hasn't been sent is dropped (neither sent nor kept), as the recording is. */
  discard(): void {
    this.audio.discard();
    this.speech.stop();
  }

  /** The screen has gone: the transcript hears nothing more. */
  close(): void {
    this.speech.stop();
  }
}

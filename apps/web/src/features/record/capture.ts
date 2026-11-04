/*
 * What the microphone records in the room, for the stage recorder (routes/record.live.tsx): the recording itself, in
 * 5-second pieces (NotesRecorder), and clips of speech for the live transcript (SpeechClips), from one microphone. A
 * room recording has one segment. The screen says what should happen (record, pause, finish, discard); this keeps
 * the two in step: pausing resolves once everything said so far has gone, finishing once the last piece and clip
 * have, and discarding drops what hasn't.
 *
 * Pieces and clips reach the recording only through its `appendAudio` and `transcribe`, so a recording kept on this
 * device until there's a connection can stand in for the one on the server without the screen changing.
 */
import type { RoomRecording, RoomRecordingState } from '@alcove/api';
import { NotesRecorder } from '~/features/call/media';
import { SpeechClips } from '~/features/call/speech';

/** Where a room recording's audio and speech go. */
export type RoomSink = Pick<RoomRecording, 'appendAudio' | 'transcribe'>;

export class RoomCapture {
  private readonly audio: NotesRecorder;
  private readonly speech: SpeechClips;

  /**
   * `lost` hears, in a sentence, that a piece of the recording couldn't be saved. `heard` hears why the live
   * transcript is behind, or null once clips get through again.
   */
  constructor(sink: RoomSink, on: { lost: (message: string) => void; heard: (problem: string | null) => void }) {
    this.audio = new NotesRecorder((p) => sink.appendAudio(p), on.lost);
    this.speech = new SpeechClips((c) => sink.transcribe(c), on.heard);
  }

  /** Follows the recording: it records from `mic` while recording (another microphone carries on in the same recording), and holds while paused. */
  follow(mic: MediaStreamTrack, status: RoomRecordingState['status']): void {
    if (status === 'recording') { this.audio.start([{ identity: 'microphone', track: mic }], 0); this.speech.start(mic, 0); }
    if (status === 'paused') { void this.audio.pause(); this.speech.pause(); }
  }

  /** Stops hearing, and resolves once everything recorded and said until now has been sent: the recording can pause then. */
  async pause(): Promise<void> {
    this.speech.pause();
    await Promise.all([this.audio.pause(), this.speech.flush()]);
  }

  /** Resolves once the last piece and clip have been sent, and hears nothing more: the recording can stop then. */
  async finish(): Promise<void> {
    await Promise.all([this.audio.flush(), this.speech.flush()]);
    this.speech.stop();
  }

  /** Stops at once. Whatever hasn't been sent is dropped, as the recording is. */
  discard(): void {
    this.audio.stop();
    this.speech.stop();
  }

  /** The screen has gone: the transcript hears nothing more. */
  close(): void {
    this.speech.stop();
  }
}

import { Live } from '../transport/live';
import { type AudioPiece, type RecordingAction, RecordingStopResultSchema, type RoomRecording, type RoomRecordingState, type TranscriptClip } from '@alcove/api';
import { z } from 'zod';

interface RecordingTransport {
  act(id: string, a: RecordingAction): Promise<RoomRecordingState>;
  audio(id: string, p: AudioPiece): Promise<RoomRecordingState>;
  transcribe(id: string, c: TranscriptClip): Promise<RoomRecordingState>;
  stop(id: string): Promise<z.infer<typeof RecordingStopResultSchema>>;
  discard(id: string): Promise<void>;
}

export class HttpRecording extends Live<RoomRecordingState> implements RoomRecording {
  constructor(initial: RoomRecordingState, private readonly t: RecordingTransport) { super(initial, (s) => s.status === 'recording'); }
  /** Shows the change at once, and resolves once the server has made it. */
  private act(a: RecordingAction, optimistic: (s: RoomRecordingState) => RoomRecordingState): Promise<void> {
    this.set(optimistic(this.state));
    return this.t.act(this.state.id, a).then((s) => this.apply(s));
  }
  rename = (title: string) => (title.trim() ? this.act({ type: 'rename', title }, (s) => ({ ...s, title })) : Promise.resolve());
  pause = () => this.act({ type: 'pause' }, (s) => ({ ...s, status: 'paused' }));
  resume = () => this.act({ type: 'resume' }, (s) => ({ ...s, status: 'recording' }));
  appendAudio = async (p: AudioPiece) => { const s = await this.t.audio(this.state.id, p); this.set({ ...this.state, recording: s.recording }); };
  transcribe = async (c: TranscriptClip) => { const s = await this.t.transcribe(this.state.id, c); this.set({ ...this.state, transcript: s.transcript }); };
  stop = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); return this.t.stop(this.state.id); };
  discard = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); await this.t.discard(this.state.id); };
}

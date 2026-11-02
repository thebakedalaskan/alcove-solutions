import type { RoomRecording, RoomRecordingState } from '@alcove/api';
import { ROOM_SCRIPT } from './fixtures';
import { Store, uid } from './emitter';

export class MockRoomRecording extends Store<RoomRecordingState> implements RoomRecording {
  private timers: ReturnType<typeof setInterval>[] = [];
  private i = 0;
  private phase = 0;
  constructor(title: string, private onStop: (s: RoomRecordingState) => Promise<{ pendingNoteId: string; duration: number }>) {
    super({ id: uid('rec'), title, elapsed: 0, status: 'recording', level: 0, transcript: [] });
    this.timers.push(setInterval(() => { if (this.state.status === 'recording') this.set((s) => ({ elapsed: s.elapsed + 1 })); }, 1000));
    this.timers.push(setInterval(() => {
      if (this.state.status !== 'recording') { if (this.state.level) this.set({ level: 0 }); return; }
      this.phase += 0.35;
      this.set({ level: Math.min(1, 0.25 + Math.abs(Math.sin(this.phase) * Math.cos(this.phase * 0.7)) * 0.75 * (0.7 + Math.random() * 0.3)) });
    }, 110));
    this.timers.push(setInterval(() => {
      if (this.state.status !== 'recording' || this.i >= ROOM_SCRIPT.length) return;
      const l = ROOM_SCRIPT[this.i++];
      if (!l) return;
      this.set((s) => ({ transcript: [...s.transcript, { id: uid('l'), at: s.elapsed, speaker: { name: l.speaker }, text: l.text }] }));
    }, 3200));
  }
  rename = (title: string) => this.set({ title });
  pause = () => this.set({ status: 'paused' });
  resume = () => this.set({ status: 'recording' });
  stop = async () => { this.timers.forEach(clearInterval); this.set({ status: 'stopped', level: 0 }); return this.onStop(this.state); };
  discard = async () => { this.timers.forEach(clearInterval); this.set({ status: 'stopped', level: 0 }); };
}

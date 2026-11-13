import type { CallMoveOut, MoveMedia, MoveOutState } from '@alcove/api';
import { Pushed } from '../live';

/** Moving to another device: the code waits to be opened on the other one, which never happens here. */
export class MoveOut extends Pushed<MoveOutState> implements CallMoveOut {
  constructor() {
    super({ stage: 'open', code: 'StorybookMoveCode00000', expiresAt: Date.now() + 120_000, device: null, sameAccount: true, problem: null });
  }
  confirm(_media: MoveMedia): Promise<void> { this.update((s) => ({ ...s, stage: 'moved' })); return Promise.resolve(); }
  cancel(): Promise<void> { this.update((s) => ({ ...s, stage: 'cancelled' })); return Promise.resolve(); }
  renew(): Promise<void> { this.update((s) => ({ ...s, stage: 'open', expiresAt: Date.now() + 120_000 })); return Promise.resolve(); }
}

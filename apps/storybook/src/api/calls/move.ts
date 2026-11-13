/*
 * A call being moved to this device, as this device sees it (/move): the other device made a code, this one opened it
 * and holds the move by its claim. It waits for Move here, then for the other device to let go; that device isn't in
 * Storybook, so the move stays there. Not now calls it off, and nothing done runs it out. Signing in here (a move needs
 * the same account) reads it again.
 */
import type { CallMoveIn, MoveInState } from '@alcove/api';
import type { MoveSpec } from '../../world/world';
import { Pushed } from '../live';
import { current } from '../state';

export class ScriptedMove extends Pushed<MoveInState> implements CallMoveIn {
  readonly claim: string;

  constructor(spec: MoveSpec) {
    const left = spec.seconds ?? 120;
    super({
      stage: left > 0 ? 'claimed' : 'expired',
      move: {
        stage: 'claimed', expiresAt: new Date(Date.now() + left * 1000).toISOString(), title: spec.title, organizerName: spec.organizerName, you: spec.you,
        account: ScriptedMove.account(), media: spec.media, joined: null
      },
      session: null, problem: null
    });
    this.claim = spec.claim;
    // Nothing happens, and it runs out.
    if (left > 0) this.after(left * 1000, () => this.update((s) => (s.stage === 'claimed' || s.stage === 'ready' ? { ...s, stage: 'expired' } : s)));
  }

  /** Whether this device is signed in to the account the move is for: anyone signed in here is, in the demo world. */
  private static account(): MoveInState['move']['account'] {
    return current().session ? 'ok' : 'needed';
  }

  ready(): Promise<void> {
    this.update((s) => ({ ...s, stage: 'ready', move: { ...s.move, stage: 'ready' } }));
    return Promise.resolve();
  }
  refresh(): Promise<void> {
    this.update((s) => ({ ...s, move: { ...s.move, account: ScriptedMove.account() } }));
    return Promise.resolve();
  }
  cancel(): Promise<void> {
    this.update((s) => ({ ...s, stage: 'cancelled', move: { ...s.move, stage: 'cancelled' } }));
    return Promise.resolve();
  }
}

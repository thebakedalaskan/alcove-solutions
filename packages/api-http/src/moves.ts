/*
 * Moving a place in a live call to another device, in the browser (docs: Calls and recordings › Moving to another
 * device). Each side is a LiveStore the screen reads with useLive(), kept up to date by checking about once a second
 * while the move is open: the device being left (HttpMoveOut) and the new device (HttpMoveIn). The new device's MLS
 * keys are made here, when it says it's ready, and never leave it; it joins the call with them once the other device
 * has let go.
 */
import {
  MOVE_CODE_SECONDS, errorCode, errorMessage, errorRequestId, type CallMoveIn, type CallMoveOut, type CallSession, type CallState, type CallTicket, type MoveDevice, type MoveIn,
  type MoveInState, type MoveMedia, type MoveOut, type MoveOutState, type MoveProblem
} from '@alcove/api';
import { MlsKeys, newIdentity } from './mls';

type Emit = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, context: Record<string, string | number | boolean | null>) => void;
/** In Node (tests), timers mustn't keep the process alive. */
const unref = (t: unknown) => { if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref(); };
const problemOf = (e: unknown): MoveProblem => ({ message: errorMessage(e), requestId: errorRequestId(e) ?? null });

class Store<S> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  getSnapshot = (): S => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  protected set(p: Partial<S>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }
}

/** How often each side checks on an open move, in ms. */
export interface MoveTiming { pollMs: number }

export interface MoveOutTransport {
  start(media: MoveMedia): Promise<{ code: string; expiresAt: string }>;
  current(): Promise<MoveOut | null>;
  confirm(media: MoveMedia): Promise<void>;
  cancel(): Promise<void>;
}
/** A code that runs out with nobody using it is replaced by itself this many times while the sheet stays open (about ten minutes). */
const RENEWALS = 4;

/** The device being left. */
export class HttpMoveOut extends Store<MoveOutState> implements CallMoveOut {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private renewals = 0;
  private media: MoveMedia;

  constructor(private readonly t: MoveOutTransport, private readonly timing: MoveTiming, private readonly emit: Emit, media: MoveMedia) {
    super({ stage: 'starting', code: null, expiresAt: null, device: null, sameAccount: false, problem: null });
    this.media = media;
  }

  /** Asks for a code; the screen shows it as soon as it's here. */
  async begin(): Promise<void> {
    try {
      const r = await this.t.start(this.media);
      // The server's clock and this one differ a little: the code never shows longer than it lasts.
      this.set({ stage: 'open', code: r.code, expiresAt: Math.min(Date.parse(r.expiresAt), Date.now() + MOVE_CODE_SECONDS * 1000), device: null, sameAccount: false, problem: null });
      this.emit('info', 'move started', {});
    } catch (e) {
      this.set({ stage: 'failed', problem: problemOf(e) });
      this.emit('warn', 'move couldn’t start', { code: errorCode(e), requestId: errorRequestId(e) ?? null });
      return;
    }
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed || !['open', 'claimed', 'ready'].includes(this.state.stage)) return;
    this.timer = setTimeout(() => { void this.check(); }, this.timing.pollMs);
    unref(this.timer);
  }

  private async check(): Promise<void> {
    if (this.closed) return;
    try {
      const m = await this.t.current();
      if (this.closed || this.state.stage === 'moving') return;
      if (!m) {
        // Nobody used the code in time: a new one, while the sheet's still open; after a while, it waits to be asked.
        if (this.state.stage === 'open' && this.renewals < RENEWALS) { this.renewals += 1; await this.begin(); return; }
        this.set({ stage: 'expired', code: null });
        return;
      }
      if (m.stage === 'cancelled') { this.set({ stage: 'cancelled', code: null }); return; }
      if (m.stage === 'released' || m.stage === 'moved') { this.set({ stage: 'moved', code: null }); return; }
      // Once it's opened elsewhere, the code is used up: only that device can carry on.
      this.set({ stage: m.stage, code: m.stage === 'open' ? this.state.code : null, expiresAt: m.stage === 'open' ? this.state.expiresAt : Date.parse(m.expiresAt), device: m.device, sameAccount: m.sameAccount, problem: null });
    } catch (e) {
      // A missed check is checked again; the screen says so only if it keeps failing.
      this.emit('debug', 'move check failed', { code: errorCode(e) });
    }
    this.schedule();
  }

  confirm = async (media: MoveMedia): Promise<void> => {
    if (this.state.stage !== 'ready') return;
    this.set({ stage: 'moving' });
    if (this.timer) clearTimeout(this.timer);
    try {
      await this.t.confirm(media);
      this.set({ stage: 'moved', code: null });
      this.emit('info', 'moved to another device', { mic: media.mic, cam: media.cam });
    } catch (e) {
      this.set({ stage: 'failed', problem: problemOf(e) });
      this.emit('warn', 'move couldn’t finish', { code: errorCode(e), requestId: errorRequestId(e) ?? null });
      throw e;
    }
  };

  cancel = async (): Promise<void> => {
    const was = this.state.stage;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (was === 'moved' || was === 'moving' || was === 'cancelled') return;
    this.set({ stage: 'cancelled', code: null });
    await this.t.cancel().catch((e: unknown) => this.emit('info', 'move couldn’t be called off', { code: errorCode(e) }));
  };

  renew = async (): Promise<void> => {
    this.renewals = 0;
    this.closed = false;
    this.set({ stage: 'starting', code: null, problem: null });
    await this.begin();
  };

  close = (): void => { void this.cancel(); };
}

export interface MoveInTransport {
  status(claim: string): Promise<MoveIn>;
  ready(b: { claim: string; identity: string; keyPackage: string; device: MoveDevice }): Promise<MoveIn>;
  arrive(claim: string): Promise<MoveIn>;
  cancel(claim: string): Promise<void>;
}
/** Joins the call with the ticket the move hands over and the MLS keys made here. */
export type Connect = (joined: { ticket: CallTicket; state: CallState }, mls: MlsKeys) => Promise<CallSession>;

/** The new device. */
export class HttpMoveIn extends Store<MoveInState> implements CallMoveIn {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private mls: MlsKeys | null = null;
  private arriving: Promise<void> | null = null;

  constructor(readonly claim: string, move: MoveIn, private readonly t: MoveInTransport, private readonly connect: Connect, private readonly timing: MoveTiming, private readonly emit: Emit) {
    super({ stage: move.stage, move, session: null, problem: null });
  }

  ready = async (device: MoveDevice): Promise<void> => {
    try {
      // This device's own identity for the call, and its MLS keys: made here, and nobody else ever has them.
      if (!this.mls) this.mls = await MlsKeys.make(newIdentity());
      const m = await this.t.ready({ claim: this.claim, identity: this.mls.identity, keyPackage: this.mls.keyPackage(), device });
      this.take(m);
      this.emit('info', 'ready to move here', {});
    } catch (e) {
      this.fail(e);
      // Refused because the move went on without this device (called off, say): the move as it stands says which.
      if (errorCode(e) === 'conflict') await this.refresh();
      throw e;
    }
    this.schedule();
  };

  refresh = async (): Promise<void> => {
    try { this.take(await this.t.status(this.claim)); } catch (e) { this.fail(e); }
  };

  cancel = async (): Promise<void> => {
    this.stop();
    this.set({ stage: 'cancelled' });
    await this.t.cancel(this.claim).catch((e: unknown) => this.emit('info', 'move couldn’t be called off', { code: errorCode(e) }));
  };

  close = (): void => { this.stop(); };

  private stop() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private take(m: MoveIn) {
    if (this.closed) return;
    this.set({ stage: m.stage, move: m, problem: null });
    if (m.stage === 'cancelled') this.stop();
  }

  /** Gone (run out, or used elsewhere): that's the end of it. Anything else is said, and checked again. */
  private fail(e: unknown) {
    if (errorCode(e) === 'not-found') { this.stop(); this.set({ stage: 'expired', problem: problemOf(e) }); return; }
    this.set({ problem: problemOf(e) });
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed) return;
    // Once ready, the other device letting go is checked for twice as often: the person is between devices meanwhile.
    this.timer = setTimeout(() => { void this.check(); }, this.state.stage === 'ready' ? this.timing.pollMs / 2 : this.timing.pollMs);
    unref(this.timer);
  }

  private async check(): Promise<void> {
    if (this.closed) return;
    try {
      const m = await this.t.status(this.claim);
      this.take(m);
      if (this.closed) return;
      if (m.stage === 'released' || m.stage === 'moved') { await this.arrive(); if (this.closed) return; }
    } catch (e) {
      this.fail(e);
    }
    this.schedule();
  }

  /** The other device has let go: in, with this device's keys. Asking again (a lost answer) gives the same connection. */
  private arrive(): Promise<void> {
    this.arriving ??= (async () => {
      try {
        const mls = this.mls;
        if (!mls) throw new Error('This device never said it was ready.');
        const m = await this.t.arrive(this.claim);
        if (!m.joined) return;
        const session = await this.connect(m.joined, mls);
        this.stop();
        this.set({ stage: 'moved', move: m, session, problem: null });
        this.emit('info', 'moved here', { role: m.joined.ticket.role });
      } catch (e) {
        // Not yet (the organizer's own connection is coming back, say): the next check tries again, and says if it was called off.
        if (errorCode(e) === 'conflict') { this.emit('info', 'not in yet', { code: 'conflict' }); return; }
        this.fail(e);
      } finally {
        this.arriving = null;
      }
    })();
    return this.arriving;
  }
}

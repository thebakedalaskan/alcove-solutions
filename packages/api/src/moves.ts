/*
 * Moving someone's place in a live call to another device (docs: Calls and recordings › Moving to another device).
 *
 * The device someone is on makes a move code. The new device opens the code's link (the code rides in the URL's
 * fragment, which no server or log ever sees) and swaps it for a claim of its own, so the code works once. When the
 * new device is ready (it has made its own MLS key package), the device being left lets go: it stops its microphone
 * and camera, leaves the room and confirms. Only then is the new device let in, as the same person, so their seat,
 * role, room, raised hand and spotlight stay, and there are never two live microphones. The organizer and invited
 * people move only to a device signed in to the same account; guests move with their call pass. The device being
 * left always has the last word.
 */
import { z } from './zod';
import { CallRoleSchema, CallStateSchema, CallTicketSchema, type CallSession, type LiveStore } from './live';
import { ISODateSchema } from './types';
import { CallIdentity, Mls } from './wire';

/** A move code, or the claim the new device swaps it for: 128 random bits, base64url. Only ever in a POST body or a URL's fragment. */
export const MoveSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/** How long a move code works while nobody has opened it, in seconds. */
export const MOVE_CODE_SECONDS = 120;

/** What the new device is, as it says itself: shown on the device being left, so the person can tell it's theirs. Never logged. */
export const MoveDeviceSchema = z.object({
  kind: z.enum(['phone', 'tablet', 'computer']),
  os: z.enum(['ios', 'android', 'macos', 'windows', 'linux', 'chromeos', 'other']),
  browser: z.enum(['safari', 'chrome', 'firefox', 'edge', 'samsung', 'other'])
});
export type MoveDevice = z.infer<typeof MoveDeviceSchema>;

/** Microphone and camera, on or off, as they are on the device being left: the new device starts them the same way, never more. */
export const MoveMediaSchema = z.object({ mic: z.boolean(), cam: z.boolean() });
export type MoveMedia = z.infer<typeof MoveMediaSchema>;

/**
 * Where a move stands. open: waiting for another device to open the link; claimed: opened there; ready: that device
 * has its keys and waits for this one to let go; released: this one let go, and the new one is coming in; moved:
 * the new one is in; cancelled: either device called it off.
 */
export const MoveStageSchema = z.enum(['open', 'claimed', 'ready', 'released', 'moved', 'cancelled']);
export type MoveStage = z.infer<typeof MoveStageSchema>;

/** A move as the device being left sees it. */
export const MoveOutSchema = z.object({
  stage: MoveStageSchema,
  expiresAt: ISODateSchema,
  device: MoveDeviceSchema.nullable(),
  /** The new device is signed in to this account. Guests: always false, so the device being left asks first. */
  sameAccount: z.boolean()
});
export type MoveOut = z.infer<typeof MoveOutSchema>;

/** A new move code, for the link `<web app>/move#<code>`. It's never sent anywhere but here and in that link. */
export const MoveCodeSchema = z.object({ code: MoveSecretSchema, expiresAt: ISODateSchema });

/**
 * A move as the new device sees it: the call, who they'll be in it, how their microphone and camera were, and
 * whether this device has to be signed in first. `joined` comes once the device being left has let go.
 */
export const MoveInSchema = z.object({
  stage: MoveStageSchema,
  expiresAt: ISODateSchema,
  title: z.string(),
  organizerName: z.string(),
  you: z.object({ name: z.string(), role: CallRoleSchema }),
  /**
   * none: a guest, so no account comes into it; needed: sign in to your account on this device first; other: this
   * device is signed in to another account; ok: signed in as you.
   */
  account: z.enum(['none', 'needed', 'other', 'ok']),
  media: MoveMediaSchema,
  joined: z.object({ ticket: CallTicketSchema, state: CallStateSchema }).nullable()
});
export type MoveIn = z.infer<typeof MoveInSchema>;
/** Opening a move link: the claim this device uses from now on (the code works once), and the move. */
export const MoveClaimSchema = z.object({ claim: MoveSecretSchema, move: MoveInSchema });

/* Wire bodies. Secrets travel only here, never in a path or query. */
export const MoveStartBodySchema = z.object({ media: MoveMediaSchema });
export const MoveConfirmBodySchema = z.object({ media: MoveMediaSchema });
export const MoveClaimBodySchema = z.object({ code: MoveSecretSchema });
export const MoveByClaimBodySchema = z.object({ claim: MoveSecretSchema });
/** The new device is ready: its own random identity for the call, and its MLS key package, made here and nowhere else. */
export const MoveReadyBodySchema = z.object({ claim: MoveSecretSchema, identity: CallIdentity, keyPackage: Mls(8192), device: MoveDeviceSchema });

/** A problem with a move, for the screen: what to say, and the request ID to quote when it came from the server. */
export interface MoveProblem { message: string; requestId: string | null }

/** The device being left: its side of a move, kept up to date while the move is open. */
export interface MoveOutState {
  /**
   * starting: asking for a code; open, claimed, ready: as the server says; moving: letting go and confirming;
   * moved: done; cancelled; expired: the code ran out with nobody using it; failed: see `problem`.
   */
  stage: 'starting' | 'open' | 'claimed' | 'ready' | 'moving' | 'moved' | 'cancelled' | 'expired' | 'failed';
  /** The code for the new device's link, while nobody has used it. */
  code: string | null;
  /** When the code (or, once it's opened, the move) runs out, in ms since the epoch. */
  expiresAt: number | null;
  device: MoveDevice | null;
  sameAccount: boolean;
  problem: MoveProblem | null;
}
export interface CallMoveOut extends LiveStore<MoveOutState> {
  /** Moves: call it once this device has stopped its microphone and camera and left the room. `media` is how they were. */
  confirm(media: MoveMedia): Promise<void>;
  /** Calls the move off: the sheet closed, or the device that opened the link isn't theirs. */
  cancel(): Promise<void>;
  /** A fresh code, after the last one ran out. */
  renew(): Promise<void>;
  /** Stops keeping up (the screen went away). A move that hasn't happened is called off. */
  close(): void;
}

/** The new device: the move it's taking over, kept up to date until the call is its own. */
export interface MoveInState {
  /** As the server says; expired: the move ran out; failed: see `problem`. */
  stage: MoveStage | 'expired' | 'failed';
  move: MoveIn;
  /** The call, here, once the other device has let go. */
  session: CallSession | null;
  problem: MoveProblem | null;
}
export interface CallMoveIn extends LiveStore<MoveInState> {
  /** The claim this device holds the move by: kept in this tab only while it goes to sign in (Google) and comes back. */
  readonly claim: string;
  /** This device is ready: it makes its own keys for the call and asks the other device to let go. */
  ready(device: MoveDevice): Promise<void>;
  /** Reads the move again (after signing in on this device). */
  refresh(): Promise<void>;
  cancel(): Promise<void>;
  /** Stops keeping up (the screen went away). */
  close(): void;
}

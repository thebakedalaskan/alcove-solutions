import { z } from '../shared/zod';

/** The longest the call's timer runs, with any time added: a day, in seconds. */
export const CALL_TIMER_MAX_SECONDS = 86_400;
const Revision = z.number().int().nonnegative();
const Seconds = z.number().int().min(1).max(CALL_TIMER_MAX_SECONDS);

/**
 * The call's timer: one countdown, the same for everyone in the call, which only the host starts and changes. Its clock is
 * the server's: while it runs, what's left is `durationSeconds` less `elapsedMs` and the time since `startedAt`, so every
 * browser works out the same second. At zero it carries on, over time, until the host adds time or stops it. Stored in the
 * call's sealed state as it is here: a field added to it needs a default.
 */
export const CallTimerSchema = z.object({
  /** This countdown, from its start until it's stopped. */
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  /** Counts its changes, so a control made against an older view of it is refused. */
  revision: Revision,
  /** How long it runs, with any time added since it started. */
  durationSeconds: Seconds,
  status: z.enum(['running', 'paused']),
  /** Milliseconds it had run before `startedAt`, without its pauses. */
  elapsedMs: z.number().nonnegative(),
  /** When it last started or resumed, in the server's milliseconds since the epoch; null while it's paused. */
  startedAt: z.number().nonnegative().nullable()
}).refine((t) => (t.status === 'running') === (t.startedAt !== null), 'A running timer has a start, and a paused one has none.');
export type CallTimer = z.infer<typeof CallTimerSchema>;

/**
 * What the host does with the timer: start one of a length while none runs, then pause, resume, add time (from now, once
 * it's over time) or stop it. Each change but a start names the revision it was made against.
 */
export const CallTimerControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), durationSeconds: Seconds }),
  z.object({ action: z.enum(['pause', 'resume', 'stop']), expectedRevision: Revision }),
  z.object({ action: z.literal('add-time'), expectedRevision: Revision, seconds: Seconds })
]);
export type CallTimerControl = z.infer<typeof CallTimerControlSchema>;

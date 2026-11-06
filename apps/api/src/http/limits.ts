import { UnavailableError } from '../errors';
import * as media from '../features/workspaces/media';

/**
 * A small fixed-window limiter: at most `max` hits per key in each window. Unauthenticated requests
 * are keyed by client address; the ones that cost inference by account.
 */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string, what = 'request', cost = 1) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.until < now) { hits.set(key, { n: cost, until: now + windowMs }); if (hits.size > 50_000) hits.clear(); return; }
    if ((h.n += cost) > max) throw new UnavailableError('Too many attempts. Wait a minute and try again.', { context: { limit: what, max, windowMs } });
  };
}

export function createHttpLimits() {
  const limiter = rateLimit(30, 60_000);

  const telemetryLimiter = rateLimit(60, 60_000);

  const attestLimiter = rateLimit(30, 60_000);

  /*
   * Speech and questions go to NEAR AI. A browser sends a clip every few seconds while someone talks: in a call the
   * host's browser sends one stream of clips per voice it hears, each limited on its own, all within the account's.
   */
  const speechLimiter = rateLimit(240, 60_000);

  const voiceLimiter = rateLimit(40, 60_000);

  const askLimiter = rateLimit(20, 60_000);

  /** Changing what a note says: each change writes a whole new revision of it, so nobody can churn one, or its history. */
  const noteChangeLimiter = rateLimit(120, 60_000);

  /** Joining by link: public, so limited per client address. */
  const callLimiter = rateLimit(120, 60_000);

  /** Picking one of the times a call offers: public too, and one person does it once. */
  const pickLimiter = rateLimit(30, 60_000);

  /**
   * Reading a call's card: public too, and every pre-join keeps reading it while it waits, once every 4 s on average
   * (15 a minute) until the organizer is there. This lets 40 people wait behind one address, as an office does.
   */
  const cardLimiter = rateLimit(600, 60_000);

  /** Encrypted chat in a call, per person in it. */
  const chatLimiter = rateLimit(120, 60_000);

  /** Fresh key packages to rejoin a call's new group, per person in it (one each time the connection that hosts changes). */
  const rejoinLimiter = rateLimit(20, 60_000);

  /** Asking for notes (and taking it back), per person in a call. */
  const askNotesLimiter = rateLimit(10, 60_000);

  /** Saying whether others may point at what you share, per person in a call: each change makes every browser fetch the call again. */
  const othersPointLimiter = rateLimit(20, 60_000);

  /** Ticking follow-ups, per person in a call: the same. */
  const followUpLimiter = rateLimit(60, 60_000);

  /** Saying you're looking at the live notes, per connection to a call: a browser does every 5 seconds. Refreshes have their own limit, for each view of each part of the call. */
  const notesWatchLimiter = rateLimit(120, 60_000);

  /** Looking for ideas from the call: a browser with a board open looks every 15 seconds or so, and only one a minute reads anything. */
  const ideasWatchLimiter = rateLimit(30, 60_000);

  /** Sorting a board's stickies into themes, for each person. */
  const sortLimiter = rateLimit(20, 60_000);

  /** Reading the call's follow-ups, per connection to a call: a browser showing them does every 5 seconds, and each read opens the documents worked on. */
  const followUpsLimiter = rateLimit(30, 60_000);

  /** Asking to see the workspace, per person in a call: each ask reaches the organizer. */
  const askSpaceLimiter = rateLimit(10, 60_000);

  /** What goes on in a call's workspace, per person in it: each step makes every browser fetch the call again. */
  const spaceLimiter = rateLimit(240, 60_000);

  /**
   * Moving to another device: new codes per person in a call; opening links per client address (codes are 128-bit, so
   * this only keeps it calm); and the new device checking on its move, at most twice a second, per client address. Each
   * move is counted too, by its secret's hash: checking on it the same, and changing it (opening, ready, coming in,
   * calling off) a handful of times, with room for coming in to be tried again each second while the organizer's
   * connection comes back.
   */
  const moveLimiter = rateLimit(12, 60_000);

  const moveOpenLimiter = rateLimit(30, 60_000);

  const moveCheckLimiter = rateLimit(240, 60_000);

  const moveSecretCheckLimiter = rateLimit(240, 60_000);

  const moveSecretChangeLimiter = rateLimit(60, 60_000);

  /** Captions ask for each new line in someone's language, so they get their own, larger allowance. */
  const captionLimiter = rateLimit(90, 60_000);

  /** Frames of a shared screen, per person in a call: browsers send one only when the screen changed, at most every few seconds. */
  const frameLimiter = rateLimit(24, 60_000);

  const shareEndLimiter = rateLimit(30, 60_000);

  /** Opening a moment of the live transcript reads all of it, per connection to the call. */
  const momentLimiter = rateLimit(60, 60_000);

  /**
   * Making calls, per account, however it's done: anyone can invite any address, and each call lands on the Home of
   * everyone invited, as many as 60 of them at a time for a call that repeats.
   */
  const makeLimiter = rateLimit(30, 60_000);

  /** Reading who's busy asks Google, for up to 300 people at a time, per account. */
  const busyLimiter = rateLimit(60, 60_000);

  /**
   * Ringing, per organizer: each ring reaches someone's screen, with a sound. Answering, per person: each answer tells
   * the room. And opening the stream of rings, per person: a tab opens one every few minutes, so this leaves room for
   * plenty of tabs, and keeps tabs taking turns over an account's streams from going round too fast. How many streams
   * can be open at once is `RingStreams`'.
   */
  const ringLimiter = rateLimit(20, 60_000);

  const ringAnswerLimiter = rateLimit(30, 60_000);

  const ringStreamLimiter = rateLimit(30, 60_000);

  /** Your own notes, per connection to a call or per account: reading them in a call reads its live transcript too. */
  const personalLimiter = rateLimit(120, 60_000);

  /**
   * What carries over into a call, per account. Each read opens every note the person has, not only the series' (which
   * of them are in it is sealed in them), and a pre-join or a call's panel reads it about once a minute.
   */
  const carryLimiter = rateLimit(60, 60_000);

  /** Changes to a workspace's tree and people, per person: a title follows what's typed, about three times a second at most. */
  const treeLimiter = rateLimit(600, 60_000);

  /** Opening a workspace's stream, per person. Browsers open it again by themselves, every few minutes when all's well. */
  const liveLimiter = rateLimit(120, 60_000);

  /** Making workspaces, per account: each is an owner with keys of its own. */
  const workspaceLimiter = rateLimit(20, 60_000);

  /** Reading your list of workspaces or your documents, per account: each opens every one you're in. */
  const workspaceListLimiter = rateLimit(120, 60_000);

  /** Opening a document's stream, per person: clicking through a list opens one each. */
  const documentLiveLimiter = rateLimit(240, 60_000);

  /** Updates to documents, per person: a browser sends at most about seven a second, and someone may have two or three open. */
  const updateLimiter = rateLimit(1200, 60_000);

  /** How much of them, in KiB: a long paste is megabytes, and nobody pastes one every second. */
  const updateBytesLimiter = rateLimit(64 * 1024, 60_000);

  /** Reading a version, per person: History reads one at a time, as someone clicks through them. */
  const versionLimiter = rateLimit(60, 60_000);

  /** Where a caret or pointer is, per person: a browser sends at most ten a second. */
  const awarenessLimiter = rateLimit(1800, 60_000);

  /** Where someone is in a workspace, per person: every 10 seconds and whenever they move or start typing. */
  const presenceLimiter = rateLimit(600, 60_000);

  /** Reading every document someone can open, for searching: once when search opens. */
  const searchLimiter = rateLimit(12, 60_000);

  /** Tagging people and saying you've heard, per person: a tag is typed, so this is far more than anyone writes. */
  const mentionLimiter = rateLimit(240, 60_000);

  /** People's IDs in a workspace, per person: asked as a document opens and as people come and go in a call. */
  const idsLimiter = rateLimit(120, 60_000);

  /** Saving someone's own notes on a document, per person: they save as they're typed. */
  const presenterLimiter = rateLimit(120, 60_000);

  /** Pieces of a file, per person: 4 MiB each, so about 40 MiB a second, more than any browser's upload. */
  const pieceLimiter = rateLimit(600, 60_000);

  /** Reading files, per person, by what it costs: each URL asked for and each piece opened. */
  const mediaLimiter = rateLimit(media.MEDIA_LIMITS.readsAMinute, 60_000);
  return { limiter, telemetryLimiter, attestLimiter, speechLimiter, voiceLimiter, askLimiter, noteChangeLimiter, callLimiter, pickLimiter, cardLimiter, chatLimiter, rejoinLimiter, askNotesLimiter, othersPointLimiter, followUpLimiter, notesWatchLimiter, ideasWatchLimiter, sortLimiter, followUpsLimiter, askSpaceLimiter, spaceLimiter, moveLimiter, moveOpenLimiter, moveCheckLimiter, moveSecretCheckLimiter, moveSecretChangeLimiter, captionLimiter, frameLimiter, shareEndLimiter, momentLimiter, makeLimiter, busyLimiter, ringLimiter, ringAnswerLimiter, ringStreamLimiter, personalLimiter, carryLimiter, treeLimiter, liveLimiter, workspaceLimiter, workspaceListLimiter, documentLiveLimiter, updateLimiter, updateBytesLimiter, versionLimiter, awarenessLimiter, presenceLimiter, searchLimiter, mentionLimiter, idsLimiter, presenterLimiter, pieceLimiter, mediaLimiter };
}

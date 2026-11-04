/**
 * AlcoveApi over HTTP: JSON REST under `/v1`, newline-delimited JSON for streams, raw bytes for
 * audio pieces. Every payload is parsed with the contract's zod schemas, so a backend that drifts
 * from the contract fails loudly here instead of corrupting the UI.
 */
import {
  AlcoveApiError, AnswerPartSchema, AttestationSchema, AUDIO_HEADERS, LIVE_TRANSCRIPT_LINES, CALL_CHAT_MAX, CALL_KEYRING, CALL_PASS_HEADER, CalendarSchema, CallCardSchema, CallEndResultSchema, CallMlsSchema, CaptionTranslationSchema, CallRoomTokenSchema, CallStateSchema, CallTicketSchema, CatchUpSchema, CreditBalanceSchema, FRAME_HEADERS, MeetingSchema, NoteProgressSchema, NoteSchema, ScreenFrameReceiptSchema,
  NoteSummarySchema, OPERATION_HEADER, OpenActionSchema, PersonSuggestionSchema, PreferencesSchema, RecordingStopResultSchema, REQUEST_ID_HEADER,
SeriesAnswerPartSchema, SeriesSchema,
  RoomRecordingStateSchema, SessionSchema, SignInResultSchema, TeamSchema, errorCode, isAlcoveErrorCode,
  type AlcoveApi, type AnswerPart, type AudioPiece, type BreakoutPlan, type CallAction, type CaptionLanguage, type CaptureDevicePart, type CaptionTranslation, type CallCrypto, type CallMediaKeys, type CallMls, type CallSession, type CallState, type CallTicket, type LiveStore, type CatchUp, type RecordingAction, type RoomRecording,
  type RoomRecordingState, type ScreenFrame, type ScreenFrameReceipt, type TranscriptClip
} from '@alcove/api';
import { MlsClient, MlsError, groupName, newIdentity } from './mls';
import { z } from 'zod';

export interface HttpOptions {
  /** e.g. "/api" behind the web app's proxy, or https://api.alcove.solutions */
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Diagnostics: every request (debug) and failure (warn/error). Fields are methods, paths,
   * statuses, codes, durations and request IDs; never bodies.
   */
  onEvent?: (e: ClientEvent) => void;
  /** How often a call checks for keys and people while nothing nudges it, in ms (default 1500). Tests go faster. */
  callPollMs?: number | undefined;
  /** How long a browser waits after the call's keys move on before it sends with its new one, in ms (default 2000). */
  callKeySwitchMs?: number | undefined;
  /** How often the organizer's browser moves the call's keys on when nobody comes or goes, in ms (default 10 minutes). */
  callRekeyMs?: number | undefined;
}
export interface ClientEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  context: Record<string, string | number | boolean | null>;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), message: z.string().optional(), requestId: z.string().optional() }).catch({});
/** IDs in paths are random; call codes are join tokens and a Google event's ID names its recurring series, so both are masked in diagnostics. */
const safePath = (p: string) => p.replace(/^\/calls\/(?!$)[^/]+/, '/calls/:code').replace(/^\/calendar\/events\/(?!$)[^/]+/, '/calendar/events/:id');
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const opId = () => b64u(randomBytes(16));

export function createHttpApi(o: HttpOptions): AlcoveApi {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const base = o.baseUrl.replace(/\/$/, '') + '/v1';

  const emit = (level: ClientEvent['level'], msg: string, context: ClientEvent['context']) => { try { o.onEvent?.({ level, msg, context }); } catch { /* diagnostics never break a request */ } };
  const parse = <S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> => {
    const r = schema.safeParse(data);
    if (!r.success) {
      emit('error', 'response did not match the contract', { what, issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`).join('; ') });
      throw new AlcoveApiError('unknown', `The server sent an unexpected ${what}.`, { cause: r.error });
    }
    return r.data;
  };
  async function send(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}, keepalive = false): Promise<Response> {
    const mutating = method !== 'GET';
    const where = { method, path: safePath(path) };
    const t0 = Date.now();
    let res: Response;
    try {
      res = await f(base + path, { method, credentials: 'include', keepalive, headers: { ...(mutating ? { [OPERATION_HEADER]: opId() } : {}), ...headers }, body: body ?? null });
    } catch (cause) {
      emit('warn', 'request could not reach the API', { ...where, ms: Date.now() - t0, error: cause instanceof Error ? cause.name : 'unknown' });
      throw new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.', { ...where, cause });
    }
    const requestId = res.headers.get(REQUEST_ID_HEADER) ?? undefined;
    if (!res.ok) {
      const e = ErrorBodySchema.parse(await res.json().catch(() => null));
      const code = isAlcoveErrorCode(e.code) ? e.code : 'unknown';
      const id = e.requestId ?? requestId;
      // Being signed out is an ordinary state, not a problem.
      const level = res.status >= 500 ? 'error' : code === 'unauthenticated' ? 'debug' : 'warn';
      emit(level, 'request failed', { ...where, status: res.status, code, requestId: id ?? null, ms: Date.now() - t0 });
      throw new AlcoveApiError(code, e.message ?? res.statusText, { ...where, status: res.status, requestId: id });
    }
    emit('debug', 'request', { ...where, status: res.status, requestId: requestId ?? null, ms: Date.now() - t0 });
    return res;
  }
  /** `keepalive`: the request outlives the page that sends it (one sent as the page goes away). */
  async function req<S extends z.ZodType>(schema: S, method: string, path: string, body?: unknown, extra: Record<string, string> = {}, keepalive = false): Promise<z.infer<S>> {
    const res = await send(method, path, body === undefined ? null : JSON.stringify(body), { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, keepalive);
    return parse(schema, await res.json(), `response from ${method} ${path}`);
  }
  async function* ndjson<S extends z.ZodType>(schema: S, path: string): AsyncIterable<z.infer<S>> {
    const res = await send('GET', path);
    if (!res.body) throw new AlcoveApiError('unknown', 'Empty stream.');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i = buf.indexOf('\n');
      while (i >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) yield parse(schema, JSON.parse(line), `stream item from ${path}`);
        i = buf.indexOf('\n');
      }
    }
  }
  const audio = (path: string, piece: AudioPiece, extra: Record<string, string> = {}) => send('POST', path, piece.data, {
    ...extra, 'content-type': piece.mimeType, [AUDIO_HEADERS.segment]: String(piece.segment), [AUDIO_HEADERS.seq]: String(piece.seq), [AUDIO_HEADERS.duration]: String(Math.round(piece.durationMs))
  }).then((r) => r.json());
  /** Speech for the live transcript: WAV bytes, placed by where the clip starts in its segment. */
  const clip = (path: string, c: TranscriptClip, extra: Record<string, string> = {}) => send('POST', path, c.data, {
    ...extra, 'content-type': 'audio/wav', [AUDIO_HEADERS.segment]: String(c.segment), [AUDIO_HEADERS.start]: String(Math.round(c.startMs)), [AUDIO_HEADERS.duration]: String(Math.round(c.durationMs))
  }).then((r) => r.json());

  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      signInUrl: (provider) => `${base}/auth/${provider}`,
      signIn: (provider, opts) => req(SignInResultSchema, 'POST', '/auth/sign-in', { provider, ...(opts?.email ? { email: opts.email } : {}) }),
      signOut: async () => { await req(z.unknown(), 'POST', '/session/sign-out', {}); }
    },
    account: {
      preferences: () => req(PreferencesSchema, 'GET', '/account/preferences'),
      updatePreferences: (p) => req(PreferencesSchema, 'PATCH', '/account/preferences', p)
    },
    people: {
      // The query goes in the body so it never appears in URLs or access logs.
      search: (query) => req(z.array(PersonSuggestionSchema), 'POST', '/people/search', { query }),
      team: () => req(TeamSchema.nullable(), 'GET', '/team'),
      inviteToTeam: (emails) => req(TeamSchema, 'POST', '/team/invites', { emails })
    },
    meetings: {
      upcoming: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=upcoming'),
      past: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=past'),
      get: (id) => req(MeetingSchema, 'GET', `/meetings/${encodeURIComponent(id)}`),
      byCode: (code) => req(MeetingSchema.nullable(), 'GET', `/calls/${encodeURIComponent(code)}/meeting`),
      create: (input) => req(MeetingSchema, 'POST', '/meetings', input),
      update: (id, input) => req(MeetingSchema, 'PATCH', `/meetings/${encodeURIComponent(id)}`, input),
      cancel: async (id) => { await req(z.unknown(), 'DELETE', `/meetings/${encodeURIComponent(id)}`); },
      scheduleNext: (id, startsAt) => req(MeetingSchema, 'POST', `/meetings/${encodeURIComponent(id)}/next`, { startsAt })
    },
    calendar: {
      get: () => req(CalendarSchema, 'GET', '/calendar'),
      connectUrl: () => `${base}/auth/google?consent=1`,
      adopt: (eventId, notes) => req(MeetingSchema, 'POST', `/calendar/events/${encodeURIComponent(eventId)}/adopt`, notes ? { notes } : {})
    },
    calls: {
      startNow: (input) => req(z.object({ code: z.string() }), 'POST', '/calls', input ?? {}),
      card: (code) => req(CallCardSchema, 'GET', `/calls/${encodeURIComponent(code)}/card`),
      join: async (code, opts) => {
        // This connection's identity and MLS keys are made here; the key package is all the API gets.
        const identity = newIdentity();
        const mls = await MlsClient.make(identity);
        const body = { mic: opts.mic, cam: opts.cam, identity, keyPackage: mls.keyPackage(), ...(opts.name ? { name: opts.name } : {}), ...(opts.previous ? { previous: opts.previous } : {}) };
        const joined = await req(z.object({ ticket: CallTicketSchema, state: CallStateSchema }), 'POST', `/calls/${encodeURIComponent(code)}/join`, body);
        // Every request about the call carries its pass; guests have no session, so this is all they have.
        const p = { [CALL_PASS_HEADER]: joined.ticket.pass };
        const live = (id: string) => `/live/calls/${id}`;
        const call = new HttpCall(joined.state, joined.ticket, mls, { pollMs: o.callPollMs ?? 1500, switchMs: o.callKeySwitchMs ?? 2000, rekeyMs: o.callRekeyMs ?? 10 * 60_000 }, {
          get: (id) => req(CallStateSchema, 'GET', live(id), undefined, p),
          act: (id, a) => req(CallStateSchema, 'POST', `${live(id)}/actions`, a, p),
          audio: async (id, piece) => parse(CallStateSchema, await audio(`${live(id)}/audio`, piece, p), 'call state'),
          transcribe: async (id, c, speaker) => parse(CallStateSchema, await clip(`${live(id)}/transcribe`, c, { ...p, [AUDIO_HEADERS.speaker]: speaker }), 'call state'),
          // A frame of this browser's own share: JPEG bytes, which share, and how long ago it was taken.
          frame: async (id, f) => parse(ScreenFrameReceiptSchema, await (await send('POST', `${live(id)}/frames`, f.data, {
            ...p, 'content-type': 'image/jpeg', [FRAME_HEADERS.share]: f.share, [FRAME_HEADERS.age]: String(Math.max(0, Math.round(Date.now() - f.takenAt)))
          })).json(), 'frame receipt'),
          shareEnded: async (id, share) => { await req(z.object({ ended: z.literal(true) }), 'POST', `${live(id)}/frames/ended`, { share }, p); },
          catchUp: (id, minutes) => req(CatchUpSchema, 'POST', `${live(id)}/catch-up`, minutes ? { minutes } : {}, p),
          askSoFar: (id, question) => req(z.array(AnswerPartSchema), 'POST', `${live(id)}/ask`, { question }, p),
          translate: (id, lines, language) => req(z.array(CaptionTranslationSchema), 'POST', `${live(id)}/translate`, { language, lines }, p),
          leave: async (id, o) => (await req(z.object({ ended: CallEndResultSchema.nullable() }), 'POST', `${live(id)}/leave`, {}, p, o?.keepalive ?? false)).ended,
          mls: (id, after) => req(CallMlsSchema, 'GET', `${live(id)}/mls?after=${after}`, undefined, p),
          commit: (id, c) => req(z.object({ epoch: z.number() }), 'POST', `${live(id)}/mls/commits`, c, p),
          message: async (id, m) => { await req(z.object({ sent: z.literal(true) }), 'POST', `${live(id)}/mls/messages`, m, p); },
          keyPackage: async (id, k) => { await req(z.object({ sent: z.literal(true) }), 'POST', `${live(id)}/mls/keypackages`, k, p); },
          room: (id) => req(CallRoomTokenSchema, 'GET', `${live(id)}/room`, undefined, p)
        }, (level, msg, context) => emit(level, msg, context));
        await call.start();
        return call;
      }
    },
    recordings: {
      start: async (title) => new HttpRecording(await req(RoomRecordingStateSchema, 'POST', '/recordings', { title }), {
        act: (id, a) => req(RoomRecordingStateSchema, 'POST', `/recordings/${id}/actions`, a),
        audio: async (id, p) => parse(RoomRecordingStateSchema, await audio(`/recordings/${id}/audio`, p), 'recording state'),
        transcribe: async (id, c) => parse(RoomRecordingStateSchema, await clip(`/recordings/${id}/transcribe`, c), 'recording state'),
        stop: (id) => req(RecordingStopResultSchema, 'POST', `/recordings/${id}/stop`, {}),
        discard: async (id) => { await req(z.unknown(), 'DELETE', `/recordings/${id}`); }
      })
    },
    notes: {
      // Search terms go in the body so they never appear in URLs or access logs.
      list: (q) => req(z.array(NoteSummarySchema), 'POST', '/notes/search', { ...(q?.kind ? { kind: q.kind } : {}), ...(q?.text ? { text: q.text } : {}) }),
      get: (id) => req(NoteSchema, 'GET', `/notes/${encodeURIComponent(id)}`),
      progress: (id) => ndjson(NoteProgressSchema, `/notes/${encodeURIComponent(id)}/progress`),
      audioUrl: (id, segment) => `${base}/notes/${encodeURIComponent(id)}/audio/${segment}`,
      screenUrl: (id, frameId) => `${base}/notes/${encodeURIComponent(id)}/screens/${encodeURIComponent(frameId)}`,
      updateDecision: (noteId, decisionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/decisions/${encodeURIComponent(decisionId)}`, patch),
      updateAction: (noteId, actionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/actions/${encodeURIComponent(actionId)}`, patch),
      updateQuestion: (noteId, questionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/questions/${encodeURIComponent(questionId)}`, patch),
      openActions: () => req(z.array(OpenActionSchema), 'GET', '/notes/actions'),
      ask: async function* (noteId, question) {
        const parts = await req(z.array(AnswerPartSchema), 'POST', `/notes/${encodeURIComponent(noteId)}/ask`, { question });
        yield* parts;
      },
      share: (id, emails) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(id)}/share`, { emails }),
      delete: async (id) => { await req(z.unknown(), 'DELETE', `/notes/${encodeURIComponent(id)}`); }
    },
    series: {
      get: (id) => req(SeriesSchema, 'GET', `/series/${encodeURIComponent(id)}`),
      ask: async function* (id, question, timeZone) {
        const parts = await req(z.array(SeriesAnswerPartSchema), 'POST', `/series/${encodeURIComponent(id)}/ask`, { question, timeZone });
        yield* parts;
      }
    },
    credits: {
      balance: () => req(CreditBalanceSchema, 'GET', '/credits')
    },
    trust: {
      attestation: (nonce) => req(AttestationSchema, 'GET', `/attestation?nonce=${encodeURIComponent(nonce)}`)
    },
    diagnostics: {
      // Straight to fetch, not through send(): a failed report must not produce another report.
      report: async (entries) => {
        if (!entries.length) return;
        await f(`${base}/telemetry`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: entries.slice(0, 20) }) }).catch(() => undefined);
      }
    }
  };
}

/* ---------- live call: server is the source of truth; the client keeps the clock ticking ---------- */
interface CallTransport {
  get(id: string): Promise<CallState>;
  act(id: string, a: CallAction): Promise<CallState>;
  audio(id: string, p: AudioPiece): Promise<CallState>;
  transcribe(id: string, c: TranscriptClip, speaker: string): Promise<CallState>;
  frame(id: string, f: ScreenFrame): Promise<ScreenFrameReceipt>;
  shareEnded(id: string, share: string): Promise<void>;
  catchUp(id: string, minutes: number | undefined): Promise<CatchUp>;
  askSoFar(id: string, question: string): Promise<AnswerPart[]>;
  translate(id: string, lines: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  leave(id: string, o?: { keepalive?: boolean | undefined }): Promise<z.infer<typeof CallEndResultSchema> | null>;
  mls(id: string, after: number): Promise<CallMls>;
  commit(id: string, c: { generation: number; epoch: number; commit: string; welcome?: string; added: string[]; removed: string[] }): Promise<{ epoch: number }>;
  message(id: string, m: { generation: number; epoch: number; message: string }): Promise<void>;
  keyPackage(id: string, k: { generation: number; keyPackage: string }): Promise<void>;
  room(id: string): Promise<{ token: string }>;
}
/** A small store for something a screen reads with useLive(). */
class Box<T> implements LiveStore<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  getSnapshot = (): T => this.value;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  set(v: T) { this.value = v; this.listeners.forEach((l) => l()); }
}
class Live<S extends { elapsed: number }> {
  protected state: S;
  private listeners = new Set<() => void>();
  private ticker: ReturnType<typeof setInterval> | null;
  constructor(initial: S, tick: (s: S) => boolean) {
    this.state = initial;
    this.ticker = setInterval(() => { if (tick(this.state)) this.set({ ...this.state, elapsed: this.state.elapsed + 1 }); }, 1000);
  }
  getSnapshot = (): S => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  protected set(s: S) { this.state = s; this.listeners.forEach((l) => l()); }
  /** Applies the server's answer but keeps the local clock if it's ahead (the server rounds). */
  protected apply(s: S) { this.set({ ...s, elapsed: Math.max(s.elapsed, this.state.elapsed) }); }
  protected stopTicking() { if (this.ticker) clearInterval(this.ticker); this.ticker = null; }
}

/** How a call keeps up: how often it checks while nothing nudges it, how long a new send key waits, how often the keys move on anyway. */
interface CallTiming { pollMs: number; switchMs: number; rekeyMs: number }
/**
 * Where an epoch's keys sit in LiveKit's key ring. Consecutive generations use different halves, so the keys
 * of a group being left (when the organizer's connection changes) stay put while people still send with them.
 */
export const keyIndex = (generation: number, epoch: number): number => (generation % 2) * (CALL_KEYRING / 2) + (epoch % (CALL_KEYRING / 2));
/** How many epochs' keys a browser keeps to decrypt with: frames still under a slightly older key play. */
const KEEP_EPOCHS = 4;
/**
 * After someone is only added, the wait before sending with the new key is short: whoever was just let in is
 * still connecting, and can't hear anyone until everyone does. After someone leaves, or the keys move on by
 * themselves, it's the full wait, so nobody still on the old keys misses a beat.
 */
const ADDED_SWITCH_MS = 500;
/**
 * The first wait between checks after asking to join; each wait doubles up to the usual pace. An invited person is
 * let in by the organizer's browser within moments, so they're in after one or two quick checks instead of a full one.
 */
const WAIT_FIRST_MS = 150;
type MediaEpoch = CallMediaKeys['epochs'][number];

class HttpCall extends Live<CallState> implements CallSession {
  readonly crypto = new Box<CallCrypto>({ status: 'joining', members: [], media: null, chat: [], missedChat: false });
  private hidden = new Set<string>();
  /** How far this browser has read the call's MLS log. */
  private after = 0;
  private generation: number;
  /** The generation this browser's MLS group is from (it's in the call's group when that's the current one). */
  private inGen = -1;
  /** The generation this browser made fresh keys for, to rejoin the organizer's new group. */
  private renewedFor = -1;
  /** The organizer's browser: key packages it has, whose it may act on now and how, whom the organizer let in, key packages it couldn't use, and asks already shown. */
  private asks = new Map<string, string>();
  private pending = new Map<string, 'auto' | 'ask'>();
  private approved = new Set<string>();
  private refused = new Set<string>();
  private shownAsks = new Set<string>();
  /** A refused commit waits before the next one, longer each time, so a refusal can never turn into a loop. */
  private commitAfter = 0;
  private refusals = 0;
  private lastCommit = Date.now();
  /** Chat waiting to go out (it's encrypted in the sync loop, so nothing else touches the keys meanwhile), and chat sent, by body, until it shows up in the log. */
  private outbox: { local: string; text: string; at: number; tries: number; sealed: { message: string; epoch: number; generation: number } | null }[] = [];
  private sent = new Map<string, string>();
  /** Media keys: the latest few epochs' (to decrypt with), and this browser's own key to send with. */
  private epochs: { tag: string; entry: MediaEpoch }[] = [];
  private send: { tag: string; generation: number; index: number; key: Uint8Array } | null = null;
  private media: CallMediaKeys | null = null;
  private switchTimer: ReturnType<typeof setTimeout> | null = null;
  private switchFirst: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private fetching: Promise<void> | null = null;
  private fetchAgain = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Checks in a row while not in the call's group, so the first come quickly and the rest settle to the usual pace. */
  private waits = 0;
  private closed = false;

  constructor(initial: CallState, readonly ticket: CallTicket, private readonly mls: MlsClient, private readonly timing: CallTiming, private readonly t: CallTransport,
    private readonly emit: (level: ClientEvent['level'], msg: string, context: ClientEvent['context']) => void) {
    super(initial, (s) => s.phase === 'in-call');
    this.generation = initial.generation;
  }
  private get organizer() { return this.ticket.role === 'host'; }
  private get inCurrentGroup() { return this.mls.inGroup && this.inGen === this.generation; }

  /** The organizer's browser starts the call's group; anyone else starts asking to be let in. */
  async start(): Promise<void> {
    if (this.organizer) {
      await this.mls.create(this.state.callId, this.generation);
      this.inGen = this.generation;
      await this.keysMoved(true);
    }
    await this.sync();
  }

  /** The server's state, minus notices this screen has dismissed. */
  private take(s: CallState) { this.apply({ ...s, notices: s.notices.filter((n) => !this.hidden.has(n.id)) }); }
  private notify(text: string) { this.set({ ...this.state, notices: [...this.state.notices, { id: b64u(randomBytes(8)), kind: 'info', text }] }); }
  private patch(p: Partial<CallCrypto>) { this.crypto.set({ ...this.crypto.getSnapshot(), ...p }); }
  refresh = async (what?: { call: boolean; log: boolean } | undefined) => {
    await Promise.all([(what?.call ?? true) ? this.fetchState() : undefined, (what?.log ?? true) ? this.sync() : undefined]);
  };
  /** One state fetch at a time, and one more straight after if a nudge came meanwhile. */
  private fetchState(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.fetching) { this.fetchAgain = true; return this.fetching; }
    this.fetching = (async () => {
      try {
        do { this.fetchAgain = false; this.take(await this.t.get(this.state.callId)); } while (this.fetchAgain && !this.closed);
      } finally { this.fetching = null; }
    })();
    return this.fetching;
  }

  /** Keeps up with the call's MLS log: one run at a time, and another straight after if something asked meanwhile. */
  private sync(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do { this.again = false; await this.step(); } while (this.again && !this.closed);
      } catch (e) {
        this.emit('warn', 'call keys not in step', { code: e instanceof MlsError ? 'mls' : errorCode(e) });
      } finally {
        this.running = null;
        this.schedule();
      }
    })();
    return this.running;
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed) return;
    const st = this.crypto.getSnapshot().status;
    if (st === 'denied' || st === 'removed' || st === 'failed') return;
    // While waiting there's no room to be nudged through, so this is how the welcome arrives; after that it's a backstop.
    // Soon after asking it checks often, since the organizer's browser lets invited people in within moments; a little
    // apart, so many browsers asking at once don't check in step. Rejoining a new group keeps the usual pace.
    this.waits = st === 'waiting' ? this.waits + 1 : 0;
    const quick = Math.min(this.timing.pollMs, WAIT_FIRST_MS * 2 ** (this.waits - 1)) * (0.8 + Math.random() * 0.4);
    this.timer = setTimeout(() => { void this.sync(); }, st === 'in' ? this.timing.pollMs * 4 : st === 'waiting' ? quick : this.timing.pollMs);
    unref(this.timer);
  }
  /** Out of the call (turned away, removed, or this call went on elsewhere) or out of step: stop keeping up. */
  private out(status: 'denied' | 'removed' | 'failed', why: string) {
    if (this.switchTimer) clearTimeout(this.switchTimer);
    this.switchTimer = null;
    this.media = null;
    this.patch({ status, media: null });
    this.emit(status === 'failed' ? 'warn' : 'info', 'call keys stopped', { status, why });
  }

  private async step(): Promise<void> {
    const id = this.state.callId;
    let log: CallMls;
    try {
      log = await this.t.mls(id, this.after);
    } catch (e) {
      const code = errorCode(e);
      // Removed (or the pass is over): this browser is out of the call. Ended: there's nothing left to keep up with.
      if (code === 'forbidden' || code === 'unauthenticated') { this.out('removed', code); return; }
      if (code === 'conflict' || code === 'not-found') { this.close(); return; }
      throw e;
    }
    const was = this.crypto.getSnapshot().status;
    if (log.admission === 'denied') { this.out(was === 'waiting' || was === 'joining' ? 'denied' : 'removed', 'admission'); return; }
    if (log.generation !== this.generation) {
      // The organizer's connection changed: its new group starts over, and everyone already let in rejoins it.
      this.generation = log.generation;
      this.asks.clear(); this.pending.clear(); this.approved.clear(); this.refused.clear();
    }
    // Let in before the organizer's connection changed: fresh keys for its new group, asked for until they arrive.
    if (log.rejoin && !this.organizer) {
      if (this.renewedFor !== log.generation) { await this.mls.renew(); this.renewedFor = log.generation; }
      try {
        await this.t.keyPackage(id, { generation: log.generation, keyPackage: this.mls.keyPackage() });
        this.emit('info', 'rejoining the call’s new key generation', { generation: log.generation });
      } catch (e) {
        if (errorCode(e) !== 'conflict') throw e;
      }
    }
    let ended: 'removed' | 'failed' | null = null;
    for (const item of log.items) {
      try {
        if (item.kind === 'keypackage') {
          if (this.organizer) this.asks.set(item.from, item.body);
        } else if (item.kind === 'welcome') {
          if (!this.organizer && !this.inCurrentGroup) {
            await this.mls.join(item.body, { group: groupName(id, this.generation), organizer: log.organizer });
            this.inGen = this.generation;
            await this.keysMoved(true);
          }
        } else if (item.kind === 'commit') {
          if (this.inCurrentGroup) {
            const before = this.mls.members();
            const r = await this.mls.process(item.body);
            if (r === 'applied') { const now = this.mls.members(); await this.keysMoved(false, before.every((id) => now.includes(id)) && now.length > before.length); }
            else if (r === 'removed') ended = 'removed';
            else if (r === 'behind') ended = 'failed';
            else if (r === 'refused') this.emit('warn', 'a commit in the call’s log was refused', { seq: item.seq });
          }
        } else await this.read(item.seq, item.body, log.generation);
      } catch (e) {
        // One entry that can't be used doesn't hold up the rest. A welcome that can't be opened leaves this browser outside the group.
        this.emit('warn', 'an entry in the call’s log couldn’t be used', { kind: item.kind, seq: item.seq, code: e instanceof MlsError ? 'mls' : errorCode(e) });
        if (item.kind === 'welcome') ended = 'failed';
      }
      this.after = Math.max(this.after, item.seq);
      if (ended) break;
    }
    if (ended) { this.out(ended, 'log'); return; }
    this.after = Math.max(this.after, log.latest);
    if (log.more) { this.again = true; return; }
    // Everything up to the server's epoch has been read; still behind it means a commit couldn't be applied here.
    if (!this.organizer && this.inCurrentGroup && this.mls.epoch() < log.epoch) { this.out('failed', 'behind'); return; }
    if (this.inCurrentGroup && log.earlierChat && !this.crypto.getSnapshot().missedChat) this.patch({ missedChat: true });
    let newAsk = false;
    if (this.organizer && this.inCurrentGroup) {
      this.pending = new Map(log.pending.map((p) => [p.id, p.admit]));
      for (const who of [...this.asks.keys()]) if (!this.pending.has(who)) this.asks.delete(who);
      for (const p of log.pending) if (p.admit === 'ask' && !this.shownAsks.has(p.id)) { this.shownAsks.add(p.id); newAsk = true; }
      await this.commit(log.departed);
    }
    if (this.inCurrentGroup) await this.flushChat();
    const status: CallCrypto['status'] = this.inCurrentGroup ? 'in' : log.admission === 'waiting' ? 'waiting' : 'joining';
    this.patch({ status, members: this.inCurrentGroup ? this.mls.members() : this.crypto.getSnapshot().members, media: this.media });
    // Let in: the call (who's in it, what's been said) is this browser's to see now. Someone new asking: the organizer sees them.
    if ((status === 'in' && was !== 'in') || newAsk) await this.fetchState();
  }

  /** Chat from the log, in order. The sender's own message takes its place there, so everyone sees chat in the same order. */
  private async read(seq: number, body: string, generation: number): Promise<void> {
    const id = `${generation}:${seq}`;
    const local = this.sent.get(body);
    if (local !== undefined) {
      this.sent.delete(body);
      const s = this.crypto.getSnapshot();
      const mine = s.chat.find((m) => m.id === local);
      if (mine) this.patch({ chat: [...s.chat.filter((m) => m.id !== local), { ...mine, id }] });
      return;
    }
    if (!this.inCurrentGroup) return;
    const m = await this.mls.decrypt(body);
    if (m.kind === 'chat') {
      const s = this.crypto.getSnapshot();
      this.patch({ chat: [...s.chat, { id, from: m.from, isMe: m.from === this.ticket.identity, text: m.text, at: m.at }] });
    } else if (m.kind === 'before') {
      if (!this.crypto.getSnapshot().missedChat) this.patch({ missedChat: true });
    } else this.emit('debug', 'a chat message couldn’t be read', { seq });
  }

  /**
   * The organizer's browser: one commit that lets in whoever may come in now (up to 50 at a time), takes out
   * whoever left, and otherwise moves the keys on every few minutes. The API takes it in order or refuses it.
   */
  private async commit(departed: string[]): Promise<void> {
    if (Date.now() < this.commitAfter) return;
    const id = this.state.callId;
    const adds = [...this.asks].filter(([who]) => {
      const admit = this.pending.get(who);
      return admit !== undefined && !this.refused.has(who) && (admit === 'auto' || this.approved.has(who));
    }).map(([identity, keyPackage]) => ({ identity, keyPackage }));
    const rekey = Date.now() - this.lastCommit >= this.timing.rekeyMs;
    const { commit: c, refused } = await this.mls.commit(adds, departed.filter((who) => who !== this.ticket.identity), { rekey });
    for (const who of refused) {
      // A key package nobody can be added with: they're told they weren't let in, rather than waiting for ever.
      this.refused.add(who);
      this.asks.delete(who);
      this.emit('warn', 'a key package couldn’t be used', { pending: this.pending.get(who) ?? null });
      await this.t.act(id, { type: 'deny', identity: who }).catch((e: unknown) => this.emit('info', 'couldn’t turn away a broken key package', { code: errorCode(e) }));
    }
    if (!c) return;
    try {
      await this.t.commit(id, { generation: this.generation, epoch: c.epoch, commit: c.commit, ...(c.welcome ? { welcome: c.welcome } : {}), added: c.added, removed: c.removed });
    } catch (e) {
      const code = errorCode(e);
      if (code === 'conflict' || code === 'invalid') {
        // Refused: the call moved on, or someone in it isn't waiting any more. It's dropped, the log is read again, and the next commit waits a little.
        await this.mls.drop();
        this.refusals += 1;
        this.commitAfter = Date.now() + Math.min(30_000, 250 * 2 ** this.refusals);
        this.emit('info', 'a commit was refused', { code, refusals: this.refusals });
        this.again = true;
        return;
      }
      // Lost on the way: it's sent again, exactly as it was, next time (or found in the log, if it arrived).
      throw e;
    }
    await this.mls.settle();
    this.refusals = 0;
    this.lastCommit = Date.now();
    for (const who of c.added) { this.asks.delete(who); this.approved.delete(who); }
    await this.keysMoved(false, c.added.length > 0 && c.removed.length === 0);
    this.emit('info', 'call keys moved on', { added: c.added.length, removed: c.removed.length, epoch: c.epoch + 1, rekey: !c.added.length && !c.removed.length });
    this.again = true;
  }

  /** Chat waiting to go out, in order. A message that can't go after a few tries is taken back, and the sender is told. */
  private async flushChat(): Promise<void> {
    const id = this.state.callId;
    while (this.outbox[0]) {
      const m = this.outbox[0];
      if (!m.sealed || m.sealed.generation !== this.generation) {
        try { m.sealed = { ...(await this.mls.encrypt(m.text, m.at)), generation: this.generation }; }
        catch { this.unsend(m.local); continue; }
      }
      this.sent.set(m.sealed.message, m.local);
      try {
        await this.t.message(id, { generation: m.sealed.generation, epoch: m.sealed.epoch, message: m.sealed.message });
        this.outbox.shift();
        // Read the log again straight away: the message takes its place there, among everyone else's.
        this.again = true;
      } catch (e) {
        const code = errorCode(e);
        m.tries += 1;
        // The keys moved on under it: encrypted again next time. Lost on the way: the same message is sent again (others read it once).
        if (code === 'conflict') { this.sent.delete(m.sealed.message); m.sealed = null; }
        if (m.tries >= 3 || code === 'invalid' || code === 'forbidden') { if (m.sealed) this.sent.delete(m.sealed.message); this.unsend(m.local); continue; }
        return;
      }
    }
  }
  private unsend(local: string) {
    this.outbox = this.outbox.filter((m) => m.local !== local);
    const s = this.crypto.getSnapshot();
    this.patch({ chat: s.chat.filter((m) => m.id !== local) });
    this.notify('Your message wasn’t sent. Try again.');
  }

  /**
   * The group moved to a new epoch (or this browser just joined it): every member's media keys for it, kept
   * with the last few. This browser's own key to send with moves to the new one a moment later, so everyone
   * has the new keys before anyone sends with them; straight away if it's only just been let in.
   */
  private async keysMoved(letIn: boolean, onlyAdded = false): Promise<void> {
    const epoch = this.mls.epoch();
    const tag = `${this.generation}:${epoch}`;
    if (this.epochs.at(-1)?.tag === tag) return;
    const entry: MediaEpoch = { index: keyIndex(this.generation, epoch), keys: await this.mls.mediaKeys() };
    this.epochs = [...this.epochs.filter((e) => e.tag !== tag), { tag, entry }].slice(-KEEP_EPOCHS);
    const own = entry.keys[this.ticket.identity];
    if (own && (letIn || !this.send || this.send.generation !== this.generation)) {
      if (this.switchTimer) clearTimeout(this.switchTimer);
      this.switchTimer = null;
      this.switchFirst = null;
      this.send = { tag, generation: this.generation, index: entry.index, key: own };
    } else if (own) this.switchSoon(onlyAdded ? Math.min(ADDED_SWITCH_MS, this.timing.switchMs) : this.timing.switchMs);
    this.publishMedia();
  }
  private switchSoon(wait: number) {
    const now = Date.now();
    this.switchFirst ??= now;
    // A burst of changes doesn't keep the old key in use for long: at most twice the full wait after the first one.
    const at = Math.min(now + wait, this.switchFirst + this.timing.switchMs * 2);
    if (this.switchTimer) clearTimeout(this.switchTimer);
    this.switchTimer = setTimeout(() => this.switchNow(), Math.max(0, at - now));
    unref(this.switchTimer);
  }
  private switchNow() {
    this.switchTimer = null;
    this.switchFirst = null;
    const latest = this.epochs.at(-1);
    const own = latest?.entry.keys[this.ticket.identity];
    if (this.closed || !latest || !own || this.send?.tag === latest.tag) return;
    this.send = { tag: latest.tag, generation: this.generation, index: latest.entry.index, key: own };
    this.publishMedia();
    this.patch({ media: this.media });
  }
  private publishMedia() {
    if (!this.send) return;
    this.media = { epochs: this.epochs.map((e) => e.entry), send: { index: this.send.index, key: this.send.key } };
  }

  room = async () => {
    const r = await this.t.room(this.state.callId);
    return { serverUrl: this.ticket.serverUrl, roomName: this.ticket.roomName, identity: this.ticket.identity, token: r.token };
  };
  private act(a: CallAction) {
    void this.t.act(this.state.callId, a).then((s) => this.take(s), (e: unknown) => this.notify(e instanceof Error ? e.message : 'That didn’t work.'));
  }
  sendChat = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (t.length > CALL_CHAT_MAX) throw new AlcoveApiError('invalid', `Messages can be up to ${CALL_CHAT_MAX} characters.`);
    if (this.crypto.getSnapshot().status !== 'in') throw new AlcoveApiError('forbidden', 'Wait until the organizer lets you in.');
    const local = `me:${b64u(randomBytes(6))}`;
    const s = this.crypto.getSnapshot();
    this.patch({ chat: [...s.chat, { id: local, from: this.ticket.identity, isMe: true, text: t, at: this.state.elapsed }] });
    this.outbox.push({ local, text: t, at: this.state.elapsed, tries: 0, sealed: null });
    await this.sync();
  };
  admit = async (identity: string) => { this.approved.add(identity); await this.sync(); };
  deny = async (identity: string) => { this.take(await this.t.act(this.state.callId, { type: 'deny', identity })); };
  setNotes = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'notes', on })); };
  /* What the call captures: pause and resume are the organizer's; anyone else asks for notes. Each resolves once the server has done it. */
  pause = async () => { this.take(await this.t.act(this.state.callId, { type: 'pause' })); };
  resume = async () => { this.take(await this.t.act(this.state.callId, { type: 'resume' })); };
  requestNotes = async (up: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'request-notes', up })); };
  declineNotes = async (requestId: string) => { this.take(await this.t.act(this.state.callId, { type: 'decline-notes', requestId })); };
  setUnavailable = async (parts: CaptureDevicePart[]) => { this.take(await this.t.act(this.state.callId, { type: 'unavailable', parts })); };
  setScreens = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'screens', on })); };
  shareFrame = (f: ScreenFrame) => this.t.frame(this.state.callId, f);
  shareEnded = (share: string) => this.t.shareEnded(this.state.callId, share);
  mute = async (identity: string, trackSid: string) => { this.take(await this.t.act(this.state.callId, { type: 'mute', identity, trackSid })); };
  /** They're disconnected at once; the organizer's browser then takes them out of the group, so the keys move on without them. */
  remove = async (identity: string) => { this.take(await this.t.act(this.state.callId, { type: 'remove', identity })); await this.sync(); };
  lock = async (on: boolean) => { this.take(await this.t.act(this.state.callId, { type: 'lock', on })); };
  setHand = (up: boolean) => this.act({ type: 'hand', up });
  setSpotlight = (participantId: string | null) => this.act({ type: 'spotlight', participantId });
  openRooms = (plan: BreakoutPlan) => this.act({ type: 'rooms-open', rooms: plan.rooms, minutes: plan.minutes });
  closeRooms = () => this.act({ type: 'rooms-close' });
  messageRooms = (text: string) => { if (text.trim()) this.act({ type: 'rooms-message', text }); };
  visitRoom = (roomId: string | null) => this.act({ type: 'rooms-visit', roomId });
  translate = (lineIds: string[], language: CaptionLanguage) => this.t.translate(this.state.callId, lineIds, language);
  dismissNotice = (id: string) => { this.hidden.add(id); this.set({ ...this.state, notices: this.state.notices.filter((n) => n.id !== id) }); };
  appendAudio = async (p: AudioPiece) => { this.take(await this.t.audio(this.state.callId, p)); };
  /** Takes only the transcript from the answer, so a slow clip can't undo a newer mic or notes change. */
  /**
   * Several voices upload at once, so an answer computed before another voice's line was kept can arrive last: the
   * lines are merged by ID, newest 200 kept, rather than replaced.
   */
  transcribe = async (c: TranscriptClip, speaker: string) => {
    const s = await this.t.transcribe(this.state.callId, c, speaker);
    const byId = new Map([...this.state.transcript, ...s.transcript].map((l) => [l.id, l]));
    this.set({ ...this.state, transcript: [...byId.values()].sort((a, b) => a.at - b.at).slice(-LIVE_TRANSCRIPT_LINES) });
  };
  catchUp = (minutes?: number | undefined) => this.t.catchUp(this.state.callId, minutes);
  askSoFar = (question: string) => this.t.askSoFar(this.state.callId, question);
  close = () => {
    this.closed = true;
    this.stopTicking();
    if (this.timer) clearTimeout(this.timer);
    if (this.switchTimer) clearTimeout(this.switchTimer);
    this.timer = null;
    this.switchTimer = null;
  };
  /** The page is going away: everyone but the organizer says they've gone, in a request that outlives the page. */
  closing = () => {
    if (this.closed) return;
    this.close();
    // A failure has already been reported by the request itself, and a page going away can do nothing more.
    if (!this.organizer) this.t.leave(this.state.callId, { keepalive: true }).catch(() => undefined);
  };
  /** The organizer leaving ends the call for everyone; anyone else just goes (and is taken out of the group). */
  leave = async () => {
    this.close();
    const r = await this.t.leave(this.state.callId);
    this.set({ ...this.state, phase: 'ended' });
    return r;
  };
}
/** In Node (tests), a call's timers mustn't keep the process alive. */
function unref(t: unknown) {
  if (t && typeof t === 'object' && 'unref' in t && typeof t.unref === 'function') t.unref();
}

interface RecordingTransport {
  act(id: string, a: RecordingAction): Promise<RoomRecordingState>;
  audio(id: string, p: AudioPiece): Promise<RoomRecordingState>;
  transcribe(id: string, c: TranscriptClip): Promise<RoomRecordingState>;
  stop(id: string): Promise<z.infer<typeof RecordingStopResultSchema>>;
  discard(id: string): Promise<void>;
}
class HttpRecording extends Live<RoomRecordingState> implements RoomRecording {
  constructor(initial: RoomRecordingState, private readonly t: RecordingTransport) { super(initial, (s) => s.status === 'recording'); }
  private act(a: RecordingAction, optimistic: (s: RoomRecordingState) => RoomRecordingState) {
    this.set(optimistic(this.state));
    void this.t.act(this.state.id, a).then((s) => this.apply(s), () => undefined);
  }
  rename = (title: string) => { if (title.trim()) this.act({ type: 'rename', title }, (s) => ({ ...s, title })); };
  pause = () => this.act({ type: 'pause' }, (s) => ({ ...s, status: 'paused' }));
  resume = () => this.act({ type: 'resume' }, (s) => ({ ...s, status: 'recording' }));
  appendAudio = async (p: AudioPiece) => { const s = await this.t.audio(this.state.id, p); this.set({ ...this.state, recording: s.recording }); };
  transcribe = async (c: TranscriptClip) => { const s = await this.t.transcribe(this.state.id, c); this.set({ ...this.state, transcript: s.transcript }); };
  stop = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); return this.t.stop(this.state.id); };
  discard = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); await this.t.discard(this.state.id); };
}

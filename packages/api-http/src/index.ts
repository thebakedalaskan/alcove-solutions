/**
 * AlcoveApi over HTTP: JSON REST under `/v1`, newline-delimited JSON for streams, raw bytes for
 * audio pieces. Every payload is parsed with the contract's zod schemas, so a backend that drifts
 * from the contract fails loudly here instead of corrupting the UI.
 */
import {
  AlcoveApiError, AnswerPartSchema, AttestationSchema, AUDIO_HEADERS, CalendarSchema, CallEndResultSchema, CaptionTranslationSchema, CallStateSchema, CatchUpSchema, CreditBalanceSchema, MeetingSchema, NoteProgressSchema, NoteSchema,
  NoteSummarySchema, OPERATION_HEADER, OpenActionSchema, PersonSuggestionSchema, PreferencesSchema, RecordingStopResultSchema, REQUEST_ID_HEADER,
  RoomRecordingStateSchema, SessionSchema, SignInResultSchema, TeamSchema, isAlcoveErrorCode,
  type AlcoveApi, type AnswerPart, type AudioPiece, type BreakoutPlan, type CallAction, type CaptionLanguage, type CaptionTranslation, type CallSession, type CallState, type CatchUp, type RecordingAction, type RoomRecording,
  type RoomRecordingState, type TranscriptClip
} from '@alcove/api';
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
}
export interface ClientEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  context: Record<string, string | number | boolean | null>;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), message: z.string().optional(), requestId: z.string().optional() }).catch({});
/** IDs in paths are random; call codes are join tokens, so they're masked in diagnostics. */
const safePath = (p: string) => p.replace(/^\/calls\/(?!$)[^/]+/, '/calls/:code');
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
  async function send(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
    const mutating = method !== 'GET';
    const where = { method, path: safePath(path) };
    const t0 = Date.now();
    let res: Response;
    try {
      res = await f(base + path, { method, credentials: 'include', headers: { ...(mutating ? { [OPERATION_HEADER]: opId() } : {}), ...headers }, body: body ?? null });
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
  async function req<S extends z.ZodType>(schema: S, method: string, path: string, body?: unknown): Promise<z.infer<S>> {
    const res = await send(method, path, body === undefined ? null : JSON.stringify(body), body === undefined ? {} : { 'content-type': 'application/json' });
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
  const audio = (path: string, piece: AudioPiece) => send('POST', path, piece.data, {
    'content-type': piece.mimeType, [AUDIO_HEADERS.segment]: String(piece.segment), [AUDIO_HEADERS.seq]: String(piece.seq), [AUDIO_HEADERS.duration]: String(Math.round(piece.durationMs))
  }).then((r) => r.json());
  /** Speech for the live transcript: WAV bytes, placed by where the clip starts in its segment. */
  const clip = (path: string, c: TranscriptClip) => send('POST', path, c.data, {
    'content-type': 'audio/wav', [AUDIO_HEADERS.segment]: String(c.segment), [AUDIO_HEADERS.start]: String(Math.round(c.startMs)), [AUDIO_HEADERS.duration]: String(Math.round(c.durationMs))
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
      cancel: async (id) => { await req(z.unknown(), 'DELETE', `/meetings/${encodeURIComponent(id)}`); }
    },
    calendar: {
      get: () => req(CalendarSchema, 'GET', '/calendar'),
      connectUrl: () => `${base}/auth/google?consent=1`,
      adopt: (eventId, notes) => req(MeetingSchema, 'POST', `/calendar/events/${encodeURIComponent(eventId)}/adopt`, notes ? { notes } : {})
    },
    calls: {
      startNow: (input) => req(z.object({ code: z.string() }), 'POST', '/calls', input ?? {}),
      join: async (code, opts) => new HttpCall(await req(CallStateSchema, 'POST', `/calls/${encodeURIComponent(code)}/join`, opts), {
        act: (id, a) => req(CallStateSchema, 'POST', `/live/calls/${id}/actions`, a),
        audio: async (id, p) => parse(CallStateSchema, await audio(`/live/calls/${id}/audio`, p), 'call state'),
        transcribe: async (id, c) => parse(CallStateSchema, await clip(`/live/calls/${id}/transcribe`, c), 'call state'),
        catchUp: (id, minutes) => req(CatchUpSchema, 'POST', `/live/calls/${id}/catch-up`, minutes ? { minutes } : {}),
        askSoFar: (id, question) => req(z.array(AnswerPartSchema), 'POST', `/live/calls/${id}/ask`, { question }),
        translate: (id, lines, language) => req(z.array(CaptionTranslationSchema), 'POST', `/live/calls/${id}/translate`, { language, lines }),
        leave: (id) => req(CallEndResultSchema, 'POST', `/live/calls/${id}/leave`, {})
      })
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
      updateDecision: (noteId, decisionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/decisions/${encodeURIComponent(decisionId)}`, patch),
      updateAction: (noteId, actionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/actions/${encodeURIComponent(actionId)}`, patch),
      openActions: () => req(z.array(OpenActionSchema), 'GET', '/notes/actions'),
      ask: async function* (noteId, question) {
        const parts = await req(z.array(AnswerPartSchema), 'POST', `/notes/${encodeURIComponent(noteId)}/ask`, { question });
        yield* parts;
      },
      share: (id, emails) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(id)}/share`, { emails }),
      delete: async (id) => { await req(z.unknown(), 'DELETE', `/notes/${encodeURIComponent(id)}`); }
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
  act(id: string, a: CallAction): Promise<CallState>;
  audio(id: string, p: AudioPiece): Promise<CallState>;
  transcribe(id: string, c: TranscriptClip): Promise<CallState>;
  catchUp(id: string, minutes: number | undefined): Promise<CatchUp>;
  askSoFar(id: string, question: string): Promise<AnswerPart[]>;
  translate(id: string, lines: string[], language: CaptionLanguage): Promise<CaptionTranslation[]>;
  leave(id: string): Promise<z.infer<typeof CallEndResultSchema>>;
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

class HttpCall extends Live<CallState> implements CallSession {
  constructor(initial: CallState, private readonly t: CallTransport) { super(initial, (s) => s.phase === 'in-call'); }
  private act(a: CallAction, optimistic?: (s: CallState) => CallState) {
    if (optimistic) this.set(optimistic(this.state));
    void this.t.act(this.state.callId, a).then((s) => this.apply(s), (e: unknown) => {
      this.set({ ...this.state, notices: [...this.state.notices, { id: b64u(randomBytes(8)), kind: 'info', text: e instanceof Error ? e.message : 'That didn’t work.' }] });
    });
  }
  private me(s: CallState, patch: Partial<Pick<CallState['participants'][number], 'mic' | 'cam' | 'hand'>>): CallState {
    return { ...s, participants: s.participants.map((p) => (p.isMe ? { ...p, ...patch } : p)) };
  }
  setMic = (on: boolean) => this.act({ type: 'mic', on }, (s) => this.me(s, { mic: on }));
  setCam = (on: boolean) => this.act({ type: 'cam', on }, (s) => this.me(s, { cam: on }));
  setHand = (up: boolean) => this.act({ type: 'hand', up }, (s) => this.me(s, { hand: up }));
  setSharing = (on: boolean, title?: string) => this.act(title ? { type: 'sharing', on, title } : { type: 'sharing', on }, (s) => ({ ...s, sharing: on ? { title: title ?? 'Your screen' } : null }));
  sendChat = (text: string) => { if (text.trim()) this.act({ type: 'chat', text }); };
  setNotes = (on: boolean) => this.act({ type: 'notes', on });
  setSpotlight = (participantId: string | null) => this.act({ type: 'spotlight', participantId }, (s) => ({ ...s, spotlight: participantId }));
  openRooms = (plan: BreakoutPlan) => this.act({ type: 'rooms-open', rooms: plan.rooms, minutes: plan.minutes });
  closeRooms = () => this.act({ type: 'rooms-close' });
  messageRooms = (text: string) => { if (text.trim()) this.act({ type: 'rooms-message', text }); };
  translate = (lineIds: string[], language: CaptionLanguage) => this.t.translate(this.state.callId, lineIds, language);
  dismissNotice = (id: string) => this.act({ type: 'dismiss', id }, (s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }));
  appendAudio = async (p: AudioPiece) => { this.apply(await this.t.audio(this.state.callId, p)); };
  /** Takes only the transcript from the answer, so a slow clip can't undo a newer mic or notes change. */
  transcribe = async (c: TranscriptClip) => { const s = await this.t.transcribe(this.state.callId, c); this.set({ ...this.state, transcript: s.transcript }); };
  catchUp = (minutes?: number | undefined) => this.t.catchUp(this.state.callId, minutes);
  askSoFar = (question: string) => this.t.askSoFar(this.state.callId, question);
  leave = async () => {
    this.stopTicking();
    const r = await this.t.leave(this.state.callId);
    this.set({ ...this.state, phase: 'ended' });
    return r;
  };
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

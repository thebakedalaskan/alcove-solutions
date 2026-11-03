/**
 * AlcoveApi over HTTP: JSON REST under `/v1`, newline-delimited JSON for streams, raw bytes for
 * audio pieces. Every payload is parsed with the contract's zod schemas, so a backend that drifts
 * from the contract fails loudly here instead of corrupting the UI.
 */
import {
  AlcoveApiError, AnswerPartSchema, AUDIO_HEADERS, CallEndResultSchema, CallLinkSchema, CallStateSchema, CeremonyStartSchema, CreditBalanceSchema,
  CreditEventSchema, CreditPackSchema, MeetingSchema, NoteProgressSchema, NoteSchema, NoteSummarySchema, OPERATION_HEADER, OpenActionSchema, PasskeySchema,
  PreferencesSchema, RecordingStopResultSchema, REQUEST_ID_HEADER, RoomRecordingStateSchema, SessionSchema, SetupStepSchema, WeekStatsSchema, isAlcoveErrorCode,
  type AlcoveApi, type AudioPiece, type CallAction, type CallSession, type CallState, type RecordingAction, type RoomRecording, type RoomRecordingState
} from '@alcove/api';
import { z } from 'zod';
import { b64u, browserPasskeys, localSecrets, prfSalt, randomBytes, type PasskeyDevice, type SecretStore } from './passkeys';

export { browserPasskeys, localSecrets, type PasskeyDevice, type SecretStore } from './passkeys';

export interface HttpOptions {
  /** e.g. "/api" behind the web app's proxy, or https://api.alcove.app */
  baseUrl: string;
  fetch?: typeof fetch;
  passkeys?: PasskeyDevice;
  secrets?: SecretStore;
  /** Label stored (encrypted) for new passkeys, e.g. "Chrome on Mac". */
  deviceName?: () => string;
  /**
   * Diagnostics: every request (debug), failure (warn/error) and passkey ceremony outcome. Fields
   * are methods, paths, statuses, codes, durations, request IDs and capability flags; never bodies.
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
const opId = () => b64u(randomBytes(16));

export function createHttpApi(o: HttpOptions): AlcoveApi {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const base = o.baseUrl.replace(/\/$/, '') + '/v1';
  const passkeys = o.passkeys ?? browserPasskeys();
  const secrets = o.secrets ?? localSecrets();
  const deviceName = o.deviceName ?? (() => 'This device');

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
      // Signed-out and locked are ordinary states, not problems.
      const level = res.status >= 500 ? 'error' : code === 'unauthenticated' || code === 'locked' ? 'debug' : 'warn';
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

  /**
   * Every secret this browser has for a passkey, possibly none. The server decides which one the
   * passkey uses, and it is the one that can say why an unlock failed (unknown passkey, missing key).
   */
  function secretsFor(credentialId: string, prf: Uint8Array | null): { prf?: string; deviceSecret?: string } {
    const device = secrets.get(credentialId);
    const out: { prf?: string; deviceSecret?: string } = {};
    const key = usable(prf);
    if (key) out.prf = b64u(key);
    if (device) out.deviceSecret = b64u(device);
    return out;
  }
  async function register(startPath: string, startBody: unknown) {
    const start = await req(CeremonyStartSchema, 'POST', startPath, startBody);
    const salt = await prfSalt();
    const made = await passkeys.create(start.options, salt);
    let prf = usable(made.prf);
    // Some authenticators enable PRF at creation but only evaluate it on use: ask once more.
    if (!prf && made.prfEnabled) prf = usable((await passkeys.get({ challenge: b64u(randomBytes(32)), userVerification: 'required' }, salt, [made.credential.id]).catch(() => ({ prf: null }))).prf);
    // No usable PRF key: this passkey keeps its key in this browser instead. Never send neither.
    if (!prf && !secrets.get(made.credential.id)) secrets.put(made.credential.id, randomBytes(32));
    secrets.remember(made.credential.id);
    const keys = secretsFor(made.credential.id, prf);
    // Capability facts only: these explain most "passkey didn't work" reports without any key material.
    emit('info', 'passkey created', { prfEnabled: made.prfEnabled, prfAtCreate: Boolean(usable(made.prf)), prf: Boolean(prf), keySource: keys.prf ? 'prf' : keys.deviceSecret ? 'device' : 'none', authenticatorAttachment: made.credential.authenticatorAttachment ?? null });
    if (!keys.prf && !keys.deviceSecret) throw new AlcoveApiError('unavailable', 'This browser can’t store the key for a new passkey (storage is blocked). Allow site data for Alcove and try again.');
    return { start, made, ...keys };
  }
  /** Fresh proof with an existing passkey, required before adding or removing passkeys. */
  async function stepUp() {
    const start = await req(CeremonyStartSchema, 'POST', '/passkeys/verify/start', {});
    const used = await passkeys.get(start.options, await prfSalt());
    await req(z.unknown(), 'POST', '/passkeys/verify/finish', { challengeId: start.challengeId, credential: used.credential });
  }

  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      createAccount: async (name) => {
        const { start, made, ...keys } = await register('/auth/register/start', { name });
        return req(SessionSchema, 'POST', '/auth/register/finish', { challengeId: start.challengeId, credential: made.credential, ...keys, deviceName: deviceName() });
      },
      unlock: async () => {
        const start = await req(CeremonyStartSchema, 'POST', '/auth/unlock/start', {});
        // Offer only Alcove passkeys made in this browser when we know them; otherwise any (e.g. a synced passkey).
        const known = secrets.known();
        const used = await passkeys.get(start.options, await prfSalt(), known.length ? known : undefined);
        secrets.remember(used.credential.id);
        emit('info', 'passkey used to unlock', { knownCredentials: known.length, prf: Boolean(usable(used.prf)), deviceSecret: Boolean(secrets.get(used.credential.id)) });
        return req(SessionSchema, 'POST', '/auth/unlock/finish', { challengeId: start.challengeId, credential: used.credential, ...secretsFor(used.credential.id, used.prf) });
      },
      lock: async () => { await req(z.unknown(), 'POST', '/session/lock', {}); }
    },
    account: {
      preferences: () => req(PreferencesSchema, 'GET', '/account/preferences'),
      updatePreferences: (p) => req(PreferencesSchema, 'PATCH', '/account/preferences', p),
      rename: (name) => req(SessionSchema, 'POST', '/account/name', { name }),
      passkeys: () => req(z.array(PasskeySchema), 'GET', '/passkeys'),
      addPasskey: async () => {
        await stepUp();
        const { start, made, ...keys } = await register('/passkeys/start', {});
        return req(PasskeySchema, 'POST', '/passkeys/finish', { challengeId: start.challengeId, credential: made.credential, ...keys, deviceName: deviceName() });
      },
      removePasskey: async (id) => {
        await stepUp();
        await req(z.unknown(), 'DELETE', `/passkeys/${encodeURIComponent(id)}`, {});
      },
      setupSteps: () => req(z.array(SetupStepSchema), 'GET', '/account/setup')
    },
    meetings: {
      upcoming: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=upcoming'),
      past: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=past'),
      get: (id) => req(MeetingSchema, 'GET', `/meetings/${encodeURIComponent(id)}`),
      byCode: (code) => req(MeetingSchema.nullable(), 'GET', `/calls/${encodeURIComponent(code)}/meeting`),
      create: (input) => req(MeetingSchema, 'POST', '/meetings', input),
      update: (id, input) => req(MeetingSchema, 'PATCH', `/meetings/${encodeURIComponent(id)}`, input),
      setNotes: (id, notes) => req(MeetingSchema, 'PATCH', `/meetings/${encodeURIComponent(id)}`, { notes }),
      cancel: async (id) => { await req(z.unknown(), 'DELETE', `/meetings/${encodeURIComponent(id)}`); }
    },
    links: { create: (notes) => req(CallLinkSchema, 'POST', '/links', { notes }) },
    calls: {
      createInstant: () => req(z.object({ code: z.string() }), 'POST', '/calls', {}),
      join: async (code, opts) => new HttpCall(await req(CallStateSchema, 'POST', `/calls/${encodeURIComponent(code)}/join`, opts), {
        act: (id, a) => req(CallStateSchema, 'POST', `/live/calls/${id}/actions`, a),
        audio: async (id, p) => parse(CallStateSchema, await audio(`/live/calls/${id}/audio`, p), 'call state'),
        leave: (id) => req(CallEndResultSchema, 'POST', `/live/calls/${id}/leave`, {})
      })
    },
    recordings: {
      start: async (title) => new HttpRecording(await req(RoomRecordingStateSchema, 'POST', '/recordings', { title }), {
        act: (id, a) => req(RoomRecordingStateSchema, 'POST', `/recordings/${id}/actions`, a),
        audio: async (id, p) => parse(RoomRecordingStateSchema, await audio(`/recordings/${id}/audio`, p), 'recording state'),
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
      setActionDone: async (noteId, actionId, done) => { await req(z.unknown(), 'PATCH', `/notes/${noteId}/actions/${actionId}`, { done }); },
      openActions: () => req(z.array(OpenActionSchema), 'GET', '/notes/actions'),
      ask: async function* (noteId, question) {
        const parts = await req(z.array(AnswerPartSchema), 'POST', `/notes/${encodeURIComponent(noteId)}/ask`, { question });
        yield* parts;
      },
      delete: async (id) => { await req(z.unknown(), 'DELETE', `/notes/${encodeURIComponent(id)}`); }
    },
    credits: {
      balance: () => req(CreditBalanceSchema, 'GET', '/credits'),
      history: () => req(z.array(CreditEventSchema), 'GET', '/credits/history'),
      packs: () => req(z.array(CreditPackSchema), 'GET', '/credits/packs'),
      purchase: (packId) => req(CreditBalanceSchema, 'POST', '/credits/purchases', { packId })
    },
    stats: { week: () => req(WeekStatsSchema, 'GET', '/stats/week') },
    diagnostics: {
      // Straight to fetch, not through send(): a failed report must not produce another report.
      report: async (entries) => {
        if (!entries.length) return;
        await f(`${base}/telemetry`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: entries.slice(0, 20) }) }).catch(() => undefined);
      }
    }
  };
}

/** A PRF key is usable only if it is a full, non-zero 32 bytes. */
function usable(prf: Uint8Array | null): Uint8Array | null {
  return prf && prf.length >= 32 && prf.some((b) => b !== 0) ? prf.slice(0, 32) : null;
}

/* ---------- live call: server is the source of truth; the client keeps the clock ticking ---------- */
interface CallTransport {
  act(id: string, a: CallAction): Promise<CallState>;
  audio(id: string, p: AudioPiece): Promise<CallState>;
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
  startNotes = (mode: 'full' | 'notes') => this.act({ type: 'notes-start', mode });
  pauseNotes = () => this.act({ type: 'notes-pause' });
  resumeNotes = () => this.act({ type: 'notes-resume' });
  stopNotes = () => this.act({ type: 'notes-stop' });
  dismissNotice = (id: string) => this.act({ type: 'dismiss', id }, (s) => ({ ...s, notices: s.notices.filter((n) => n.id !== id) }));
  appendAudio = async (p: AudioPiece) => { this.apply(await this.t.audio(this.state.callId, p)); };
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
  stop = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); return this.t.stop(this.state.id); };
  discard = async () => { this.stopTicking(); this.set({ ...this.state, status: 'stopped' }); await this.t.discard(this.state.id); };
}

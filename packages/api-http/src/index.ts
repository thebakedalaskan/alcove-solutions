/**
 * AlcoveApi over HTTP. Request/response calls are JSON REST under `/v1`; anything that streams is
 * newline-delimited JSON; live calls and room recordings are WebSockets that push full state snapshots.
 * Every payload is parsed with the contract's zod schemas, so a backend that drifts from the
 * contract fails loudly here instead of corrupting the UI.
 *
 * The routes below are the proposed wire format. Change paths here, not in the app.
 */
import {
  AlcoveApiError, AnswerPartSchema, CalendarConnectionSchema, CallEndResultSchema, CallLinkSchema, CallStateSchema,
  CreditBalanceSchema, CreditEventSchema, CreditPackSchema, MeetingSchema, NoteProgressSchema, NoteSchema, NoteSummarySchema,
  OpenActionSchema, PasskeySchema, PreferencesSchema, RecordingStopResultSchema, RoomRecordingStateSchema, SessionSchema,
  SetupStepSchema, WeekStatsSchema, isAlcoveErrorCode,
  type AlcoveApi, type CallSession, type LiveStore, type RoomRecording
} from '@alcove/api';
import { z } from 'zod';

export interface HttpOptions {
  /** e.g. https://api.alcove.app */
  baseUrl: string;
  fetch?: typeof fetch;
  /** WebSocket base, defaults to baseUrl with ws(s):// */
  wsUrl?: string;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), message: z.string().optional() }).catch({});
const LiveMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: z.unknown() }),
  z.object({ type: z.literal('result'), id: z.string(), value: z.unknown() }),
  z.object({ type: z.literal('error'), id: z.string().optional(), code: z.string(), message: z.string() })
]);

export function createHttpApi(o: HttpOptions): AlcoveApi {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const base = o.baseUrl.replace(/\/$/, '') + '/v1';
  const wsBase = (o.wsUrl ?? o.baseUrl.replace(/^http/, 'ws')).replace(/\/$/, '') + '/v1';

  const fail = (code: unknown, message: string) => new AlcoveApiError(isAlcoveErrorCode(code) ? code : 'unknown', message);
  const parse = <S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> => {
    const r = schema.safeParse(data);
    if (!r.success) throw new AlcoveApiError('unknown', `The server sent an unexpected ${what}.`);
    return r.data;
  };

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await f(base + path, {
        method, credentials: 'include',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body)
      });
    } catch {
      throw new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');
    }
  }
  async function req<S extends z.ZodType>(schema: S, method: string, path: string, body?: unknown): Promise<z.infer<S>> {
    const res = await send(method, path, body);
    const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) { const e = ErrorBodySchema.parse(data); throw fail(e.code, e.message ?? res.statusText); }
    return parse(schema, data, `response from ${method} ${path}`);
  }
  async function act(method: string, path: string, body?: unknown): Promise<void> {
    await req(z.unknown(), method, path, body);
  }

  async function* ndjson<S extends z.ZodType>(schema: S, path: string, body?: unknown): AsyncIterable<z.infer<S>> {
    const res = await f(base + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: body === undefined ? { accept: 'application/x-ndjson' } : { accept: 'application/x-ndjson', 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body)
    });
    if (!res.ok || !res.body) throw new AlcoveApiError('unknown', `Stream failed: ${res.status}`);
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

  /** A WebSocket that receives `{type:'state'}` snapshots and answers `{type:'action'}` requests. */
  function live<S extends z.ZodType>(schema: S, path: string, initial: z.infer<S>) {
    const ws = new WebSocket(wsBase + path);
    let state: z.infer<S> = initial;
    const listeners = new Set<() => void>();
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    ws.onmessage = (e) => {
      const msg = LiveMessageSchema.safeParse(JSON.parse(String(e.data)));
      if (!msg.success) return;
      const m = msg.data;
      if (m.type === 'state') { state = parse(schema, m.state, `live update from ${path}`); listeners.forEach((l) => l()); }
      if (m.type === 'result') { pending.get(m.id)?.resolve(m.value); pending.delete(m.id); }
      if (m.type === 'error' && m.id) { pending.get(m.id)?.reject(fail(m.code, m.message)); pending.delete(m.id); }
    };
    const ready = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new AlcoveApiError('network', 'Lost connection to the call.'));
    });
    const send = (name: string, ...args: unknown[]) => { void ready.then(() => ws.send(JSON.stringify({ type: 'action', name, args }))); };
    const call = <R extends z.ZodType>(result: R, name: string, ...args: unknown[]) => new Promise<z.infer<R>>((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve: (v) => { try { resolve(parse(result, v, `result of ${name}`)); } catch (err) { reject(err); } }, reject });
      void ready.then(() => ws.send(JSON.stringify({ type: 'action', id, name, args })));
    });
    const store: LiveStore<z.infer<S>> = { getSnapshot: () => state, subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; } };
    return { store, send, call, ready, close: () => ws.close() };
  }

  const JoinResponse = z.object({ token: z.string(), state: CallStateSchema });
  const RecordingResponse = z.object({ id: z.string(), state: RoomRecordingStateSchema });

  return {
    auth: {
      getSession: () => req(SessionSchema.nullable(), 'GET', '/session'),
      // Real sign-in is a redirect to the provider; the callback route sets the session cookie.
      signIn: async (provider, email) => {
        if (provider === 'email') return req(SessionSchema, 'POST', '/auth/email', { email });
        globalThis.location.assign(`${base}/auth/${provider}/start?return=${encodeURIComponent(globalThis.location.href)}`);
        return new Promise(() => {});
      },
      createPasskey: async () => {
        const { publicKey } = await req(z.object({ publicKey: z.unknown() }), 'POST', '/passkeys/options', {});
        // The server returns WebAuthn options already encoded for the browser API; it validates the result.
        const cred = await navigator.credentials.create({ publicKey: parsePublicKeyOptions(publicKey) });
        return req(PasskeySchema, 'POST', '/passkeys', { credential: cred });
      },
      signOut: () => act('POST', '/session/sign-out', {})
    },
    account: {
      preferences: () => req(PreferencesSchema, 'GET', '/account/preferences'),
      updatePreferences: (p) => req(PreferencesSchema, 'PATCH', '/account/preferences', p),
      passkeys: () => req(z.array(PasskeySchema), 'GET', '/passkeys'),
      addPasskey: () => req(PasskeySchema, 'POST', '/passkeys/device-link', {}),
      calendars: () => req(z.array(CalendarConnectionSchema), 'GET', '/calendars'),
      setCalendar: (provider, connected) => req(z.array(CalendarConnectionSchema), 'POST', `/calendars/${provider}`, { connected }),
      setupSteps: () => req(z.array(SetupStepSchema), 'GET', '/account/setup')
    },
    meetings: {
      upcoming: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=upcoming'),
      past: () => req(z.array(MeetingSchema), 'GET', '/meetings?range=past'),
      get: (id) => req(MeetingSchema, 'GET', `/meetings/${id}`),
      byCode: (code) => req(MeetingSchema.nullable(), 'GET', `/calls/${code}/meeting`),
      create: (input) => req(MeetingSchema, 'POST', '/meetings', input),
      update: (id, input) => req(MeetingSchema, 'PATCH', `/meetings/${id}`, input),
      setNotes: (id, notes) => req(MeetingSchema, 'PATCH', `/meetings/${id}`, { notes }),
      resendInvite: (id, email) => act('POST', `/meetings/${id}/invites`, { email }),
      cancel: (id) => act('DELETE', `/meetings/${id}`)
    },
    links: { create: (notes) => req(CallLinkSchema, 'POST', '/links', { notes }) },
    calls: {
      createInstant: () => req(z.object({ code: z.string() }), 'POST', '/calls', {}),
      join: async (code, opts) => {
        const { token, state } = await req(JoinResponse, 'POST', `/calls/${code}/join`, opts);
        const l = live(CallStateSchema, `/calls/${code}/live?token=${encodeURIComponent(token)}`, state);
        await l.ready;
        const session: CallSession = {
          ...l.store,
          setMic: (on) => l.send('setMic', on), setCam: (on) => l.send('setCam', on), setHand: (up) => l.send('setHand', up),
          setSharing: (on) => l.send('setSharing', on), sendChat: (t) => l.send('sendChat', t),
          startNotes: (m) => l.send('startNotes', m), pauseNotes: () => l.send('pauseNotes'), resumeNotes: () => l.send('resumeNotes'),
          stopNotes: () => l.send('stopNotes'), dismissNotice: (id) => l.send('dismissNotice', id),
          invite: async (email) => { await l.call(z.unknown(), 'invite', email); },
          leave: async () => { const r = await l.call(CallEndResultSchema, 'leave'); l.close(); return r; }
        };
        return session;
      }
    },
    recordings: {
      start: async (title) => {
        const { id, state } = await req(RecordingResponse, 'POST', '/recordings', { title });
        const l = live(RoomRecordingStateSchema, `/recordings/${id}/live`, state);
        await l.ready;
        const rec: RoomRecording = {
          ...l.store,
          rename: (t) => l.send('rename', t), pause: () => l.send('pause'), resume: () => l.send('resume'),
          stop: async () => { const r = await l.call(RecordingStopResultSchema, 'stop'); l.close(); return r; },
          discard: async () => { await l.call(z.unknown(), 'discard'); l.close(); }
        };
        return rec;
      }
    },
    notes: {
      list: (q) => {
        const params = new URLSearchParams();
        if (q?.kind) params.set('kind', q.kind);
        if (q?.text) params.set('text', q.text);
        return req(z.array(NoteSummarySchema), 'GET', `/notes?${params}`);
      },
      get: (id) => req(NoteSchema, 'GET', `/notes/${id}`),
      progress: (id) => ndjson(NoteProgressSchema, `/notes/${id}/progress`),
      setActionDone: (noteId, actionId, done) => act('PATCH', `/notes/${noteId}/actions/${actionId}`, { done }),
      openActions: () => req(z.array(OpenActionSchema), 'GET', '/notes/actions?open=1&mine=1'),
      ask: (noteId, question) => ndjson(AnswerPartSchema, `/notes/${noteId}/ask`, { question }),
      shareLink: async (id) => (await req(z.object({ url: z.string() }), 'POST', `/notes/${id}/share`, {})).url
    },
    credits: {
      balance: () => req(CreditBalanceSchema, 'GET', '/credits'),
      history: () => req(z.array(CreditEventSchema), 'GET', '/credits/history'),
      packs: () => req(z.array(CreditPackSchema), 'GET', '/credits/packs'),
      purchase: (packId) => req(CreditBalanceSchema, 'POST', '/credits/purchases', { packId })
    },
    stats: { week: () => req(WeekStatsSchema, 'GET', '/stats/week') }
  };
}

/** WebAuthn options arrive as JSON; the browser can decode the standard JSON form natively. */
function parsePublicKeyOptions(json: unknown): PublicKeyCredentialCreationOptions {
  const Options = z.custom<PublicKeyCredentialCreationOptionsJSON>((v) => typeof v === 'object' && v !== null && 'challenge' in v && 'rp' in v && 'user' in v);
  const parsed = Options.safeParse(json);
  if (!parsed.success) throw new AlcoveApiError('unknown', 'The server sent invalid passkey options.');
  return PublicKeyCredential.parseCreationOptionsFromJSON(parsed.data);
}

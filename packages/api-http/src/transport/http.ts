import { b64u, randomBytes } from './ids';
import { type ClientEvent, type HttpOptions } from './options';
import { AlcoveApiError, isAlcoveErrorCode, OPERATION_HEADER, REQUEST_ID_HEADER } from '@alcove/api';
import { z } from 'zod';

const ErrorBodySchema = z.object({ code: z.string().optional(), message: z.string().optional(), requestId: z.string().optional() }).catch({});

/** IDs in paths are random; call codes are join tokens and a Google event's ID names its recurring series, so both are masked in diagnostics. */
const safePath = (p: string) => p.replace(/^\/calls\/(?!$)[^/]+/, '/calls/:code').replace(/^\/calendar\/events\/(?!$)[^/]+/, '/calendar/events/:id').replace(/^\/media\/(?!$)[^/]+/, '/media/:token');

const opId = () => b64u(randomBytes(16));
export function createHttpTransport(o: HttpOptions) {

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

  async function send(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}, keepalive = false, signal?: AbortSignal | undefined): Promise<Response> {
    const mutating = method !== 'GET';
    const where = { method, path: safePath(path) };
    const t0 = Date.now();
    let res: Response;
    try {
      res = await f(base + path, { method, credentials: 'include', keepalive, headers: { ...(mutating ? { [OPERATION_HEADER]: opId() } : {}), ...headers }, body: body ?? null, ...(signal ? { signal } : {}) });
    } catch (cause) {
      // Whoever asked gave up on it: nothing went wrong.
      if (signal?.aborted) throw cause;
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

  async function* ndjson<S extends z.ZodType>(schema: S, path: string, signal?: AbortSignal | undefined, headers: Record<string, string> = {}): AsyncIterable<z.infer<S>> {
    const res = await send('GET', path, null, headers, false, signal);
    if (!res.body) throw new AlcoveApiError('unknown', 'Empty stream.');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    // A line can be a whole document, so what's come so far is looked through once, not again with every piece that arrives.
    let pieces: string[] = [];
    try {
      for (; ;) {
        const { value, done } = await reader.read();
        if (done) break;
        let from = 0;
        for (let i = value.indexOf('\n'); i >= 0; i = value.indexOf('\n', from)) {
          pieces.push(value.slice(from, i));
          const line = pieces.join('').trim();
          pieces = [];
          from = i + 1;
          if (line) yield parse(schema, JSON.parse(line), `stream item from ${path}`);
        }
        if (from < value.length) pieces.push(value.slice(from));
      }
    } finally {
      // Whoever was reading may have stopped early, and the API lets go of a stream once nobody's there.
      reader.cancel().catch(() => undefined);
    }
  }
  return { f, base, emit, parse, send, req, ndjson };
}

export type HttpTransport = ReturnType<typeof createHttpTransport>;

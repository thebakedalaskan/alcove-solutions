/*
 * Runs a listener process (docs: Calls and recordings › The listener): registers with LiveKit and hears the calls it's
 * sent to, until it's told to stop. Its settings come from the environment. It says what it does as JSON lines on
 * stdout: IDs, counts and codes, never what was said.
 */
import { createListenerApi } from '@alcove/api-http';
import { z } from 'zod';
import { serveDispatch, type ListenerLog } from './index';

const Env = z.object({
  API_URL: z.string().url(),
  /** The web app's origin: the API takes changes only from it, so the listener says it comes from there. */
  WEB_ORIGIN: z.string().url(),
  LISTENER_KEY: z.string().min(32),
  LIVEKIT_URL: z.string().regex(/^wss?:\/\/\S+$/),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32),
  LISTENER_AGENT: z.string().regex(/^[a-z0-9-]{1,64}$/).default('alcove-listener'),
  LISTENER_SEATS: z.coerce.number().int().min(1).max(500).default(40)
});

const line = (level: 'info' | 'warn', msg: string, ctx?: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), service: 'alcove-listener', msg, ...ctx })}\n`);
};
const log: ListenerLog = { info: (msg, ctx) => line('info', msg, ctx), warn: (msg, ctx) => line('warn', msg, ctx) };

function run(env: z.infer<typeof Env>): void {
  const fetchFromApp: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', env.WEB_ORIGIN);
    return fetch(input, { ...init, headers });
  };
  const api = createListenerApi({ baseUrl: env.API_URL, fetch: fetchFromApp, key: env.LISTENER_KEY });
  const serving = serveDispatch({ livekitUrl: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET, agentName: env.LISTENER_AGENT, seats: env.LISTENER_SEATS, api, log });
  log.info('listener starting', { agent: env.LISTENER_AGENT, seats: env.LISTENER_SEATS });
  const stop = (signal: string) => {
    log.info('listener stopping', { signal, hearing: serving.hearing() });
    serving.stop().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

// Without its key (or LiveKit's) nothing could join a call: say so, and wait, rather than stop the rest of `pnpm dev`.
const parsed = Env.safeParse(process.env);
if (parsed.success) run(parsed.data);
else {
  log.warn('listener not started: its settings are missing or wrong', { settings: parsed.error.issues.map((i) => i.path.join('.')) });
  setInterval(() => undefined, 60 * 60_000);
}

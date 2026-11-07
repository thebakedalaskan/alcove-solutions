/*
 * Listener processes for tests (apps/listener's cli.ts), each its own child process, so a test can stop one the way a
 * crash would (SIGKILL) and see the API send another. They register with the test LiveKit under the harness's
 * LISTENER_AGENT and join through the harness's API.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Harness } from './harness';
import { ORIGIN } from './harness';

const CLI = fileURLToPath(new URL('../../../listener/src/cli.ts', import.meta.url));
const API_DIR = fileURLToPath(new URL('../..', import.meta.url));

export interface Worker {
  /** What it has said so far, one JSON line each. */
  lines: string[];
  /** Waits until it has registered with LiveKit. */
  registered(): Promise<void>;
  /** Dies the way a crash does: no goodbye to LiveKit or the call. */
  crash(): void;
  /** Stops as a deploy would: leaves its calls first. */
  stop(): Promise<void>;
}

export function startWorker(h: Harness): Worker {
  const cfg = h.deps.cfg;
  const env = {
    ...process.env, API_URL: h.baseUrl, WEB_ORIGIN: ORIGIN, LISTENER_KEY: cfg.LISTENER_KEY ?? '', LISTENER_AGENT: cfg.LISTENER_AGENT,
    LIVEKIT_URL: cfg.LIVEKIT_URL, LIVEKIT_API_KEY: cfg.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: cfg.LIVEKIT_API_SECRET
  };
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', CLI], { cwd: API_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines: string[] = [];
  child.stdout?.on('data', (d: Buffer) => { lines.push(...String(d).split('\n').filter(Boolean)); });
  child.stderr?.on('data', (d: Buffer) => { lines.push(...String(d).split('\n').filter(Boolean)); });
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  return {
    lines,
    async registered() {
      const until = Date.now() + 30_000;
      while (!lines.some((l) => l.includes('listener registered with LiveKit'))) {
        if (Date.now() > until) throw new Error(`the listener never registered: ${lines.slice(-5).join(' | ')}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    crash() { child.kill('SIGKILL'); },
    async stop() { if (child.exitCode === null) child.kill('SIGTERM'); await exited; }
  };
}

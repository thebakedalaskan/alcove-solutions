/** Original Alcove sine-tone cues. Output never attaches to capture, LiveKit or a recorder. */
import { SoundReceiptsSchema, type SoundPreferences } from '@alcove/api';
import { canChooseSpeaker } from '~/features/call/media/devices';
import { log } from './log';

const alog = log.child({ component: 'sound-output' });
export type SoundCue = 'mic-on' | 'mic-off' | 'join' | 'leave' | 'hand' | 'question' | 'admission' | 'timer' | 'ring';
const tones: Record<SoundCue, readonly (readonly [number, number])[]> = {
  'mic-on': [[0, 523.25], [0.075, 659.25]], 'mic-off': [[0, 659.25], [0.075, 523.25]],
  join: [[0, 392], [0.1, 523.25]], leave: [[0, 523.25], [0.1, 392]],
  hand: [[0, 587.33], [0.12, 659.25]], question: [[0, 523.25], [0.13, 698.46]],
  admission: [[0, 392], [0.14, 587.33], [0.28, 659.25]],
  timer: [[0, 783.99], [0.18, 523.25]], ring: [[0, 659.25], [0.16, 880], [0.8, 659.25], [0.96, 880]]
};
const category: Record<SoundCue, keyof SoundPreferences> = {
  'mic-on': 'mic', 'mic-off': 'mic', join: 'people', leave: 'people', hand: 'hands', question: 'questions', admission: 'admissions', timer: 'timers', ring: 'ringing'
};
const priority = (cue: SoundCue) => cue === 'mic-on' || cue === 'mic-off' ? 4 : cue === 'admission' ? 3 : cue === 'timer' || cue === 'ring' ? 1 : 0;
const cooldown = (cue: SoundCue) => category[cue] === 'mic' ? 0 : cue === 'admission' ? 700 : 1800;
export function soundAllowed(cue: SoundCue, prefs: SoundPreferences): boolean {
  return prefs.enabled && prefs.volume > 0 && Boolean(prefs[category[cue]]) && (!prefs.quiet || cue === 'mic-on' || cue === 'mic-off' || cue === 'admission');
}
interface Request { owner: object; cue: SoundCue; key: string; until: number; current: () => { prefs: SoundPreferences; speakerId: string | null }; preview?: boolean; generation?: number; categoryGeneration?: number; cancelled?: boolean }
interface Output { context: AudioContext; destination: AudioNode; audio: HTMLAudioElement | null }
const pending: Request[] = [];
const generations = new WeakMap<object, number>();
const categoryGenerations = new Map<keyof SoundPreferences, number>();
const heard = new Map<string, number>();
const playedCategories = new Map<string, number>();
let running = false;
let preparing: Request | null = null;
let active: { owner: object; cue: SoundCue; stop: () => void } | null = null;
const RECEIPTS = 'alcove.sound.receipts';
const tab = globalThis.crypto?.randomUUID() ?? String(Math.random());
let output: Output | null = null;
let readyOwners = 0;
const valid = (request: Request) => !request.cancelled && Date.now() <= request.until
  && request.generation === (generations.get(request.owner) ?? 0)
  && request.categoryGeneration === categoryGenerations.get(category[request.cue]);

/** Safari uses the same context unlocked on a gesture. Browsers with speaker routing use an output-only audio element. */
function makeOutput(): Output | null {
  if (output) return output;
  if (typeof AudioContext === 'undefined' || ('userActivation' in navigator && !navigator.userActivation.hasBeenActive)) return null;
  const context = new AudioContext();
  if (!canChooseSpeaker()) output = { context, destination: context.destination, audio: null };
  else {
    const destination = context.createMediaStreamDestination();
    const audio = new Audio();
    audio.srcObject = destination.stream;
    output = { context, destination, audio };
  }
  return output;
}
/** Never wait for an unavailable speaker, device picker or browser playback permission. */
async function bounded(action: Promise<unknown>): Promise<boolean> {
  return Promise.race([action.then(() => true, (e: unknown) => { alog.debug('sound output stayed unavailable', { err: e }); return false; }), new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), 200); })]);
}
/** Called synchronously from a control's trusted gesture, including controls portalled into a child window. */
export function unlockAudioOutput(): void {
  try {
    const out = makeOutput();
    if (!out) return;
    void bounded(Promise.all([out.context.resume(), out.audio?.play()]));
  } catch (e) { alog.debug('sound output could not open', { err: e }); }
}
export function readyAudioOutput(): () => void {
  readyOwners++;
  const ready = () => unlockAudioOutput();
  addEventListener('pointerdown', ready, { capture: true });
  addEventListener('keydown', ready, { capture: true });
  return () => {
    removeEventListener('pointerdown', ready, { capture: true });
    removeEventListener('keydown', ready, { capture: true });
    readyOwners--;
    if (readyOwners === 0 && output) {
      output.audio?.pause();
      if (output.audio) output.audio.srcObject = null;
      void output.context.close().catch(() => undefined);
      output = null;
    }
  };
}
function receipts() {
  try { const parsed = SoundReceiptsSchema.safeParse(JSON.parse(localStorage.getItem(RECEIPTS) ?? '[]')); return parsed.success ? parsed.data : []; }
  catch { return []; }
}
function remember(key: string, at: number): boolean {
  try {
    localStorage.setItem(RECEIPTS, JSON.stringify([...receipts().filter((r) => at - r.at < 15_000 && r.key !== key).slice(-127), { key, at, tab }]));
    return true;
  } catch (e) { alog.debug('sound receipt stayed in this tab', { err: e }); return false; }
}
/** Readiness is proved before claiming; receipts are retained only for a phrase whose oscillators actually started. */
async function claim(request: Request, play: () => Promise<boolean>): Promise<void> {
  const take = async () => {
    if (!valid(request)) return;
    const now = Date.now();
    for (const [id, at] of heard) if (now - at > 15_000) heard.delete(id);
    const previous = receipts();
    const kind = `category:${category[request.cue]}`;
    if (heard.has(request.key) || previous.some((r) => r.key === request.key && now - r.at < 15_000)) return;
    if (!request.preview && (now - (playedCategories.get(kind) ?? 0) < cooldown(request.cue) || previous.some((r) => r.key === kind && now - r.at < cooldown(request.cue)))) return;
    const perform = async () => {
      // Without Web Locks, a short storage reservation lets simultaneous ready tabs elect one. Failed output releases it.
      const fallback = !('locks' in navigator) && remember(request.key, now);
      if (fallback) {
        await new Promise<void>((resolve) => { setTimeout(resolve, 30); });
        if (receipts().find((r) => r.key === request.key)?.tab !== tab) return;
      }
      if (!await play()) {
        if (fallback) {
          try { localStorage.setItem(RECEIPTS, JSON.stringify(receipts().filter((r) => r.key !== request.key || r.tab !== tab))); }
          catch (e) { alog.debug('a failed sound receipt could not be released', { err: e }); }
        }
        return;
      }
      heard.set(request.key, now);
      if (heard.size > 128) { const first = heard.keys().next().value; if (first) heard.delete(first); }
      remember(request.key, now);
      if (!request.preview) { playedCategories.set(kind, now); remember(kind, now); }
    };
    if ('locks' in navigator) await navigator.locks.request('alcove-sound-output', { ifAvailable: true }, async (lock) => { if (lock) await perform(); });
    else await perform();
  };
  if ('locks' in navigator) await navigator.locks.request(`alcove-sound:${request.key}`, { ifAvailable: true }, async (lock) => { if (lock) await take(); });
  else await take();
}
async function route(audio: HTMLAudioElement, id: string): Promise<'ready' | 'failed' | 'timeout'> {
  return Promise.race([audio.setSinkId(id).then(() => 'ready' as const, (e: unknown) => { alog.debug('sound uses the system speaker', { err: e }); return 'failed' as const; }), new Promise<'timeout'>((resolve) => { setTimeout(() => resolve('timeout'), 200); })]);
}
function retireOutput(out: Output): void {
  out.audio?.pause();
  if (out.audio) out.audio.srcObject = null;
  void out.context.close().catch(() => undefined);
  if (output === out) output = null;
}
async function prepare(request: Request): Promise<Output | null> {
  const out = makeOutput();
  if (!out || !valid(request)) return null;
  const { speakerId } = request.current();
  if (out.audio) {
    const chosen = speakerId ?? '';
    if (out.audio.sinkId !== chosen) {
      const result = await route(out.audio, chosen);
      if (result === 'timeout') { retireOutput(out); return null; }
      if (!valid(request)) return null;
      // A rejected choice is no longer usable. Pending choices are detached so a late switch cannot reroute a later cue.
      if (result === 'failed' && await route(out.audio, '') !== 'ready') { retireOutput(out); return null; }
    }
  }
  if (!valid(request)) return null;
  if (!await bounded(Promise.all([out.context.resume(), out.audio?.play()]))) return null;
  return valid(request) && out.context.state === 'running' && (!out.audio || !out.audio.paused) ? out : null;
}
async function render(request: Request, out: Output): Promise<boolean> {
  const { prefs } = request.current();
  if (!valid(request) || out.context.state !== 'running' || (!request.preview && !soundAllowed(request.cue, prefs))) return false;
  const gain = out.context.createGain();
  gain.gain.value = 0.12 * prefs.volume;
  gain.connect(out.destination);
  const oscillators: OscillatorNode[] = [];
  let finish = () => {};
  const stop = () => { for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* Already ended. */ } oscillator.disconnect(); } gain.disconnect(); finish(); };
  if (preparing === request) preparing = null;
  active = { owner: request.owner, cue: request.cue, stop };
  try {
    const start = out.context.currentTime + 0.01;
    for (const [at, hz] of tones[request.cue]) {
      const oscillator = out.context.createOscillator();
      const envelope = out.context.createGain();
      oscillator.frequency.value = hz;
      envelope.gain.setValueAtTime(0.0001, start + at);
      envelope.gain.exponentialRampToValueAtTime(0.65, start + at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.19);
      oscillator.connect(envelope).connect(gain);
      oscillator.start(start + at);
      oscillator.stop(start + at + 0.21);
      oscillators.push(oscillator);
    }
    const end = tones[request.cue].at(-1)?.[0] ?? 0;
    await new Promise<void>((resolve) => { finish = resolve; setTimeout(resolve, (end + 0.24) * 1000); });
    return true;
  } catch (e) { alog.debug('sound output unavailable', { err: e }); return false; }
  finally { stop(); if (active?.owner === request.owner) active = null; }
}
async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let request = pending.shift(); request; request = pending.shift()) {
      if (!valid(request)) continue;
      const current = request;
      preparing = current;
      try {
        const out = await prepare(current);
        if (out) await claim(current, () => render(current, out));
      } finally { if (preparing === current) preparing = null; }
    }
  } catch (e) { alog.debug('sound scheduler stayed quiet', { err: e }); }
  finally { running = false; }
}
export function playSound(request: Request): void {
  if (!request.preview && !soundAllowed(request.cue, request.current().prefs)) return;
  if (pending.some((r) => r.key === request.key)) return;
  // A shifted request may still be awaiting output preparation. The generation invalidates it too.
  const nextCategory = (categoryGenerations.get(category[request.cue]) ?? 0) + 1;
  categoryGenerations.set(category[request.cue], nextCategory);
  // One phrase per category in a burst. New microphone confirmations replace stale confirmations.
  for (let i = pending.length - 1; i >= 0; i--) if (category[pending[i]?.cue ?? 'ring'] === category[request.cue]) pending.splice(i, 1);
  if (preparing && priority(request.cue) > priority(preparing.cue)) preparing.cancelled = true;
  if (active && priority(request.cue) > priority(active.cue)) active.stop();
  if (active && category[request.cue] === 'mic' && category[active.cue] === 'mic') active.stop();
  pending.push({ ...request, generation: generations.get(request.owner) ?? 0, categoryGeneration: nextCategory });
  pending.sort((a, b) => priority(b.cue) - priority(a.cue));
  if (pending.length > 4) pending.pop();
  void drain();
}
/** Leaving a call/room or changing preferences clears queued and currently audible cues. */
export function stopSounds(owner: object): void {
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i]?.owner === owner) pending.splice(i, 1);
  if (active?.owner === owner) active.stop();
}

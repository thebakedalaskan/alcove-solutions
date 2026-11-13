import { TabAttentionSignalSchema, type TabAttentionSignal } from '@alcove/api';
import { log } from '~/lib/log';

type CallSignal = Extract<TabAttentionSignal, { type: 'call' }>;
interface Projection { signal: CallSignal; at: number }
const calls = new Map<string, Projection>();
const localTabs = new Set<string>();
let liveTabs = new Set<string>();
const listeners = new Set<() => void>();
const reads = new Set<(owner: string) => void>();
const publishers = new Set<() => void>();
let channel: BroadcastChannel | null = null;
let version = 0;
const changed = () => { version++; for (const f of listeners) f(); };

/** A disconnected or crashed tab cannot leave attention behind indefinitely. Nothing here is persisted. */
const EXPIRES_MS = 20_000;
export const attentionLock = (tab: string) => `alcove.attention.${tab}`;
export function attentionCounts(owner: string | null): { mentions: number; actions: number } {
  const byCall = new Map<string, { mentions: number; actions: number }>();
  for (const { signal: s } of calls.values()) {
    if (s.owner !== owner) continue;
    const previous = byCall.get(s.call);
    byCall.set(s.call, { mentions: Math.max(previous?.mentions ?? 0, s.mentions), actions: Math.max(previous?.actions ?? 0, s.actions) });
  }
  return [...byCall.values()].reduce((sum, c) => ({ mentions: sum.mentions + c.mentions, actions: sum.actions + c.actions }), { mentions: 0, actions: 0 });
}

function take(s: TabAttentionSignal) {
  if (s.type === 'call') { calls.set(s.tab, { signal: s, at: Date.now() }); changed(); }
  else if (s.type === 'gone') { calls.delete(s.tab); changed(); }
  else if (s.type === 'look') { for (const publish of publishers) publish(); }
  else for (const read of reads) read(s.owner);
}

/** Owns the channel and expiry timer only while the root subscribes, including in Storybook. */
export function subscribeAttention(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('alcove-attention');
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = TabAttentionSignalSchema.safeParse(event.data);
        if (parsed.success) take(parsed.data);
      };
      channel.postMessage({ type: 'look' } satisfies TabAttentionSignal);
    }
  }
  let active = true;
  const prune = async () => {
    // A live lock survives background timer throttling. Only a closed/crashed publisher can lose it.
    if (navigator.locks) {
      try {
        const held = (await navigator.locks.query()).held ?? [];
        if (!active) return;
        liveTabs = new Set(held.flatMap((lock) => lock.name?.startsWith('alcove.attention.') ? [lock.name.slice('alcove.attention.'.length)] : []));
      } catch (error) { log.child({ component: 'tab-attention' }).debug('tab liveness could not be checked', { err: error }); }
    }
    if (!active) return;
    for (const [tab, p] of calls) if (!localTabs.has(tab) && !liveTabs.has(tab) && Date.now() - p.at > EXPIRES_MS) { calls.delete(tab); changed(); }
  };
  const timer = setInterval(() => { void prune(); }, 5_000);
  return () => {
    active = false; clearInterval(timer);
    listeners.delete(listener);
    if (!listeners.size) { channel?.close(); channel = null; calls.clear(); }
  };
}
export const attentionVersion = () => version;
export const serverAttentionVersion = () => 0;
export function publishAttention(signal: TabAttentionSignal): void {
  if (signal.type === 'call') localTabs.add(signal.tab);
  else if (signal.type === 'gone') localTabs.delete(signal.tab);
  take(signal);
  channel?.postMessage(signal);
}
/** This tab's liveness, independent of whether its background timers run on time. */
export function holdAttention(tab: string): () => void {
  if (!navigator.locks) return () => {};
  const stop = new AbortController();
  let release = () => {};
  const held = new Promise<void>((done) => { release = done; });
  void navigator.locks.request(attentionLock(tab), { signal: stop.signal }, () => held)
    .catch((error: unknown) => { if (!stop.signal.aborted) log.child({ component: 'tab-attention' }).debug('tab liveness lock unavailable', { err: error }); });
  return () => { stop.abort(); release(); };
}
export function answerAttentionLook(publish: () => void): () => void { publishers.add(publish); return () => { publishers.delete(publish); }; }
export function onMentionsRead(read: (owner: string) => void): () => void { reads.add(read); return () => { reads.delete(read); }; }
export const announceMentionsRead = (owner: string) => publishAttention({ type: 'mentions-read', owner });

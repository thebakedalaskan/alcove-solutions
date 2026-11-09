/** Fresh attention events only. Snapshot baselines are reset on join, reconnect, generation and room changes. */
import type { CallSession, CallState, CallCrypto, DirectMessagesState } from '@alcove/api';
import { useEffect, useRef } from 'react';
import { playSound, readyAudioOutput, stopSounds } from '~/lib/audio-output';
import { unreadThreadReplies } from '../session/replyAlerts';
import { useSoundPreferences } from '~/lib/sound-preferences';

export function useCallSounds({ call, state, chat, direct, speakerId, connected, presenting }: { call: CallSession; state: CallState; chat: CallCrypto; direct: DirectMessagesState; speakerId: string | null; connected: boolean; presenting: boolean }) {
  const { prefs, ready } = useSoundPreferences();
  // Presenting comes from actual local screen shares or CallPresent.mine, never inferred from someone else's content.
  const moderatesAttention = state.isHost || presenting;
  const audiblePrefs = { ...prefs, hands: prefs.hands && moderatesAttention, questions: prefs.questions && moderatesAttention };
  const owner = useRef({});
  const alive = useRef(false);
  const allowed = useRef({ connected, ready, phase: state.phase, scope: '' });
  const current = useRef({ prefs: audiblePrefs, speakerId });
  current.current = { prefs: audiblePrefs, speakerId };
  const baseline = useRef<{ scope: string; latest: number; serverNow: number } | null>(null);
  const privateBaseline = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const replyBaseline = useRef<{ scope: string; at: number; ids: Set<string> } | null>(null);
  const privateReady = useRef(direct.ready);
  privateReady.current = direct.ready;
  const scope = `${state.callId}:${state.generation}:${state.attention.place}`;
  allowed.current = { connected, ready, phase: state.phase, scope };
  // Recheck live scope at playback too, including the interval before an effect cleanup runs.
  const playback = () => {
    const now = allowed.current;
    return { ...current.current, prefs: { ...current.current.prefs, enabled: current.current.prefs.enabled
      && alive.current && now.connected && now.ready && now.phase === 'in-call' && now.scope === scope } };
  };
  useEffect(readyAudioOutput, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopSounds(owner.current); };
  }, [call, scope]);
  useEffect(() => () => stopSounds(owner.current), [prefs, moderatesAttention]);
  useEffect(() => {
    const previous = privateBaseline.current;
    const ids = new Set(direct.messages.map((m) => m.id));
    privateBaseline.current = connected && direct.ready ? { scope, ids } : null;
    if (!previous || previous.scope !== scope || !connected || !direct.ready || state.phase !== 'in-call') return;
    for (const message of direct.messages) {
      if (message.to !== call.ticket.identity || previous.ids.has(message.id) || state.elapsed - message.at > 5 || message.place !== state.attention.place) continue;
      playSound({ owner: owner.current, cue: message.thread ? 'reply' : 'message', key: `${state.callId}:${message.id}`, until: Date.now() + 1200, current: () => {
        const current = playback();
        return { ...current, prefs: { ...current.prefs, enabled: current.prefs.enabled && privateReady.current } };
      } });
    }
  }, [direct, connected, scope, state.phase]);
  useEffect(() => {
    const ids = new Set(unreadThreadReplies(state, chat, call.ticket.identity));
    const previous = replyBaseline.current;
    replyBaseline.current = connected && chat.status === 'in' ? { scope, at: Date.now(), ids: new Set(chat.chat.filter((m) => !m.isMe && !m.sending && !m.failed).map((m) => m.id)) } : null;
    if (!previous || previous.scope !== scope || Date.now() - previous.at > 12_000 || !connected || chat.status !== 'in') return;
    for (const message of chat.chat) {
      if (!ids.has(message.id) || !chat.members.includes(message.from) || previous.ids.has(message.id) || state.elapsed - message.at > 5) continue;
      playSound({ owner: owner.current, cue: 'reply', key: `${state.callId}:${message.id}`, until: Date.now() + 1200, current: playback });
    }
  }, [chat, state, connected, scope, call]);
  useEffect(() => {
    const previous = baseline.current;
    const now = Date.parse(state.attention.serverNow);
    const latest = state.attention.latest;
    baseline.current = { scope, latest, serverNow: now };
    if (!connected || !ready || state.phase !== 'in-call') { baseline.current = null; stopSounds(owner.current); return; }
    // A long snapshot gap can contain a reconnect with no visible intermediate state. Do not play its history.
    if (!previous || previous.scope !== scope || now - previous.serverNow > 12_000 || latest < previous.latest) return;
    for (const cue of state.attention.cues) {
      // Server filtering remains authoritative: presenting never grants access to another room's questions.
      if ((cue.kind === 'hand' || cue.kind === 'question') && !moderatesAttention) continue;
      const age = now - Date.parse(cue.at);
      if (cue.seq <= previous.latest || age < 0 || age > 5_000) continue;
      playSound({ owner: owner.current, cue: cue.kind, key: `${state.callId}:${cue.id}`, until: Date.now() + 1200, current: playback });
    }
  }, [state.attention, state.callId, state.phase, scope, connected, ready, moderatesAttention]);
  return {
    /** The caller confirms the latest successful actual local mic transition, never a requested or pending toggle. */
    confirmMic(enabled: boolean) {
      const now = allowed.current;
      if (!alive.current || now.scope !== scope || !now.connected || !now.ready || now.phase !== 'in-call') return;
      playSound({ owner: owner.current, cue: enabled ? 'mic-on' : 'mic-off', key: `mic:${crypto.randomUUID()}`, until: Date.now() + 700, current: playback });
    }
  };
}

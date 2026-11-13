/*
 * Notifications: how things reach you, then what does. The first panel is the ways: the browser's own notifications, the
 * sounds and how loud they are, quiet mode, and the reminder before a call. The second, What reaches you, has one row for
 * each thing that can reach you, with an Alert (from the browser when Alcove is in another tab, once browser notifications
 * are on; for replies and mentions in a call, also a brief alert on screen, browser or not) and a Sound. Settings has all of it. A call's own Settings (More, then Settings) has the
 * same pieces for the call, signed-out guests included, whose choices stay in this browser.
 */
import type { NotificationPrefs, SoundPreferences } from '@alcove/api';
import { AlertTable, Button, Segmented, SettingFact, SettingsGroup, SettingsPanel, SoundLevel, Switch, type IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playSound, readyAudioOutput, stopSounds } from '~/lib/audio-output';
import { useNotificationPreferences } from '~/lib/notification-preferences';
import { q } from '~/lib/queries';
import { useSoundPreferences } from '~/lib/sound-preferences';
import { readPrefs } from '~/features/call/media/devices';
import { askToNotify, useNotifyPermission } from '~/features/shell/notification-permission';
import { Setting, SwitchSetting, useSave, useSaveState } from './save';

/** Everything that can alert you, and everything that can make a sound: each a choice of its own. */
type AlertKey = Exclude<keyof NotificationPrefs, 'enabled' | 'beforeCall'>;
type SoundKey = Exclude<keyof SoundPreferences, 'enabled' | 'volume' | 'quiet'>;
/** One thing that can reach you, said once. A way that doesn't apply to it is null. */
interface Reach { id: string; label: string; note?: string | undefined; icon: IconName; alert: AlertKey | null; sound: SoundKey | null }
interface Reaches { title: string; rows: readonly Reach[] }

const IN_A_CALL: Reaches = { title: 'In a call', rows: [
  { id: 'private-messages', label: 'Private messages', icon: 'privateChat', alert: 'privateMessages', sound: 'messages' },
  { id: 'mentions', label: 'Mentions', icon: 'at', alert: 'chatMentions', sound: 'mentions' },
  { id: 'replies', label: 'Replies to you', icon: 'reply', alert: 'replies', sound: 'replies' },
  { id: 'admissions', label: 'Requests to join', note: 'When you host', icon: 'door', alert: 'admissions', sound: 'admissions' },
  { id: 'hands', label: 'Raised hands', note: 'When you host or present', icon: 'hand', alert: 'hands', sound: 'hands' },
  { id: 'questions', label: 'New questions', note: 'When you host or present', icon: 'ask', alert: 'questions', sound: 'questions' },
  { id: 'timers', label: 'The timer running out', icon: 'timer', alert: 'timers', sound: 'timers' },
  { id: 'people', label: 'People joining and leaving', icon: 'people', alert: null, sound: 'people' },
  { id: 'mic', label: 'Your microphone on and off', icon: 'mic', alert: null, sound: 'mic' }
] };
const OUTSIDE_A_CALL: Reaches = { title: 'Outside a call', rows: [
  { id: 'ringing', label: 'Someone rings you', icon: 'ringIn', alert: 'ringing', sound: 'ringing' },
  { id: 'notes-ready', label: 'Your notes are ready', icon: 'fileCheck', alert: 'notesReady', sound: null },
  { id: 'shared', label: 'Notes shared with you', icon: 'shareNodes', alert: 'sharedWithYou', sound: null },
  { id: 'notes-asked', label: 'Someone asks for notes', note: 'Calls you organize', icon: 'handHelping', alert: 'notesRequested', sound: null },
  { id: 'follow-up', label: 'A follow-up is due', note: 'At 9:00 that day', icon: 'todo', alert: 'followUpDue', sound: null },
  { id: 'tagged', label: 'Mentions in documents', icon: 'filePen', alert: 'tagged', sound: null },
  { id: 'plan', label: 'Your plan', note: 'Pro about to end, renewed or ended', icon: 'coins', alert: 'plan', sound: null }
] };

const alertPatch = (key: AlertKey, on: boolean): Partial<NotificationPrefs> => { const patch: Partial<NotificationPrefs> = {}; patch[key] = on; return patch; };
const soundPatch = (key: SoundKey, on: boolean): Partial<SoundPreferences> => { const patch: Partial<SoundPreferences> = {}; patch[key] = on; return patch; };

/** Where the pieces' choices go. Each is named by its row, which says Saved for a moment once it's kept (on Settings). */
interface Writes {
  notify: (label: string, patch: Partial<NotificationPrefs>) => void;
  sound: (label: string, patch: Partial<SoundPreferences>) => void;
}
type NotificationChoices = ReturnType<typeof useNotificationPreferences>;

const BROWSER = 'Browser notifications';

/**
 * Browser notifications: what the browser adds to the alerts Alcove shows anyway. Only Turn on asks the browser, and the
 * answer is kept only for whoever pressed it, in this tab, while they're still signed in as they were. The row keeps the
 * focus when the button gives way to a switch or a fact.
 */
function BrowserNotifications({ choices, writes }: { choices: NotificationChoices; writes: Writes }) {
  const { prefs, ready, scope, capturePermissionIntent } = choices;
  const permission = useNotifyPermission();
  const row = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const context = useRef(scope);
  context.current = scope;
  const version = useRef(0);
  useEffect(() => { version.current++; setAsking(false); return () => { version.current++; }; }, [scope]);
  const turnOn = async () => {
    const at = version.current;
    const forScope = scope;
    const stillOriginal = capturePermissionIntent();
    setAsking(true);
    try {
      const answer = permission === 'granted' ? permission : await askToNotify();
      if (version.current !== at || context.current !== forScope || !stillOriginal()) return;
      if (answer === 'granted') writes.notify(BROWSER, { enabled: true });
    } finally {
      if (version.current === at && context.current === forScope) { setAsking(false); row.current?.focus({ preventScroll: true }); }
    }
  };
  if (permission === 'granted') {
    return <Setting ref={row} tabIndex={-1} label={BROWSER} help="When Alcove is in another tab. They never show names or messages."
      onLabel={ready ? () => writes.notify(BROWSER, { enabled: !prefs.enabled }) : undefined}
      control={<Switch label={BROWSER} checked={prefs.enabled} disabled={!ready} onChange={(enabled) => writes.notify(BROWSER, { enabled })} />} />;
  }
  if (permission === 'denied') {
    return <Setting ref={row} tabIndex={-1} label={BROWSER} problem help="Blocked in this browser. Allow them for this site in its settings."
      control={<SettingFact icon="bellOff" tone="no">Blocked</SettingFact>} />;
  }
  if (permission === 'unsupported') {
    return <Setting ref={row} tabIndex={-1} label={BROWSER} help="This browser can’t show them. Alerts still show inside Alcove."
      control={<SettingFact icon="bellOff">Not available</SettingFact>} />;
  }
  return <Setting ref={row} tabIndex={-1} label={BROWSER} help="So alerts reach you when Alcove is in another tab."
    control={<Button variant="secondary" size="sm" icon="bell" loading={asking} disabled={!ready} onClick={() => void turnOn()}>Turn on</Button>} />;
}

/** How long the volume stays where it is before it's saved: a drag is saved once, where it settles. */
const SETTLE_MS = 400;
/** How long Play says it's playing: about as long as the cue. */
const PLAYING_MS = 600;

/**
 * The volume as it's dragged, saved once it settles rather than at every step. What's saved shows again once it moves on
 * from where the drag began: the change was kept or refused, or another tab changed it. Leaving mid-drag saves it too.
 */
function useSettledVolume(saved: number, write: (volume: number) => void): [number, (volume: number) => void] {
  const [draft, setDraft] = useState<{ volume: number; from: number } | null>(null);
  const pending = useRef<{ volume: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const latest = useRef(write);
  latest.current = write;
  const flush = useCallback(() => {
    const was = pending.current;
    if (!was) return;
    clearTimeout(was.timer);
    pending.current = null;
    latest.current(was.volume);
  }, []);
  useEffect(() => flush, [flush]);
  useEffect(() => { if (draft && !pending.current && saved !== draft.from) setDraft(null); }, [saved, draft]);
  const change = (volume: number) => {
    setDraft((was) => ({ volume, from: was?.from ?? saved }));
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { volume, timer: setTimeout(flush, SETTLE_MS) };
  };
  return [draft?.volume ?? saved, change];
}

/**
 * Sounds: off or on, how loud, and a short cue to hear it at that volume, on the speaker chosen for calls. Turning them off
 * keeps what each one plays, for when they're on again.
 */
function Sounds({ sounds, ready, writes, speaker }: { sounds: SoundPreferences; ready: boolean; writes: Writes; speaker: () => string | null }) {
  const [volume, setVolume] = useSettledVolume(sounds.volume, (to) => writes.sound('Sounds', { volume: to }));
  const owner = useRef({});
  const [playing, setPlaying] = useState(false);
  const stopPlaying = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heard = useRef({ sounds, volume });
  heard.current = { sounds, volume };
  useEffect(readyAudioOutput, []);
  useEffect(() => { const mine = owner.current; return () => { clearTimeout(stopPlaying.current); stopSounds(mine); }; }, []);
  const play = () => {
    clearTimeout(stopPlaying.current);
    setPlaying(true);
    stopPlaying.current = setTimeout(() => setPlaying(false), PLAYING_MS);
    // `preview` is what lets Play be heard while notifications are paused: a preview skips soundAllowed, and the pause with
    // it, so the pause it carries (none) is never read.
    playSound({
      owner: owner.current, cue: 'message', key: `preview:${crypto.randomUUID()}`, until: Date.now() + 1200, preview: true,
      current: () => ({ prefs: { ...heard.current.sounds, volume: heard.current.volume }, notificationsPauseEnd: null, speakerId: speaker() })
    });
  };
  const muted = !sounds.enabled;
  return <Setting label="Sounds" help={muted ? 'Off. What each one plays is kept for when you turn them on.' : undefined}
    control={<SoundLevel volume={volume} muted={muted} playing={playing} disabled={!ready} onVolume={setVolume}
      onMute={(off) => writes.sound('Sounds', { enabled: !off })} onPlay={play} />} />;
}

/** Quiet mode: only the cues you can't do without. Waits on sounds being on. */
function QuietMode({ sounds, ready, writes }: { sounds: SoundPreferences; ready: boolean; writes: Writes }) {
  return <SwitchSetting label="Quiet mode" help="Only your microphone and requests to join make a sound." checked={sounds.quiet}
    disabled={!ready || !sounds.enabled} onChange={(quiet) => writes.sound('Quiet mode', { quiet })} />;
}

/** What reaches you: a row per thing, its Alert and its Sound side by side. With sounds off, the Sound column steps back. */
function WhatReachesYou({ groups, notifications, sounds, ready, writes }: { groups: readonly Reaches[]; notifications: NotificationPrefs; sounds: SoundPreferences; ready: boolean; writes: Writes }) {
  const state = useSaveState();
  const change = (id: string, way: 'alert' | 'sound', on: boolean) => {
    const row = groups.flatMap((g) => g.rows).find((r) => r.id === id);
    if (!row || !ready) return;
    if (way === 'alert' && row.alert) writes.notify(row.label, alertPatch(row.alert, on));
    if (way === 'sound' && row.sound) writes.sound(row.label, soundPatch(row.sound, on));
  };
  return <AlertTable label="What reaches you" soundOff={!sounds.enabled} disabled={!ready} onChange={change}
    groups={groups.map((g) => ({ title: g.title, rows: g.rows.map((r) => ({
      id: r.id, label: r.label, note: r.note, icon: r.icon, saveState: state(r.label),
      alert: r.alert ? notifications[r.alert] : null, sound: r.sound ? sounds[r.sound] : null
    })) }))} />;
}

const BEFORE = [{ value: '1', label: '1 min' }, { value: '5', label: '5 min' }, { value: 'off', label: 'Off' }] satisfies { value: '1' | '5' | 'off'; label: string }[];

/** Notifications on Settings: the ways in one panel, What reaches you in the next. Each change is kept for the account. */
export function NotificationsGroup() {
  const prefs = useQuery(q.prefs()).data;
  const choices = useNotificationPreferences();
  const save = useSave();
  if (!prefs) return null;
  const writes: Writes = { notify: (label, patch) => save(label, { notifications: patch }), sound: (label, patch) => save(label, { sounds: patch }) };
  const n = choices.prefs;
  return (
    <SettingsGroup id="notifications" title="Notifications">
      <SettingsPanel>
        <BrowserNotifications choices={choices} writes={writes} />
        <Sounds sounds={prefs.sounds} ready writes={writes} speaker={() => readPrefs().speaker ?? null} />
        <QuietMode sounds={prefs.sounds} ready writes={writes} />
        <Setting label="Before a call starts" help="A reminder for calls you organize."
          control={<Segmented<'1' | '5' | 'off'> label="Before a call starts" value={n.beforeCall === 0 ? 'off' : n.beforeCall === 1 ? '1' : '5'} options={BEFORE}
            onChange={(value) => writes.notify('Before a call starts', { beforeCall: value === 'off' ? 0 : value === '1' ? 1 : 5 })} />} />
      </SettingsPanel>
      <SettingsPanel title="What reaches you">
        <WhatReachesYou groups={[IN_A_CALL, OUTSIDE_A_CALL]} notifications={n} sounds={prefs.sounds} ready={choices.ready} writes={writes} />
      </SettingsPanel>
    </SettingsGroup>
  );
}

/**
 * A call's own Settings (More, then Settings), on every screen: the browser's notifications, sounds and quiet mode, then what
 * reaches you in a call. Signed in, the choices are the account's, as on Settings; a guest's stay in this browser.
 */
export function CallAlertControls({ speakerId }: { speakerId: string | null }) {
  const choices = useNotificationPreferences();
  const sounds = useSoundPreferences();
  const writes: Writes = { notify: (_label, patch) => choices.update(patch), sound: (_label, patch) => sounds.update(patch) };
  return (
    <>
      <SettingsPanel>
        <BrowserNotifications choices={choices} writes={writes} />
        <Sounds sounds={sounds.prefs} ready={sounds.ready} writes={writes} speaker={() => speakerId} />
        <QuietMode sounds={sounds.prefs} ready={sounds.ready} writes={writes} />
      </SettingsPanel>
      <SettingsPanel title="What reaches you">
        <WhatReachesYou groups={[IN_A_CALL]} notifications={choices.prefs} sounds={sounds.prefs} ready={choices.ready && sounds.ready} writes={writes} />
      </SettingsPanel>
    </>
  );
}

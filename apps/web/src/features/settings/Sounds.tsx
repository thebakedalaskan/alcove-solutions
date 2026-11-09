/** Playback controls use the same preference owner in Settings, active calls and guest calls. */
import type { Preferences, SoundPreferences } from '@alcove/api';
import { Button, Select, SettingRow, SettingsPart, Switch } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { playSound, readyAudioOutput, stopSounds, type SoundCue } from '~/lib/audio-output';
import { useSoundPreferences } from '~/lib/sound-preferences';
import { useCallAlertPreference } from '~/features/call/session/alertPreferences';
import { readPrefs } from '~/features/call/media/devices';
import { Setting, SwitchSetting, useSave } from './save';

const categories: readonly { key: keyof Pick<SoundPreferences, 'mic' | 'people' | 'hands' | 'questions' | 'messages' | 'replies' | 'mentions' | 'admissions' | 'timers' | 'ringing'>; label: string; cue: SoundCue; help?: string }[] = [
  { key: 'mic', label: 'Microphone on and off', cue: 'mic-on' },
  { key: 'people', label: 'People joining and leaving', cue: 'join' },
  { key: 'hands', label: 'Raised hands', cue: 'hand', help: 'When you host or present. Hosts also hear requests for help from other rooms.' },
  { key: 'questions', label: 'New questions', cue: 'question', help: 'When you host or present, for questions in your room.' },
  { key: 'replies', label: 'Replies in conversations I follow', cue: 'reply', help: 'For replies to your messages or threads you have joined.' },
  { key: 'mentions', label: 'Mentions addressed to me', cue: 'mention', help: 'One cue for a confirmed room or private mention, including in a thread.' },
  { key: 'messages', label: 'Private messages', cue: 'message', help: 'A quiet cue without message previews.' },
  { key: 'admissions', label: 'Requests to join when I host', cue: 'admission' },
  { key: 'timers', label: 'Board timers', cue: 'timer' },
  { key: 'ringing', label: 'Incoming calls', cue: 'ring' }
];
const previews = [
  { value: 'mic-on', label: 'Microphone on' }, { value: 'mic-off', label: 'Microphone off' },
  { value: 'join', label: 'Person joins' }, { value: 'leave', label: 'Person leaves' },
  { value: 'hand', label: 'Raised hand' }, { value: 'question', label: 'New question' },
  { value: 'reply', label: 'Thread reply' },
  { value: 'mention', label: 'Mention addressed to me' },
  { value: 'message', label: 'Private message' },
  { value: 'admission', label: 'Request to join' }, { value: 'timer', label: 'Board timer' }, { value: 'ring', label: 'Incoming call' }
] satisfies { value: SoundCue; label: string }[];
function SoundPreview({ prefs, speakerId }: { prefs: SoundPreferences; speakerId: string | null }) {
  const [cue, setCue] = useState<SoundCue>('mic-on');
  const [said, setSaid] = useState(false);
  const owner = useRef({});
  const current = useRef({ prefs, speakerId });
  current.current = { prefs, speakerId };
  useEffect(readyAudioOutput, []);
  useEffect(() => () => stopSounds(owner.current), [prefs]);
  return <div className="set-line"><Select<SoundCue> label="Sound to preview" value={cue} options={previews} onChange={setCue} /><Button variant="secondary" size="sm" disabled={prefs.volume === 0} onClick={() => {
    setSaid(true);
    playSound({ owner: owner.current, cue, key: `preview:${crypto.randomUUID()}`, until: Date.now() + 1200, current: () => current.current, preview: true });
  }}>Preview sound</Button><span className="sr-only" role="status">{said ? 'Preview requested. If silent, check your browser and speaker volume.' : ''}</span></div>;
}
export function SoundsPart({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const change = (label: string, patch: Partial<SoundPreferences>) => save(label, { sounds: patch });
  return <SettingsPart id="sounds" title="Sounds">
    <SwitchSetting label="Play sounds" help="Short cues on your speaker. These work independently of browser notifications." checked={prefs.sounds.enabled} onChange={(enabled) => change('Play sounds', { enabled })} />
    <Setting label="Sound volume" control={<input aria-label="Sound volume" className="set-sound-volume" type="range" min="0" max="100" step="5" value={Math.round(prefs.sounds.volume * 100)} onChange={(e) => change('Sound volume', { volume: Number(e.currentTarget.value) / 100 })} />} />
    <SwitchSetting label="Quiet mode" help="Keep your microphone confirmations and requests to join when you host. Silence other cues." checked={prefs.sounds.quiet} onChange={(quiet) => change('Quiet mode', { quiet })} />
    <SwitchSetting label="Show reply alerts" help="A brief message with Open reply. Unread counts stay available when alerts are off." checked={prefs.notifications.replyAlerts} onChange={(replyAlerts) => save('Show reply alerts', { notifications: { replyAlerts } })} />
    <SwitchSetting label="Show mention alerts" help="A brief message with Open mention, without a content preview. Unread counts stay available when alerts are off." checked={prefs.notifications.mentionAlerts} onChange={(mentionAlerts) => save('Show mention alerts', { notifications: { mentionAlerts } })} />
    {categories.map(({ key, label, help }) => <SwitchSetting key={key} label={label} help={help} checked={prefs.sounds[key]} disabled={!prefs.sounds.enabled} onChange={(on) => change(label, { [key]: on })} />)}
    <SettingRow wide label="Listen to a sound" help="Preview plays at your sound volume, even when that category is off. If silent, check your browser and speaker volume." control={<SoundPreview prefs={prefs.sounds} speakerId={readPrefs().speaker ?? null} />} />
  </SettingsPart>;
}
/** Reachable from More on wide and phone calls, including signed-out guests. */
export function CallSoundControls({ speakerId }: { speakerId: string | null }) {
  const { prefs, update, ready } = useSoundPreferences();
  const replies = useCallAlertPreference('replyAlerts');
  const mentions = useCallAlertPreference('mentionAlerts');
  return <div className="set-parts">
    <SettingRow label="Play sounds" control={<Switch label="Play sounds" checked={prefs.enabled} disabled={!ready} onChange={(enabled) => update({ enabled })} />} />
    <SettingRow label="Quiet mode" help="Keep microphone confirmations and requests to join when you host." control={<Switch label="Quiet mode" checked={prefs.quiet} disabled={!ready} onChange={(quiet) => update({ quiet })} />} />
    <SettingRow label="Sound volume" control={<input aria-label="Sound volume" className="set-sound-volume" type="range" min="0" max="100" step="5" value={Math.round(prefs.volume * 100)} disabled={!ready} onChange={(e) => update({ volume: Number(e.currentTarget.value) / 100 })} />} />
    <SettingRow label="Show reply alerts" help="Brief on-screen alerts. Unread counts remain available." control={<Switch label="Show reply alerts" checked={replies.enabled} disabled={!replies.ready} onChange={replies.update} />} />
    <SettingRow label="Show mention alerts" help="Brief alerts with Open mention and no content preview." control={<Switch label="Show mention alerts" checked={mentions.enabled} disabled={!mentions.ready} onChange={mentions.update} />} />
    {categories.map(({ key, label, help }) => <SettingRow key={key} label={label} help={help} control={<Switch label={label} checked={prefs[key]} disabled={!ready || !prefs.enabled} onChange={(on) => update({ [key]: on })} />} />)}
    <SettingRow wide label="Listen to a sound" control={<SoundPreview prefs={prefs} speakerId={speakerId} />} />
  </div>;
}

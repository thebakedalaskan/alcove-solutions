/*
 * Settings, from More: one window for what you set up and leave, its parts as tabs down its left (a strip along its top on a
 * phone, where it's a sheet). Audio and video holds the menus the dock's arrows open (DevicePickers.tsx); Video quality, Sounds
 * and Notifications are your own, as on Settings' page; and Call, for whoever hosts, changes the call for everyone in it:
 * locking it, and (the organizer's alone) pointing at shared screens. Only one window is ever open over the call.
 */
import { errorMessage } from '@alcove/api';
import { IconButton, Modal, SettingRow, Switch, Tabs, useToast, type AvatarPerson } from '@alcove/ui';
import { useId, useState } from 'react';
import { CallNotificationControls } from '~/features/settings/Notifications';
import { CallSoundControls } from '~/features/settings/Sounds';
import { CamOptions, MicOptions } from '../media/DevicePickers';
import type { Devices } from '../media/devices';
import type { LocalMedia, MediaSnapshot } from '../media/media';
import { VideoQuality } from '../media/VideoQuality';
import type { HostControls } from './Panel';

export type SettingsTab = 'av' | 'quality' | 'sounds' | 'notifications' | 'call';

const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'av', label: 'Audio and video' },
  { value: 'quality', label: 'Video quality' },
  { value: 'sounds', label: 'Sounds' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'call', label: 'Call' }
];

/** The call's own settings, from whoever hosts it: the same controls People's host has. */
export type CallSettingsHost = Pick<HostControls, 'locked' | 'lock' | 'pointing' | 'setPointing'>;

export function CallSettings({ open, onOpenChange, tab, onTab, phone, media, m, devices, me, onSwitched, onBackground, host, organizer, backTo }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** The part that shows. Call falls back to Audio and video for anyone who doesn't host (any more). */
  tab: SettingsTab; onTab: (tab: SettingsTab) => void;
  /** A phone: the parts are a strip along the top, and the arrow keys go across it. */
  phone: boolean;
  media: LocalMedia; m: MediaSnapshot; devices: Devices;
  /** You, on your camera's preview while it's off. */
  me: AvatarPerson;
  /** Says which device it switched to, as the dock's own menus do. */
  onSwitched: { mic: (what: 'mic' | 'speaker', label: string) => void; cam: (label: string) => void };
  /** Background's window replaces Settings, so two windows never stack. */
  onBackground: () => void;
  /** Whoever hosts has Call; everyone else has no such part. */
  host: CallSettingsHost | null;
  /** Pointing is the organizer's to turn on or off, so someone hosting while they're away has Lock the call alone. */
  organizer: boolean;
  /** Where the keys go as it closes: More, which it opened from, has gone by then. */
  backTo: () => HTMLElement | null;
}) {
  const id = useId();
  const tabs = host ? TABS : TABS.filter((t) => t.value !== 'call');
  const shown = tabs.some((t) => t.value === tab) ? tab : 'av';
  const label = tabs.find((t) => t.value === shown)?.label ?? 'Audio and video';
  const onCloseFocus = () => { const to = backTo(); to?.focus({ preventScroll: true }); return to !== null; };
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Settings" className="ic-set" onCloseFocus={onCloseFocus}>
      <div className="ic-set-in">
        <div className="ic-set-side">
          <h2 className="ic-set-h">Settings</h2>
          {/* Down the parts (across them on a phone), each showing as the keys reach it. */}
          <Tabs className="ic-set-nav" label="Settings" options={tabs} value={shown} onChange={onTab} vertical={!phone} id={id} panel={`${id}-pane`} />
        </div>
        <section id={`${id}-pane`} className="ic-set-pane" role="tabpanel" aria-labelledby={`${id}-${shown}`}>
          <h3 className="ic-set-ph">{label}</h3>
          {shown === 'av' ? (
            <>
              <MicOptions media={media} m={m} devices={devices} live={open} onSwitched={onSwitched.mic} />
              <div className="ic-msep" />
              <CamOptions media={media} m={m} devices={devices} me={me} onBackground={onBackground} onSwitched={onSwitched.cam} />
            </>
          ) : shown === 'quality' ? <VideoQuality media={media} m={m} />
            : shown === 'sounds' ? <CallSoundControls speakerId={m.speakerId} />
              : shown === 'notifications' ? <CallNotificationControls />
                : host && <HostSettings host={host} organizer={organizer} />}
        </section>
        <IconButton icon="x" label="Close settings" className="ic-set-x" onClick={() => onOpenChange(false)} />
      </div>
    </Modal>
  );
}

/** Call: what whoever hosts changes for everyone here. Each switch moves once the call has taken it. */
function HostSettings({ host, organizer }: { host: CallSettingsHost; organizer: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'lock' | 'pointing' | null>(null);
  const failed = (e: unknown) => toast(errorMessage(e), { icon: 'x' });
  const lock = (on: boolean) => {
    setBusy('lock');
    host.lock(on).then(() => toast(on ? 'The call is locked. Nobody new can join.' : 'The call is unlocked', { icon: 'lock' }), failed).finally(() => setBusy(null));
  };
  // Everyone here is told, the organizer too, as the call says it.
  const point = (on: boolean) => { setBusy('pointing'); host.setPointing(on).catch(failed).finally(() => setBusy(null)); };
  return (
    <div className="set-parts">
      <SettingRow label="Lock the call" help="Nobody new can ask to join, and anyone who leaves can’t come back."
        control={<Switch checked={host.locked} label="Lock the call" disabled={busy === 'lock'} onChange={lock} />} />
      {organizer && (
        <SettingRow label="Pointing at shared screens" help="Anyone here can point and mark, unless whoever shares says only they can."
          control={<Switch checked={host.pointing} label="Pointing at shared screens" disabled={busy === 'pointing'} onChange={point} />} />
      )}
    </div>
  );
}

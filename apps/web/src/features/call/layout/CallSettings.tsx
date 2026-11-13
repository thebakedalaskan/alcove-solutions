/*
 * Settings, from More: one window for what you set up and leave, its parts as tabs down its left (a strip along its top on a
 * phone, where it's a sheet). Audio and video holds the menus the dock's arrows open (DevicePickers.tsx); Video quality and
 * Notifications (the browser's, sounds, quiet mode and what reaches you in a call) are your own, from the same pieces as
 * Settings' page; and Call, for whoever hosts, changes the call for everyone in it: locking it, and (the organizer's alone)
 * pointing at shared screens. Only one window is ever open over the call.
 */
import { errorMessage } from '@alcove/api';
import { IconButton, Modal, SettingRow, Switch, Tabs, useToast, type AvatarPerson } from '@alcove/ui';
import { useId, useState, type RefObject } from 'react';
import { CallAlertControls } from '~/features/notifications/Controls';
import { ChooseBackground } from '../media/backgrounds/ChooseBackground';
import { CamOptions, MicOptions } from '../media/DevicePickers';
import type { Devices } from '../media/devices';
import type { LocalMedia, MediaSnapshot } from '../media/media';
import { VideoQuality } from '../media/VideoQuality';
import type { HostControls } from './Panel';

export type SettingsTab = 'av' | 'quality' | 'notifications' | 'call';

const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'av', label: 'Audio and video' },
  { value: 'quality', label: 'Video quality' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'call', label: 'Call' }
];

/** The call's own settings, from whoever hosts it: the same controls People's host has. */
export type CallSettingsHost = Pick<HostControls, 'locked' | 'lock' | 'pointing' | 'setPointing'>;

/**
 * The windows over the call: Settings, from More, open on the part you last had, and Background, from the camera's menu or
 * Settings. One at a time: what one opens from closes as it opens, and both go under Leave's question or once the call's over.
 */
export function useCallWindows() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('av');
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  return { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab, backgroundOpen, setBackgroundOpen, closeAll: () => { setSettingsOpen(false); setBackgroundOpen(false); } };
}
export type CallWindowsState = ReturnType<typeof useCallWindows>;

/** Settings and Background, each handing focus back to what opened it in the dock (`dock`) as it closes. */
export function CallWindows({ windows, phone, media, m, devices, me, host, organizer, dock }: {
  windows: CallWindowsState;
  phone: boolean;
  media: LocalMedia; m: MediaSnapshot; devices: Devices;
  me: AvatarPerson;
  host: CallSettingsHost | null;
  organizer: boolean;
  dock: RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  /** Which device it switched to, from Settings as from the dock's own menus. */
  const switched = {
    mic: (what: 'mic' | 'speaker', label: string) => { toast(`Switched to ${label}`, { icon: what === 'mic' ? 'mic' : 'speaker' }); },
    cam: (label: string) => { toast(`Switched to ${label}`, { icon: 'video' }); }
  };
  return (
    <>
      <CallSettings open={windows.settingsOpen} onOpenChange={windows.setSettingsOpen} tab={windows.settingsTab} onTab={windows.setSettingsTab} phone={phone} media={media} m={m} devices={devices} me={me}
        onSwitched={switched} host={host} organizer={organizer} onBackground={() => { windows.setSettingsOpen(false); windows.setBackgroundOpen(true); }}
        backTo={() => dock.current?.querySelector<HTMLElement>('[data-more]') ?? null} />
      <ChooseBackground media={media} m={m} me={me} open={windows.backgroundOpen} onOpenChange={windows.setBackgroundOpen}
        backTo={() => [...(dock.current?.querySelectorAll<HTMLElement>('[data-cam-menu], [data-more]') ?? [])].find((el) => el.getClientRects().length > 0) ?? null} />
    </>
  );
}

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
            : shown === 'notifications' ? <CallAlertControls speakerId={m.speakerId} />
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
    <div className="set-groups">
      <SettingRow label="Lock the call" help="Nobody new can ask to join, and anyone who leaves can’t come back."
        control={<Switch checked={host.locked} label="Lock the call" disabled={busy === 'lock'} onChange={lock} />} />
      {organizer && (
        <SettingRow label="Pointing at shared screens" help="Anyone here can point and mark, unless whoever shares says only they can."
          control={<Switch checked={host.pointing} label="Pointing at shared screens" disabled={busy === 'pointing'} onChange={point} />} />
      )}
    </div>
  );
}

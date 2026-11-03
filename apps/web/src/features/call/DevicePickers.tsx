/* Choosing a microphone, camera and speaker: on the pre-join screen, and from the call's controls. */
import { Icon, Popover, cn, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { TEST_SECONDS, testMicrophone, type Device, type DeviceKind, type Devices, type TestPhase } from './devices';
import type { LocalMedia, MediaSnapshot } from './media';

const NAME: Record<DeviceKind, string> = { mic: 'Microphone', cam: 'Camera', speaker: 'Speaker' };
const ICON: Record<DeviceKind, IconName> = { mic: 'mic', cam: 'video', speaker: 'speaker' };

/** The device in use, else the first one listed (the browser's default comes first). */
const current = (devices: Device[], id: string | null) => (id && devices.some((d) => d.id === id) ? id : devices[0]?.id ?? '');

/** A compact picker for one kind of device. Hidden when there's nothing to choose between. */
export function DeviceSelect({ kind, devices, value, onChange }: { kind: DeviceKind; devices: Device[]; value: string | null; onChange: (id: string) => void }) {
  if (!devices.length) return null;
  return (
    <label className="dev-pick" title={NAME[kind]}>
      <Icon name={ICON[kind]} size={16} />
      <select aria-label={NAME[kind]} value={current(devices, value)} onChange={(e) => onChange(e.target.value)}>
        {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <Icon name="down" size={14} className="dev-caret" />
    </label>
  );
}

/** The pre-join row: pick devices, and hear yourself back before anyone else does. */
export function PrejoinDevices({ media, m, devices }: { media: LocalMedia; m: MediaSnapshot; devices: Devices }) {
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [left, setLeft] = useState(TEST_SECONDS);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const track = media.micTrack();
  const test = async () => {
    if (!track || phase !== 'idle') return;
    setLeft(TEST_SECONDS);
    timer.current = setInterval(() => setLeft((n) => Math.max(1, n - 1)), 1000);
    try {
      await testMicrophone(track, m.speakerId ?? undefined, (p) => { setPhase(p); if (p !== 'listening' && timer.current) { clearInterval(timer.current); timer.current = null; } });
    } finally {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }
  };
  return (
    <div className="pj-devices">
      <DeviceSelect kind="mic" devices={devices.mic} value={m.micId} onChange={(id) => void media.chooseMic(id)} />
      <DeviceSelect kind="cam" devices={devices.cam} value={m.camId} onChange={(id) => void media.chooseCam(id)} />
      <DeviceSelect kind="speaker" devices={devices.speaker} value={m.speakerId} onChange={(id) => media.chooseSpeaker(id)} />
      <button type="button" className={cn('pj-test', phase !== 'idle' && 'on')} disabled={!track || !m.mic || phase !== 'idle'}
        title={m.mic ? 'Records a few seconds and plays them back here. Nothing is uploaded or kept.' : 'Turn your microphone on to test it'} onClick={() => void test()}>
        {phase === 'listening' ? <><i className="rec-dot" />Say something… {left}</> : phase === 'playing' ? <><Icon name="speaker" size={15} />Playing it back</> : <><Icon name="mic" size={15} />Test microphone</>}
      </button>
      {phase !== 'idle' && <p className="pj-dev-note"><Icon name="lock" size={13} />It plays back here only. Nothing is uploaded or kept.</p>}
      {m.notice && <p className="pj-dev-note warn"><Icon name="clock" size={13} />{m.notice}</p>}
    </div>
  );
}

/** The little arrow on the call's microphone and camera buttons: which device, and (for sound) which speaker. */
export function DeviceMenu({ kind, media, m, devices, open, onOpenChange }: {
  kind: 'mic' | 'cam'; media: LocalMedia; m: MediaSnapshot; devices: Devices; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const own = kind === 'mic' ? devices.mic : devices.cam;
  const chosen = current(own, kind === 'mic' ? m.micId : m.camId);
  const pick = (id: string) => { onOpenChange(false); void (kind === 'mic' ? media.chooseMic(id) : media.chooseCam(id)); };
  const speaker = current(devices.speaker, m.speakerId);
  const item = (d: Device, on: boolean, choose: (id: string) => void) => (
    <button key={d.id} type="button" className={cn('pop-item dev-item', on && 'sel')} role="menuitemradio" aria-checked={on} onClick={() => choose(d.id)}>
      {on ? <Icon name="check" size={16} /> : <span />}<span><b>{d.label}</b></span>
    </button>
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="start" dark label={kind === 'mic' ? 'Microphone and speaker' : 'Camera'} className="dev-pop"
      anchor={<button type="button" className="rb-caret" aria-label={kind === 'mic' ? 'Choose a microphone' : 'Choose a camera'}><Icon name="down" size={12} /></button>}>
      <div className="dev-h">{NAME[kind]}</div>
      {own.length ? own.map((d) => item(d, d.id === chosen, pick)) : <p className="dev-none">No {NAME[kind].toLowerCase()} found.</p>}
      {kind === 'mic' && devices.speaker.length > 0 && (
        <>
          <div className="pop-sep" />
          <div className="dev-h">Speaker</div>
          {devices.speaker.map((d) => item(d, d.id === speaker, (id) => { onOpenChange(false); media.chooseSpeaker(id); }))}
        </>
      )}
    </Popover>
  );
}

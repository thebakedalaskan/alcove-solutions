/* Choosing a microphone, camera and speaker: on the pre-join screen, and from the call's controls. */
import { CallTile, DockChevron, Icon, Popover, Switch, cn, type AvatarPerson, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEST_SECONDS, testMicrophone, type Device, type DeviceKind, type Devices, type TestPhase } from './devices';
import type { LocalMedia, MediaSnapshot } from './media';
import { Video, useLevels } from './Video';

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
        {phase === 'listening' ? <><i className="ac-rec-dot" />Say something… {left}</> : phase === 'playing' ? <><Icon name="speaker" size={15} />Playing it back</> : <><Icon name="mic" size={15} />Test microphone</>}
      </button>
      {phase !== 'idle' && <p className="pj-dev-note"><Icon name="lock" size={13} />It plays back here only. Nothing is uploaded or kept.</p>}
      {m.notice && <p className="pj-dev-note warn"><Icon name="clock" size={13} />{m.notice}</p>}
    </div>
  );
}

const bars = (l: number, i: number) => Math.max(18, Math.min(100, 18 + l * 120 * (0.6 + ((i * 37) % 10) / 20)));

/** The real microphone level, as three bars beside the microphone in use. */
function Level({ media, live }: { media: LocalMedia; live: boolean }) {
  const h = useLevels(media, 3, live, bars);
  return <span className="ic-meter" aria-hidden="true">{h.map((x, i) => <i key={i} style={{ height: `${x}%` }} />)}</span>;
}

function Option({ on, label, onPick, extra }: { on: boolean; label: string; onPick: () => void; extra?: ReactNode }) {
  return (
    <button type="button" className="ic-opt" role="menuitemradio" aria-checked={on} onClick={onPick}>
      <span className="nm">{label}</span>{extra}<Icon name="check" size={16} className="tick" />
    </button>
  );
}

interface MicProps { media: LocalMedia; m: MediaSnapshot; devices: Devices; live: boolean; onSwitched: (what: 'mic' | 'speaker', label: string) => void }

/** Which microphone, which speaker, a test sound, and noise reduction. */
export function MicOptions({ media, m, devices, live, onSwitched }: MicProps) {
  const mic = current(devices.mic, m.micId);
  const speaker = current(devices.speaker, m.speakerId);
  const [playing, setPlaying] = useState(false);
  const speakerName = devices.speaker.find((d) => d.id === speaker)?.label ?? 'your speaker';
  const test = async () => { setPlaying(true); try { await media.playTestSound(); } finally { setPlaying(false); } };
  return (
    <>
      <div className="ac-eyebrow">Microphone</div>
      {devices.mic.length ? devices.mic.map((d) => (
        <Option key={d.id} on={d.id === mic} label={d.label} extra={d.id === mic ? <Level media={media} live={live && m.mic} /> : undefined}
          onPick={() => { if (d.id !== mic) { void media.chooseMic(d.id); onSwitched('mic', d.label); } }} />
      )) : <p className="ic-none">No microphone found.</p>}
      <div className="ac-eyebrow mt">Speaker</div>
      {devices.speaker.length ? devices.speaker.map((d) => (
        <Option key={d.id} on={d.id === speaker} label={d.label} onPick={() => { if (d.id !== speaker) { media.chooseSpeaker(d.id); onSwitched('speaker', d.label); } }} />
      )) : <p className="ic-none">Sound plays through the speaker your system uses.</p>}
      <div className="ic-srow">
        <button type="button" className="ac-btn is-quiet is-sm" disabled={playing} onClick={() => void test()}>
          {playing ? <><span className="ac-level" aria-hidden="true"><i /><i /><i /></span><span>Playing on {speakerName}</span></> : <><Icon name="speaker" size={16} /><span>Play test sound</span></>}
        </button>
      </div>
      <div className="ic-msep" />
      <div className="ic-srow"><span>Noise reduction</span><Switch className="end" checked={m.noiseReduction} label="Noise reduction" onChange={(on) => void media.setNoiseReduction(on)} /></div>
    </>
  );
}

/** The microphone's menu, from the chevron beside it. */
export function MicMenu({ open, onOpenChange, ...rest }: Omit<MicProps, 'live'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="start" label="Microphone and speaker" className="ic-dmenu"
      anchor={<DockChevron label="Microphone and speaker" on={open} />}>
      <MicOptions {...rest} live={open} />
    </Popover>
  );
}

interface CamProps { media: LocalMedia; m: MediaSnapshot; devices: Devices; me: AvatarPerson; preview?: boolean; onSwitched: (label: string) => void }

/** Your own preview, which camera, and background blur where the browser can do it. */
export function CamOptions({ media, m, devices, me, preview = true, onSwitched }: CamProps) {
  const cam = current(devices.cam, m.camId);
  return (
    <>
      {preview && (
        <div className="ic-cprev">
          <CallTile person={me} name="Your camera">{m.cam && m.camera ? <Video stream={m.camera} /> : undefined}</CallTile>
        </div>
      )}
      <div className={cn('ac-eyebrow', preview && 'mt')}>Camera</div>
      {devices.cam.length ? devices.cam.map((d) => (
        <Option key={d.id} on={d.id === cam} label={d.label} onPick={() => { if (d.id !== cam) { void media.chooseCam(d.id); onSwitched(d.label); } }} />
      )) : <p className="ic-none">No camera found.</p>}
      {m.canBlur && (
        <>
          <div className="ic-msep" />
          <div className="ic-srow"><span>Blur my background</span><Switch className="end" checked={m.blur} label="Blur my background" onChange={(on) => void media.setBlur(on)} /></div>
        </>
      )}
    </>
  );
}

/** The camera's menu, from the chevron beside it. */
export function CamMenu({ open, onOpenChange, ...rest }: CamProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="start" label="Camera" className="ic-dmenu"
      anchor={<DockChevron label="Camera and background" on={open} />}>
      <CamOptions {...rest} />
    </Popover>
  );
}

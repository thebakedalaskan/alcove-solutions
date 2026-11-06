/*
 * Choosing a microphone, camera and speaker: on the pre-join screen, and from the call's controls. Each says what it's
 * using and, when one isn't working, what's wrong and how to fix it, without keeping anyone from joining.
 */
import { Button, CallTile, DockChevron, Icon, Notice, Popover, Spinner, Switch, Tooltip, cn, type AvatarPerson, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { stateOf, troubles, type Trouble } from './access';
import { BackgroundOptions } from './BackgroundOptions';
import { TEST_SECONDS, canChooseSpeaker, testMicrophone, type Capture, type Device, type DeviceKind, type Devices, type TestPhase } from './devices';
import type { LocalMedia, MediaSnapshot } from './media';
import { Video, useLevels } from './Video';

const NAME: Record<DeviceKind, string> = { mic: 'Microphone', cam: 'Camera', speaker: 'Speaker' };
const ICON: Record<DeviceKind, IconName> = { mic: 'mic', cam: 'video', speaker: 'speaker' };
const OFF: Record<Capture, IconName> = { mic: 'micOff', cam: 'videoOff' };
const SYSTEM_SPEAKER = 'This browser plays calls through the speaker your system uses. Change it in your computer’s sound settings.';

/** The device in use, else the first one listed (the browser's default comes first). */
const current = (devices: Device[], id: string | null) => (id && devices.some((d) => d.id === id) ? id : devices[0]?.id ?? '');

const bars = (l: number, i: number) => Math.max(34, Math.min(100, 34 + l * 110 * (0.6 + ((i * 37) % 10) / 20)));
/** The real microphone level, as three bars beside the microphone in use. */
function Level({ media, live }: { media: LocalMedia; live: boolean }) {
  const h = useLevels(media, 3, live, bars);
  return <span className={cn('ic-meter', !live && 'is-quiet')} aria-hidden="true">{h.map((x, i) => <i key={i} style={{ height: `${x}%` }} />)}</span>;
}

/** Up and Down move between a menu's choices, Home and End to the first and last; Tab still leaves the menu. */
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('ic-opt')) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('.ic-opt')];
  const at = all.indexOf(e.target);
  const to = e.key === 'ArrowDown' ? all[at + 1] : e.key === 'ArrowUp' ? all[at - 1] : e.key === 'Home' ? all[0] : e.key === 'End' ? all.at(-1) : undefined;
  if (!to) return;
  e.preventDefault();
  to.focus();
}

/** A compact picker for one kind of device, with the microphone's level beside it. Hidden when there's nothing to choose between. */
export function DeviceSelect({ kind, devices, value, onChange, meter }: { kind: DeviceKind; devices: Device[]; value: string | null; onChange: (id: string) => void; meter?: ReactNode }) {
  if (!devices.length) return null;
  return (
    <label className="dev-pick" title={NAME[kind]}>
      <Icon name={ICON[kind]} size={16} />
      {meter}
      <select aria-label={NAME[kind]} value={current(devices, value)} onChange={(e) => onChange(e.target.value)}>
        {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <Icon name="down" size={14} className="dev-caret" />
    </label>
  );
}

/** In place of a picker: a device that isn't working, in two or three words. The panel below says why. */
function DeviceState({ kind, text }: { kind: Capture; text: string }) {
  return <span className="dev-pick is-state"><Icon name={OFF[kind]} size={16} />{text}</span>;
}

/** Where the browser can't choose a speaker: what plays where, and where to change it. */
function SystemSpeaker() {
  return (
    <Tooltip label={SYSTEM_SPEAKER}>
      <span className="dev-pick is-static" tabIndex={0} aria-label={SYSTEM_SPEAKER}><Icon name="speaker" size={16} />System speaker</span>
    </Tooltip>
  );
}

/** Before joining: what isn't working, how to fix it, and that joining works anyway. */
function PrejoinTrouble({ list, onRetry }: { list: Trouble[]; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const several = list.reduce((n, t) => n + t.kinds.length, 0) > 1;
  const retry = async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } };
  return (
    <div className="pj-trouble" role="status">
      {list.map((t) => (
        <div key={t.problem} className="row">
          <Icon name={t.kinds.length > 1 ? 'videoOff' : OFF[t.kinds[0] ?? 'mic']} size={17} />
          <div><b>{t.title}</b>{t.how && <p>{t.how}</p>}</div>
        </div>
      ))}
      <div className="foot">
        <span>You can still join, and turn {several ? 'them' : 'it'} on later.</span>
        {list.some((t) => t.retry) && (
          <button type="button" className="pj-test" disabled={busy} onClick={() => void retry()}>{busy ? <Spinner /> : <Icon name="retry" size={15} />}Try again</button>
        )}
      </div>
    </div>
  );
}

/** The pre-join row: pick devices, see the microphone's level, and hear yourself back before anyone else does. */
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
  const list = troubles(m);
  const said = m.changes.at(-1);
  const mic = m.access.mic.problem;
  const cam = m.access.cam.problem;
  return (
    <div className="pj-devices">
      {mic ? <DeviceState kind="mic" text={stateOf('mic', mic)} />
        : <DeviceSelect kind="mic" devices={devices.mic} value={m.micId} onChange={(id) => void media.chooseMic(id)} meter={<Level media={media} live={m.mic} />} />}
      {cam ? <DeviceState kind="cam" text={stateOf('cam', cam)} /> : <DeviceSelect kind="cam" devices={devices.cam} value={m.camId} onChange={(id) => void media.chooseCam(id)} />}
      {canChooseSpeaker() ? <DeviceSelect kind="speaker" devices={devices.speaker} value={m.speakerId} onChange={(id) => media.chooseSpeaker(id)} /> : <SystemSpeaker />}
      {m.canBackground && <PrejoinBackground media={media} m={m} />}
      <button type="button" className={cn('pj-test', phase !== 'idle' && 'on')} disabled={!track || !m.mic || phase !== 'idle'}
        title={!track ? 'Your microphone isn’t working yet' : m.mic ? 'Records a few seconds and plays them back here. Nothing is uploaded or kept.' : 'Turn your microphone on to test it'} onClick={() => void test()}>
        {phase === 'listening' ? <><i className="ac-rec-dot" />Say something… {left}</> : phase === 'playing' ? <><Icon name="speaker" size={15} />Playing it back</> : <><Icon name="mic" size={15} />Test microphone</>}
      </button>
      {phase !== 'idle' && <p className="pj-dev-note"><Icon name="lock" size={13} />It plays back here only. Nothing is uploaded or kept.</p>}
      {said && !list.length && <p className="pj-dev-note" aria-live="polite"><Icon name={ICON[said.kind]} size={13} />{said.text}</p>}
      {list.length > 0 && <PrejoinTrouble list={list} onRetry={() => media.retry()} />}
    </div>
  );
}

/** Before joining: what shows behind you, chosen before anyone sees you. */
function PrejoinBackground({ media, m }: { media: LocalMedia; m: MediaSnapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} side="top" align="start" label="Background" className="ic-dmenu"
      anchor={<button type="button" className={cn('pj-test', open && 'is-open')} aria-haspopup="dialog"><Icon name="image" size={15} />Background</button>}>
      <div className="ac-eyebrow">Background</div>
      <BackgroundOptions media={media} m={m} />
    </Popover>
  );
}

function Option({ on, label, onPick, extra }: { on: boolean; label: string; onPick: () => void; extra?: ReactNode }) {
  return (
    <button type="button" className="ic-opt" role="menuitemradio" aria-checked={on} onClick={onPick}>
      <span className="nm">{label}</span>{extra}<Icon name="check" size={16} className="tick" />
    </button>
  );
}

/** In a device menu: what isn't working, how to fix it, and the one thing to press. */
function MenuTrouble({ trouble, action }: { trouble: Trouble; action: { label: string; run: () => Promise<unknown> } | null }) {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  return (
    <Notice tone="caution" icon={OFF[trouble.kinds[0] ?? 'mic']} className="ic-dtrouble">
      <b>{trouble.title}</b>
      {trouble.how && <p>{trouble.how}</p>}
      {action && <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(action.run)}>{action.label}</Button>}
    </Notice>
  );
}

interface MicProps { media: LocalMedia; m: MediaSnapshot; devices: Devices; live: boolean; onSwitched: (what: 'mic' | 'speaker', label: string) => void }

/** Which microphone (and how loud it's hearing you), which speaker, a test sound, and noise reduction. */
export function MicOptions({ media, m, devices, live, onSwitched }: MicProps) {
  const mic = current(devices.mic, m.micId);
  const speaker = current(devices.speaker, m.speakerId);
  const [playing, setPlaying] = useState(false);
  const speakerName = devices.speaker.find((d) => d.id === speaker)?.label ?? 'your speaker';
  const test = async () => { setPlaying(true); try { await media.playTestSound(); } finally { setPlaying(false); } };
  const trouble = troubles(m, ['mic'])[0];
  return (
    <div onKeyDown={arrows}>
      {trouble && <MenuTrouble trouble={trouble} action={trouble.retry ? { label: 'Try again', run: () => media.retry() } : null} />}
      {(devices.mic.length > 0 || !trouble) && <div className="ac-eyebrow">Microphone</div>}
      {devices.mic.length ? devices.mic.map((d) => (
        <Option key={d.id} on={d.id === mic} label={d.label} extra={d.id === mic && !trouble ? <Level media={media} live={live && m.mic} /> : undefined}
          onPick={() => { if (d.id !== mic) void media.chooseMic(d.id).then((ok) => { if (ok) onSwitched('mic', d.label); }); }} />
      )) : !trouble && <p className="ic-none">No microphone found.</p>}
      <div className="ac-eyebrow mt">Speaker</div>
      {canChooseSpeaker() && devices.speaker.length ? devices.speaker.map((d) => (
        <Option key={d.id} on={d.id === speaker} label={d.label} onPick={() => { if (d.id !== speaker) { media.chooseSpeaker(d.id); onSwitched('speaker', d.label); } }} />
      )) : <p className="ic-none">{canChooseSpeaker() ? 'Sound plays through the speaker your system uses.' : SYSTEM_SPEAKER}</p>}
      <div className="ic-srow">
        <button type="button" className="ac-btn is-quiet is-sm" disabled={playing} onClick={() => void test()}>
          {playing ? <><span className="ac-level" aria-hidden="true"><i /><i /><i /></span><span>Playing on {speakerName}</span></> : <><Icon name="speaker" size={16} /><span>Play test sound</span></>}
        </button>
      </div>
      <div className="ic-msep" />
      <div className="ic-srow"><span>Noise reduction</span><Switch className="end" checked={m.noiseReduction} label="Noise reduction" onChange={(on) => void media.setNoiseReduction(on)} /></div>
    </div>
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

/** Your own preview, which camera, and what shows behind you where the browser can draw it. */
export function CamOptions({ media, m, devices, me, preview = true, onSwitched }: CamProps) {
  const cam = current(devices.cam, m.camId);
  const trouble = troubles(m, ['cam'])[0];
  return (
    <div onKeyDown={arrows}>
      {trouble && <MenuTrouble trouble={trouble} action={trouble.retry ? { label: 'Turn camera on', run: () => media.setCam(true) } : null} />}
      {preview && (
        <div className="ic-cprev">
          <CallTile person={me} name="Your camera">{m.cam && m.camera ? <Video stream={m.camera} /> : undefined}</CallTile>
        </div>
      )}
      {(devices.cam.length > 0 || !trouble) && <div className={cn('ac-eyebrow', (preview || trouble) && 'mt')}>Camera</div>}
      {devices.cam.length ? devices.cam.map((d) => (
        <Option key={d.id} on={d.id === cam} label={d.label} onPick={() => { if (d.id !== cam) void media.chooseCam(d.id).then((ok) => { if (ok) onSwitched(d.label); }); }} />
      )) : !trouble && <p className="ic-none">No camera found.</p>}
      {m.canBackground && (
        <>
          <div className="ic-msep" />
          <div className="ac-eyebrow">Background</div>
          <BackgroundOptions media={media} m={m} />
        </>
      )}
    </div>
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

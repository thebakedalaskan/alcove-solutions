/*
 * Choosing a microphone, camera and speaker, each from a menu in the call's own style: before joining, a calm picker for
 * each (the microphone's level beside it, and a line under it when something changed by itself), and in the call, from the
 * arrows beside the microphone and camera and in Settings › Audio and video. Before joining, the microphone's menu tests it;
 * in the call it doesn't, as the microphone is live there (heard by everyone, and by the notes). The speaker's plays a sound,
 * so it's checked where it's chosen; the camera's menu in the call opens Background. Each says what it's using and, when one
 * isn't working, what's wrong and how to fix it, without keeping anyone from joining.
 */
import { Button, CallTile, DockChevron, Icon, Notice, Popover, Switch, backgroundLabel, cn, type AvatarPerson, type IconName } from '@alcove/ui';
import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLive } from '~/lib/live';
import { stateOf, troubles, type Trouble } from './access';
import { ChooseBackground } from './backgrounds/ChooseBackground';
import { SYSTEM_DEVICE, TEST_SECONDS, canChooseSpeaker, deviceChoices, micTestOf, type Capture, type Device, type DeviceKind, type DeviceRow, type Devices } from './devices';
import type { LocalMedia, MediaSnapshot } from './media';
import { Video, useLevels } from './Video';

const NAME: Record<DeviceKind, string> = { mic: 'Microphone', cam: 'Camera', speaker: 'Speaker' };
const ICON: Record<DeviceKind, IconName> = { mic: 'mic', cam: 'video', speaker: 'speaker' };
const OFF: Record<Capture, IconName> = { mic: 'micOff', cam: 'videoOff' };
const SYSTEM_SPEAKER = 'This browser plays calls through the speaker your system uses. Change it in your computer’s sound settings.';

/** The name of the device in use: the one the system uses while that's what's in use. */
const inUse = (devices: Device[], id: string | null): string => {
  const { rows, on } = deviceChoices(devices, id);
  return rows.find((r) => r.id === on)?.name ?? '';
};
/** What a device is, from its name where that says (headphones, a phone), else what kind it is. */
function iconOf(kind: DeviceKind, name: string): IconName {
  if (kind !== 'cam' && /airpods|headphone|headset|earbud|earphone|\bbuds\b/i.test(name)) return 'listening';
  // A whole word: a microphone isn't a phone.
  if (/\b(i?phone|continuity)\b/i.test(name)) return 'phone';
  return ICON[kind];
}
const clock = (s: number) => `0:${String(s).padStart(2, '0')}`;

const bars = (l: number, i: number) => Math.max(34, Math.min(100, 34 + l * 110 * (0.6 + ((i * 37) % 10) / 20)));
/** The real microphone level, as three bars beside the microphone in use. */
function Level({ media, live }: { media: LocalMedia; live: boolean }) {
  const h = useLevels(media, 3, live, bars);
  return <span className={cn('ic-meter', !live && 'is-quiet')} aria-hidden="true">{h.map((x, i) => <i key={i} style={{ height: `${x}%` }} />)}</span>;
}

/** Up and Down move between a menu's rows, Home and End to the first and last; Tab still leaves the menu. */
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('ic-opt')) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('.ic-opt')];
  const at = all.indexOf(e.target);
  const to = e.key === 'ArrowDown' ? all[at + 1] : e.key === 'ArrowUp' ? all[at - 1] : e.key === 'Home' ? all[0] : e.key === 'End' ? all.at(-1) : undefined;
  if (!to) return;
  e.preventDefault();
  to.focus();
}

/**
 * A device menu's body. As a menu opens, the device in use has the focus (the first menu's, where one sheet holds two), and
 * the menu keeps that focus rather than moving it to the first row. In a window (a Modal) the window says where focus
 * starts: focus moved before its trap is in place could leave it.
 */
function Choices({ children }: { children: ReactNode }) {
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || el.closest('.ac-modal') || document.activeElement?.closest('.ic-devs')) return;
    el.querySelector<HTMLElement>('.ic-opt[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} className="ic-devs" onKeyDown={arrows}>{children}</div>;
}

/** One device in a menu: what it is, its name, that it's the system's choice where it is, and a tick on the one in use. */
function Option({ kind, row, on, onPick, extra }: { kind: DeviceKind; row: DeviceRow; on: boolean; onPick: () => void; extra?: ReactNode }) {
  return (
    <button type="button" className="ic-opt" role="menuitemradio" aria-checked={on} aria-label={row.system ? `${row.name}, your system’s choice` : undefined} onClick={onPick}>
      <Icon name={iconOf(kind, row.name)} size={16} className="lead" />
      <span className="nm">{row.name}{row.system && <small>Your system’s choice</small>}</span>{extra}<Icon name="check" size={16} className="tick" />
    </button>
  );
}

/**
 * One kind of device, in a group named for it: each device once (deviceChoices), the one in use ticked with `extra` beside
 * it, and while one is pinned, Follow your system last. Picking the one in use again does nothing. `onPick` gets what
 * was picked and the name of the device it uses.
 */
function DeviceList({ kind, devices, using, onPick, extra }: { kind: DeviceKind; devices: Device[]; using: string | null; onPick: (id: string, name: string) => void; extra?: ReactNode }) {
  const { rows, on, follow } = deviceChoices(devices, using);
  const system = rows.find((r) => r.system);
  return (
    <div role="group" aria-label={NAME[kind]}>
      {rows.map((r) => <Option key={r.id} kind={kind} row={r} on={r.id === on} extra={r.id === on ? extra : undefined} onPick={() => { if (r.id !== on) onPick(r.id, r.name); }} />)}
      {follow && (
        <button type="button" className="ic-opt" role="menuitemradio" aria-checked={false} onClick={() => onPick(SYSTEM_DEVICE, system?.name ?? 'your system’s choice')}>
          <Icon name="laptop" size={16} className="lead" /><span className="nm">Follow your system</span><Icon name="check" size={16} className="tick" />
        </button>
      )}
    </div>
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

/**
 * Test your microphone, under the microphones before joining: it listens for three seconds (its level and the seconds left
 * beside it, a bar filling under it), then plays them back through the speaker chosen. Nothing is uploaded or kept, which is
 * true only before joining: in the call the microphone is live. The row stays where it is throughout, so the keys stay where
 * they were.
 */
function MicTest({ media, m }: { media: LocalMedia; m: MediaSnapshot }) {
  const test = micTestOf(media);
  const t = useLive(test);
  const track = media.micTrack();
  const why = !track ? 'Your microphone isn’t working yet' : !m.mic ? 'Turn your microphone on to test it' : null;
  const busy = t.phase !== 'idle';
  const run = () => { if (track && !why && !busy) void test.run(track, m.speakerId ?? undefined); };
  return (
    <div className={cn('ic-test', busy && 'is-on')}>
      <button type="button" className="ic-opt" aria-disabled={why !== null || busy} onClick={run}>
        {t.phase === 'listening' ? <Level media={media} live /> : <Icon name={t.phase === 'playing' ? 'speaker' : 'waveform'} size={16} className="lead" />}
        <span className="nm">{t.phase === 'listening' ? 'Say something…' : t.phase === 'playing' ? 'Playing it back' : 'Test your microphone'}{why && !busy && <small>{why}</small>}</span>
        {t.phase === 'listening' && <span className="left ac-mono">{clock(t.left)}</span>}
      </button>
      {busy && (
        <>
          <span className="bar" aria-hidden="true"><i key={t.phase} style={{ '--for': `${TEST_SECONDS}s` }} /></span>
          <p>It plays back here only. Nothing is uploaded or kept.</p>
        </>
      )}
      <span className="sr-only" role="status">{t.phase === 'listening' ? `Listening for ${TEST_SECONDS} seconds.` : t.phase === 'playing' ? 'Now you hear what it heard.' : ''}</span>
    </div>
  );
}

/** Play a test sound, under the speakers: a short chime through the speaker chosen, so you know you'll hear people. */
function SoundTest({ media, on }: { media: LocalMedia; on: string }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    if (playing) return;
    setPlaying(true);
    try { await media.playTestSound(); } finally { setPlaying(false); }
  };
  return (
    <button type="button" className="ic-opt" aria-disabled={playing} onClick={() => void play()}>
      {playing ? <span className="ac-level lead" aria-hidden="true"><i /><i /><i /></span> : <Icon name="speaker" size={16} className="lead" />}
      <span className="nm">{playing ? `Playing on ${on}` : 'Play a test sound'}</span>
    </button>
  );
}

/** Which speaker, and a sound to check it; or, where the browser can't choose one, that calls play through the system's. */
function SpeakerChoices({ media, m, devices, onSwitched }: { media: LocalMedia; m: MediaSnapshot; devices: Devices; onSwitched: (label: string) => void }) {
  const chooses = canChooseSpeaker() && devices.speaker.length > 0;
  return (
    <>
      <div className="ac-eyebrow">Speaker</div>
      {chooses ? <DeviceList kind="speaker" devices={devices.speaker} using={m.speakerId} onPick={(id, name) => { media.chooseSpeaker(id); onSwitched(name); }} />
        : <p className="ic-none">{canChooseSpeaker() ? 'Sound plays through the speaker your system uses.' : SYSTEM_SPEAKER}</p>}
      <SoundTest media={media} on={chooses ? inUse(devices.speaker, m.speakerId) || 'your speaker' : 'your system’s speaker'} />
    </>
  );
}

interface MicProps { media: LocalMedia; m: MediaSnapshot; devices: Devices; live: boolean; onSwitched: (what: 'mic' | 'speaker', label: string) => void }

/**
 * Which microphone (and how loud it's hearing you), and before joining (`test`) Test your microphone; then which speaker, with a
 * test sound, unless the speaker has a picker of its own (`speaker={false}`, before joining); and noise reduction.
 */
export function MicOptions({ media, m, devices, live, speaker = true, test = false, onSwitched }: MicProps & { speaker?: boolean | undefined; test?: boolean | undefined }) {
  const trouble = troubles(m, ['mic'])[0];
  return (
    <Choices>
      {trouble && <MenuTrouble trouble={trouble} action={trouble.retry ? { label: 'Try again', run: () => media.retry() } : null} />}
      {(devices.mic.length > 0 || !trouble) && <div className="ac-eyebrow">Microphone</div>}
      {devices.mic.length ? (
        <DeviceList kind="mic" devices={devices.mic} using={m.micId} extra={trouble ? undefined : <Level media={media} live={live && m.mic} />}
          onPick={(id, name) => void media.chooseMic(id).then((ok) => { if (ok) onSwitched('mic', name); })} />
      ) : !trouble && <p className="ic-none">No microphone found.</p>}
      {test && !trouble && <MicTest media={media} m={m} />}
      {speaker && <><div className="ic-msep" /><SpeakerChoices media={media} m={m} devices={devices} onSwitched={(label) => onSwitched('speaker', label)} /></>}
      <div className="ic-msep" />
      <div className="ic-srow"><span>Noise reduction</span><Switch className="end" checked={m.noiseReduction} label="Noise reduction" onChange={(on) => void media.setNoiseReduction(on)} /></div>
    </Choices>
  );
}

/** The microphone's menu, from the arrow beside it. */
export function MicMenu({ open, onOpenChange, ...rest }: Omit<MicProps, 'live'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="start" label="Microphone and speaker" className="ic-dmenu is-devices"
      anchor={<DockChevron label="Microphone and speaker" on={open} />}>
      <MicOptions {...rest} live={open} />
    </Popover>
  );
}

interface CamProps {
  media: LocalMedia; m: MediaSnapshot; devices: Devices; me: AvatarPerson; preview?: boolean;
  /**
   * Background, which opens its window. Whoever passes it closes what these options are in first (the camera's menu, or
   * Settings › Audio and video, which Background's window then takes the place of), so no window opens over another.
   * Without it there's no Background row.
   */
  onBackground?: (() => void) | undefined;
  onSwitched: (label: string) => void;
}

/** Your own preview, which camera, and Background, with what shows behind you now. */
export function CamOptions({ media, m, devices, me, preview = true, onBackground, onSwitched }: CamProps) {
  const trouble = troubles(m, ['cam'])[0];
  return (
    <Choices>
      {trouble && <MenuTrouble trouble={trouble} action={trouble.retry ? { label: 'Turn camera on', run: () => media.setCam(true) } : null} />}
      {preview && (
        <div className="ic-cprev">
          <CallTile person={me} name="Your camera">{m.cam && m.camera ? <Video stream={m.camera} /> : undefined}</CallTile>
        </div>
      )}
      {(devices.cam.length > 0 || !trouble) && <div className={cn('ac-eyebrow', (preview || trouble) && 'mt')}>Camera</div>}
      {devices.cam.length ? <DeviceList kind="cam" devices={devices.cam} using={m.camId} onPick={(id, name) => void media.chooseCam(id).then((ok) => { if (ok) onSwitched(name); })} />
        : !trouble && <p className="ic-none">No camera found.</p>}
      {onBackground && (
        <>
          <div className="ic-msep" />
          <button type="button" className="ic-opt" aria-haspopup="dialog" onClick={onBackground}>
            <Icon name="image" size={16} className="lead" /><span className="nm">Background</span><span className="end">{backgroundLabel(m.background)}</span><Icon name="chevron" size={15} className="go" />
          </button>
        </>
      )}
    </Choices>
  );
}

/** The camera's menu, from the arrow beside it (`data-cam-menu`, for focus to come back to once Background closes). */
export function CamMenu({ open, onOpenChange, ...rest }: CamProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="start" label="Camera" className="ic-dmenu is-devices"
      anchor={<DockChevron label="Camera and background" on={open} data-cam-menu="" />}>
      <CamOptions {...rest} />
    </Popover>
  );
}

/* ---------- before joining ---------- */

/**
 * A picker before joining: a calm pill (what kind it is, the microphone's level, the device in use) that opens its menu,
 * and a short line under it when something changed by itself.
 */
function Picker({ kind, name, meter, note, children }: { kind: DeviceKind; name: string; meter?: ReactNode; note: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pj-dev">
      <Popover open={open} onOpenChange={setOpen} side="top" align="start" label={NAME[kind]} className="ic-dmenu is-devices"
        anchor={(
          <button type="button" className="dev-pick" aria-label={`${NAME[kind]}: ${name}`} title={name}>
            <Icon name={ICON[kind]} size={16} />{meter}<span className="nm ac-clamp-1">{name}</span><Icon name="down" size={14} className="caret" />
          </button>
        )}>
        {children}
      </Popover>
      {note && <p className="pj-dev-note">{note}</p>}
    </div>
  );
}

/** In place of a picker: a device that isn't working, in two or three words. The panel below says why. */
function DeviceState({ kind, text }: { kind: Capture; text: string }) {
  return <div className="pj-dev"><span className="dev-pick is-state"><Icon name={OFF[kind]} size={16} /><span className="nm ac-clamp-1">{text}</span></span></div>;
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
        {list.some((t) => t.retry) && <Button variant="secondary" size="sm" icon="retry" loading={busy} onClick={() => void retry()}>Try again</Button>}
      </div>
    </div>
  );
}

/** Background, beside the pickers: its window, so it's chosen before anyone sees you. */
function PrejoinBackground({ media, m, me }: { media: LocalMedia; m: MediaSnapshot; me: AvatarPerson }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pj-dev">
      <button type="button" className="dev-pick" aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="image" size={16} /><span className="nm">Background</span></button>
      <ChooseBackground media={media} m={m} me={me} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * What changed by itself (a device unplugged, or one chosen before that isn't here): the last of each kind, said under that
 * kind's picker until a device of that kind is picked. `latest` is the newest of them, for a screen reader to hear.
 */
function useNotes(media: LocalMedia, m: MediaSnapshot) {
  const [cleared, setCleared] = useState<Record<DeviceKind, number>>({ mic: 0, cam: 0, speaker: 0 });
  const of = (kind: DeviceKind): string | null => m.changes.findLast((c) => c.kind === kind && c.n > cleared[kind])?.text ?? null;
  const clear = (kind: DeviceKind) => { const n = media.getSnapshot().changes.at(-1)?.n ?? 0; setCleared((c) => ({ ...c, [kind]: n })); };
  const last = m.changes.at(-1);
  return { of, clear, latest: last && of(last.kind) === last.text ? last.text : '' };
}

/** The pre-join row: a picker for each device, Background, and anything that isn't working. */
export function PrejoinDevices({ media, m, devices, me }: { media: LocalMedia; m: MediaSnapshot; devices: Devices; me: AvatarPerson }) {
  const notes = useNotes(media, m);
  const list = troubles(m);
  const mic = m.access.mic.problem;
  const cam = m.access.cam.problem;
  const chooses = canChooseSpeaker();
  return (
    <div className="pj-devices">
      {mic ? <DeviceState kind="mic" text={stateOf('mic', mic)} /> : devices.mic.length > 0 && (
        <Picker kind="mic" name={inUse(devices.mic, m.micId)} meter={<Level media={media} live={m.mic} />} note={notes.of('mic')}>
          <MicOptions media={media} m={m} devices={devices} live speaker={false} test onSwitched={(what) => notes.clear(what)} />
        </Picker>
      )}
      {cam ? <DeviceState kind="cam" text={stateOf('cam', cam)} /> : devices.cam.length > 0 && (
        <Picker kind="cam" name={inUse(devices.cam, m.camId)} note={notes.of('cam')}>
          <CamOptions media={media} m={m} devices={devices} me={me} preview={false} onSwitched={() => notes.clear('cam')} />
        </Picker>
      )}
      {(!chooses || devices.speaker.length > 0) && (
        <Picker kind="speaker" name={chooses ? inUse(devices.speaker, m.speakerId) : 'System speaker'} note={notes.of('speaker')}>
          <Choices><SpeakerChoices media={media} m={m} devices={devices} onSwitched={() => notes.clear('speaker')} /></Choices>
        </Picker>
      )}
      <PrejoinBackground media={media} m={m} me={me} />
      <span className="sr-only" role="status">{notes.latest}</span>
      {list.length > 0 && <PrejoinTrouble list={list} onRetry={() => media.retry()} />}
    </div>
  );
}

/*
 * Audio and video: the microphone, speaker and camera this browser uses, the same choices the join screen and the call
 * remember (features/call/media/devices.ts), kept in this browser only. Nothing opens by itself: "Check the level" opens
 * the microphone for a few seconds, to show how loud it hears you, and it closes sooner when pressed again or when this
 * group leaves the screen. Choosing a device doesn't open it. The camera is never opened: you see yourself when you
 * join a call, never before.
 */
import { Button, Icon, MicLevel, Select, SettingFact, SettingRow, SettingsGroup, SettingsPanel, Tooltip, cn, useToast, type SelectOption } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { stateOf, troubles } from '~/features/call/media/access';
import { canChooseSpeaker, permissions, plainName, readPrefs, rememberDevice, useDevices, watchPermissions, type Capture, type Device, type Permission } from '~/features/call/media/devices';
import { LocalMedia } from '~/features/call/media/media';
import { useLive } from '~/lib/live';
import { Setting, SwitchSetting, useSaved } from './save';

/** How long Check the level keeps the microphone open. */
const CHECK_SECONDS = 8;
/** How finely the level is drawn. */
const LEVEL_BARS = 26;

/** What the browser says about the microphone and the camera, kept current; null until it has said. */
function usePermissions(): Record<Capture, Permission> | null {
  const [p, setP] = useState<Record<Capture, Permission> | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => { void permissions().then((now) => { if (alive) setP(now); }); };
    read();
    const unwatch = watchPermissions(read);
    return () => { alive = false; unwatch(); };
  }, []);
  return p;
}

/** Whether the element with this id is on screen, in a tab that's showing. */
function useOnScreen(id: string): boolean {
  const [inView, setInView] = useState(false);
  const [showing, setShowing] = useState(true);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const io = new IntersectionObserver((seen) => setInView(seen.some((e) => e.isIntersecting)));
    io.observe(el);
    const look = () => setShowing(document.visibilityState === 'visible');
    look();
    document.addEventListener('visibilitychange', look);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', look); };
  }, [id]);
  return inView && showing;
}

/** How loud the microphone hears you, 0 to 1, ten times a second while `on`. */
function useMicLevel(media: LocalMedia, on: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setLevel(media.level()), 110);
    return () => { clearInterval(t); setLevel(0); };
  }, [media, on]);
  return on ? level : 0;
}

/** A device as people know it; the system's own choice says which device that is now. */
const option = (d: Device): SelectOption<string> => ({
  value: d.id,
  label: d.id === 'default' ? `Same as system (${plainName(d.label)})` : d.id === 'communications' ? `Communications (${plainName(d.label)})` : plainName(d.label)
});
/** The first of `ids` that's plugged in, else the first listed (the browser's default comes first). */
const pick = (devices: Device[], ...ids: (string | null | undefined)[]) => ids.find((id) => id && devices.some((d) => d.id === id)) ?? devices[0]?.id;

export function AudioGroup() {
  const [media] = useState(() => new LocalMedia());
  const m = useLive(media);
  const perms = usePermissions();
  const shown = useOnScreen('audio');
  const saved = useSaved();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [left, setLeft] = useState(CHECK_SECONDS);
  const [tried, setTried] = useState(false);
  const [mic, setMic] = useState(() => readPrefs().mic);
  const [speaker, setSpeaker] = useState(() => readPrefs().speaker);
  const [cam, setCam] = useState(() => readPrefs().cam);
  const [playing, setPlaying] = useState(false);
  // Open only while checking: a few seconds at most, and not once this group is off the screen or the tab is hidden.
  useEffect(() => {
    if (!checking) return;
    if (!shown) { setChecking(false); return; }
    void media.start({ mic: true, cam: false });
    const began = Date.now();
    setLeft(CHECK_SECONDS);
    const t = setInterval(() => {
      const gone = (Date.now() - began) / 1000;
      if (gone < CHECK_SECONDS) setLeft(Math.ceil(CHECK_SECONDS - gone));
      else setChecking(false);
    }, 200);
    return () => { clearInterval(t); media.stop(); };
  }, [checking, shown, media]);
  const level = useMicLevel(media, checking && m.mic);
  // Browsers name devices only once they're allowed, so the lists are read again as that changes.
  const devices = useDevices(`${m.micId ?? ''}:${perms?.mic ?? ''}:${perms?.cam ?? ''}`);

  // What went wrong the last time the level was checked, until it's checked again.
  const trouble = tried ? troubles(m, ['mic'])[0] : undefined;
  const micId = pick(devices.mic, checking ? m.micId : undefined, mic);
  const speakerId = pick(devices.speaker, speaker);
  const camId = pick(devices.cam, cam);
  const hasMics = devices.mic.length > 0 && micId !== undefined;
  const canPick = canChooseSpeaker();
  const hasSpeakers = canPick && devices.speaker.length > 0 && speakerId !== undefined;

  // A refused microphone takes Check the level with it, and one that starts takes Try again: focus stays on the row.
  const micRow = useRef<HTMLDivElement>(null);
  const troubled = trouble !== undefined;
  const wasTroubled = useRef(troubled);
  useEffect(() => {
    if (wasTroubled.current === troubled) return;
    wasTroubled.current = troubled;
    if (document.activeElement === document.body) micRow.current?.focus({ preventScroll: true });
  }, [troubled]);

  const check = () => { setTried(true); setChecking((on) => !on); };
  const retry = () => { if (checking) void media.retry(); else check(); };
  const chooseMic = (id: string) => {
    if (!checking) { setMic(id); rememberDevice('mic', id); saved('Microphone'); return; }
    void media.chooseMic(id).then((ok) => {
      if (ok) { setMic(id); saved('Microphone'); }
      else toast(media.getSnapshot().changes.at(-1)?.text ?? 'That microphone didn’t start.', { icon: 'micOff' });
    });
  };
  const chooseSpeaker = (id: string) => { setSpeaker(id); media.chooseSpeaker(id); saved('Speaker'); };
  const test = async () => {
    if (playing) return;
    // Through the chosen speaker while it's plugged in, else the system's.
    if (speaker && devices.speaker.some((d) => d.id === speaker)) media.chooseSpeaker(speaker);
    setPlaying(true);
    try { await media.playTestSound(); } finally { setPlaying(false); }
  };

  return (
    <SettingsGroup id="audio" title="Audio and video" tag={<><Icon name="laptop" size={15} />This browser</>}>
      <SettingsPanel>
        {trouble ? (
          <SettingRow ref={micRow} tabIndex={-1} label="Microphone" problem help={trouble.how ?? trouble.title}
            control={(
              <div className="set-line">
                <SettingFact icon="micOff" tone="no">{stateOf('mic', trouble.problem)}</SettingFact>
                {trouble.retry && <Button variant="quiet" size="sm" icon="retry" onClick={retry}>Try again</Button>}
              </div>
            )} />
        ) : (
          <Setting ref={micRow} tabIndex={-1} stack label="Microphone" help={checking ? 'Speak, and watch it move. Nothing is recorded.' : perms?.mic === 'prompt' ? 'Your browser asks first.' : undefined}
            control={(
              <>
                {hasMics && <Select label="Microphone" value={micId} options={devices.mic.map(option)} onChange={chooseMic} />}
                <div className={cn('set-lvl', checking && 'is-on')}>
                  {checking && <MicLevel level={level} bars={LEVEL_BARS} className="set-ticks" />}
                  <Tooltip label={checking ? 'Stop checking' : `Opens the microphone for ${CHECK_SECONDS} seconds. Nothing is recorded.`}>
                    <button type="button" className={cn('set-test', !hasMics && 'is-flush')} aria-pressed={checking} onClick={check}>
                      {checking ? `Stop · ${left} s` : <><span className="set-bars" aria-hidden="true"><i /><i /><i /><i /></span>Check the level</>}
                    </button>
                  </Tooltip>
                </div>
              </>
            )} />
        )}
        <Setting stack label="Speaker" help={canPick ? undefined : 'This browser uses the speaker your system uses. Change it in your computer’s sound settings.'}
          control={(
            <>
              {hasSpeakers && <Select label="Speaker" value={speakerId} options={devices.speaker.map(option)} onChange={chooseSpeaker} />}
              {!canPick && <SettingFact>System speaker</SettingFact>}
              <button type="button" className={cn('set-test', playing && 'is-busy', !hasSpeakers && 'is-flush')} aria-disabled={playing || undefined} onClick={() => void test()}>
                <Icon name="speaker" size={15} />{playing ? 'Playing' : 'Play test sound'}
              </button>
            </>
          )} />
        {devices.cam.length > 0 && camId
          ? <Setting label="Camera" control={<Select label="Camera" value={camId} options={devices.cam.map(option)} onChange={(id) => { rememberDevice('cam', id); setCam(id); saved('Camera'); }} />} />
          : perms?.cam === 'denied' ? <SettingRow label="Camera" problem help="Allow the camera for this site in your browser’s settings." control={<SettingFact icon="videoOff" tone="no">Blocked</SettingFact>} />
            : perms?.cam === 'granted' ? <SettingRow label="Camera" control={<SettingFact icon="videoOff">No camera</SettingFact>} />
              : <SettingRow label="Camera" help="Allow it when you next join a call, then pick one here." control={<SettingFact icon="videoOff">Not allowed yet</SettingFact>} />}
        <SwitchSetting label="Reduce background noise" checked={m.noiseReduction} onChange={(on) => void media.setNoiseReduction(on).then(() => saved('Reduce background noise'))} />
      </SettingsPanel>
    </SettingsGroup>
  );
}

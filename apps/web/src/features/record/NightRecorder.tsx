/*
 * The night recorder on Record: the recorder on the horizon, and in the sky above it a name for the recording, Start
 * recording (or R), which opens the stage recorder (/record/live) and hands it the name in memory, never in the address,
 * then the microphone it will use and how loud that is. The page never opens the microphone by itself: only "Check the
 * level" does, until Stop is pressed or the page is left. The camera has no part here.
 */
import { Button, Icon, Kbd, RecMeter, RecorderSun, Select, Tooltip, cn, useVoice } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { troubles } from '~/features/call/media/access';
import { deviceOptions, readPrefs, rememberDevice, useDevices } from '~/features/call/media/devices';
import { LocalMedia } from '~/features/call/media/media';
import { overlayOpen, typing } from '~/lib/keys';
import { sessions, useLive, useOnline } from '~/lib/live';
import { UNNAMED } from './uploads';

/** `keeps`: it records without a connection. Without one, and with that off, Start recording waits for the connection. */
export function NightRecorder({ keeps }: { keeps: boolean }) {
  const navigate = useNavigate();
  const online = useOnline();
  const [name, setName] = useState('');
  const locked = !online && !keeps;
  const start = () => {
    if (locked) return;
    sessions.roomTitle = name.trim() || null;
    void navigate({ to: '/record/live' });
  };
  const latest = useRef(start);
  latest.current = start;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e.target) || overlayOpen()) return;
      e.preventDefault();
      latest.current();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const check = useMicCheck();
  const sun = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  useVoice({ sun, meter, level: () => check.media.level(), on: check.hearing, gain: 0.8 });
  const lit = check.checking && !check.trouble;

  return (
    <>
      {/* Dark until something is recorded: a lit rim while it's checked, and it's only full of colour on the stage. */}
      <RecorderSun ref={sun} orb={lit ? 'check' : 'idle'} voice={lit ? 'level' : 'idle'} />
      <section className="rec-go" aria-label="Recorder" style={{ '--d': 1 }}>
        <div role="status">
          {!online && (
            <p className="rec-off">
              <Icon name="wifiOff" size={15} />
              {keeps ? 'Offline. Recording still works.' : 'Offline. Recording needs a connection.'}
            </p>
          )}
        </div>
        <input className="rec-name" type="text" value={name} placeholder={UNNAMED} aria-label="Name this recording" title="Name this recording" maxLength={160}
          autoComplete="off" spellCheck={false} enterKeyHint="go" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }} />
        <div className="rec-a">
          <Button variant="primary" className={cn('rec-start', locked && 'is-off')} aria-label="Start recording" aria-disabled={locked} aria-keyshortcuts="R" onClick={start}>
            {/* On the cream of the button, so it's the day's rec. */}
            <i className="rec-dot light" aria-hidden="true" />Start recording<Kbd>R</Kbd>
          </Button>
        </div>
        <MicCheck check={check} meter={meter} />
      </section>
    </>
  );
}

/**
 * The microphone to record with, chosen in this browser (the stage recorder and calls use the same choice), and its
 * check. Choosing one while it's closed only remembers it; "Check the level" opens it, and Stop lets go of it.
 */
function useMicCheck() {
  const [media] = useState(() => new LocalMedia());
  const m = useLive(media);
  const [checking, setChecking] = useState(false);
  /** What the picker shows while the microphone is closed: the remembered one, one chosen since, or the one last checked. */
  const [chosen, setChosen] = useState(() => readPrefs().mic);
  /** The microphone's news (a choice that didn't start, one unplugged) shows only when it's newer than the last check or choice. */
  const [seen, setSeen] = useState(0);
  /* Browsers name microphones only once one has been allowed, so the list is read again when one opens. */
  const devices = useDevices(m.camera);
  useEffect(() => () => media.stop(), [media]);

  // The same list as the call's: each microphone once, the system's saying so, and Follow your system while one is pinned.
  const { value, options } = deviceOptions(devices.mic, (checking && m.micId) || chosen, 'mic');
  const newest = () => m.changes.at(-1)?.n ?? 0;
  return {
    media, checking, options, value,
    hearing: checking && m.mic,
    trouble: checking ? troubles(m, ['mic'])[0] : undefined,
    said: checking ? m.changes.filter((c) => c.kind === 'mic' && c.n > seen).at(-1) : undefined,
    toggle: () => {
      if (checking) {
        // What was in use stays shown: a choice that didn't start never took.
        setChosen(m.micId ?? chosen);
        media.stop();
      } else {
        setSeen(newest());
        void media.start({ mic: true, cam: false });
      }
      setChecking(!checking);
    },
    choose: (id: string) => {
      setSeen(newest());
      if (!checking) { rememberDevice('mic', id); setChosen(id); return; }
      void media.chooseMic(id).then((ok) => { if (ok) setChosen(id); });
    }
  };
}

function MicCheck({ check, meter }: { check: ReturnType<typeof useMicCheck>; meter: RefObject<HTMLSpanElement | null> }) {
  const { media, checking, options, value, trouble, said, toggle, choose } = check;
  const missing = trouble?.problem === 'missing';
  return (
    <>
      <div className="rec-chips">
        <Select stage icon={trouble ? 'micOff' : 'mic'} label="Microphone" align="center" value={missing ? undefined : value} options={missing ? [] : options} onChange={choose}
          placeholder={missing ? 'No microphone' : 'Default microphone'} disabled={missing || !options.length} className={cn('rec-chip', trouble && 'is-warn')} />
        <Tooltip label={checking ? 'Lets go of the microphone.' : 'Opens the microphone to show how loud it is. Nothing is recorded.'}>
          <button type="button" className={cn('rec-chip rec-lv', checking && 'is-on', checking && trouble && 'is-dead')} aria-pressed={checking} onClick={toggle}>
            <RecMeter ref={meter} />
            <span className={cn(checking && 'sr-only')}>Check the level</span>
            {checking && <span aria-hidden="true">Stop</span>}
          </button>
        </Tooltip>
      </div>
      <div role="status" className={cn('rec-say', (trouble || said) && 'is-warn')}>
        {trouble
          ? <p>{trouble.title} {trouble.how}{trouble.retry && <button type="button" className="rec-retry" onClick={() => void media.retry()}>Try again</button>}</p>
          : <p>{said ? said.text : checking ? 'Nothing is recorded.' : 'Let everyone here know before you start.'}</p>}
      </div>
    </>
  );
}

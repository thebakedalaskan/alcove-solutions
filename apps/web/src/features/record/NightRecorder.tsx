/*
 * The night recorder on Record: a name for the recording, the microphone it will use and how loud that is, and
 * Start recording (or R), which opens the stage recorder (/record/live) and hands it the name in memory, never in
 * the address. The page never opens the microphone by itself: only "Check the level" does, until Stop is pressed or
 * the page is left. The camera has no part here.
 */
import { Icon, Kbd, MicLevel, Select, Tooltip, cn, type SelectOption } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { troubles } from '~/features/call/access';
import { plainName, readPrefs, rememberDevice, useDevices, type Device } from '~/features/call/devices';
import { LocalMedia } from '~/features/call/media';
import { overlayOpen, typing } from '~/lib/keys';
import { sessions, useLive, useOnline } from '~/lib/live';

export function NightRecorder() {
  const navigate = useNavigate();
  const online = useOnline();
  const [name, setName] = useState('');
  const start = () => {
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

  return (
    <section className="rec-card" aria-label="Recorder">
      <div className="rec-orb" aria-hidden="true"><i /></div>
      <div className="rec-body">
        <div className="rec-top">
          <span className="rec-k"><Icon name="room" size={15} />In the room</span>
          {online
            ? <span className="rec-pill"><Icon name="transcript" size={14} />Transcribed as you talk</span>
            : <span className="rec-pill"><Icon name="wifiOff" size={14} />Offline · needs a connection to start</span>}
        </div>
        <input className="rec-name" type="text" value={name} placeholder="Name this recording" aria-label="Name this recording" maxLength={160}
          autoComplete="off" spellCheck={false} enterKeyHint="go" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); start(); } }} />
        <MicCheck />
        <div className="rec-acts">
          <button type="button" className="rec-go" aria-label="Start recording" aria-keyshortcuts="R" onClick={start}>
            <i aria-hidden="true" />Start recording<Kbd>R</Kbd>
          </button>
          <p className="rec-note">Let everyone here know before you start.</p>
        </div>
      </div>
    </section>
  );
}

/** Chrome lists its default and communications microphones again under those names, beside the real ones. */
const STANDS_IN = new Set(['default', 'communications']);
const nameOf = (d: Device) => plainName(d.label) || d.label;

/** The microphones to choose from, each once, by the name people know it by. */
function micOptions(list: Device[]): SelectOption<string>[] {
  const real = list.filter((d) => !STANDS_IN.has(d.id));
  return (real.length ? real : list).map((d) => ({ value: d.id, label: nameOf(d) }));
}
/** Which option `id` is: itself, or for the browser's default (or no choice yet), the microphone that is the default now. */
function optionFor(id: string | undefined, list: Device[], options: SelectOption<string>[]): string | undefined {
  if (id && options.some((o) => o.value === id)) return id;
  const stand = list.find((d) => d.id === (id && STANDS_IN.has(id) ? id : 'default'));
  return (stand && options.find((o) => o.label === nameOf(stand))?.value) ?? options[0]?.value;
}

/** How loud the microphone is, read ten times a second while `live`. */
function useLevel(media: LocalMedia, live: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setLevel(media.level()), 100);
    return () => clearInterval(t);
  }, [media, live]);
  return live ? level : 0;
}

/**
 * The microphone to record with, chosen in this browser (the stage recorder and calls use the same choice), and
 * its level. Choosing one while it's closed only remembers it; "Check the level" opens it, and Stop lets go of it.
 */
function MicCheck() {
  const [media] = useState(() => new LocalMedia());
  const m = useLive(media);
  const [checking, setChecking] = useState(false);
  /** What the picker shows while the microphone is closed: the remembered one, one chosen since, or the one last checked. */
  const [chosen, setChosen] = useState(() => readPrefs().mic);
  /** The microphone's news (a choice that didn't start, one unplugged) shows only when it's newer than the last check or choice. */
  const [seen, setSeen] = useState(0);
  /* Browsers name microphones only once one has been allowed, so the list is read again when one opens. */
  const devices = useDevices(m.camera);
  const level = useLevel(media, checking && m.mic);
  useEffect(() => () => media.stop(), [media]);

  const options = micOptions(devices.mic);
  const value = optionFor((checking && m.micId) || chosen, devices.mic, options);
  const trouble = checking ? troubles(m, ['mic'])[0] : undefined;
  const said = checking ? m.changes.filter((c) => c.kind === 'mic' && c.n > seen).at(-1) : undefined;
  const newest = () => m.changes.at(-1)?.n ?? 0;
  const toggle = () => {
    if (checking) {
      // What was in use stays shown: a choice that didn't start never took.
      setChosen(m.micId ?? chosen);
      media.stop();
    } else {
      setSeen(newest());
      void media.start({ mic: true, cam: false });
    }
    setChecking(!checking);
  };
  const choose = (id: string) => {
    setSeen(newest());
    if (!checking) { rememberDevice('mic', id); setChosen(id); return; }
    void media.chooseMic(id).then((ok) => { if (ok) setChosen(id); });
  };

  return (
    <>
      <div className="rec-mic">
        {options.length > 0 && <Select stage icon="mic" label="Microphone" value={value} options={options} onChange={choose} />}
        <Tooltip label={checking ? 'Lets go of the microphone.' : 'Opens the microphone to show how loud it is. Nothing is recorded.'}>
          <button type="button" className={cn('rec-level', checking && 'is-on')} aria-pressed={checking} onClick={toggle}>
            <span aria-hidden="true"><MicLevel stage level={level} /></span>
            <span className={cn(checking && 'sr-only')}>Check the level</span>
            {checking && <span aria-hidden="true">Stop</span>}
          </button>
        </Tooltip>
      </div>
      <div role="status" className="rec-say">
        {trouble ? (
          <p className="is-trouble">{trouble.title} {trouble.how}{trouble.retry && <> <button type="button" onClick={() => void media.retry()}>Try again</button></>}</p>
        ) : said && <p>{said.text}</p>}
      </div>
    </>
  );
}

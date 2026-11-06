/*
 * Offline recordings, on Record's night (welcome-night.css, `lp-rec`). In the sky: what state the recorder is in, the
 * part's head and the recorder's controls. On the horizon, where the sun would be, the recorder itself: the app's
 * RecorderSun, a dark disc with the last light on its rim that fills with colour while it records and sets when it's done.
 * On the water: its voice, what's heard a line at a time, where it's kept, then the session's notes once it's back online,
 * and under them what Alcove can see (`children`). It plays once as the recorder comes into view, recording offline with a
 * voice that needs no microphone. Until then, and with reduced motion, it's the finished picture.
 */
import { Button, Chip, Dots, Icon, RecorderSun, SealedBadge, cn, useSceneLoop, useVoice, type IconName, type OrbState, type VoiceKind } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { position } from '~/lib/time';
import { HEARD, SESSION } from './night';
import { Sky } from './Sky';

/** Where the take is: before it starts, recording offline, uploading once it's back online, the notes just written, done. */
type Step = 'ready' | 'live' | 'upload' | 'written' | 'done';
/** `heard`: how many lines have been heard. `secs`: how long it has recorded. `press`: the button it's about to press is down. */
interface Take { step: Step; heard: number; secs: number; press: boolean }

const READY: Take = { step: 'ready', heard: 0, secs: 0, press: false };
/** The finished picture: what the page shows until the recorder plays, and with reduced motion. */
const DONE: Take = { step: 'done', heard: HEARD.length, secs: 0, press: false };

const ORB: Record<Step, OrbState> = { ready: 'idle', live: 'live', upload: 'set', written: 'set', done: 'set' };
const VOICE: Record<Step, VoiceKind> = { ready: 'idle', live: 'live', upload: 'idle', written: 'idle', done: 'idle' };
const SAY: Record<Step, string> = {
  ready: 'Let everyone here know before you start.',
  live: 'Recording. Encrypted on this device as it goes.',
  upload: 'Saved on this device',
  written: SESSION.uploaded,
  done: SESSION.uploaded
};
const STATE: Record<Step, readonly [IconName, string]> = {
  ready: ['wifiOff', 'Offline. Recording still works.'],
  live: ['wifiOff', 'Offline. Recording still works.'],
  upload: ['cloudUpload', 'Back online. Uploading'],
  written: ['circleCheck', 'Back online. Notes written.'],
  done: ['circleCheck', 'Back online. Notes written.']
};
/** Each second of the take shows as four on its clock. */
const PACE = 4;

/** Someone talking, for a recorder with no microphone: syllables in phrases, with a breath between them. */
function talking(): number {
  const t = performance.now() / 1000;
  const phrase = Math.max(0, Math.sin(t * 1.7) + 0.45);
  const syllable = Math.abs(Math.sin(t * 8.3 + 1.6 * Math.sin(t * 2.1)));
  return 0.02 + 0.3 * phrase * syllable + 0.05 * Math.random();
}

export function RecordScene({ head, children }: { head: ReactNode; children?: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const [take, setTake] = useState<Take>(DONE);
  const [playing, setPlaying] = useState(false);
  /** A take has played to its end: until then the finished picture is all there's been, and its button says Play it. */
  const [played, setPlayed] = useState(false);
  const [seen, setSeen] = useState(false);
  const sun = useRef<HTMLDivElement>(null);
  const ctrl = useRef<HTMLDivElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  /** The recorder's part of the night, from the top of its sky to the bottom of its notes: the take only moves while it's on screen. */
  const whole = useRef<HTMLSpanElement>(null);
  const { step } = take;
  const written = step === 'written' || step === 'done';

  useEffect(() => {
    const el = whole.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((es) => setSeen(es.at(-1)?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /*
   * Just before any of it can be seen it's set back to the start, and it plays once the controls are well in view. Reached
   * from below, it has already been seen finished, so it stays that way until it's played again.
   */
  useEffect(() => {
    const area = whole.current;
    const el = ctrl.current;
    if (reduce || !area || !el) return undefined;
    const play = new IntersectionObserver((es) => {
      if (!es.at(-1)?.isIntersecting) return;
      play.disconnect();
      setPlaying(true);
    }, { threshold: 0.6 });
    const near = new IntersectionObserver((es) => {
      if (!es.at(-1)?.isIntersecting) return;
      near.disconnect();
      if (el.getBoundingClientRect().bottom <= 0) return;
      setTake(READY);
      play.observe(el);
    }, { rootMargin: '0px 0px 25% 0px' });
    near.observe(area);
    return () => { near.disconnect(); play.disconnect(); };
  }, [reduce]);

  useSceneLoop(whole, async (c) => {
    let now = READY;
    const to = (next: Partial<Take>) => { now = { ...now, ...next }; setTake(now); };
    let ms = 0;
    /** Records for `wait` ms, the clock in the state pill going on a second at a time. */
    const record = async (wait: number) => {
      for (let left = wait; left > 0; left -= 1000) {
        const beat = Math.min(1000, left);
        await c.sleep(beat);
        ms += beat;
        to({ secs: Math.floor((ms / 1000) * PACE) });
      }
    };
    to(READY);
    await c.sleep(1300);
    to({ press: true });
    await c.sleep(220);
    to({ step: 'live', press: false });
    for (let i = 1; i <= HEARD.length; i++) {
      await record(2600);
      to({ heard: i });
    }
    await record(2800);
    to({ press: true });
    await c.sleep(220);
    to({ step: 'upload', press: false });
    await c.sleep(2600);
    to({ step: 'written' });
    await c.sleep(400);
    to({ step: 'done' });
    setPlayed(true);
    setPlaying(false);
  }, playing);

  useVoice({ sun, level: talking, on: step === 'live' && seen && !reduce });

  /* Played from the keyboard, the way to play it once more comes back where it was. */
  useEffect(() => {
    if (step === 'done' && document.activeElement === ctrl.current) again.current?.focus();
  }, [step]);

  const replay = () => {
    ctrl.current?.focus();
    setTake(READY);
    setPlaying(true);
  };

  const [icon, state] = STATE[step];
  return (
    <Sky moment="record" id="offline" className="lp-night lp-rec dark" sky={(
      <div className="lp-wrap lp-rec-up">
        <p className={cn('rec-off lp-rec-state', step === 'ready' && 'is-off')}>
          <Icon name={icon} size={15} />
          <span>{state}{step === 'live' && <> <span className="lp-rec-t">{position(take.secs)}</span></>}</span>
          {step === 'upload' && <Dots />}
        </p>
        {head}
        <div ref={ctrl} className="lp-rec-ctrl" role="group" aria-label="Recorder" tabIndex={-1}>
          <p className="lp-rec-name">{SESSION.title}</p>
          <div className="rec-ctl lp-rec-row">
            {/* What the take presses itself is a picture of the controls; only playing it again is yours. */}
            {step === 'ready' && (
              <Button variant="primary" className={cn('rec-start', take.press && 'is-pressed')} inert>
                <i className="rec-dot light" aria-hidden="true" />Start recording
              </Button>
            )}
            {step === 'live' && (
              <>
                <Button icon="pause" inert>Pause</Button>
                <Button variant="primary" className={cn(take.press && 'is-pressed')} inert><Icon name="stop" size={16} className="rec-sq" />Finish and save</Button>
              </>
            )}
            {step === 'done' && <Button ref={again} icon={played ? 'reset' : 'play'} onClick={replay}>{played ? 'Play it again' : 'Play it'}</Button>}
          </div>
          <p className="rec-say lp-rec-say">{SAY[step]}</p>
        </div>
      </div>
    )}>
      <RecorderSun ref={sun} orb={ORB[step]} voice={VOICE[step]} />
      <div className="lp-wrap lp-rec-water">
        <span ref={whole} className="lp-rec-whole" aria-hidden="true" />
        <div className="lp-rec-heard">
          {HEARD.map((line, i) => (
            <p key={line} className={cn('rec-l', i >= take.heard && 'is-off')} data-age={i < take.heard ? take.heard - 1 - i : undefined}>{line}</p>
          ))}
        </div>
        <div className={cn('lp-rec-saved', take.heard === 0 && 'is-off')}>
          <p className="rec-said">
            <Icon name={written ? 'lock' : 'hardDrive'} size={16} />
            <span>{written ? 'Room notes go to nobody until you share them.' : 'Saved on this device. It uploads when you’re back online.'}</span>
          </p>
        </div>
        <article className={cn('lp-rec-note', !written && 'is-off')}>
          <header className="lp-rec-note-top">
            <h3>{SESSION.title}</h3>
            <Chip icon="lock">Only you</Chip>
            <Chip>{SESSION.format}</Chip>
            <span className="when">{SESSION.when}</span>
          </header>
          <dl>
            {SESSION.parts.map(([part, said]) => <div key={part}><dt>{part}</dt><dd>{said}</dd></div>)}
          </dl>
          <p className="lp-rec-note-foot"><SealedBadge inline title={SESSION.checked} /></p>
        </article>
      </div>
      {children}
    </Sky>
  );
}

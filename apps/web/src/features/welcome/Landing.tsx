/*
 * The welcome page: what Alcove is, before sign-in. Always the night look; the dawn bands are in the
 * light theme. Each feature gets a heading row and a scene that plays while it's on screen.
 */
import { Button, EASE, Icon, Logo, Reveal, RevealGroup, cn, type IconName } from '@alcove/ui';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { HeroMark } from './HeroMark';
import { LayoutScene } from './LayoutScene';
import { NotesScene } from './NotesScene';
import { PrivacyScene } from './PrivacyScene';
import { RoomScene } from './RoomScene';
import { RoomsScene } from './RoomsScene';
import { TranslateScene } from './TranslateScene';
import { WaysIn, type Auth } from './WaysIn';

const HEADLINE = 'Meetings, powered by confidential AI.'.split(' ');
const SECTIONS = [['in-the-room', 'In the room'], ['notes', 'Notes'], ['layouts', 'Layouts'], ['rooms', 'Breakout rooms'], ['translate', 'Translation'], ['privacy', 'Privacy']] as const;

/** A link that glides to a section of this page. */
function Jump({ to, children }: { to: string; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    const t = document.getElementById(to);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  return <a href={`#${to}`} onClick={go}>{children}</a>;
}

function Eyebrow({ icon, children }: { icon?: IconName | undefined; children: ReactNode }) {
  return <p className="ac-eyebrow is-sun">{icon && <Icon name={icon} size={16} />}{children}</p>;
}

/** A feature's heading row: the eyebrow and title on the left, what it does on the right. */
function BandHead({ icon, eyebrow, title, children }: { icon: IconName; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <RevealGroup className="lp-band-head">
      <div><Eyebrow icon={icon}>{eyebrow}</Eyebrow><h2 className="ac-display-l">{title}</h2></div>
      <div>{children}</div>
    </RevealGroup>
  );
}

function Hero({ auth }: { auth: Auth }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const rise = (i: number) => ({ initial: reduce ? false : { opacity: 0, y: 26 }, animate: { opacity: 1, y: 0 }, transition: { duration: 1.1, delay: 0.5 + i * 0.1, ease: EASE.expo } });
  return (
    <section className="lp-hero" id="top" ref={ref}>
      <motion.div className="lp-hero-glow" aria-hidden="true" initial={reduce ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 2.4, delay: 0.1, ease: EASE.expo }} />
      <div>
        <motion.p className="ac-eyebrow is-sun" {...rise(0)}>Private video calls</motion.p>
        <h1 className="ac-display-xl lp-h1" aria-label={HEADLINE.join(' ')}>
          {HEADLINE.map((w, i) => (
            <Fragment key={w}>
              <motion.span aria-hidden="true" className={cn('lp-w', i >= HEADLINE.length - 2 && 'lp-hl')} initial={reduce ? false : { y: '60%', opacity: 0, rotate: 2 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 1.3, delay: 0.15 + i * 0.07, ease: EASE.expo }}>{w}</motion.span>
              {i < HEADLINE.length - 1 ? ' ' : ''}
            </Fragment>
          ))}
        </h1>
        <motion.p className="ac-body-l lp-lead" {...rise(1)}>
          Alcove is a supercharged meeting platform: notes that write themselves, live translation, breakout rooms and private catch-ups, all built into the call. The AI runs inside sealed hardware, so nobody else can read a word, not even us.
        </motion.p>
        <motion.div {...rise(2)}><WaysIn auth={auth} layout="hero" /></motion.div>
      </div>
      <div className="lp-arch"><HeroMark hero={ref} /></div>
    </section>
  );
}

function Close({ auth }: { auth: Auth }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  return (
    <section className="lp-close" id="start" ref={ref}>
      <motion.div className="sunbig" aria-hidden="true" style={{ y: reduce ? -100 : y }} />
      <div className="horizon" aria-hidden="true" />
      <div className="lp-wrap inner">
        <RevealGroup>
          <Eyebrow>Get started</Eyebrow>
          <h2 className="ac-display-l">Bring private AI to your next meeting.</h2>
          <p className="ac-body-l say">Sign in with your work account. Your calendar and your team come with you, so your first call is one click away.</p>
        </RevealGroup>
        <Reveal className="end"><WaysIn auth={auth} layout="stack" /></Reveal>
      </div>
    </section>
  );
}

export function Landing({ auth }: { auth: Auth }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 10);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return (
    <motion.div className="lp dark" animate={{ opacity: auth.leaving ? 0 : 1 }} transition={{ duration: 0.3, ease: EASE.in }}>
      <div className={cn('lp-navwrap', scrolled && 'is-scrolled')}>
        <div className="lp-wrap">
          <header className="lp-nav">
            <Jump to="top"><Logo size={25} /></Jump>
            <nav className="lp-links" aria-label="Sections">{SECTIONS.map(([id, label]) => <Jump key={id} to={id}>{label}</Jump>)}</nav>
            <div className="end">
              <Button variant="quiet" size="sm" disabled={auth.busy !== null} onClick={auth.google}>Sign in</Button>
              <Button variant="primary" size="sm" disabled={auth.busy !== null} onClick={auth.google}>Get started</Button>
            </div>
          </header>
        </div>
      </div>

      <main>
        <div className="lp-wrap"><Hero auth={auth} /></div>
        <div className="lp-rule" />

        <section className="lp-dawn light" id="in-the-room">
          <div className="lp-band lp-wrap">
            <RoomScene copy={
              <RevealGroup>
                <Eyebrow icon="phone">In the room</Eyebrow>
                <h2 className="ac-display-l">Offline calls</h2>
                <p className="ac-body-l say">For therapists, clinicians and coaches. Record on your phone with no connection; the audio is encrypted as it’s captured. When you’re back online, Alcove writes your session notes in the format you use, and only you can read them.</p>
              </RevealGroup>
            } />
          </div>
        </section>

        <section className="lp-band lp-wrap" id="notes">
          <BandHead icon="notes" eyebrow="Live notes" title="Built-in Transcripts">
            <p className="ac-body-l">As people talk, Alcove keeps what was decided and who’s doing what, then writes the summary when the call ends. Everyone sees the sign while notes are on, and only the people invited receive them.</p>
            <div className="lp-facts">
              <span className="ac-chip is-sun"><Icon name="sealed" size={14} />Written in confidential compute</span>
              <span className="ac-chip"><Icon name="people" size={14} />No bot in the call</span>
              <span className="ac-chip"><Icon name="ask" size={14} />Ask the call anything</span>
            </div>
          </BandHead>
          <Reveal lift><NotesScene /></Reveal>
        </section>

        <section className="lp-dawn light" id="layouts">
          <div className="lp-band lp-wrap">
            <BandHead icon="layout" eyebrow="Layouts" title="Arrange the call the way you work">
              <p className="ac-body-l">Drag anyone to a new spot, pull the divider to give a shared screen more room, or double-click someone to make them the speaker. Your layout only changes your own view.</p>
            </BandHead>
            <Reveal lift><LayoutScene /></Reveal>
          </div>
        </section>

        <section className="lp-band lp-wrap" id="rooms">
          <BandHead icon="rooms" eyebrow="Breakout rooms" title="Breakout rooms natively">
            <p className="ac-body-l">Open rooms in two clicks. People move in together, every room runs on the same timer, and you can message all rooms at once. Each room keeps its own notes, and they join the call’s notes when everyone’s back.</p>
          </BandHead>
          <Reveal lift><RoomsScene /></Reveal>
        </section>

        <section className="lp-dawn light" id="translate">
          <div className="lp-band lp-wrap">
            <BandHead icon="translate" eyebrow="Live translation" title="Everyone follows along in their own language.">
              <p className="ac-body-l">Captions appear in each person’s language as people speak, and the notes are written in yours. Translation happens in confidential compute too, so it’s as private as the call.</p>
            </BandHead>
            <Reveal lift><TranslateScene /></Reveal>
          </div>
        </section>

        <section className="lp-band lp-wrap" id="privacy">
          <BandHead icon="sealed" eyebrow="Privacy" title="Nobody else can read a word.">
            <p className="ac-body-l">Audio is sealed on your device and opened only inside confidential compute, hardware that proves which code it runs before it gets anything. Alcove’s servers only ever hold sealed data.</p>
          </BandHead>
          <Reveal lift><PrivacyScene /></Reveal>
        </section>

        <Close auth={auth} />
      </main>

      <div className="lp-wrap">
        <footer className="lp-foot">
          <Logo size={22} />
          <span>Private video calls with AI built in.</span>
          <nav aria-label="More"><Jump to="privacy">Privacy</Jump><Jump to="in-the-room">For therapists</Jump><Jump to="top">Back to top</Jump></nav>
        </footer>
      </div>
    </motion.div>
  );
}

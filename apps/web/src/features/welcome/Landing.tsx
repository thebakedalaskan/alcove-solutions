/*
 * The welcome page: what Alcove is, before sign-in, told as one evening on the app's own scene. The hero is Home's sunset,
 * the ways in on the sky with the sun under them, setting as the page scrolls on. The note and the call sit on its water,
 * the call a night window of its own. Then the team stands on the horizon with the sun low, your agent works in Alcove, the
 * recorder stands on the night's horizon above what Alcove can see, and morning comes up behind the last ask. Each scene
 * plays while it's on screen; with reduced motion each shows a still.
 */
import { Button, EASE, Icon, IconButton, Logo, cn, useTheme, type IconName } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { AgentScene } from './AgentScene';
import { CallTour } from './CallTour';
import { NoteScene } from './NoteScene';
import { RecordScene } from './RecordScene';
import { SealedScene } from './SealedScene';
import { PartHead, Sky } from './Sky';
import { TeamScene } from './TeamScene';
import { WaysIn, type Auth } from './WaysIn';

/** The headline: two sentences, each its own line where there's room. */
const HEADLINE = [['Your', 'meeting', 'superapp.'], ['Powered', 'by', 'confidential', 'AI.']] as const;
/** The words in the evening's colours: the sky's on the app, the sun's on what powers it. The rest are ink. */
const TINT: Partial<Record<(typeof HEADLINE)[number][number], 'lp-cool' | 'lp-warm'>> = {
  meeting: 'lp-cool', 'superapp.': 'lp-cool', confidential: 'lp-warm', 'AI.': 'lp-warm'
};
const PARTS = [['notes', 'Notes'], ['call', 'In the call'], ['time', 'Find a time'], ['agents', 'Agents'], ['offline', 'Offline'], ['privacy', 'Privacy']] as const;
const TOOLS = [
  ['search_notes', 'Find what was said, across your calls'],
  ['get_note', 'Open one call’s notes, with its moments'],
  ['ask_notes', 'Answer from your notes, citing the moments'],
  ['list_follow_ups', 'What’s yours to do, and when'],
  ['find_time', 'When everyone is free'],
  ['schedule_call', 'Book it, with notes on or off'],
  ['read_document', 'Read or edit a document in your workspace']
] as const;
const FACTS: readonly (readonly [IconName, string])[] = [
  ['badgeCheck', 'Each model’s hardware is checked before it gets a word, and every note says what was checked.'],
  ['lock', 'Titles, names, chat, audio and notes are sealed before they’re stored, under keys for your account.'],
  ['trash', 'Deleting a note removes its rows, its audio and every copy.']
];

/** A link that glides to a part of this page. */
function Jump({ to, children, current = false }: { to: string; children: ReactNode; current?: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    const t = document.getElementById(to);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  return <a href={`#${to}`} onClick={go} aria-current={current ? 'true' : undefined}>{children}</a>;
}

/**
 * Where the page is: scrolled past its top, which part is in the middle of the window, and whether night is under the nav.
 * Parts hold parts (Find a time holds Agents and Offline, and Offline holds Privacy), so the part in the middle is the
 * innermost of those there: the last of them in the page's order.
 */
function usePlace() {
  const [scrolled, setScrolled] = useState(false);
  const [part, setPart] = useState<string | null>(null);
  const [night, setNight] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener('scroll', on, { passive: true });
    const middle = new Set<string>();
    const parts = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) middle.add(e.target.id); else middle.delete(e.target.id); });
      setPart(PARTS.findLast(([id]) => middle.has(id))?.[0] ?? null);
    }, { rootMargin: '-45% 0px -50% 0px' });
    PARTS.forEach(([id]) => { const el = document.getElementById(id); if (el) parts.observe(el); });
    const under = new Set<Element>();
    let nights: IntersectionObserver | null = null;
    const watchNights = () => {
      nights?.disconnect();
      under.clear();
      nights = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) under.add(e.target); else under.delete(e.target); });
        setNight(under.size > 0);
      }, { rootMargin: `0px 0px -${Math.max(0, innerHeight - 40)}px 0px` });
      document.querySelectorAll('.lp-call, .lp-night').forEach((el) => nights?.observe(el));
    };
    watchNights();
    addEventListener('resize', watchNights);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', watchNights); parts.disconnect(); nights?.disconnect(); };
  }, []);
  return { scrolled, part, night };
}

function Nav({ auth }: { auth: Auth }) {
  const { scrolled, part, night } = usePlace();
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  return (
    <header className={cn('lp-nav', scrolled && 'is-scrolled', night && 'dark')}>
      <div className="lp-wrap lp-nav-in">
        <Jump to="top"><Logo size={25} /></Jump>
        <nav className="lp-links" aria-label="Parts of the page">{PARTS.map(([id, label]) => <Jump key={id} to={id} current={part === id}>{label}</Jump>)}</nav>
        <div className="end">
          <IconButton icon={dark ? 'sun' : 'moon'} label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'} onClick={toggle} />
          <Button variant="quiet" size="sm" className="lp-signin" disabled={auth.busy !== null} onClick={auth.google}>Sign in</Button>
          <Button variant="secondary" size="sm" className="lp-start" disabled={auth.busy !== null} onClick={auth.google}>Get started</Button>
        </div>
      </div>
    </header>
  );
}

function Hero({ auth }: { auth: Auth }) {
  const reduce = useReducedMotion() ?? false;
  const rise = (i: number) => ({ initial: reduce ? false : { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 1, delay: 0.55 + i * 0.12, ease: EASE.out } });
  return (
    <div className="lp-wrap lp-hero-in">
      <h1 className="lp-h1" aria-label={HEADLINE.map((line) => line.join(' ')).join(' ')}>
        {HEADLINE.map((line, l) => (
          <span key={line.join(' ')} className="lp-h1-line">
            {line.map((w, j) => {
              /* Where the word comes in the headline: the words rise in turn, across both lines. */
              const i = HEADLINE.slice(0, l).flat().length + j;
              return (
                <Fragment key={w}>
                  <motion.span aria-hidden="true" className={cn('lp-w', TINT[w])} initial={reduce ? false : { y: '42%', opacity: 0, rotate: 1.5 }}
                    animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 1.25, delay: 0.12 + i * 0.07, ease: EASE.out }}>{w}</motion.span>
                  {j < line.length - 1 ? ' ' : ''}
                </Fragment>
              );
            })}
          </span>
        ))}
      </h1>
      <motion.p className="lp-lede" {...rise(0)}>
        Video calls with the note taker built in. The transcript, the summary and who’s doing what are written inside confidential compute, so Alcove can’t read them.
      </motion.p>
      <motion.div {...rise(1)}><WaysIn auth={auth} layout="hero" note="Free to start, with 400 minutes of notes." /></motion.div>
    </div>
  );
}

function Close({ auth }: { auth: Auth }) {
  return (
    <div className="lp-wrap lp-close-in">
      <PartHead center title="Start your first call">Sign in with Google, Microsoft or your company’s single sign-on. Your calendar and your team come with you.</PartHead>
      <WaysIn auth={auth} layout="hero" note="Calls without notes are free." />
    </div>
  );
}

export function Landing({ auth }: { auth: Auth }) {
  return (
    <motion.div className="lp" animate={{ opacity: auth.leaving ? 0 : 1 }} transition={{ duration: 0.3, ease: EASE.in }}>
      <Nav auth={auth} />
      <main>
        <Sky moment="home" className="lp-hero" id="top" sun="set" sky={<Hero auth={auth} />}>
          <section className="lp-wrap lp-notes" id="notes" aria-labelledby="notes-title">
            <PartHead id="notes-title" title="Notes that write themselves">
              The transcript fills in as people talk. When the call ends you have the summary, what was decided and who’s doing what, each linked to the moment it was said, with the recording to play it back.
            </PartHead>
            <NoteScene />
          </section>
          <section className="lp-call dark" id="call" aria-labelledby="call-title">
            <div className="lp-wrap">
              <PartHead id="call-title" title="In the call" className="lp-call-head">All of it runs in the browser, with nothing to install, and the call is end-to-end encrypted.</PartHead>
              <CallTour />
            </div>
          </section>
          <div className="lp-gap" />
        </Sky>

        <TeamScene head={<PartHead center id="time-title" title="Find a time with your team">See when people are free across the week, never what they’re doing. Pick a time and the invite goes out from your calendar.</PartHead>}>
          <section className="lp-wrap lp-agent" id="agents" aria-labelledby="agents-title">
            <div>
              <PartHead id="agents-title" title="Your agent can use Alcove">
                Connect any agent that speaks MCP. It can search what was said, find a time and book the call, and read or edit your documents, with the access you have and no more.
              </PartHead>
              <dl className="lp-tools">{TOOLS.map(([name, what]) => <div key={name}><dt><code>{name}</code></dt><dd>{what}</dd></div>)}</dl>
            </div>
            <AgentScene />
          </section>
          <RecordScene head={<PartHead center id="offline-title" title="Offline recordings">For therapy sessions, interviews and site visits. Record without a connection: the audio is encrypted as it’s captured and uploads when you’re back online. Then the notes are written in the format you use, for you alone.</PartHead>}>
            <section className="lp-wrap lp-sealed" id="privacy" aria-labelledby="privacy-title">
              <div>
                <PartHead id="privacy-title" title="What Alcove can see">
                  Calls are end-to-end encrypted. Notes are written inside confidential compute, hardware that proves which code it runs before it’s given anything. Our servers only ever hold sealed records.
                </PartHead>
                <ul className="lp-facts">{FACTS.map(([icon, text]) => <li key={text}><Icon name={icon} size={18} />{text}</li>)}</ul>
              </div>
              <SealedScene />
            </section>
          </RecordScene>
          <div className="lp-gap" />
        </TeamScene>

        <Sky moment="home" className="lp-close" id="start" sun="rise" sky={<Close auth={auth} />}>
          <div className="lp-wrap lp-close-water">
            <footer className="lp-foot">
              <span>© 2026 Alcove</span>
              <span>Private video calls with notes written in confidential compute.</span>
              <nav aria-label="More"><Jump to="privacy">Privacy</Jump><Jump to="offline">For therapists</Jump><Jump to="agents">For agents</Jump><Jump to="top">Back to the top</Jump></nav>
            </footer>
          </div>
        </Sky>
      </main>
    </motion.div>
  );
}

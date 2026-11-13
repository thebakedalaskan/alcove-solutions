/*
 * The welcome page: what Alcove is, before sign-in, told as one evening on the app's own scene. The hero looks out of a cove
 * at Home's sunset, the ways in on the sky with the sun under them, setting as the page scrolls on. The note and the call
 * sit on its water, the call a night window of its own. Then the team stands on the horizon with the sun low, your agent
 * works in Alcove, the recorder stands on the night's horizon above what Alcove can see, the plans sit in a cove at night
 * with the last of the sun (PlansScene.tsx), and morning comes up behind the last ask, in a cove of its own. Each scene
 * plays while it's on screen; with reduced motion each shows a still. Signing in sails out of the hero's cove to Home
 * (lib/sailOut.ts, features/home/SailOut.tsx).
 */
import { Button, EASE, Icon, IconButton, Logo, cn, useTheme, type IconName } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { keepSailOut } from '~/lib/sailOut';
import { AgentScene } from './AgentScene';
import { CallTour } from './CallTour';
import { CLOSE_COVE, HERO_COVE } from './coves';
import { NoteScene } from './NoteScene';
import { PlansScene } from './PlansScene';
import { RecordScene } from './RecordScene';
import { SealedScene } from './SealedScene';
import { PartHead, Sky, coveOnScreen } from './Sky';
import { TeamScene } from './TeamScene';
import { WaysIn, type Auth } from './WaysIn';

/** The headline: two sentences, each its own line where there's room. */
const HEADLINE = [['Your', 'meeting', 'superapp.'], ['Powered', 'by', 'confidential', 'AI.']] as const;
/** The words in the evening's colours: the sky's on the app, the sun's on what powers it. The rest are ink. */
const TINT: Partial<Record<(typeof HEADLINE)[number][number], 'lp-cool' | 'lp-warm'>> = {
  meeting: 'lp-cool', 'superapp.': 'lp-cool', confidential: 'lp-warm', 'AI.': 'lp-warm'
};
const PARTS = [['notes', 'Notes'], ['call', 'In the call'], ['time', 'Find a time'], ['agents', 'Agents'], ['offline', 'Offline'], ['privacy', 'Privacy'], ['plans', 'Plans']] as const;
const TOOLS = [
  ['list_notes', 'Find what was said, across your calls'],
  ['get_note', 'Open one call’s notes, with its moments'],
  ['ask_notes', 'Answer from your notes, citing the moments'],
  ['get_inbox', 'What’s yours to do, and when'],
  ['get_availability', 'When people are busy, so your agent can find a time'],
  ['schedule_call', 'Book it, with notes on or off'],
  ['update_action', 'Update your follow-ups and mark them done']
] as const;
const FACTS: readonly (readonly [IconName, string])[] = [
  ['badgeCheck', 'Alcove runs in a confidential VM, and checks AI models’ hardware before sending them call content.'],
  ['lock', 'Titles, names, chat, audio and notes are sealed before they’re stored, under keys for your account.'],
  ['trash', 'Deleting a note removes it from Alcove’s live systems. Drive exports stay in Drive.']
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
        Video calls with the note taker built in. Get a transcript, a summary and follow-ups, with recordings and notes encrypted in storage.
      </motion.p>
      <motion.div {...rise(1)}><WaysIn auth={auth} layout="hero" note="Free to start, with about 5 hours of notes a month." /></motion.div>
    </div>
  );
}

function Close({ auth }: { auth: Auth }) {
  return (
    <div className="lp-wrap lp-close-in">
      <PartHead center title="Start your first call">Sign in to start a call. Connect Google Calendar separately to check availability and send calendar invitations.</PartHead>
      <WaysIn auth={auth} layout="hero" note="Calls without notes are free." />
    </div>
  );
}

/**
 * The ways in, remembering the hero's cove as it stands on screen as one is pressed, for signing in to sail out of. The sun
 * keeps the lift pointing at Google gave it while Google opens (`held`). When the hero was in view (`sailing`), the sky and
 * its cove stay on screen while Home loads, so Home sails out of the very cove that was there, with nothing blank between.
 */
function useSailing(auth: Auth): { ways: Auth; held: boolean; sailing: boolean } {
  const reduce = useReducedMotion() ?? false;
  const [lifted, setLifted] = useState(false);
  const [inView, setInView] = useState(false);
  const keep = () => {
    const hero = document.getElementById('top');
    const at = hero ? coveOnScreen(hero, HERO_COVE) : null;
    keepSailOut(at);
    setInView(at !== null);
    setLifted(Boolean(hero?.querySelector('.lp-hero-in .lp-go')?.matches(':hover, :focus-visible')));
  };
  return {
    ways: { ...auth, google: () => { keep(); auth.google(); }, go: (provider, email) => { keep(); return auth.go(provider, email); } },
    held: lifted && auth.busy !== null,
    sailing: inView && !reduce && auth.busy !== null
  };
}

export function Landing({ auth }: { auth: Auth }) {
  const { ways, held, sailing } = useSailing(auth);
  return (
    <motion.div className={cn('lp', auth.leaving && sailing && 'is-sailing')} animate={{ opacity: auth.leaving && !sailing ? 0 : 1 }} transition={{ duration: 0.3, ease: EASE.in }}>
      <Nav auth={ways} />
      <main>
        <Sky moment="home" className={cn('lp-hero', held && 'is-going')} id="top" sun="set" cove={HERO_COVE} sky={<Hero auth={ways} />}>
          <section className="lp-wrap lp-notes" id="notes" aria-labelledby="notes-title">
            <PartHead id="notes-title" title="Notes that write themselves">
              The transcript fills in as people talk. When the call ends you have the summary, what was decided and who’s doing what, each linked to the moment it was said, with the recording to play it back.
            </PartHead>
            <NoteScene />
          </section>
          <section className="lp-call dark" id="call" aria-labelledby="call-title">
            <div className="lp-wrap">
              <PartHead id="call-title" title="In the call" className="lp-call-head">Join from your browser. Live audio, video and screen sharing are end-to-end encrypted.</PartHead>
              <CallTour />
            </div>
          </section>
          <div className="lp-gap" />
        </Sky>

        <TeamScene head={<PartHead center id="time-title" title="Find a time with your team">See when people are free across the week, never what they’re doing. Pick a time and the invite goes out from your calendar.</PartHead>}>
          <section className="lp-wrap lp-agent" id="agents" aria-labelledby="agents-title">
            <div>
              <PartHead id="agents-title" title="Your agent can use Alcove">
                Connect an agent that speaks MCP. It can search what was said, find a time, book a call and manage your follow-ups, with the permissions you choose and the access you have.
              </PartHead>
              <dl className="lp-tools">{TOOLS.map(([name, what]) => <div key={name}><dt><code>{name}</code></dt><dd>{what}</dd></div>)}</dl>
            </div>
            <AgentScene />
          </section>
          <RecordScene head={<PartHead center id="offline-title" title="Offline recordings">For therapy sessions, interviews and site visits. Record without a connection: the audio is encrypted as it’s captured and uploads when you’re back online. Then the notes are written in the format you use, for you alone.</PartHead>}>
            <section className="lp-wrap lp-sealed" id="privacy" aria-labelledby="privacy-title">
              <div>
                <PartHead id="privacy-title" title="What Alcove can see">
                  Live call audio and video are end-to-end encrypted. When notes are on, Alcove reads call audio and transcripts to write them, only inside a confidential VM on Intel TDX. The key that opens what’s stored is made there and released only to Alcove’s signed, attested server, and your browser checks that attestation itself.
                </PartHead>
                <ul className="lp-facts">{FACTS.map(([icon, text]) => <li key={text}><Icon name={icon} size={18} />{text}</li>)}</ul>
              </div>
              <SealedScene />
            </section>
          </RecordScene>
          <div className="lp-gap" />
        </TeamScene>

        <PlansScene auth={ways} />

        <Sky moment="home" className="lp-close" id="start" sun="rise" cove={CLOSE_COVE} sky={<Close auth={ways} />}>
          <div className="lp-wrap lp-close-water">
            <footer className="lp-foot">
              <span>© 2026 Alcove</span>
              <span>End-to-end encrypted live calls with built-in notes.</span>
              <nav aria-label="More"><Link to="/privacy">Privacy policy</Link><Jump to="offline">For therapists</Jump><Jump to="agents">For agents</Jump><Jump to="top">Back to the top</Jump></nav>
            </footer>
          </div>
        </Sky>
      </main>
    </motion.div>
  );
}

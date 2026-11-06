/*
 * Your agent using Alcove over MCP: you ask it something, it calls Alcove's tools one after another (each spins, then
 * ticks with what came back), answers with the moment it found, and books the call. It plays once when it's on screen;
 * the still, and what reduced motion shows, is the finished conversation. Everything keeps its place from the start, so
 * nothing moves under what's already there.
 */
import { Chip, CheckDraw, EASE, Faces, Icon, Spinner, useSceneLoop } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { CAST } from '~/features/notes/cast';

const ASK = 'What did we decide about the onboarding launch? Then book 45 minutes with Priya and Kofi next week to go over it.';
/** What it calls, with what, and what came back. Tuesday 10 November at 11:00 is free for all three in the week on this page. */
const CALLS = [
  { tool: 'search_notes', args: '“onboarding launch”', back: '3 notes' },
  { tool: 'get_note', args: 'Team standup · 5 Nov', back: '1 decision, 2 follow-ups' },
  { tool: 'find_time', args: 'Priya, Kofi, you · 45 min · 9–13 Nov', back: 'Tue 10 Nov, 11:00' },
  { tool: 'schedule_call', args: 'Onboarding review · notes on', back: 'Booked' }
] as const;
const BEFORE = 'The new onboarding ships behind a flag on 12 November, and support gets the help article first.'.split(' ');
const AFTER = 'Priya’s help article is still open, due Friday. I booked Onboarding review for Tuesday 10 November at 11:00 with Priya and Kofi, with notes on.'.split(' ');

/* The beats, in order: your message, then each call running and back, the answer, and the call it booked. */
const ASKED = 1;
const running = (i: number) => 2 + 2 * i;
const back = (i: number) => 3 + 2 * i;
const ANSWERED = back(CALLS.length - 1) + 1;
const BOOKED = ANSWERED + 1;
/** Between one word of the answer and the next, in seconds. */
const WORD = 0.028;

/** Comes up into its place when `on`; until then it holds that place, unseen. */
function Rise({ on, className, children }: { on: boolean; className: string; children: ReactNode }) {
  return (
    <motion.div className={className} initial={false} animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }} transition={{ duration: 0.55, ease: EASE.out }}>
      {children}
    </motion.div>
  );
}

/** A word of the answer, written in after the `i` before it. */
function Word({ on, i, children }: { on: boolean; i: number; children: ReactNode }) {
  return <motion.span initial={false} animate={{ opacity: on ? 1 : 0 }} transition={{ duration: 0.3, delay: on ? i * WORD : 0 }}>{children}</motion.span>;
}

export function AgentScene() {
  const reduce = useReducedMotion() ?? false;
  const [beat, setBeat] = useState(reduce ? BOOKED : 0);
  const win = useRef<HTMLDivElement>(null);

  useSceneLoop(win, async (c) => {
    await c.sleep(500);
    setBeat(ASKED);
    await c.sleep(1100);
    for (let i = 0; i < CALLS.length; i++) {
      setBeat(running(i));
      await c.sleep(900);
      setBeat(back(i));
      await c.sleep(300);
    }
    setBeat(ANSWERED);
    await c.sleep((BEFORE.length + AFTER.length + 1) * WORD * 1000 + 300);
    setBeat(BOOKED);
  }, !reduce);

  const said = beat >= ANSWERED;
  return (
    <div ref={win} className="lp-ag">
      <div className="lp-ag-top">
        <span className="lp-ag-mark"><Icon name="agent" size={17} /></span>
        Your agent
        <Chip><span className="ok" aria-hidden="true" />Alcove connected</Chip>
      </div>
      <div className="lp-ag-body">
        <Rise on={beat >= ASKED} className="lp-ag-you">{ASK}</Rise>
        {CALLS.map((call, i) => {
          const done = beat >= back(i);
          return (
            <Rise key={call.tool} on={beat >= running(i)} className="lp-ag-call">
              <span className="st">{beat === running(i) && <Spinner />}<CheckDraw done={done} size={15} duration={reduce ? 0 : 0.36} /></span>
              <span><code>{call.tool}</code> <span className="q">{call.args}</span></span>
              <motion.span className="res" initial={false} animate={{ opacity: done ? 1 : 0 }} transition={{ duration: 0.3 }}>{call.back}</motion.span>
            </Rise>
          );
        })}
        <p className="lp-ag-say">
          {BEFORE.map((w, i) => <Word key={`b${i}`} on={said} i={i}>{`${w} `}</Word>)}
          <Word on={said} i={BEFORE.length}><Chip icon="moment" className="lp-ag-mc">Team standup · 6:12</Chip></Word>
          {AFTER.map((w, i) => <Word key={`a${i}`} on={said} i={BEFORE.length + 1 + i}>{` ${w}`}</Word>)}
        </p>
        <Rise on={beat >= BOOKED} className="lp-ag-booked">
          <span className="d">Tue<b>10</b></span>
          <span className="t">Onboarding review<small>11:00–11:45 · notes on · invites from your calendar</small></span>
          <Faces people={[CAST.priya, CAST.kofi, CAST.art]} size={24} max={3} />
        </Rise>
      </div>
      <div className="lp-ag-foot" aria-hidden="true">Message your agent<span className="snd"><Icon name="send" size={16} /></span></div>
    </div>
  );
}

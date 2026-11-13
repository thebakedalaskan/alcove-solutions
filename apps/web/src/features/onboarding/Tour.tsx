/*
 * The tour of Home: after a new account comes in, and again from your menu or Settings. Each slide points at the real
 * thing as it is now, found by its `data-tour` hook: Start now and Schedule, the call Home offers, the example note or
 * Calls, Search or ask, the Drive, Record, Agents. A slide whose thing isn't there (nothing to join, Agents on a phone)
 * is left out, or points at what stands in for it (the example note before there are notes); nothing is drawn onto the
 * page for the tour.
 */
import { TourDialog, useToast, type TourSlide } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { shortcut } from '~/lib/keys';
import { minutesUntil, untilLabel } from '~/lib/time';
import { aheadShown, going, joinable, type Ahead } from '~/features/calls/list/ahead';
import { usePlanChoiceUp } from '~/features/plans/choice';
import { ArtAgents, ArtAsk, ArtCall, ArtDrive, ArtNotes, ArtRoom, ArtStart, ArtSun } from './art';
import { arrival, rememberTour, tourSeen, useArrival } from './store';

/** The first element with this hook that's on screen: laid out, and not in something inert (a hidden side panel). */
const hook = (name: string) => (): HTMLElement | null => {
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) if (el instanceof HTMLElement && el.getClientRects().length && !el.closest('[inert]')) return el;
  return null;
};

/** A slide before it knows what follows it. `lead` is the button on the slide before that leads to it. */
type Draft = Omit<TourSlide, 'next'> & { lead: string };

/** The slides for Home as it is right now, in order. `join` is the call Home offers at the top, by Home's own rule. */
function slidesFor(o: { join: Ahead | undefined; now: number }): TourSlide[] {
  // Keyboard shortcuts are only worth mentioning where there's a keyboard.
  const keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const drafts: Draft[] = [];
  const add = (d: Draft) => { if (d.target()) drafts.push(d); };
  add({
    id: 'start', lead: 'Back to the start', title: 'Start or schedule a call', art: <ArtStart />, prefer: ['below', 'right', 'left'], target: hook('start'),
    text: `Start now goes straight to the call. Schedule suggests times that suit everyone and sends the invites.${keys ? ' Or press N.' : ''}`
  });
  // Home only marks its line for an Alcove call, so a meeting elsewhere gets no stop.
  if (o.join) {
    add({
      id: 'join', lead: 'Show me the call', title: 'Join a call', art: <ArtCall />, prefer: ['below', 'right', 'left'], target: hook('join'),
      text: `${o.join.title} ${going(o.join, o.now) ? 'is happening now' : `starts ${untilLabel(minutesUntil(o.join.startsAt, o.now))}`}. Join from here${keys ? ', or press J' : ''}. Captions, chat and boards are in the call.`
    });
  }
  const example = hook('notes-example');
  add(example()
    ? {
      id: 'notes', lead: 'Show me notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['right', 'above', 'left'], target: example,
      text: 'Open the example to see what a call leaves you: a summary, decisions and follow-ups, written in confidential compute.'
    }
    : {
      id: 'notes', lead: 'Show me notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['right', 'below', 'above'], target: hook('calls'),
      text: 'Every call’s notes are in Calls: a summary, decisions and follow-ups, written in confidential compute.'
    });
  add({
    id: 'ask', lead: 'Show me search', title: 'Search or ask', art: <ArtAsk />, prefer: ['below', 'left'], target: hook('ask'),
    text: `Find what anyone said in any call, or ask a question and get an answer with the moments it came from.${keys ? ` Press ${shortcut('K')}.` : ''}`
  });
  add({
    id: 'drive', lead: 'Show me the Drive', title: 'Documents and boards', art: <ArtDrive />, prefer: ['right', 'above', 'below'], target: hook('drive'),
    text: 'Write and sketch together in a call. Each call keeps what it made, and the Drive keeps it all.'
  });
  add({
    id: 'room', lead: 'Show me recording', title: 'Record in the room', art: <ArtRoom />, prefer: ['right', 'above', 'below'], target: hook('record'),
    text: 'Meeting in person? Record on your phone, even offline. Notes are written when you’re back online.'
  });
  add({
    id: 'agents', lead: 'Show me agents', title: 'Bring your agent', art: <ArtAgents />, prefer: ['right', 'above'], target: hook('agents'),
    text: 'Let Claude or another agent find notes and book calls for you, with only what you allow.'
  });
  add({
    id: 'ready', lead: 'Back to the start', title: 'You’re ready', art: <ArtSun />, prefer: ['below', 'right', 'left'], target: hook('start'),
    text: 'Start a call now, or schedule one for later.'
  });
  return drafts.map((d, i) => ({ id: d.id, title: d.title, text: d.text, art: d.art, prefer: d.prefer, target: d.target, next: drafts[i + 1]?.lead ?? 'Start using Alcove' }));
}

export function TourHost() {
  const { tour, stage } = useArrival();
  const session = useQuery(accountQueries.session()).data;
  const upcoming = useQuery(callQueries.upcoming()).data;
  const calendar = useQuery(calendarQueries.calendar()).data;
  const prefs = useQuery(accountQueries.prefs()).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  // The address changes as soon as a navigation starts; Home is on the page once the router has finished.
  const settled = useRouterState({ select: (s) => s.status === 'idle' });
  const navigate = useNavigate();
  const toast = useToast();
  const [slides, setSlides] = useState<TourSlide[] | null>(null);
  // The plans come first when they're up in Home's place (features/plans/choice.ts): the tour waits for Home.
  const choosing = usePlanChoiceUp();

  useEffect(() => {
    if (!tour || !session || stage !== 'none' || choosing) return;
    if (tour.auto && tourSeen(session.ownerId)) { arrival.tourTaken(); return; }
    if (path !== '/home') { void navigate({ to: '/home' }); return; }
    if (!settled) return;
    // Home settles in first.
    const t = setTimeout(() => {
      const now = Date.now();
      const join = joinable(aheadShown(upcoming, calendar?.events, prefs?.showOtherMeetings, now), session.user.email, now);
      const s = slidesFor({ join, now });
      arrival.tourTaken();
      if (s.length) setSlides(s);
    }, tour.auto ? 350 : 250);
    return () => clearTimeout(t);
  }, [tour, session, stage, choosing, path, settled, navigate, upcoming, calendar, prefs]);

  if (!slides || !session) return null;
  return (
    <TourDialog slides={slides} onClose={(finished) => {
      setSlides(null);
      rememberTour(session.ownerId);
      toast(finished ? 'You can take the tour again from your menu.' : 'Tour closed. You can take it again from your menu.', { icon: 'compass', ms: 4200 });
    }} />
  );
}

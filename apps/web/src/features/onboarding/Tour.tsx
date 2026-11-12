/*
 * The tour of Home: after a new account comes in, and again from your menu or Settings. Each stop points at the real
 * thing as it is now, found by its `data-tour` hook: Start now and Schedule, the call Home offers, the example note or
 * Calls, Search or ask, the Drive, Record, Agents. A stop whose thing isn't there (nothing to join, Agents on a phone) is
 * left out, or points at what stands in for it (the example note before there are notes); nothing is drawn onto the page
 * for the tour.
 */
import { TourDialog, useToast, type TourSlide } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { q } from '~/lib/queries';
import { shortcut } from '~/lib/keys';
import { minutesUntil, untilLabel } from '~/lib/time';
import { aheadOf, joinable, type Ahead } from '~/features/home/day';
import { ArtAgents, ArtAsk, ArtCall, ArtDrive, ArtNotes, ArtRoom, ArtStart, ArtSun } from './art';
import { arrival, rememberTour, tourSeen, useArrival } from './store';

/** The first element with this hook that's on screen: laid out, and not in something inert (a hidden side panel). */
const hook = (name: string) => (): HTMLElement | null => {
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) if (el instanceof HTMLElement && el.getClientRects().length && !el.closest('[inert]')) return el;
  return null;
};

/** A stop before it knows what follows it. `called` names it on the button before it ("Show me search"), unless `lead` says the whole button. */
type Draft = Omit<TourSlide, 'next'> & { called: string; lead?: string | undefined };

/** The stops for Home as it is right now, in order. `join` is the call Home offers at the top, when it's an Alcove call. */
function slidesFor(o: { join: Ahead | undefined }): TourSlide[] {
  // Keyboard shortcuts are only worth mentioning where there's a keyboard.
  const keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const drafts: Draft[] = [];
  const add = (d: Draft) => { if (d.target()) drafts.push(d); };
  add({
    id: 'start', called: 'where to start', title: 'Start or schedule a call', art: <ArtStart />, prefer: ['below', 'right', 'left'], target: hook('start'),
    text: `Start now goes straight to the call. Schedule suggests times that suit everyone and sends the invites.${keys ? ' N starts one from any page.' : ''}`
  });
  if (o.join?.kind === 'call') {
    const mins = minutesUntil(o.join.startsAt);
    add({
      id: 'join', called: 'the call', title: 'Join a call', art: <ArtCall />, prefer: ['below', 'right', 'left'], target: hook('join'),
      text: `${o.join.title} ${mins <= 0 ? 'is happening now' : `starts ${untilLabel(mins)}`}. Join from here${keys ? ', or press J' : ''}. Captions, chat and boards are in the call.`
    });
  }
  const example = hook('notes-example');
  add(example()
    ? {
      id: 'notes', called: 'notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['right', 'above', 'left'], target: example,
      text: 'Open the example to see what a call leaves you: a summary, decisions and follow-ups, written in confidential compute.'
    }
    : {
      id: 'notes', called: 'notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['right', 'below', 'above'], target: hook('calls'),
      text: 'Every call’s notes are in Calls: a summary, decisions and follow-ups, written in confidential compute.'
    });
  add({
    id: 'ask', called: 'search', title: 'Search or ask', art: <ArtAsk />, prefer: ['below', 'left'], target: hook('ask'),
    text: `Find what anyone said in any call, or ask a question and get an answer with the moments it came from.${keys ? ` Press ${shortcut('K')}.` : ''}`
  });
  add({
    id: 'drive', called: 'the Drive', title: 'Documents and boards', art: <ArtDrive />, prefer: ['right', 'above', 'below'], target: hook('drive'),
    text: 'Write and sketch together in a call. Each call keeps what it made, and the Drive keeps it all.'
  });
  add({
    id: 'room', called: 'recording', title: 'Record in the room', art: <ArtRoom />, prefer: ['right', 'above', 'below'], target: hook('record'),
    text: 'Meeting in person? Record on your phone, even offline. Notes are written when you’re back online.'
  });
  add({
    id: 'agents', called: 'agents', title: 'Bring your agent', art: <ArtAgents />, prefer: ['right', 'above'], target: hook('agents'),
    text: 'Let Claude or another agent find notes and book calls for you, with only what you allow.'
  });
  add({
    id: 'ready', called: 'where to start', lead: 'Back to the start', title: 'You’re ready', art: <ArtSun />, prefer: ['below', 'right', 'left'], target: hook('start'),
    text: 'Start a call now, or schedule one for later.'
  });
  return drafts.map((d, i) => {
    const after = drafts[i + 1];
    return { id: d.id, title: d.title, text: d.text, art: d.art, prefer: d.prefer, target: d.target, next: after ? after.lead ?? `Show me ${after.called}` : 'Start using Alcove' };
  });
}

export function TourHost() {
  const { tour, stage } = useArrival();
  const session = useQuery(q.session()).data;
  const upcoming = useQuery(q.upcoming()).data;
  const calendar = useQuery(q.calendar()).data;
  const prefs = useQuery(q.prefs()).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const toast = useToast();
  const [slides, setSlides] = useState<TourSlide[] | null>(null);

  useEffect(() => {
    if (!tour || !session || stage !== 'none') return;
    if (tour.auto && tourSeen(session.ownerId)) { arrival.tourTaken(); return; }
    if (path !== '/home') { void navigate({ to: '/home' }); return; }
    // Home settles in first.
    const t = setTimeout(() => {
      const now = Date.now();
      // The call Home offers at the top, by Home's own rule.
      const others = prefs?.showOtherMeetings !== false;
      const join = joinable(aheadOf(upcoming ?? [], others ? calendar?.events ?? [] : [], now), session.user.email, now);
      const s = slidesFor({ join });
      arrival.tourTaken();
      if (s.length) setSlides(s);
    }, tour.auto ? 350 : 250);
    return () => clearTimeout(t);
  }, [tour, session, stage, path, navigate, upcoming, calendar, prefs]);

  if (!slides || !session) return null;
  return (
    <TourDialog slides={slides} onClose={(finished) => {
      setSlides(null);
      rememberTour(session.ownerId);
      toast(finished ? 'You can take the tour again from your menu.' : 'Tour closed. You can take it again from your menu.', { icon: 'compass', ms: 4200 });
    }} />
  );
}

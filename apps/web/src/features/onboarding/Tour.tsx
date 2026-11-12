/*
 * The tour of Home: after a new account comes in, and again from Settings. Each slide points
 * at the real thing on Home as it is now, found by its `data-tour` hook. A slide whose thing isn't
 * there (no calls yet, nothing to join) is left out, or points at what stands in for it (the example
 * note); nothing is drawn onto the page for the tour.
 */
import type { Meeting } from '@alcove/api';
import { TourDialog, useToast, type TourSlide } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { q } from '~/lib/queries';
import { minutesUntil, untilLabel } from '~/lib/time';
import { aheadOf, joinable, type Ahead } from '~/features/home/day';
import { usePlanChoiceUp } from '~/features/plans/choice';
import { ArtCall, ArtNotes, ArtRoom, ArtSchedule, ArtSeal, ArtSun } from './art';
import { arrival, rememberTour, tourSeen, useArrival } from './store';

/** The first element with this hook that's on screen: laid out, and not in something inert (a hidden side panel). */
const hook = (name: string) => (): HTMLElement | null => {
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) if (el instanceof HTMLElement && el.getClientRects().length && !el.closest('[inert]')) return el;
  return null;
};

/** A slide before it knows what follows it; `called` names it on the button before it. */
type Draft = Omit<TourSlide, 'next'> & { called: string };

/** The slides for Home as it is right now, in order. */
function slidesFor(o: { next: Meeting | undefined; join: Ahead | undefined; firstDay: boolean; calendar: boolean }): TourSlide[] {
  // Keyboard shortcuts are only worth mentioning where there's a keyboard.
  const keys = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const drafts: Draft[] = [];
  const add = (d: Draft) => { if (d.target()) drafts.push(d); };
  add({
    id: 'schedule', called: 'notes', title: 'Start or schedule a call', art: <ArtSchedule />, prefer: ['right', 'below'], target: hook('new-call'),
    text: `Press Start a call${keys ? ', or N,' : ''} to go now, or schedule it for later: who, when, then the details. Alcove suggests the times${o.calendar ? ' and puts it on your calendar' : ''}.`
  });
  const example = hook('notes-example');
  add(example()
    ? { id: 'notes', called: 'notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['left', 'below', 'above'], target: example, text: 'See what your notes will look like: a summary, decisions and follow-ups. Only the people invited get them.' }
    : { id: 'notes', called: 'notes', title: 'Notes for your calls', art: <ArtNotes />, prefer: ['right', 'above', 'below'], target: hook('notes'), text: 'Notes are set when you schedule. Everyone in the call can see they’re on, and only the people invited get them.' });
  if (o.join) {
    const mins = minutesUntil(o.join.startsAt);
    add({
      id: 'join', called: 'how to join', title: 'Join a call', art: <ArtCall />, prefer: ['below', 'above', 'right'], target: hook('join'),
      text: `${o.join.title} ${mins <= 0 ? 'is happening now' : `starts ${untilLabel(mins)}`}. Join from here${keys ? ' or press J' : ''}. Captions and translation are in the call.`
    });
  }
  add({ id: 'room', called: 'the room', title: 'Record in the room', art: <ArtRoom />, prefer: ['right', 'below'], target: hook('room'), text: 'Meeting in person? Record on your phone, even offline. Notes are written when you’re back online.' });
  add({ id: 'sealed', called: 'privacy', title: 'Your notes stay yours', art: <ArtSeal />, prefer: ['left', 'below'], target: hook('sealed'), text: 'Alcove encrypts stored notes and uses the call’s sharing permissions to decide who can open them.' });
  add({
    id: 'ready', called: 'where to start', title: 'You’re ready', art: <ArtSun />, prefer: ['right', 'below', 'left'], target: hook('new-call'),
    text: `Start a call now, or schedule one for later.${o.firstDay && o.next?.notes === 'on' ? ` Your first notes arrive after ${o.next.title}.` : ''}`
  });
  return drafts.map((d, i) => {
    const after = drafts[i + 1];
    return { id: d.id, title: d.title, text: d.text, art: d.art, prefer: d.prefer, target: d.target, next: after ? `Show me ${after.called}` : 'Start using Alcove' };
  });
}

export function TourHost() {
  const { tour, stage } = useArrival();
  const session = useQuery(q.session()).data;
  const upcoming = useQuery(q.upcoming()).data;
  const notes = useQuery(q.notes()).data;
  const calendar = useQuery(q.calendar()).data;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const toast = useToast();
  const [slides, setSlides] = useState<TourSlide[] | null>(null);
  // The plans come first when they're up in Home's place (features/plans/choice.ts): the tour waits for Home.
  const choosing = usePlanChoiceUp();

  useEffect(() => {
    if (!tour || !session || stage !== 'none' || choosing) return;
    if (tour.auto && tourSeen(session.ownerId)) { arrival.tourTaken(); return; }
    if (path !== '/home') { void navigate({ to: '/home' }); return; }
    // Home settles in first.
    const t = setTimeout(() => {
      const now = Date.now();
      const next = (upcoming ?? []).filter((m) => new Date(m.endsAt).getTime() > now && !m.offer).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      const join = joinable(aheadOf(upcoming ?? [], [], now), session.user.email, now);
      const s = slidesFor({ next, join, firstDay: (notes ?? []).length === 0, calendar: calendar?.source === 'google' && !calendar.needsAccess });
      arrival.tourTaken();
      if (s.length) setSlides(s);
    }, tour.auto ? 350 : 250);
    return () => clearTimeout(t);
  }, [tour, session, stage, choosing, path, navigate, upcoming, notes, calendar]);

  if (!slides || !session) return null;
  return (
    <TourDialog slides={slides} onClose={(finished) => {
      setSlides(null);
      rememberTour(session.ownerId);
      toast(finished ? 'You can take the tour again from Settings.' : 'Tour closed. You can take it again from Settings.', { icon: 'compass', ms: 4200 });
    }} />
  );
}

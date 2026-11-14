/*
 * Landing on For you, where the side panel's Home count leads (`/home#for-you`). For you comes into view, gliding while Home
 * was already open (unless motion is reduced) and simply there on arriving from another page, turns to the tab where things
 * wait with focus on it, and its edge glows for a moment (Widget's `landed`). Then the address lets go of the hash, so the
 * count lands again each time it's pressed, and a reload opens Home as ever.
 */
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/** The hash that names For you in Home's address, which is also its id. */
export const FOR_YOU = 'for-you';
/** How long For you stays marked once landed on: a little longer than its glow fades (kit.css, `.ac-widget[data-landed]`). */
const GLOW_MS = 2000;

/**
 * Lands on For you while the address names it. `turn` turns For you to the tab where things wait and gives back what takes
 * focus there. Says whether For you is marked as just landed on.
 */
export function useLandOnForYou(turn: () => HTMLElement | null): boolean {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const navigate = useNavigate();
  /* How many times it has landed this visit, and whether it's marked now. */
  const [landings, setLandings] = useState(0);
  const [landed, setLanded] = useState(false);
  const turning = useRef(turn);
  useEffect(() => { turning.current = turn; });
  /* Whether Home was open before the address named For you. */
  const open = useRef(false);
  useEffect(() => {
    if (hash !== FOR_YOU) return;
    const box = document.getElementById(FOR_YOU);
    if (box) {
      // Arriving, Home starts from its top as any page opens: an address with a hash keeps the last page's scroll.
      if (!open.current) scrollTo({ top: 0 });
      // Then only as far as it takes to see it whole (scroll-margin keeps it off the page's edge), or its top when it's taller.
      const glide = open.current && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollIntoView({ block: 'nearest', behavior: glide ? 'smooth' : 'auto' });
      turning.current()?.focus({ preventScroll: true });
      setLandings((n) => n + 1);
    }
    void navigate({ to: '/home', replace: true, resetScroll: false, hashScrollIntoView: false });
  }, [hash, navigate]);
  useEffect(() => { open.current = true; }, []);
  /* Each landing marks it afresh: off for a frame, so a glow that's still fading starts again, then on for a while. */
  useEffect(() => {
    if (!landings) return;
    setLanded(false);
    const frame = requestAnimationFrame(() => setLanded(true));
    const t = setTimeout(() => setLanded(false), GLOW_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(t); };
  }, [landings]);
  return landed;
}

/*
 * Signing in from the welcome page sails out of its cove to Home (docs/design/pages.md › Welcome). The welcome page kept where
 * its cove stood on screen as a way in was pressed (lib/sailOut.ts). Home takes it as it first shows and sails out of that
 * cove onto itself, once: to its own horizon and sun, inside the page's real frame, with the side panel sliding in and its
 * own parts rising in as the sea clears. A new account has its arrival instead, and with reduced motion Home just opens.
 */
import type { SailOutStored } from '@alcove/api';
import { SailOut, type SailFrom, type SailHome } from '@alcove/ui';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useArrival } from '~/features/onboarding/store';
import { HERO_COVE } from '~/features/welcome/coves';
import { log } from '~/lib/log';
import { takeSailOut } from '~/lib/sailOut';

const slog = log.child({ component: 'sail-out' });
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pxOf = (v: string) => Number.parseFloat(v) || 0;

/** Home as it's laid out (`page` is its evening): its horizon and sun, the frame round it, and what comes in. */
function homeAt(page: HTMLElement): SailHome | null {
  const scene = page.querySelector(':scope > .hz');
  const sun = scene?.querySelector(':scope > .hz-up > .hz-light');
  if (!scene || !sun) return null;
  const at = sun.getBoundingClientRect();
  const shell = page.closest('.shell');
  /* The page's rounded edge is the shell's ::after (styles/shell.css); a phone has none. */
  const edge = shell ? getComputedStyle(shell, '::after') : null;
  const frame = edge && edge.display !== 'none'
    ? { top: pxOf(edge.top), right: pxOf(edge.right), bottom: pxOf(edge.bottom), left: pxOf(edge.left), radius: pxOf(edge.borderTopLeftRadius) }
    : null;
  const side = frame && shell && !shell.classList.contains('is-bare') ? shell.querySelector(':scope > .sb .sb-in') : null;
  /* Search and you (or the phone's top bar), then Home's own parts in their order. */
  const rise = [shell?.querySelector(':scope > .ph-head'), shell?.querySelector('.top-acts'), ...Array.from(page.querySelector(':scope > .dusk-in')?.children ?? [])]
    .filter((el): el is Element => el instanceof Element);
  return { line: at.top, x: at.left, r: pxOf(getComputedStyle(scene).getPropertyValue('--hz-sun-r')) || 48, frame, side, rise };
}

/**
 * Where the sail starts: the hero's cove as it was on screen, when it was in view in a window this wide and its sun can rise
 * from there to Home's; otherwise the hero's cove low in the window, as the welcome page opens.
 */
function startFrom(hero: SailOutStored['hero'], home: SailHome): SailFrom {
  const width = document.documentElement.clientWidth;
  if (hero && Math.abs(hero.width - width) <= 1 && hero.line + hero.sun > home.line + 1) return { ...hero, width, seen: true };
  const line = Math.round(Math.max(document.documentElement.clientHeight * 0.7, home.line + 40));
  return { width, line, sky: line, foot: Math.round(HERO_COVE.foot(line)), sun: 0, r: clamp(width * 0.041, 44, 60), words: [], seed: HERO_COVE.seed };
}

/** Plays the sail over Home (`page`, its evening) if a way in on the welcome page was pressed on the way here. */
export function SailOutHere({ page }: { page: RefObject<HTMLElement | null> }) {
  const { stage } = useArrival();
  const arriving = useRef(stage !== 'none');
  const [sail, setSail] = useState<{ from: SailFrom; home: SailHome } | null>(null);

  useLayoutEffect(() => {
    const kept = takeSailOut();
    const el = page.current;
    if (!kept || !el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (arriving.current || still) { slog.debug('not sailing out', { arriving: arriving.current, reducedMotion: still }); return; }
    const home = homeAt(el);
    if (!home) { slog.warn('home not found to sail out to'); return; }
    const from = startFrom(kept.hero, home);
    slog.debug('sailing out', { heroInView: kept.hero !== null, framed: home.frame !== null, rising: home.rise.length });
    setSail({ from, home });
  }, [page]);

  if (!sail) return null;
  return <SailOut from={sail.from} home={sail.home} onDone={() => setSail(null)} />;
}

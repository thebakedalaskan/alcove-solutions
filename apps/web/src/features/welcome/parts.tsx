/* Pieces the welcome page's scenes share: the call's header and dock, people's tiles and words that write themselves in. */
import { CallDock, CallTile, DockButton, DockLeave, DockSeparator, EASE, NotesSign, type IconName } from '@alcove/ui';
import { motion } from 'motion/react';
import { Fragment, type ReactNode } from 'react';
import { CAST, firstOf, type CastId } from '~/features/notes/cast';

/** A rectangle in a scene's design pixels: left, top, width, height. */
export type Rect = readonly [number, number, number, number];
export const box = (r: Rect) => ({ left: r[0], top: r[1], width: r[2], height: r[3] });


/** The call's title, the notes sign and the clock, across the top of the stage. */
export function SceneHead({ title, time, left = 24, top = 22, width }: { title: string; time: string; left?: number; top?: number; width?: number }) {
  return (
    <div className="lp-sc-head" style={width ? { left, top, width } : { left, top, right: 24 }}>
      <span className="t">{title}</span>
      <NotesSign stage>Notes on</NotesSign>
      <span className="ac-time">{time}</span>
    </div>
  );
}

const TOOLS: { icon: IconName; label: string }[] = [{ icon: 'layout', label: 'Layout' }, { icon: 'rooms', label: 'Breakout rooms' }, { icon: 'notes', label: 'Notes' }, { icon: 'chat', label: 'Chat' }];

/** The dock, with one tool open. `press` changes each time that tool is pressed. */
export function SceneDock({ on, press = 0 }: { on: IconName; press?: number }) {
  return (
    <div className="lp-sc-dock">
      <CallDock>
        <DockButton icon="mic" label="Microphone" tabIndex={-1} />
        <DockButton icon="video" label="Camera" tabIndex={-1} />
        <DockButton icon="screen" label="Share screen" tabIndex={-1} />
        <DockSeparator />
        {TOOLS.map((t) => t.icon === on
          ? <motion.span key={`${t.icon}-${press}`} className="press" initial={{ scale: 1 }} animate={press ? { scale: [1, 0.88, 1] } : { scale: 1 }} transition={{ duration: 0.28, ease: EASE.inOut }}><DockButton icon={t.icon} label={t.label} on tabIndex={-1} /></motion.span>
          : <DockButton key={t.icon} icon={t.icon} label={t.label} tabIndex={-1} />)}
        <DockSeparator />
        <DockLeave tabIndex={-1} />
      </CallDock>
    </div>
  );
}

/** A person's tile at a fixed place on the stage. */
export function Tile({ id, rect, speaking = false }: { id: CastId; rect: Rect; speaking?: boolean }) {
  return <div className="lp-tile" style={box(rect)}><CallTile person={CAST[id]} name={firstOf(id)} speaking={speaking} /></div>;
}

/**
 * Words that write themselves in: each rises out of a blur a beat after the one before. `chunks` are
 * the pieces to reveal (words, or phrases for languages written without spaces); `joiner` goes
 * between them. `still` shows them as they are.
 */
export function WriteIn({ chunks, joiner = ' ', step = 0.09, delay = 0, blur = 4, still = false }: { chunks: string[]; joiner?: string; step?: number; delay?: number; blur?: number; still?: boolean }) {
  return (
    <>
      {chunks.map((w, i) => (
        <Fragment key={`${i}-${w}`}>
          <motion.span className="lp-w-in" initial={still ? false : { opacity: 0, y: 5, filter: `blur(${blur}px)` }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.5, delay: delay + i * step, ease: EASE.out }}>{w}</motion.span>
          {i < chunks.length - 1 ? joiner : ''}
        </Fragment>
      ))}
    </>
  );
}

export const words = (s: string) => s.split(' ').filter(Boolean);

/** The panel of a scene that can't be used, only watched. */
export function SceneFrame({ children }: { children: ReactNode }) {
  return <div className="lp-frame ac-stage dark">{children}</div>;
}

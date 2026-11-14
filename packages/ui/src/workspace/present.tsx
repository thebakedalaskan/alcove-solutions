/* Playing a video for everyone, a page that swaps in place, and a document's history. */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../foundation/cn';
import { Icon } from '../foundation/icon';
import { Button, IconButton } from '../foundation/primitives';
import { useMove } from './shared';

/** Swaps what's inside in place, cross-fading 240 ms, when `id` changes: the page of a document. */
export function WsFade({ id, children, className }: { id: string; children: ReactNode; className?: string | undefined }) {
  const move = useMove();
  return <motion.div key={id} className={className} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={move(2)}>{children}</motion.div>;
}

/**
 * How a video playing for everyone is going in this browser, when it isn't simply playing along: said in place of who's
 * playing it, with what to do about it. Nothing about it reaches anyone else.
 */
export interface WsPlayingHere { say: string; action?: { label: string; onClick: () => void } | undefined }

/**
 * A video playing for everyone. `mine`: you started it. `by`: who did, by first name. `canControl`: you can pause, move and
 * stop it, as whoever started it and the organizer can. `progress` and `volume` run from 0 to 1, and volume is yours alone.
 */
export interface WsPlaying { title: string; mine: boolean; by: string; canControl: boolean; on: boolean; at: string; progress: number; volume: number; here?: WsPlayingHere | null | undefined }

/**
 * Above the dock while a video plays for everyone. Pass what's playing to show it: it rises 10 px, 420 ms, and drops 10 px
 * and fades, 240 ms, when you pass null. Whoever can control it gets play and pause, the bar to move it along, and stop.
 * `lift` raises it, in px, over whatever else stands above the dock, such as captions.
 */
export function WsPlayBar({ playing, lift = 0, onToggle, onSeek, onStop, onVolume }: {
  playing: WsPlaying | null; lift?: number | undefined; onToggle: () => void; onSeek: (progress: number) => void; onStop: () => void; onVolume: (volume: number) => void;
}) {
  const move = useMove();
  const label = playing?.on ? 'Pause for everyone' : 'Play for everyone';
  const here = playing?.here;
  return (
    <AnimatePresence initial={false}>
      {playing && (
        <motion.div className="ws-play" role="group" aria-label={playing.title} style={{ '--lift': `${lift}px` }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: move(3) }} exit={{ opacity: 0, y: 10, transition: move(2) }}>
          {playing.canControl && <button type="button" className="ws-pb" aria-label={label} title={label} onClick={onToggle}>{playing.on ? <Icon name="pause" size={16} /> : <Icon name="play" size={15} />}</button>}
          <span className="m"><b>{playing.title}</b><small role="status">{here ? here.say : playing.mine ? 'Playing for everyone' : `${playing.by} is playing this for everyone`}</small></span>
          {here?.action ? <Button size="xs" className="ws-ph" onClick={here.action.onClick}>{here.action.label}</Button> : (
            <span className={cn('bar', playing.canControl && 'can-seek')}>
              <i style={{ width: `${playing.progress * 100}%` }} />
              {playing.canControl && <input type="range" min={0} max={1} step={0.001} value={playing.progress} aria-label="Where it’s playing, for everyone" onChange={(e) => onSeek(Number(e.target.value))} />}
            </span>
          )}
          <span className="ac-time">{playing.at}</span>
          <span className="v">
            <Icon name="speaker" size={15} />
            <span className="vb"><i style={{ width: `${playing.volume * 100}%` }} /><input type="range" min={0} max={1} step={0.05} value={playing.volume} aria-label="Your volume" onChange={(e) => onVolume(Number(e.target.value))} /></span>
            <small>Only you</small>
          </span>
          {playing.canControl && <button type="button" className="ws-px" aria-label="Stop for everyone" title="Stop for everyone" onClick={onStop}><Icon name="x" size={15} /></button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A version of a document: during a call, by someone, when it began. `fixed`: it's only saying so, and there's nothing to open. */
export interface WsVersion { id: string; name: string; sub: string; at: string; fixed?: boolean | undefined }

/** What Restore asks first, when it would change the page under someone. */
export interface WsRestoreAsk { text: string; onRestore: () => void; onKeep: () => void }

/**
 * History, beside the page: versions grouped by call, newest first. Pressing one shows it, and Up and Down move through them.
 * Restore shows on anything but the first, which is now: leave `onRestore` out for someone who can only read. `ask` takes
 * its place while it's asking. `note` says what's here when there's nothing to go back to.
 */
export function WsHistory({ versions, selected, onSelect, onRestore, restoring = false, ask, note, onClose }: {
  versions: WsVersion[]; selected: string; onSelect: (id: string) => void; onRestore?: (() => void) | undefined; restoring?: boolean | undefined;
  ask?: WsRestoreAsk | null | undefined; note?: string | undefined; onClose: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  /* The keyboard comes here as it opens, so Up, Down and Esc work straight away, and stays on what's chosen. */
  useEffect(() => {
    const box = list.current;
    if (opened.current && !box?.contains(document.activeElement)) return;
    opened.current = true;
    box?.querySelector<HTMLElement>('.is-cur')?.focus({ preventScroll: true });
  }, [selected]);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = versions.filter((v) => !v.fixed);
    const next = rows[rows.findIndex((v) => v.id === selected) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) onSelect(next.id);
  };
  const row = (v: WsVersion) => <><span className="m"><b>{v.name}</b><small>{v.sub}</small></span><span className="ac-time">{v.at}</span></>;
  const past = versions[0] !== undefined && selected !== versions[0].id;
  return (
    <aside className="wh" aria-label="History">
      <div className="wh-h"><b>History</b><IconButton icon="x" size={16} className="wd-ib" label="Close history" onClick={onClose} /></div>
      <div ref={list} className="wh-l" onKeyDown={keys}>
        {versions.map((v) => (v.fixed ? <div key={v.id} className="wh-r is-fixed">{row(v)}</div> : (
          <button key={v.id} type="button" className={cn('wh-r', v.id === selected && 'is-cur')} aria-pressed={v.id === selected} onClick={() => onSelect(v.id)}>{row(v)}</button>
        )))}
        {note && <p className="wh-n">{note}</p>}
      </div>
      {past && onRestore && (
        <div className="wh-f">
          {ask ? <>
            <p>{ask.text}</p>
            <div className="ac">
              <Button size="sm" loading={restoring} onClick={ask.onRestore}>Restore for everyone</Button>
              <Button variant="quiet" size="sm" disabled={restoring} onClick={ask.onKeep}>Not yet</Button>
            </div>
          </> : <Button size="sm" loading={restoring} onClick={onRestore}>Restore this version</Button>}
        </div>
      )}
    </aside>
  );
}

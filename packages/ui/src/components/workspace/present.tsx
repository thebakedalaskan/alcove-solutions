/* Presenting, playing a video for everyone, and a document's history. */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { Icon } from '../icon';
import { Faces, type AvatarPerson } from '../people';
import { Button, IconButton } from '../primitives';
import { useMove } from './shared';

/** At the top of the page for whoever's presenting: what everyone is seeing. */
export interface WsPresentMine { mine: true; name: string; at: number; total: number }
/**
 * At the top of the page for everyone else who can open it. `away`: they've gone to Work on my own, and the strip brings
 * them back. `onStop` is for the organizer, who can stop anyone's presentation.
 */
export interface WsPresentTheirs { mine?: false | undefined; name: string; presenter: AvatarPerson; by: string; away: boolean; onToggle: () => void; onStop?: (() => void) | undefined }
/** For someone who can't open what's being presented: who's presenting, and nothing about what. */
export interface WsPresentPrivate { mine?: false | undefined; name: null; presenter: AvatarPerson; by: string; onStop?: (() => void) | undefined }

/** The strip that says what's being presented. It takes the place of a document's head. */
export function WsPresentStrip(props: WsPresentMine | WsPresentTheirs | WsPresentPrivate) {
  if (props.mine) {
    return (
      <div className="wp-tag" role="status">
        <span className="ws-live" /><b>Everyone sees this</b><span className="wp-name">{props.name} · {props.at} of {props.total}</span>
      </div>
    );
  }
  const stop = props.onStop && <Button variant="quiet" size="xs" onClick={props.onStop}>Stop presenting</Button>;
  return (
    <div className="wp-tag" role="status">
      <Faces people={[props.presenter]} size={20} /><b>{props.by} is presenting</b><span className="wp-name">{props.name ?? 'Something you can’t open'}</span>
      {(props.name !== null || stop) && (
        <span className="wp-acts">
          {props.name !== null && <Button variant="quiet" size="xs" onClick={props.onToggle}>{props.away ? 'Back to the presentation' : 'Work on my own'}</Button>}
          {stop}
        </span>
      )}
    </div>
  );
}

/**
 * Beside the page, for whoever's presenting: where you are, Back and Next, your notes and Stop presenting, which stays at
 * the foot. `part`: this section's name. `next`: the next one's, or null at the end. `notes` is null for someone without an
 * account, who has nowhere to keep them.
 */
export function WsPresenterView({ at, total, part, next, notes, onNotes, onBack, onNext, onStop }: {
  at: number; total: number; part: string; next: string | null; notes: string | null; onNotes: (notes: string) => void; onBack: () => void; onNext: () => void; onStop: () => void;
}) {
  return (
    <aside className="wp" aria-label="Presenter view">
      <div className="wp-sec">
        <span className="ac-eyebrow">Only you see this</span>
        <div className="wp-now"><span className="n">{at}<small>of {total}</small></span><div><b>{part}</b><small>Next: {next ?? 'That’s the end'}</small></div></div>
        <div className="wp-go">
          <Button size="sm" disabled={at <= 1} onClick={onBack}><Icon name="left" size={15} />Back</Button>
          <Button variant="primary" size="sm" disabled={next === null} onClick={onNext}>Next<Icon name="right" size={15} /></Button>
        </div>
      </div>
      {notes === null ? <div className="wp-sec grow" /> : (
        <div className="wp-sec grow"><span className="ac-eyebrow">Your notes</span><textarea className="wp-notes" aria-label="Your notes" value={notes} onChange={(e) => onNotes(e.target.value)} /></div>
      )}
      <Button variant="quiet" size="sm" onClick={onStop}><Icon name="stop" size={13} />Stop presenting</Button>
    </aside>
  );
}

/** Swaps what's inside in place, cross-fading 240 ms, when `id` changes: a presentation's sections, the page of a document. */
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

/** A version of a document: during a call, by someone, when it began. */
export interface WsVersion { id: string; name: string; sub: string; at: string }

/**
 * History, beside the page: versions grouped by call, newest first. Pressing one shows it. Restore shows on anything but
 * the first, which is now.
 */
export function WsHistory({ versions, selected, onSelect, onRestore, onClose }: { versions: WsVersion[]; selected: string; onSelect: (id: string) => void; onRestore: () => void; onClose: () => void }) {
  return (
    <aside className="wh" aria-label="History">
      <div className="wh-h"><b>History</b><IconButton icon="x" size={16} className="wd-ib" label="Close history" onClick={onClose} /></div>
      <div className="wh-l">
        {versions.map((v) => (
          <button key={v.id} type="button" className={cn('wh-r', v.id === selected && 'is-cur')} aria-pressed={v.id === selected} onClick={() => onSelect(v.id)}>
            <span className="m"><b>{v.name}</b><small>{v.sub}</small></span><span className="ac-time">{v.at}</span>
          </button>
        ))}
      </div>
      {versions[0] && selected !== versions[0].id && <div className="wh-f"><Button size="sm" onClick={onRestore}>Restore this version</Button></div>}
    </aside>
  );
}

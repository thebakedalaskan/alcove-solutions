/*
 * Playing a video for everyone, on the call's screen: the call's one player (sharedVideo.ts), for as long as the call is
 * on, and the bar above the dock. The bar says what's playing and who started it, and has your own volume; whoever can
 * control it also gets play and pause, the bar to move it along, and stop. How it's going in this browser, when that isn't
 * simply playing along, takes the place of who started it, with what to do about it.
 */
import { firstName, type CallSession } from '@alcove/api';
import { WsPlayBar, type WsPlaying, type WsPlayingHere } from '@alcove/ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspacePlaying } from '~/features/workspace/context';
import { useLive } from '~/lib/live';
import { position } from '~/lib/time';
import { SharedVideo, type PlayHere, type PlayView } from './sharedVideo';
import { videoSourceFor } from './videoSource';

/** The call's player, from when the call's screen opens until `on` is false: the call has ended, or you've left it. */
export function useSharedVideo(session: CallSession, on: boolean, failed: (e: unknown) => void): SharedVideo {
  const said = useRef(failed);
  said.current = failed;
  const [player] = useState(() => {
    const pass = session.ticket.pass;
    const about = (v: { workspaceId: string; documentId: string; mediaId: string }) =>
      import('~/features/workspace/videoAbout').then(({ videoAbout }) => videoAbout(v.workspaceId, v.documentId, v.mediaId, pass));
    return new SharedVideo(session, videoSourceFor(pass), about, (e) => said.current(e));
  });
  useEffect(() => (on ? player.start() : undefined), [player, on]);
  return player;
}

/**
 * What the workspace needs to know about what's playing: which document and file, and whether you may start another. It
 * changes only when one of those does, not every second.
 */
export function useWorkspacePlaying(player: SharedVideo, start: (documentId: string, mediaId: string) => void): WorkspacePlaying {
  const key = useSyncExternalStore(player.subscribe, () => {
    const p = player.getSnapshot().play;
    return p ? `${p.documentId} ${p.mediaId} ${p.mine ? 'mine' : 'theirs'}` : '';
  });
  const begin = useRef(start);
  begin.current = start;
  return useMemo((): WorkspacePlaying => {
    const [documentId, media, whose] = key.split(' ');
    const now = documentId && media ? { documentId, video: { media, clock: player.clock, show: player.show } } : null;
    /* Nobody starts a video over someone else's: the call would refuse it. Your own gives way to the next you start. */
    return { now, start: now && whose !== 'mine' ? undefined : (d, m) => begin.current(d, m) };
  }, [player, key]);
}

function hereOf(here: PlayHere, player: SharedVideo): WsPlayingHere | null {
  switch (here) {
    case 'playing': return null;
    case 'starting':
    case 'loading': return { say: 'Loading…' };
    case 'blocked': return { say: 'Your browser is holding it back', action: { label: 'Play here', onClick: player.join } };
    case 'away': return { say: 'Paused for you', action: { label: 'Back to everyone', onClick: player.join } };
    case 'unsupported': return { say: 'This browser can’t play it' };
    case 'failed': return { say: 'It didn’t load here', action: { label: 'Try again', onClick: player.retry } };
  }
}

function barOf(v: PlayView, player: SharedVideo): WsPlaying | null {
  const p = v.play;
  if (!p) return null;
  return {
    title: v.title || 'Video', mine: p.mine, by: firstName(p.by.name), canControl: p.canControl, on: v.playing,
    at: position(v.at / 1000), progress: v.length ? Math.min(1, v.at / v.length) : 0, volume: v.volume, here: hereOf(v.here, player)
  };
}

/** Room between the bar and captions, which stand above the dock too. */
const CLEAR = 8;

/**
 * How far the bar rises so captions stay readable under it. The call draws them where it likes, at whatever height their
 * lines need, so it looks twice a second while something plays.
 */
function useCaptionRoom(on: boolean): number {
  const [lift, setLift] = useState(0);
  const now = useRef(0);
  now.current = lift;
  useEffect(() => {
    if (!on) { setLift(0); return; }
    const look = () => {
      const bar = document.querySelector('.ws-play');
      const cap = document.querySelector('.ic-cap');
      const next = bar && cap ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom + now.current - cap.getBoundingClientRect().top + CLEAR)) : 0;
      setLift((was) => (Math.abs(was - next) < 2 ? was : next));
    };
    look();
    const t = setInterval(look, 500);
    return () => clearInterval(t);
  }, [on]);
  return lift;
}

/** The bar above the dock, while a video plays for everyone. */
export function PlayTogetherBar({ player }: { player: SharedVideo }) {
  const view = useLive(player);
  const lift = useCaptionRoom(view.play !== null);
  return <WsPlayBar playing={barOf(view, player)} lift={lift} onToggle={player.toggle} onSeek={player.seek} onStop={player.stop} onVolume={player.setVolume} />;
}

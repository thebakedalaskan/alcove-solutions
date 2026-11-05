/*
 * A video played for everyone in a call (docs: Calls and recordings › Playing a video together). Every browser plays the
 * file itself, from the workspace: nobody shares a screen, so nobody hears it twice, and the picture is the file's own. The
 * call says what's playing in the part of it you're in, and where it's got to on the server's clock (`CallWorkspace.play`,
 * `playPosition`); this keeps one player in step with that. A little either way is let be; more than half a second, and
 * it moves to where everyone is. Someone who joins late lands at the same moment.
 *
 * There's one player for the whole call, whatever's open: a video block on screen borrows its picture (`show`), and with
 * none it plays out of sight and is still heard. It stops when the call says nothing's playing where you are, which is what
 * stopping, losing the document, being removed, another workspace or another room all come to. Nothing done here alone
 * reaches anyone else: a browser that won't play sound until something's pressed, or the system's own pause key, holds it
 * for you, and Back to everyone puts you where everyone is.
 */
import { errorCode, playPosition, type CallPlay, type CallSession, type LiveStore } from '@alcove/api';
import { log } from '~/lib/log';
import type { VideoClock } from '~/features/workspace/editor/types';

const plog = log.child({ component: 'play-together' });

/** A video in the call's workspace, as the call names it. */
export interface CallVideo { workspaceId: string; documentId: string; mediaId: string }
/** Where a video is read from: the workspace's media, which a player reads by range. */
export type VideoSource = (video: CallVideo) => Promise<string>;
/** What a video's block says about it: its title, and how long it is, in seconds, if it says. */
export interface VideoAbout { title: string; seconds: number | null }
export type VideoAboutReader = (video: CallVideo) => Promise<VideoAbout | null>;

/** How far this player can drift from everyone else's before it's moved to where they are. */
export const DRIFT_MS = 500;
/** A held picture is the same frame for everyone. */
const HELD_MS = 40;
const TICK_MS = 250;

/**
 * How it's going here. `starting`: the file's on its way. `playing`: in step with everyone, playing or held as the call says.
 * `loading`: waiting for more of the file. `blocked`: the browser won't play it until something here is pressed. `away`:
 * paused here with the system's own controls. `unsupported`: this browser can't play the file. `failed`: it didn't arrive.
 */
export type PlayHere = 'starting' | 'playing' | 'loading' | 'blocked' | 'away' | 'unsupported' | 'failed';

export interface PlayView {
  /** What's playing where you are, as the call last said. Null when nothing is. */
  play: CallPlay | null;
  /** Whether it's playing for everyone, counting what you've just asked for. */
  playing: boolean;
  /** What its block calls it, once its document has been read. */
  title: string;
  here: PlayHere;
  /** Where it is for everyone, in whole seconds, as ms. */
  at: number;
  /** How long it is, in ms, once that's known. */
  length: number | null;
  /** Yours alone, from 0 to 1. */
  volume: number;
}

const NOTHING: PlayView = { play: null, playing: false, title: '', here: 'starting', at: 0, length: null, volume: 1 };

const same = (a: PlayView, b: PlayView) =>
  a.play === b.play && a.playing === b.playing && a.title === b.title && a.here === b.here && a.at === b.at && a.length === b.length && a.volume === b.volume;

/** What someone who can control it just asked for, until the call has answered. */
interface Asked { positionMs: number; playing: boolean; at: number }

export class SharedVideo implements LiveStore<PlayView> {
  private readonly video: HTMLVideoElement;
  /** Where the player waits, out of sight, while no block on screen has its picture. */
  private readonly hold: HTMLDivElement;
  private places: HTMLElement[] = [];
  private listeners = new Set<() => void>();
  private view: PlayView = NOTHING;
  private clockView: VideoClock = { seconds: 0, total: 0 };
  private clockListeners = new Set<() => void>();
  /** What the call said last, and when this browser heard it, on its own clock. */
  private play: CallPlay | null = null;
  private heard = 0;
  private asked: Asked | null = null;
  /** The file in the player, as `<document>/<media>`, and the video it is. */
  private loaded: string | null = null;
  private current: CallVideo | null = null;
  private title = '';
  private aboutLength: number | null = null;
  private blocked = false;
  private away = false;
  private waiting = false;
  private failure: 'unsupported' | 'failed' | null = null;
  /** It played here once: a file that stops arriving now is the connection, or a URL that's run out. */
  private started = false;
  private retried = false;
  private volume = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Whoever started it has said it's over, at the end. */
  private endSaid = false;
  private unhear: (() => void) | null = null;
  private unpress: (() => void) | null = null;

  constructor(
    private readonly session: CallSession,
    private readonly source: VideoSource,
    private readonly about: VideoAboutReader,
    private readonly failed: (e: unknown) => void
  ) {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.disableRemotePlayback = true;
    for (const type of ['loadedmetadata', 'durationchange', 'canplay', 'playing', 'waiting', 'seeked', 'ended', 'error']) v.addEventListener(type, this.onMedia);
    this.video = v;
    this.hold = document.createElement('div');
    this.hold.className = 'ws-vhold';
    this.hold.setAttribute('aria-hidden', 'true');
    this.hold.append(v);
  }

  getSnapshot = (): PlayView => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Where it's got to, for a video block: it moves on about once a second, and nothing else draws again for it. */
  readonly clock = {
    subscribe: (listener: () => void) => {
      this.clockListeners.add(listener);
      return () => { this.clockListeners.delete(listener); };
    },
    getSnapshot: (): VideoClock => this.clockView
  };

  /** Follows the call from now on. What it returns stops following it, and leaves nothing playing. */
  start(): () => void {
    document.body.append(this.hold);
    this.unhear = this.session.subscribe(this.hearCall);
    this.hearCall();
    return () => {
      this.unhear?.();
      this.unhear = null;
      this.play = null;
      this.unload();
      this.hold.remove();
      this.publish();
    };
  }

  /** Lends the picture to a block, until what it returns is called. The last block to ask has it; with none, it's out of sight. */
  show = (into: HTMLElement): (() => void) => {
    this.places.push(into);
    into.append(this.video);
    return () => {
      this.places = this.places.filter((p) => p !== into);
      if (this.video.parentElement === into) (this.places.at(-1) ?? this.hold).append(this.video);
    };
  };

  /** Plays here in step with everyone: for a browser that held it back, or someone who paused it here. Press it from a click. */
  join = () => {
    this.blocked = false;
    this.away = false;
    this.unpress?.();
    this.step();
  };

  /** Tries the file again, after it didn't arrive. */
  retry = () => {
    this.failure = null;
    this.retried = false;
    this.loaded = null;
    this.step();
  };

  setVolume = (volume: number) => {
    this.volume = Math.max(0, Math.min(1, volume));
    this.video.volume = this.volume;
    this.publish();
  };

  /** Whoever can control it: pauses it for everyone where it is now, or plays it on. */
  toggle = () => {
    const want = this.shared();
    if (!want) return;
    if (want.playing) {
      const at = Math.round(this.here() === 'playing' ? this.video.currentTime * 1000 : want.at);
      this.ask({ positionMs: at, playing: false }, () => this.session.pausePlaying(at));
    } else {
      this.ask({ positionMs: want.at, playing: true }, () => this.session.resumePlaying());
    }
  };

  /** Whoever can control it: moves it along for everyone, `progress` from 0 to 1. */
  seek = (progress: number) => {
    const want = this.shared();
    const length = this.length();
    if (!want || length === null) return;
    const at = Math.round(Math.max(0, Math.min(1, progress)) * length);
    this.ask({ positionMs: at, playing: want.playing }, () => this.session.seekPlaying(at));
  };

  /** Whoever can control it: stops it for everyone. The video stays in its document. */
  stop = () => { this.session.stopPlaying().catch(this.failed); };

  private ask(next: Omit<Asked, 'at'>, send: () => Promise<void>) {
    const asked: Asked = { ...next, at: performance.now() };
    this.asked = asked;
    this.step();
    /* Once the call has answered, what it says is what's so: the answer is in by the time this settles. */
    send().catch(this.failed).finally(() => {
      if (this.asked !== asked) return;
      this.asked = null;
      this.step();
    });
  }

  private hearCall = () => {
    const now = this.session.getSnapshot().workspace.play;
    if (now === this.play) return;
    const was = this.play;
    this.play = now;
    this.heard = performance.now();
    if (!now || !was || was.mediaId !== now.mediaId || was.documentId !== now.documentId) this.endSaid = false;
    this.step();
  };

  /** Where it is for everyone now, in ms, and whether it's playing: what you just asked for, or else what the call said. */
  private shared(): { at: number; playing: boolean } | null {
    const p = this.play;
    if (!p) return null;
    const now = performance.now();
    const a = this.asked;
    const at = a ? a.positionMs + (a.playing ? now - a.at : 0) : playPosition(p, now - this.heard);
    const length = this.length();
    return { at: Math.max(0, length === null ? at : Math.min(at, length)), playing: a ? a.playing : p.playing };
  }

  private length(): number | null {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d * 1000 : this.aboutLength;
  }

  private here(): PlayHere {
    if (this.failure) return this.failure;
    if (this.blocked) return 'blocked';
    if (this.away) return 'away';
    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) return 'starting';
    if (this.waiting && this.shared()?.playing) return 'loading';
    return 'playing';
  }

  /** Brings the player in line with the call. It runs on every word from the call and four times a second while something's on. */
  private step = () => {
    const p = this.play;
    if (!p) { this.unload(); this.publish(); return; }
    const key = `${p.documentId}/${p.mediaId}`;
    if (this.loaded !== key) this.load(p, key);
    if (!this.timer) this.timer = setInterval(this.step, TICK_MS);
    const want = this.shared();
    const v = this.video;
    if (want && this.failure === null && v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      const off = Math.abs(v.currentTime * 1000 - want.at);
      if (want.playing && !this.away) {
        if (!v.seeking && off > DRIFT_MS) v.currentTime = want.at / 1000;
        /* Played to the end here a moment before everyone: playing it again would start it over. */
        const length = this.length();
        const over = length !== null && want.at >= length - (v.ended ? DRIFT_MS : 0);
        if (v.paused && !this.blocked && !over) this.resume();
      } else {
        if (!v.paused) v.pause();
        if (!want.playing && !v.seeking && off > HELD_MS) v.currentTime = want.at / 1000;
      }
    }
    this.atTheEnd(p, want);
    this.publish();
  };

  /** Whoever started it says it's over when it reaches the end, once, so it stops for everyone. */
  private atTheEnd(p: CallPlay, want: { at: number; playing: boolean } | null) {
    const length = this.length();
    if (!p.mine || this.endSaid || !want?.playing || length === null || want.at < length) return;
    this.endSaid = true;
    this.session.stopPlaying().catch((e: unknown) => plog.debug('the end wasn’t said', { code: errorCode(e) }));
  }

  private resume() {
    const v = this.video;
    v.volume = this.volume;
    v.play().then(() => {
      this.started = true;
      if (this.blocked) { this.blocked = false; this.publish(); }
    }, (e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        if (this.blocked) return;
        plog.info('the browser held a video back until something is pressed', { documentId: this.play?.documentId ?? null });
        this.blocked = true;
        this.whenPressed();
        this.publish();
        return;
      }
      /* Paused or moved on before it got going: the next step sorts it out. */
      if (e instanceof DOMException && e.name === 'AbortError') return;
      plog.warn('a video didn’t play', { err: e });
    });
  }

  /** Anything pressed here counts, as it does for the call's own sound, as well as Play here. */
  private whenPressed() {
    if (this.unpress) return;
    const go = () => this.join();
    const kinds = ['pointerdown', 'keydown'] as const;
    for (const k of kinds) addEventListener(k, go, { capture: true });
    this.unpress = () => {
      for (const k of kinds) removeEventListener(k, go, { capture: true });
      this.unpress = null;
    };
  }

  private load(p: CallPlay, key: string) {
    this.loaded = key;
    this.failure = null;
    this.blocked = false;
    this.away = false;
    this.waiting = false;
    this.started = false;
    this.retried = false;
    this.title = '';
    this.aboutLength = null;
    this.unpress?.();
    this.empty();
    this.current = null;
    const workspaceId = this.session.getSnapshot().workspace.id;
    if (workspaceId === null) { this.failure = 'failed'; return; }
    const video: CallVideo = { workspaceId, documentId: p.documentId, mediaId: p.mediaId };
    this.current = video;
    this.takeMediaKeys();
    this.about(video).then((a) => {
      if (this.loaded !== key || !a) return;
      this.title = a.title;
      this.aboutLength = a.seconds === null ? null : a.seconds * 1000;
      this.nameIt();
      this.publish();
    }, (e: unknown) => plog.debug('a video’s block wasn’t read', { code: errorCode(e), documentId: p.documentId }));
    this.open(video, key);
  }

  /** Asks where the file is and gives it to the player. A URL is never logged: for a guest it's all it takes to read the file. */
  private open(video: CallVideo, key: string) {
    this.source(video).then((src) => {
      if (this.loaded !== key) return;
      this.video.src = src;
      this.video.load();
    }, (e: unknown) => {
      if (this.loaded !== key) return;
      plog.warn('a video playing for everyone didn’t open', { code: errorCode(e), documentId: video.documentId, mediaId: video.mediaId });
      this.failure = 'failed';
      this.publish();
    });
  }

  private onMedia = (e: Event) => {
    switch (e.type) {
      case 'waiting': this.waiting = true; break;
      case 'canplay':
      case 'playing': this.waiting = false; break;
      case 'error': this.broke(); return;
    }
    this.step();
  };

  /** The file didn't play. Once it had, it's the connection or a URL that's run out, so it's asked for again, once. */
  private broke() {
    const key = this.loaded;
    const video = this.current;
    if (key === null || !this.video.getAttribute('src')) return;
    const code = this.video.error?.code ?? null;
    if (this.started && !this.retried && video) {
      this.retried = true;
      plog.info('a video playing for everyone stopped arriving, so it’s asked for again', { code, documentId: video.documentId });
      this.open(video, key);
      return;
    }
    this.failure = this.started || code === MediaError.MEDIA_ERR_NETWORK || !navigator.onLine ? 'failed' : 'unsupported';
    plog.warn('a video playing for everyone can’t play here', { code, why: this.failure });
    this.publish();
  }

  /** Nothing's playing here any more: the player lets go of the file and the system's keys. */
  private unload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.loaded === null) return;
    this.loaded = null;
    this.current = null;
    this.asked = null;
    this.unpress?.();
    this.giveBackMediaKeys();
    this.empty();
  }

  private empty() {
    const v = this.video;
    v.pause();
    if (!v.getAttribute('src')) return;
    v.removeAttribute('src');
    v.load();
  }

  /** The system's own pause and play keys hold it for you alone, and bring you back. */
  private takeMediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const s = navigator.mediaSession;
    s.setActionHandler('pause', () => { this.away = true; this.video.pause(); this.publish(); });
    s.setActionHandler('play', () => this.join());
  }

  private nameIt() {
    if ('mediaSession' in navigator && this.title) navigator.mediaSession.metadata = new MediaMetadata({ title: this.title });
  }

  private giveBackMediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const s = navigator.mediaSession;
    s.setActionHandler('pause', null);
    s.setActionHandler('play', null);
    s.metadata = null;
  }

  private publish() {
    const p = this.play;
    const want = this.shared();
    const length = this.length();
    const next: PlayView = p
      ? { play: p, playing: want?.playing ?? false, title: this.title, here: this.here(), at: Math.floor((want?.at ?? 0) / 1000) * 1000, length, volume: this.volume }
      : { ...NOTHING, volume: this.volume };
    if (!same(next, this.view)) {
      this.view = next;
      this.listeners.forEach((l) => l());
    }
    const clock: VideoClock = { seconds: next.at / 1000, total: length === null ? 0 : length / 1000 };
    if (clock.seconds !== this.clockView.seconds || clock.total !== this.clockView.total) {
      this.clockView = clock;
      this.clockListeners.forEach((l) => l());
    }
  }
}

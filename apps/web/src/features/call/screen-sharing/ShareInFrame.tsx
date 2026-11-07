/*
 * A screen in its frame (layout/frame.tsx): someone's share looked at your own way (ShareSurface.tsx: zoom, a picture held
 * still, earlier pictures, its own window), with everyone's pointers and marks on it (SharePointing.tsx), and your own share as
 * it goes out. The frame is one tab stop: its keys are the share's (LOOK_KEYS, L to point, and while pointing, the pointer's),
 * and its name menu (`ShareMenuRows`) lists them. What's kept of each share (`useShareLooks`) is this screen's only, let go of
 * when the share stops, when your part of the call changes, and (earlier pictures) while notes are paused.
 */
import type { Person } from '@alcove/api';
import { Icon, Kbd, RecDot, Scope, cn, useSettledPress, useToast, type IconName } from '@alcove/ui';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLive } from '~/lib/live';
import { callName } from '~/lib/people';
import { screenOf } from '../layout/onStage';
import type { StageShare } from '../layout/Stage';
import { FeedVideo } from '../media/Video';
import type { ShareMarks } from './marks';
import { popKind } from './popOut';
import { isZoomed, ZOOM_MAX } from './shareFrame';
import { LOOK_ARIA, LOOK_KEYS, ShareLooks, type ShareLook } from './shareLook';
import { ShareMarksDrawing, SharePointing, type PointingKeys } from './SharePointing';
import { ShareAway, ShareSurface, ShareWindow, historyNote } from './ShareSurface';

/** How each share is looked at here, kept for those on your stage or in their own window, and let go of with the rest. */
export function useShareLooks({ shares, part, paused, kept }: { shares: readonly StageShare[]; part: string; paused: boolean; kept: readonly string[] }) {
  const [looks] = useState(() => new ShareLooks());
  const seen = useLive(looks);
  useEffect(() => () => looks.clear(), [looks]);
  useEffect(() => { looks.policy(part, paused); }, [looks, part, paused]);
  const others = shares.filter((s) => !s.mine).map((s) => s.id).join(' ');
  const popped = seen.popped && shares.some((s) => s.id === seen.popped?.id) ? seen.popped.id : null;
  const keptKey = [...kept, ...(popped ? [popped] : [])].join(' ');
  useEffect(() => { looks.sync(others ? others.split(' ') : [], keptKey ? keptKey.split(' ') : []); }, [looks, others, keptKey]);
  return { looks, seen, popped };
}
export type Looks = ReturnType<typeof useShareLooks>;

/**
 * A share you brought back from its own window (Back to the call, in its frame or in the window, Bring it back here, or closing
 * the window) takes the keys back: on your stage, its frame's body, where its keys work; as a tile, its tile. So focus never
 * drops to the page as the button that brought it back goes.
 */
export function useFocusBack(looks: Looks): void {
  const n = looks.seen.back?.n ?? 0;
  const { looks: store } = looks;
  useEffect(() => {
    const id = store.getSnapshot().back?.id;
    if (!n || !id) return;
    document.querySelector<HTMLElement>(`.ic-scr-body[data-share="${CSS.escape(id)}"], [data-tile="${CSS.escape(screenOf(id))}"]`)?.focus({ preventScroll: true });
  }, [n, store]);
}

/** Pointing at a share: which one you point at (one at a time), and the keys each share's pointing takes while you do. */
export function usePointing(shares: readonly StageShare[], onStage: (id: string) => boolean, popped: string | null) {
  const [at, setAt] = useState<string | null>(null);
  const keys = useRef(new Map<string, PointingKeys>());
  const setters = useRef(new Map<string, (f: PointingKeys | null) => void>());
  const keysOf = (id: string) => {
    let set = setters.current.get(id);
    if (!set) {
      set = (f) => { if (f) keys.current.set(id, f); else keys.current.delete(id); };
      setters.current.set(id, set);
    }
    return set;
  };
  // Pointing ends with the share going from your stage, into its own window, or closing to you (its presenter, or the organizer, said so).
  const now = at !== null && shares.some((s) => s.id === at && s.point !== null && s.point.closed === null && onStage(s.id) && popped !== s.id) ? at : null;
  useEffect(() => { if (at !== null && now === null) setAt(null); }, [at, now]);
  return { at: now, set: setAt, keys, keysOf };
}
export type Pointing = ReturnType<typeof usePointing>;

/** A share on your stage, in its frame: its picture, looked at your own way, with pointers and marks on it. */
export function ShareInFrame({ share: s, look, looks, popped, marks, me, whoIs, pointing, onPopOut }: {
  share: StageShare;
  /** How you look at it: someone else's, live in the room. Null for your own, which is shown as it goes out. */
  look: ShareLook | null;
  looks: ShareLooks;
  /** It's in its own window: the frame says so, with a way to bring it back. */
  popped: boolean;
  marks: ShareMarks | null;
  me: Person;
  whoIs: (id: string) => Person;
  pointing: Pointing;
  onPopOut: (() => void) | null;
}) {
  const here = pointing.at === s.id;
  const can = s.point !== null && s.point.closed === null && !popped && !look?.getSnapshot().held;
  const toggle = () => { if (here) pointing.set(null); else if (can) pointing.set(s.id); };
  /* The frame's body takes the share's keys: the pointer's while pointing, then L, then looking closer. */
  const keys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    if (here && pointing.keys.current.get(s.id)?.(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if ((e.key === 'l' || e.key === 'L') && !e.shiftKey && (can || here)) { e.preventDefault(); e.stopPropagation(); toggle(); return; }
    if (look && look.key(e.key)) { e.preventDefault(); e.stopPropagation(); }
  };
  const said = [s.label, s.sound ? (s.sound.muted ? 'its sound muted for you' : 'with sound') : '', popped ? 'in its own window' : '',
    here ? 'you’re pointing at it: arrow keys move your pointer, Enter marks, Backspace takes your last mark back, Escape stops' : can ? 'L to point at it' : ''];
  const drawing = s.point && marks ? <ShareMarksDrawing marks={marks} share={s.point.sid} whoIs={whoIs} me={me} /> : null;
  const point = s.point && marks ? (
    <SharePointing marks={marks} share={s.point.sid} look={look} mine={s.mine} big can={s.point.closed === null} active={here}
      onKeys={pointing.keysOf(s.id)} onActive={(on) => pointing.set(on ? s.id : null)}>{look ? null : drawing}</SharePointing>
  ) : null;
  return (
    <div className={cn('ic-scr-body', here && 'is-pointing')} data-share={s.id} tabIndex={0} role="group" aria-roledescription="shared screen"
      aria-label={said.filter(Boolean).join(', ')} aria-keyshortcuts={`L${look ? ` ${LOOK_ARIA}` : ''}`} aria-describedby={look ? `sv-${s.id}` : undefined} onKeyDown={keys}>
      {popped ? <ShareAway onBack={() => looks.popIn(true)} />
        : look && 'room' in s.feed ? (
          <ShareSurface look={look} feed={s.feed} where="stage" label={s.name} describe={`sv-${s.id}`} popOut={onPopOut ? { open: false, toggle: onPopOut } : null} overLive={drawing}>{point}</ShareSurface>
        ) : <><FeedVideo feed={s.feed} className="screen" />{point}</>}
    </div>
  );
}

/** Someone's share in its own window, while it's there: in that window's document, from here. */
export function ShareWindows({ shares, looks, marks, me, whoIs }: { shares: readonly StageShare[]; looks: Looks; marks: ShareMarks | null; me: Person; whoIs: (id: string) => Person }) {
  const win = looks.seen.popped;
  const s = win ? shares.find((x) => x.id === win.id) : undefined;
  if (!win || !s || !('room' in s.feed)) return null;
  return createPortal(
    <ShareWindow look={looks.looks.look(s.id)} feed={s.feed} presenter={s.presenter} name={s.name} kind={win.kind} onBack={() => looks.looks.popIn(true)}
      over={s.point && marks ? <ShareMarksDrawing marks={marks} share={s.point.sid} whoIs={whoIs} me={me} /> : null} />, win.win.document.body
  );
}

/** Opens someone's share in its own window, from the click that asked: the browser opens one only from a click. Null where it can't. */
export function usePopOut(looks: ShareLooks): ((s: StageShare) => void) | null {
  const toast = useToast();
  const [kind] = useState(popKind);
  if (!kind) return null;
  return (s) => {
    const pic = looks.look(s.id).getSnapshot().pic;
    void looks.popOut(s.id, s.name, pic.w > 0 && pic.h > 0 ? pic.w / pic.h : 1.6).then((r) => {
      if (r === 'blocked') toast(kind === 'window' ? 'Your browser blocked the window. Allow pop-ups for Alcove, then try again.' : 'Your browser didn’t open the window. Try again.', { icon: 'pip' });
    });
  };
}

function Row({ icon, label, kb, keys, onPick, disabled = false, end }: { icon: IconName; label: string; kb?: string | undefined; keys?: string | undefined; onPick: () => void; disabled?: boolean | undefined; end?: ReactNode }) {
  return (
    <button type="button" className="mi" role="menuitem" disabled={disabled} aria-keyshortcuts={keys} onClick={onPick}>
      <Icon name={icon} size={17} /><span className="t">{label}</span>{end}{kb && <Kbd>{kb}</Kbd>}
    </button>
  );
}

/** What someone's screen's name menu offers: pointing, looking closer, its sound, its own window, the board, and Show beside. */
export function ShareMenuRows({ share: s, look, pointing, popped, onPopOut, onPut, onBeside, onDone }: {
  share: StageShare; look: ShareLook | null; pointing: Pointing; popped: boolean;
  onPopOut: (() => void) | null;
  /** Puts a picture of it on the board in the call, for whoever can add to that board. */
  onPut: (() => void) | undefined;
  /** Puts something else presented beside it: by its name. */
  onBeside: { name: string; onPick: () => void }[];
  onDone: () => void;
}) {
  const st = useLookState(look);
  const here = pointing.at === s.id;
  const held = st?.held !== null && st?.held !== undefined;
  const closed = s.point?.closed ?? null;
  const canPoint = s.point !== null && closed === null && !popped && !held;
  const press = useSettledPress(['point', 'zoom', 'freeze', 'earlier', 'sound', 'window', 'put', ...onBeside.map((b) => `beside:${b.name}`)].join('\n'));
  const pick = (f: () => void) => press(() => { onDone(); f(); });
  return (
    <>
      {s.point && (closed === 'call' ? <p className="hint">The organizer turned off pointing at shared screens.</p>
        : closed === 'presenter' ? <p className="hint">{callName(s.presenter)} isn’t letting others point at their screen.</p>
          : <Row icon="pointer" label={here ? 'Stop pointing' : 'Point at it'} kb="L" keys="L" disabled={!canPoint && !here} onPick={pick(() => pointing.set(here ? null : s.id))} end={<Scope everyone>Everyone</Scope>} />)}
      {look && st && (
        <>
          <Row icon={held ? 'play' : 'pause'} label={held ? 'Back to live' : 'Freeze the picture'} kb={LOOK_KEYS.freeze.shown} keys={LOOK_KEYS.freeze.aria} onPick={pick(() => (held ? look.live() : void look.freeze()))} />
          <Row icon="stepBack" label="Earlier picture" kb={LOOK_KEYS.earlier.shown} keys={LOOK_KEYS.earlier.aria} disabled={!st.canEarlier} onPick={pick(() => void look.earlier())} />
          {held && <Row icon="stepForward" label="Later picture" kb={LOOK_KEYS.later.shown} keys={LOOK_KEYS.later.aria} onPick={pick(() => look.later())} />}
          <Row icon="zoomIn" label="Zoom in" kb={LOOK_KEYS.zoomIn.shown} keys={LOOK_KEYS.zoomIn.aria} disabled={st.framing.zoom >= ZOOM_MAX - 0.001} onPick={pick(() => look.zoomStep(1))} />
          {isZoomed(st.framing) && <Row icon="zoomOut" label="Zoom out" kb={LOOK_KEYS.zoomOut.shown} keys={LOOK_KEYS.zoomOut.aria} onPick={pick(() => look.zoomStep(-1))} />}
          {isZoomed(st.framing) && <Row icon="whole" label="See the whole picture" kb={LOOK_KEYS.whole.shown} keys={LOOK_KEYS.whole.aria} onPick={pick(() => look.whole())} />}
        </>
      )}
      {s.sound && <Row icon={s.sound.muted ? 'speaker' : 'speakerOff'} label={s.sound.muted ? 'Play its sound for you' : 'Mute its sound for you'} onPick={pick(s.sound.toggle)} />}
      {onPopOut && <Row icon={popped ? 'popIn' : 'pip'} label={popped ? 'Bring it back here' : 'Open in its own window'} onPick={pick(onPopOut)} />}
      {onPut && <Row icon="image" label="Put on the board" onPick={pick(onPut)} />}
      {onBeside.map((b) => <Row key={b.name} icon="panelRight" label={`Show ${b.name} beside`} onPick={pick(b.onPick)} />)}
      {look && st && <p className="hint">{historyNote(st.off)}</p>}
    </>
  );
}

/** What your own screen's name menu offers: whether others can point at it, clearing their marks, and changing what you share. */
export function MyShareMenuRows({ read, othersPoint, marksOn, onOthersPoint, onClear, onChange, onDone }: {
  /** It's read for the notes. */
  read: boolean;
  /** Pointing is on in the call, and whether others may point at yours. Null while the call doesn't let anyone point. */
  othersPoint: boolean | null;
  marksOn: number;
  onOthersPoint: () => void;
  onClear: () => void;
  onChange: () => void;
  onDone: () => void;
}) {
  const press = useSettledPress(['point', 'clear', 'change'].join('\n'));
  const pick = (f: () => void) => press(() => { onDone(); f(); });
  return (
    <>
      {othersPoint !== null && (
        <button type="button" className="mi" role="menuitemcheckbox" aria-checked={othersPoint} onClick={pick(onOthersPoint)}>
          <Icon name={othersPoint ? 'pointer' : 'pointerOff'} size={17} /><span className="t">Others can point at it</span><Icon name="check" size={16} className="tick" />
        </button>
      )}
      <Row icon="eraser" label="Clear marks" disabled={marksOn === 0} onPick={pick(onClear)} />
      <Row icon="screen" label="Change what you share" onPick={pick(onChange)} />
      {read && <p className="hint ic-readline"><RecDot />Read for the notes</p>}
    </>
  );
}

const quiet = () => () => undefined;
const nothing = () => null;
/** How a share is looked at now, or null for one that isn't. */
function useLookState(look: ShareLook | null) {
  const [, force] = useState(0);
  useEffect(() => (look ? look.subscribe(() => force((n) => n + 1)) : quiet()), [look]);
  return look ? look.getSnapshot() : nothing();
}

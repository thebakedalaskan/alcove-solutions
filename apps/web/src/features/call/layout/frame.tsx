/*
 * What's on your stage, each in its frame (docs: Calls and recordings › The call screen): a screen, a board or the workspace,
 * with one bar that works the same way for all three (`CallFrame` in @alcove/ui). On its left, whoever presents it (or the
 * kind's icon while it's only on your screen), its name as a menu, a line of what's so, and on a board or the workspace who
 * can edit it, which can open who has it in the name's menu. On its right, only what applies:
 * following whoever presents it, Present, focus, Stop sharing on your own screen, and Close, which asks "for you or for
 * everyone" while you present a board or the workspace, and on the call's board nobody presents for whoever opened it or the
 * organizer. On your own screen Close puts it away for you while it's still shared, as a tile with the people. Close says
 * when it's the last thing on your stage, so the people fill it again.
 *
 * The frames sit over the main area where panels.ts puts them, and glide there. The workspace stays here once it's been open,
 * out of sight while it isn't on your stage, so it keeps its place, its caret and its undo.
 */
import type { AvatarPerson, IconName } from '@alcove/ui';
import { CallFrame, FramePager, Icon, cn, type CloseAskProps, type PresentAskProps } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import type { Box } from './stageLayout';
import { GLIDE } from './Stage';

const at = (r: Box) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** One frame's place over the main area: it rises in as it opens, and glides as the room around it changes. */
export function FrameBox({ id, box, shown, focused, children }: { id: string; box: Box; shown: boolean; focused: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const glide = reduce ? { duration: 0 } : GLIDE;
  return (
    <motion.div className={cn('ic-framebox', !shown && 'is-away', focused && 'is-focus')} data-thing={id} inert={!shown || undefined} aria-hidden={!shown || undefined}
      initial={{ ...at(box), opacity: 0, y: 8 }} animate={{ ...at(box), opacity: shown ? 1 : 0, y: shown ? 0 : 8 }}
      transition={{ left: glide, top: glide, width: glide, height: glide, opacity: reduce ? { duration: 0 } : { duration: 0.24, ease: GLIDE.ease, delay: shown ? 0.06 : 0 }, y: glide }}>
      {children}
    </motion.div>
  );
}

/** Whoever presents what's in a frame, as its bar says. */
export interface FrameBy {
  person: AvatarPerson;
  first: string;
  mine: boolean;
}

/** What every frame's bar has, whatever's in it. */
export interface FrameBar {
  icon: IconName;
  name: string;
  /** Whoever presents it; null while it's only on your screen. */
  by: FrameBy | null;
  /** How many follow you, as each of them says, while you present a board or the workspace: whoever works on their own isn't counted. */
  followers: number;
  /** On someone else's board or workspace: whether you follow them, where they are, and the switch. */
  follow: { on: boolean; where: string; onToggle: () => void } | null;
  /** Present, on a board or the workspace only on your screen: null where you can't. */
  present: { onPress: () => void; busy: boolean; ask?: PresentAskProps | undefined } | null;
  focus: { on: boolean; onToggle: () => void } | null;
  phone: boolean;
  /** Close: closes what's only on your screen, or someone else's presentation, or your own screen, for you. */
  onClose: () => void;
  /** It's the only thing on your stage: closing it gives the stage back to the people, and Close says so. */
  clears: boolean;
  /**
   * Close asks, for you or for everyone, while you present a board or the workspace, and on the call's board nobody presents
   * for whoever may take it out of the call.
   */
  ask: Omit<CloseAskProps, 'title'> | null;
  /**
   * Who can edit it, after the line of what's so: "Everyone in the call can edit". `opens`: it opens who has it in the name's
   * menu, which `rows` then starts on (`start` is `access`).
   */
  access: { label: string; opens: boolean } | null;
  /** The name's menu, as each kind fills it; with the organizer's stop after a line on someone else's. */
  rows: (close: () => void, start: 'access' | null) => ReactNode;
  /** On someone else's presentation, for the organizer: "Close it for everyone", or "Stop it for everyone" on a screen. */
  stop: { label: string; onPick: () => void } | null;
}

/** The frame's bar, as `CallFrame` takes it, around what's in it. */
export function Frame({ bar, meta, onStop, foot, children }: {
  bar: FrameBar;
  /** What the line beside the name says, in place of who presents it: a screen of yours says how it goes out. */
  meta?: string | undefined;
  /** Stop sharing, on your own screen, for everyone: beside Close, which only puts it away for you. */
  onStop?: (() => void) | undefined;
  /** The board's pager, at the foot of the frame, for whoever presents it. */
  foot?: ReactNode;
  children: ReactNode;
}) {
  /** The name's menu, opened from its name or from who can edit it. */
  const [menu, setMenu] = useState<'name' | 'access' | null>(null);
  const { by } = bar;
  const theirs = by !== null && !by.mine;
  const following = bar.followers === 0 ? 'nobody following' : `${bar.followers} following`;
  const line = meta ?? (by === null ? 'Only on your screen' : by.mine ? `You’re presenting · ${following}` : `${by.first} is presenting`);
  const rows = bar.rows(() => setMenu(null), menu === 'access' ? 'access' : null);
  const back = bar.clears ? ', and the people fill your stage again' : '';
  const tip = onStop ? `Put it away for you${back}. It’s still shared, as a tile with the people`
    : bar.ask ? `Close it for you, or for everyone${back}`
      : by === null ? `Close it${back}`
        : `Close it for you${back}. While ${by.first} presents, its tile takes you back`;
  return (
    <CallFrame who={by?.person ?? null} icon={bar.icon} name={bar.name} meta={line} label={`${bar.name}, ${by ? 'everyone sees it' : 'only you see it'}`}
      access={bar.access ? { label: bar.access.label, onPress: bar.access.opens ? () => setMenu('access') : undefined, open: menu === 'access' } : null}
      menu={{
        open: menu !== null, onOpenChange: (open) => setMenu(open ? 'name' : null), label: bar.name,
        children: (
          <>
            {rows}
            {bar.stop && menu === 'name' && (
              <>
                <div className="ic-msep" />
                <button type="button" className="mi is-stopall" role="menuitem" onClick={() => { setMenu(null); bar.stop?.onPick(); }}>
                  <Icon name="x" size={17} /><span className="t">{bar.stop.label}</span>
                </button>
              </>
            )}
          </>
        )
      }}
      following={theirs && bar.follow ? { person: by.person, name: by.first, on: bar.follow.on, where: `${by.first} is in ${bar.follow.where}`, onToggle: bar.follow.onToggle } : null}
      present={bar.present ? { onPress: bar.present.onPress, busy: bar.present.busy, ask: bar.present.ask } : undefined}
      focus={bar.phone ? null : bar.focus} focused={bar.focus?.on ?? false} phone={bar.phone} onStop={onStop}
      close={{ tip, onClose: bar.onClose, ask: bar.ask ? { ...bar.ask, title: `Close ${bar.name}` } : undefined }}
      lit={theirs && bar.follow?.on === true} foot={foot}>
      {children}
    </CallFrame>
  );
}

/** The board presenter's pager at the frame's foot: ‹ "1 of 3" over the frame's name › and their notes. */
export function BoardPagerFoot({ pager, onBack, onNext, notes }: {
  pager: { at: number; total: number; part: string };
  onBack: () => void; onNext: () => void;
  notes: { on: boolean; onToggle: () => void } | null;
}) {
  return (
    <div data-pager="">
      <FramePager at={pager.at} total={pager.total} part={pager.part} onBack={onBack} onNext={onNext} notes={notes} />
    </div>
  );
}

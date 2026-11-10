import { CALL_REACTIONS } from '@alcove/api';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '../cn';
import { Emoji, EMOJI_WORDS, type EmojiName } from './emoji';
import { Popover, Tooltip } from './overlay';
import { IconButton } from './primitives';

/** One emoji under a message: the names of who reacted with it (yours as "You"), in the order they did, and whether one is yours. */
export interface ReactionShown { name: EmojiName; names: string[]; mine: boolean }

/**
 * Who reacted, in about `max` characters: as many names as fit, then how many more ("Aiko, Ben, Cleo +2"). The
 * first name always shows, however long.
 */
export function reactorsLabel(names: string[], max = 40): string {
  let text = '';
  let shown = 0;
  for (const n of names) {
    const next = shown ? `${text}, ${n}` : n;
    const rest = names.length - shown - 1;
    if (shown && next.length + (rest ? ` +${rest}`.length : 0) > max) break;
    text = next;
    shown += 1;
  }
  const rest = names.length - shown;
  return rest ? `${text} +${rest}` : text;
}

/** Arrow keys, Home and End move between the emoji in the picker. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const all = [...e.currentTarget.querySelectorAll('button')];
  const at = all.findIndex((b) => b === document.activeElement);
  const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  all[(to + all.length) % all.length]?.focus();
}

/**
 * The eight emoji to press, in a grid. `mine` marks the ones already used (and makes each a toggle for assistive
 * technology); leave it out when pressing just sends one.
 */
export function ReactPicker({ onPick, mine, label = 'Reactions', className }: {
  onPick: (name: EmojiName) => void; mine?: EmojiName[] | undefined; label?: string | undefined; className?: string | undefined;
}) {
  return (
    <div className={cn('ac-react-pick', className)} role="group" aria-label={label} onKeyDown={moveFocus}>
      {CALL_REACTIONS.map((name) => {
        const on = mine?.includes(name) ?? false;
        return (
          <button key={name} type="button" className={cn('ac-react-opt', on && 'is-mine')} aria-pressed={mine ? on : undefined} aria-label={EMOJI_WORDS[name]} title={EMOJI_WORDS[name]}
            onClick={() => onPick(name)}>
            <Emoji name={name} size={24} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The button that adds a reaction, and the emoji it offers. Picking one you've already reacted with takes it back.
 * `small` is the one at the end of a message's reactions.
 */
export function ReactionAdd({ mine, onPick, small = false, className }: {
  /** The emoji you've already reacted with to this message. */
  mine: EmojiName[];
  onPick: (name: EmojiName, on: boolean) => void;
  small?: boolean | undefined; className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} label="Add a reaction" side="top" align="end" tip="Add reaction" className="ac-react-pop"
      anchor={<IconButton icon="react" label="Add reaction" title={undefined} size={small ? 15 : 17} on={open} className={cn('ac-react-add', small && 'is-small', className)} />}>
      <ReactPicker mine={mine} onPick={(name) => { onPick(name, !mine.includes(name)); setOpen(false); }} />
    </Popover>
  );
}

/**
 * A message's reactions: each emoji with how many reacted with it, yours marked. Pressing one adds yours, or takes it
 * back; its tooltip says who. Ends with a small button to add another. Nothing when there are none.
 * `canReact` is false while reacting isn't possible yet (a message of yours still on its way).
 */
export function Reactions({ reactions, onToggle, canReact = true, className }: {
  reactions: ReactionShown[]; onToggle: (name: EmojiName, on: boolean) => void; canReact?: boolean | undefined; className?: string | undefined;
}) {
  if (!reactions.length) return null;
  return (
    <div className={cn('ac-reacts', className)}>
      {reactions.map((r) => (
        <Tooltip key={r.name} label={<span className="ac-react-tip"><Emoji name={r.name} size={16} />{reactorsLabel(r.names)}</span>}>
          <button type="button" className={cn('ac-react', r.mine && 'is-mine')} aria-pressed={r.mine} aria-disabled={!canReact || undefined}
            aria-label={`${EMOJI_WORDS[r.name]}, ${r.names.length}: ${reactorsLabel(r.names)}`}
            onClick={() => { if (canReact) onToggle(r.name, !r.mine); }}>
            <Emoji name={r.name} size={16} /><span className="n">{r.names.length}</span>
          </button>
        </Tooltip>
      ))}
      {canReact && <ReactionAdd small mine={reactions.filter((r) => r.mine).map((r) => r.name)} onPick={onToggle} />}
    </div>
  );
}

import type { CallReaction } from '@alcove/api';
import { DockButton, Popover, ReactPicker } from '@alcove/ui';

/** React, in the dock: the emoji to send floating up over everyone's call. It stays open, so they can come as fast as you press. */
export function ReactMenu({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (name: CallReaction) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} side="top" align="center" label="React" tip="React" className="ac-react-pop"
      anchor={<DockButton icon="react" label="React" title={undefined} on={open} />}>
      <ReactPicker label="Send a reaction everyone sees" onPick={onPick} />
    </Popover>
  );
}

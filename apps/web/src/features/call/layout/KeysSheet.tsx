/*
 * Keyboard shortcuts, from More: the call's keys, and what works on a tile you've reached with Tab. Only the keys you have
 * here are listed: Mark this moment needs an account, and just the document a window wider than a phone.
 */
import { IconButton, Kbd, Modal } from '@alcove/ui';
import { CALL_KEYS, TILE_KEYS, type CallKey } from '../session/useCallShortcuts';

const Keys = ({ keys }: { keys: string[] }) => <span className="ks-k">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;

export function KeysSheet({ open, onOpenChange, without }: { open: boolean; onOpenChange: (open: boolean) => void; without: CallKey['id'][] }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Keyboard shortcuts" className="ic-ks" focusSelf>
      <div className="ks-h">
        <div><h2>Keyboard shortcuts</h2><p>The letters sleep while you type.</p></div>
        <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} />
      </div>
      <div className="ks-body">
        <ul className="ks-list" aria-label="In the call">
          {CALL_KEYS.filter((k) => !without.includes(k.id)).map((k) => <li key={k.id}><span>{k.what}</span><Keys keys={k.keys} /></li>)}
        </ul>
        <p className="ks-sub">On a tile</p>
        <ul className="ks-list" aria-label="On a tile">
          {TILE_KEYS.map((k) => <li key={k.what}><span>{k.what}</span><Keys keys={k.keys} /></li>)}
        </ul>
      </div>
    </Modal>
  );
}

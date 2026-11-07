/*
 * Keyboard shortcuts, from More: the call's keys, then what works on what you've reached with Tab: a tile, a shared screen on
 * your stage, and a board you present. Only the call's keys you have here are listed: Mark this moment needs an account, and
 * focus a window wider than a phone.
 */
import { IconButton, Kbd, Modal } from '@alcove/ui';
import { CALL_KEYS, PRESENTING_KEYS, SHARE_KEYS, TILE_KEYS, type CallKey, type ThingKey } from '../session/useCallShortcuts';

const Keys = ({ keys }: { keys: string[] }) => <span className="ks-k">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;

/** What works on one thing, under its name. */
function OnIt({ title, keys }: { title: string; keys: ThingKey[] }) {
  return (
    <>
      <p className="ks-sub">{title}</p>
      <ul className="ks-list" aria-label={title}>
        {keys.map((k) => <li key={k.what}><span>{k.what}</span><Keys keys={k.keys} /></li>)}
      </ul>
    </>
  );
}

/**
 * `backTo`: where the keys go as it closes. It opens from More's menu, which has gone by then, so they go to More itself, which
 * opens it again, rather than to nothing.
 */
export function KeysSheet({ open, onOpenChange, without, backTo }: { open: boolean; onOpenChange: (open: boolean) => void; without: CallKey['id'][]; backTo: () => HTMLElement | null }) {
  const onCloseFocus = () => { const to = backTo(); to?.focus({ preventScroll: true }); return to !== null; };
  return (
    <Modal open={open} onOpenChange={onOpenChange} label="Keyboard shortcuts" className="ic-ks" focusSelf onCloseFocus={onCloseFocus}>
      <div className="ks-h">
        <div><h2>Keyboard shortcuts</h2><p>The letters sleep while you type.</p></div>
        <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} />
      </div>
      <div className="ks-body">
        <ul className="ks-list" aria-label="In the call">
          {CALL_KEYS.filter((k) => !without.includes(k.id)).map((k) => <li key={k.id}><span>{k.what}</span><Keys keys={k.keys} /></li>)}
        </ul>
        <OnIt title="On a tile" keys={TILE_KEYS} />
        <OnIt title="On a shared screen" keys={SHARE_KEYS} />
        <OnIt title="On a board you present" keys={PRESENTING_KEYS} />
      </div>
    </Modal>
  );
}

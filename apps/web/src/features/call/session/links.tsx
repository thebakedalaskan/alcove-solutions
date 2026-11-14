import { IconButton, LinkRow, useToast } from '@alcove/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { aloneClosed, closeAlone } from './seen';

export const joinUrl = (code: string) => `${location.origin}/join/${code}`;
/** A call's link as it's shown, without its https://. */
export const shownUrl = (code: string) => joinUrl(code).replace(/^https?:\/\//, '');
/** Puts a call's link on the clipboard, for a control that shows it did. */
export const copyUrl = (code: string) => { void navigator.clipboard?.writeText(joinUrl(code)).catch(() => undefined); };

/** Copies a call's link and says so. */
export function useCopyLink() {
  const toast = useToast();
  return (code: string) => {
    copyUrl(code);
    toast(<>Link copied <span className="ac-mono opacity-60">{shownUrl(code)}</span></>, { icon: 'link' });
  };
}

/**
 * On your own, the link for anyone to ask to join (`justYou`, and no captions over it): at the bottom left of the stage, or at the
 * foot of the workspace's list while that's in sight, where it covers nothing (`WorkspaceCall.foot`). One element while it's the
 * same, so the workspace doesn't draw again for it. Closed, it's gone for the rest of the call (`closed`), as a reload remembers:
 * the link is still in People.
 */
export function useAloneCard({ justYou, captions, callId, code }: { justYou: boolean; captions: boolean; callId: string; code: string }): { card: ReactNode; closed: boolean } {
  const [aloneShut, setAloneShut] = useState(() => aloneClosed(callId));
  const card = useMemo(() => (justYou && !captions && !aloneShut ? (
    <div className="rg-alone">
      <div className="rg-alone-h">
        <div><b>Just you so far</b><p>Anyone with the link can ask to join.</p></div>
        <IconButton icon="x" size={16} label="Close" onClick={() => { setAloneShut(true); closeAlone(callId); }} />
      </div>
      <LinkRow link={shownUrl(code)} onCopy={() => copyUrl(code)} />
    </div>
  ) : null), [justYou, captions, aloneShut, code, callId]);
  return { card, closed: aloneShut };
}

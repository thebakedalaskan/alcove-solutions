import { useToast } from '@alcove/ui';

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

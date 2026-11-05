/*
 * What's open over the Team page. One thing at a time, so one filled button: an open popover has its own, and takes it
 * from Invite people. Who's ticked in Invite people lives here too, since they step up on the line as they're picked.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type Change<T> = (now: T) => T;
interface Open {
  open: string | undefined;
  setOpen: (how: Change<string | undefined>) => void;
  picked: readonly string[];
  setPicked: (emails: readonly string[]) => void;
}
const OpenContext = createContext<Open>({ open: undefined, setOpen: () => {}, picked: [], setPicked: () => {} });

export function OpenHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const value = useMemo(() => ({ open, setOpen, picked, setPicked }), [open, picked]);
  return <OpenContext.Provider value={value}>{children}</OpenContext.Provider>;
}
export const useOpen = () => useContext(OpenContext);

/** A popover's `open` and `onOpenChange`, by its name on the page. Closing never closes whatever has opened since. */
export function usePop(name: string) {
  const { open, setOpen } = useOpen();
  return { open: open === name, onOpenChange: (on: boolean) => setOpen((now) => (on ? name : now === name ? undefined : now)) };
}
/** The name of someone's popover on the line. */
export const personPop = (email: string) => `person ${email.toLowerCase()}`;

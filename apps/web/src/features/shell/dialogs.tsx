import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LinkDialog } from '~/features/meetings/LinkDialog';
import { ScheduleDialog } from '~/features/meetings/ScheduleDialog';

type Open = { kind: 'schedule'; meetingId?: string | undefined } | { kind: 'link' } | null;
const Ctx = createContext<{ open: (d: Exclude<Open, null>) => void; close: () => void }>({ open: () => {}, close: () => {} });

/** App-wide dialogs. Any screen can open "schedule" or "link" without owning the dialog. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [d, setD] = useState<Open>(null);
  const close = useCallback(() => setD(null), []);
  const value = useMemo(() => ({ open: setD, close }), [close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ScheduleDialog open={d?.kind === 'schedule'} meetingId={d?.kind === 'schedule' ? d.meetingId : undefined} onClose={close} />
      <LinkDialog open={d?.kind === 'link'} onClose={close} />
    </Ctx.Provider>
  );
}
export const useDialogs = () => useContext(Ctx);

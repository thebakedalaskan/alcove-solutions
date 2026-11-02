import type { CallSession, CallState } from '@alcove/api';
import { Icon, IconButton, RecDot, useToast } from '@alcove/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

/** Announcements everyone sees: notes started, paused, people joined. */
export function Notices({ state, session }: { state: CallState; session: CallSession }) {
  // Each notice stays for a few seconds, then dismisses itself for everyone.
  const ids = state.notices.map((n) => n.id).join(',');
  useEffect(() => {
    const timers = ids.split(',').filter(Boolean).map((id) => setTimeout(() => session.dismissNotice(id), 5000));
    return () => timers.forEach(clearTimeout);
  }, [ids, session]);
  return (
    <div className="pointer-events-none fixed left-1/2 top-16 z-[6] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {state.notices.map((n) => (
          <motion.div key={n.id} layout initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            role="status" className="pointer-events-auto flex items-center gap-3 rounded-[14px] bg-stage-ink py-2.5 pl-4 pr-2.5 text-sm font-medium text-[#17140F] shadow-float">
            {n.kind === 'notes' ? <RecDot /> : <Icon name={n.kind === 'people' ? 'users' : 'screen'} className="size-4" />}
            <span>{n.text}</span>
            <button type="button" onClick={() => session.dismissNotice(n.id)} className="h-[30px] rounded-lg bg-[#17140F] px-2.5 text-[13px] font-semibold text-stage-ink">Got it</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Shown on a fresh instant call until someone joins, like a host's "your meeting is ready". */
export function ReadyCard({ state, onClose, name }: { state: CallState; onClose: () => void; name: string }) {
  const toast = useToast();
  return (
    <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ delay: 0.3, type: 'spring', stiffness: 380, damping: 32 }}
      role="dialog" aria-label="Your call is ready" className="fixed bottom-24 left-6 z-[6] flex w-[360px] flex-col gap-3 rounded-[20px] bg-[#1E1B17] p-[18px] shadow-float">
      <div className="flex items-center justify-between"><b className="text-base">Your call is ready</b><IconButton tone="stage" icon="x" label="Close" onClick={onClose} /></div>
      <p className="m-0 text-[13.5px] text-[#BEB5A9]">This is your call’s link. Other people can’t join calls yet in this build, so it’s just you for now.</p>
      <div className="flex items-center justify-between rounded-xl bg-[#2A2621] py-1.5 pl-3 pr-1.5 text-[13.5px]">
        <span className="font-mono">alcove.app/{state.code}</span>
        <IconButton tone="stage" icon="copy" label="Copy link" onClick={async () => { try { await navigator.clipboard.writeText(`https://alcove.app/${state.code}`); } catch { /* blocked */ } toast('Link copied'); }} />
      </div>
      <span className="flex items-center gap-1.5 text-[13px] text-stage-dim"><Icon name="lock" className="size-3.5" />Joined as {name} · {state.notes.status === 'off' ? 'notes are off' : 'notes are on'}</span>
    </motion.div>
  );
}

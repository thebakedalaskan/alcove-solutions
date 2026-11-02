import { errorMessage } from '@alcove/api';
import { Button, Icon, Mark, Spinner, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api } from '~/lib/api';
import { q, qk } from '~/lib/queries';

export const Route = createFileRoute('/welcome')({
  validateSearch: (s: Record<string, unknown>): { ended?: boolean | undefined } => ({ ended: s['ended'] === true || s['ended'] === 'true' ? true : undefined }),
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(q.session())) throw redirect({ to: '/home' });
  },
  component: Welcome
});

const rise = (delay: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay, ease: [0.22, 0.8, 0.24, 1] as const } });

function Welcome() {
  const { ended } = Route.useSearch();
  const [mode, setMode] = useState<'create' | 'unlock'>(ended ? 'unlock' : 'create');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const s = await fn();
      qc.clear();
      qc.setQueryData(qk.session, s);
      await navigate({ to: '/home' });
    } catch (e) { toast(errorMessage(e), 'x'); setBusy(false); }
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#0D0B09] text-[#F5F1EA] [color-scheme:dark]">
      <motion.div aria-hidden className="absolute left-1/2 top-[38%] size-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,166,43,.22),rgba(255,166,43,.06)_45%,transparent_70%)]"
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 2.2, ease: [0.22, 0.8, 0.24, 1] }} />
      <div className="relative flex w-full max-w-[420px] flex-col items-center gap-[22px] px-6 py-10 text-center">
        <Mark size={120} animate className="dark" />
        <motion.div {...rise(0.5)} className="-mt-1 font-display text-[64px] font-extrabold leading-none tracking-[-.045em]">alcove</motion.div>
        <motion.p {...rise(0.7)} className="m-0 max-w-[30ch] text-[19px] text-[#BEB5A9]">
          {ended ? 'Your session ended. Unlock with your passkey to carry on.' : 'Private video calls, with notes only the people in the call can read.'}
        </motion.p>
        <motion.div {...rise(0.9)} className="mt-2 w-full max-w-[360px]">
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'create' ? (
              <motion.form key="create" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
                onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => api.auth.createAccount(name.trim())); }} className="flex flex-col gap-2.5">
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Your name" aria-label="Your name" maxLength={80}
                  className="h-[54px] rounded-[14px] border-0 bg-white/[.06] px-4 text-center text-base text-[#F5F1EA] shadow-[inset_0_0_0_1px_rgba(255,255,255,.13)] outline-none placeholder:text-[#8F877C] focus:shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.4)]" />
                <Button type="submit" size="lg" variant="light" block disabled={!name.trim() || busy} className="h-[54px]">
                  {busy ? <><Spinner /> Waiting for your passkey…</> : <><Icon name="fingerprint" /> Create your passkey</>}
                </Button>
                <button type="button" onClick={() => setMode('unlock')} className="mt-1 text-[13.5px] text-[#8F877C] transition-colors hover:text-[#F5F1EA]">I already have an Alcove passkey</button>
              </motion.form>
            ) : (
              <motion.div key="unlock" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="flex flex-col gap-2.5">
                <Button size="lg" variant="light" block disabled={busy} className="h-[54px]" onClick={() => void run(() => api.auth.unlock())}>
                  {busy ? <><Spinner /> Waiting for your passkey…</> : <><Icon name="fingerprint" /> Unlock with your passkey</>}
                </Button>
                <button type="button" onClick={() => setMode('create')} className="mt-1 text-[13.5px] text-[#8F877C] transition-colors hover:text-[#F5F1EA]">New here? Create an account</button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <motion.p {...rise(1.3)} className="absolute inset-x-0 bottom-7 m-0 flex items-center justify-center gap-2 px-5 text-center text-[13px] text-[#8F877C]">
        <Icon name="lock" className="size-3.5" /> Your passkey is the only key to your notes. Alcove keeps it out of its database.
      </motion.p>
    </main>
  );
}

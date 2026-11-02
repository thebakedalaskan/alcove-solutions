import { errorMessage } from '@alcove/api';
import type { AuthProvider } from '@alcove/api';
import { Icon, Mark, useToast } from '@alcove/ui';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useState } from 'react';
import { ProviderButtons } from '~/features/onboarding/ProviderButtons';
import { api } from '~/lib/api';
import { q, useResetCache } from '~/lib/queries';

export const Route = createFileRoute('/welcome')({
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.ensureQueryData(q.session());
    if (s?.hasPasskey) throw redirect({ to: '/home' });
  },
  component: Welcome
});

const rise = (delay: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay, ease: [0.22, 0.8, 0.24, 1] as const } });

function Welcome() {
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const navigate = useNavigate();
  const reset = useResetCache();
  const toast = useToast();
  const signIn = async (p: AuthProvider) => {
    setBusy(p);
    try { await api.auth.signIn(p); await reset(); await navigate({ to: '/passkey' }); }
    catch (e) { toast(errorMessage(e), 'x'); setBusy(null); }
  };
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#0D0B09] text-[#F5F1EA] [color-scheme:dark]">
      <motion.div aria-hidden className="absolute left-1/2 top-[38%] size-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,166,43,.22),rgba(255,166,43,.06)_45%,transparent_70%)]"
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 2.2, ease: [0.22, 0.8, 0.24, 1] }} />
      <div className="relative flex w-full max-w-[420px] flex-col items-center gap-[22px] px-6 py-10 text-center">
        <Mark size={120} animate className="dark" />
        <motion.div {...rise(0.5)} className="-mt-1 font-display text-[64px] font-extrabold leading-none tracking-[-.045em]">alcove</motion.div>
        <motion.p {...rise(0.7)} className="m-0 max-w-[30ch] text-[19px] text-[#BEB5A9]">Private video calls, with notes only the people in the call can read.</motion.p>
        <motion.div {...rise(0.9)} className="mt-2 w-full max-w-[360px]"><ProviderButtons busy={busy} onPick={signIn} /></motion.div>
        <motion.div {...rise(1.1)}>
          <Link to="/join/$code" params={{ code: 'kpw-rnzq-hte' }} className="text-[13.5px] font-medium text-[#8F877C] transition-colors hover:text-[#F5F1EA]">Joining from a link? You don’t need an account.</Link>
        </motion.div>
      </div>
      <motion.p {...rise(1.3)} className="absolute inset-x-0 bottom-7 m-0 flex items-center justify-center gap-2 px-5 text-center text-[13px] text-[#8F877C]">
        <Icon name="lock" className="size-3.5" /> Calls are end-to-end encrypted. Notes are written inside a sealed server Alcove can’t read.
      </motion.p>
    </main>
  );
}

import { errorMessage } from '@alcove/api';
import { Button, Chip, Icon, IconButton, Logo, cn, useTheme, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useState } from 'react';
import { api } from '~/lib/api';
import { q, qk } from '~/lib/queries';

export const Route = createFileRoute('/passkey')({
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.ensureQueryData(q.session());
    if (!s) throw redirect({ to: '/welcome' });
  },
  component: PasskeyStep
});

function PasskeyStep() {
  const { data: session } = useQuery(q.session());
  const [state, setState] = useState<'idle' | 'scan' | 'done'>(session?.hasPasskey ? 'done' : 'idle');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { resolved, toggle } = useTheme();
  const provider = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple', email: 'Your email' }[session?.provider ?? 'google'];

  const create = async () => {
    setState('scan');
    try { await api.auth.createPasskey(); setState('done'); await qc.invalidateQueries({ queryKey: qk.session }); }
    catch (e) { setState('idle'); toast(errorMessage(e), 'x'); }
  };

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-7 py-[22px]">
        <Logo size={22} />
        {session && <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3"><Icon name="check" className="size-3.5 text-ok" />{session.user.email}</span>}
        <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} />
      </header>
      <div className="grid flex-1 place-items-center px-6 pb-16 pt-5">
        <div className="grid w-full max-w-[1040px] items-center gap-16 md:grid-cols-2">
          <motion.div className="flex flex-col gap-[18px]" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.07 } } }}>
            {[
              <h1 key="h" className="text-[clamp(34px,4.4vw,48px)] leading-[1.02]">Now lock your notes<br />with a passkey.</h1>,
              <p key="p" className="m-0 max-w-[40ch] text-[17px] text-ink-2">{provider} signs you in and sends your invites. The passkey is different: it’s the only key to your notes, and it never leaves this device.</p>,
              <div key="b" className="flex flex-wrap items-center gap-3">
                {state === 'done'
                  ? <><Button size="lg" iconRight="right" onClick={() => navigate({ to: '/home' })}>Open Alcove</Button><Chip tone="ok" icon="check">Passkey created</Chip></>
                  : <Button size="lg" icon="fingerprint" loading={state === 'scan'} onClick={create}>{state === 'scan' ? 'Waiting for your device…' : 'Create passkey'}</Button>}
              </div>
            ].map((el, i) => <motion.div key={i} variants={{ h: { opacity: 0, y: 14 }, s: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 0.8, 0.24, 1] } } }}>{el}</motion.div>)}
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, ease: [0.22, 0.8, 0.24, 1], delay: 0.15 }}
            className="relative grid aspect-square w-full max-w-[420px] place-items-center justify-self-center overflow-hidden rounded-[32px] bg-card shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair)]">
            <span className="absolute top-7 text-[15px] font-bold text-ink-2">{session?.user.name}</span>
            <div className={cn('relative grid size-[150px] place-items-center rounded-full shadow-[inset_0_0_0_1px_var(--hair)] transition-colors duration-500', state === 'done' ? 'bg-ok-soft' : 'bg-raised')}>
              <Icon name="fingerprint" className={cn('size-[74px] stroke-[1.4] transition-colors duration-500', state === 'done' ? 'text-ok' : 'text-ink-2')} />
              <svg viewBox="0 0 180 180" className="absolute -inset-2.5 size-[calc(100%+20px)] -rotate-90" aria-hidden>
                <motion.circle cx="90" cy="90" r="85" className="fill-none stroke-ok" strokeWidth={3} strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: state === 'idle' ? 0 : 1 }} transition={{ duration: 1.3, ease: [0.55, 0, 0.2, 1] }} />
              </svg>
            </div>
            <span className="absolute bottom-7 text-sm text-ink-3">{state === 'done' ? 'Passkey saved on this device' : state === 'scan' ? 'Touch the sensor…' : 'Touch ID, Face ID or a security key'}</span>
          </motion.div>
        </div>
      </div>
    </main>
  );
}

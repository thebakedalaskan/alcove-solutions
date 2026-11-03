import { firstName } from '@alcove/api';
import { Avatar, Button, EASE, Faces, Icon, Logo, ProviderMark } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { NoteCard } from '~/features/notes/NoteCard';
import { requireAccount } from '~/lib/guards';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/ready')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(q.upcoming()), context.queryClient.ensureQueryData(q.team())]),
  component: Ready
});

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/* Signed in for the first time: who you are, what came with you, and the example note. Opening Alcove flies the note into its place on Home. */
function Ready() {
  const session = useQuery(q.session()).data;
  const team = useQuery(q.team()).data ?? null;
  const calendar = useQuery(q.calendar()).data;
  const calendarOn = calendar?.source === 'google' && !calendar.needsAccess;
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const rise = (i: number) => ({ initial: reduce ? false : { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.62, delay: 0.12 + i * 0.07, ease: EASE.out } });

  const open = async () => {
    const card = document.querySelector('#readyNote .ac-notes');
    let flight: { el: HTMLElement; from: DOMRect; w: number; h: number; s: number } | null = null;
    if (card instanceof HTMLElement && !reduce && innerWidth > 860) {
      const from = card.getBoundingClientRect();
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const el = card.cloneNode(true);
      if (el instanceof HTMLElement) {
        const s = from.width / w;
        Object.assign(el.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${w}px`, height: `${h}px`, margin: '0', zIndex: '85', transformOrigin: '0 0', transform: `scale(${s})`, pointerEvents: 'none' });
        document.body.append(el);
        flight = { el, from, w, h, s };
      }
    }
    await navigate({ to: '/home' });
    if (!flight) return;
    await frame();
    const { el, from, w, h, s } = flight;
    const target = document.getElementById('exampleNote');
    if (!target) { el.remove(); return; }
    const t = target.getBoundingClientRect();
    target.style.opacity = '0';
    await el.animate([
      { transform: `translate(0, 0) scale(${s})` },
      { transform: `translate(${t.left - from.left}px, ${t.top - from.top}px) scale(${t.width / w}, ${t.height / h})` }
    ], { duration: 950, easing: 'cubic-bezier(0.65, 0, 0.22, 1)', fill: 'forwards' }).finished.catch(() => undefined);
    target.style.transition = 'opacity 260ms ease';
    target.style.opacity = '1';
    await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).finished.catch(() => undefined);
    el.remove();
  };

  const me = session?.user;
  return (
    <main className="grid min-h-screen grid-cols-1 items-center gap-12 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:px-[clamp(28px,6vw,96px)]">
      <div className="grid max-w-[540px] content-start gap-6">
        <motion.div {...rise(0)}><Logo /></motion.div>
        <motion.h1 className="ac-display-l mt-6" {...rise(1)}>You’re in, {me ? firstName(me.name) : ''}.</motion.h1>
        <motion.p className="ac-body-l text-ink-2" {...rise(2)}>
          {team ? `Your calendar and your team at ${team.name} came with you.` : session?.sample || calendarOn ? 'Your calendar came with you.' : 'Start a call or schedule one. Notes from your calls land here.'}
        </motion.p>
        <motion.div {...rise(3)}><Button variant="primary" size="lg" iconRight="right" onClick={() => void open()}>Open Alcove</Button></motion.div>
      </div>
      <div className="grid gap-4">
        {session && (
          <motion.div className="ac-card flex items-center gap-3 !py-3" {...rise(2)}>
            <Avatar person={session.user} size={32} />
            <span className="min-w-0"><b className="block truncate text-[14.5px] font-semibold">{session.user.name}</b><small className="block truncate text-[12.5px] text-ink-3">{session.user.email}</small></span>
            <span className="ml-auto text-ink-3">{session.provider === 'sso' ? <Icon name="key" size={16} /> : <ProviderMark provider={session.provider} />}</span>
          </motion.div>
        )}
        {team && (
          <motion.div className="ac-card flex items-center gap-3 !py-3 text-[13.5px] text-ink-2" {...rise(3)}>
            <Faces people={team.members.map((m) => m.person)} size={24} />
            <span><b className="font-semibold text-ink">{team.name}</b> · {team.members.length} colleagues</span>
          </motion.div>
        )}
        <motion.div id="readyNote" {...rise(4)}><NoteCard you={me} /></motion.div>
      </div>
    </main>
  );
}

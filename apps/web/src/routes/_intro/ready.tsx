import { firstName } from '@alcove/api';
import { Icon } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { Moment } from '~/features/welcome/Moments';
import { requireAccount } from '~/lib/guards';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_intro/ready')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(q.upcoming()), context.queryClient.ensureQueryData(q.team())]),
  component: Ready
});

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/* Signed in for the first time. Opening Alcove flies the note into its place on Home. */
function Ready() {
  const session = useQuery(q.session()).data;
  const team = useQuery(q.team()).data ?? null;
  const calendar = useQuery(q.calendar()).data;
  const calendarOn = calendar?.source === 'google' && !calendar.needsAccess;
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;

  const open = async () => {
    const card = document.querySelector('#stNote .note-card');
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
      { transform: `translate(0, 0) scale(${s})`, borderRadius: '24px' },
      { transform: `translate(${t.left - from.left}px, ${t.top - from.top}px) scale(${t.width / w}, ${t.height / h})`, borderRadius: '22px' }
    ], { duration: 950, easing: 'cubic-bezier(0.65, 0, 0.22, 1)', fill: 'forwards' }).finished.catch(() => undefined);
    target.style.transition = 'opacity 260ms ease';
    target.style.opacity = '1';
    await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).finished.catch(() => undefined);
    el.remove();
  };

  const parts = [
    <h1 key="h" className="in-title mid">You’re in, {session ? firstName(session.user.name) : ''}.</h1>,
    <p key="p" className="in-body">{team ? `Your calendar and your team at ${team.name} came with you.` : session?.sample || calendarOn ? 'Your calendar came with you.' : 'Start a call or schedule one. Notes from your calls land here.'}</p>,
    <div key="a" className="in-actions"><button type="button" className="in-cta" onClick={() => void open()}>Open Alcove <Icon name="right" size={18} /></button></div>
  ];
  return <Moment out={false} replacing={false} parts={parts} />;
}

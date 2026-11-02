import { Button, Mark } from '@alcove/ui';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';

export const Route = createFileRoute('/ended')({
  validateSearch: (s: Record<string, unknown>): { title?: string | undefined; minutes?: number | undefined; code?: string | undefined; guest?: boolean | undefined } => {
    const { title, minutes, code, guest } = { title: s['title'], minutes: s['minutes'], code: s['code'], guest: s['guest'] };
    return { title: typeof title === 'string' ? title : undefined, minutes: Number(minutes) || undefined, code: typeof code === 'string' ? code : undefined, guest: guest === true || guest === 'true' || undefined };
  },
  component: Ended
});

function Ended() {
  const { title, minutes, code, guest } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex max-w-[520px] flex-col items-center gap-4 text-center">
        <Mark size={48} />
        <h1 className="text-[40px]">You left the call</h1>
        <p className="m-0 text-ink-3">{title}{minutes ? ` · ${minutes} min` : ''}. {guest ? 'If the host took notes, they’ll be shared with the people in the call.' : 'No notes were taken.'}</p>
        <div className="flex gap-2.5">
          {code && <Button variant="secondary" size="lg" onClick={() => navigate({ to: '/join/$code', params: { code } })}>Rejoin</Button>}
          {guest ? <Link to="/welcome" className="inline-flex h-[50px] items-center rounded-[14px] bg-btn px-6 font-semibold text-btn-ink">Try Alcove</Link> : <Button size="lg" onClick={() => navigate({ to: '/home' })}>Back to home</Button>}
        </div>
      </motion.div>
    </main>
  );
}

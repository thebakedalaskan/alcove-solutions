import { errorMessage, type Meeting, type NotesAudience, type NotesMode } from '@alcove/api';
import { Button, Icon, IconButton, Logo, RadioRow, Segmented, useTheme, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { DevicePreview, DeviceRow } from '~/features/call/DevicePreview';
import { LocalMedia } from '~/features/call/media';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { sessions } from '~/lib/live';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/join/$code')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  loader: async ({ context: { queryClient: qc }, params }) => {
    const [meeting, prefs] = await Promise.all([qc.fetchQuery(q.byCode(params.code)), qc.ensureQueryData(q.prefs())]);
    return { meeting, prefs };
  },
  component: PreJoin
});

function PreJoin() {
  const { code } = Route.useParams();
  const { meeting, prefs } = Route.useLoaderData();
  const { data: session } = useQuery(q.session());
  const { resolved, toggle } = useTheme();
  const router = useRouter();
  const navigate = useNavigate();
  const toast = useToast();
  const [media] = useState(() => sessions.media ?? new LocalMedia());
  const initial: NotesMode | null = !meeting ? null : meeting.notes !== 'ask' ? meeting.notes : prefs.notesDefault === 'always' ? prefs.keep : prefs.notesDefault === 'never' ? 'off' : null;
  const [notes, setNotes] = useState<NotesMode | null>(initial);
  const [audience, setAudience] = useState<NotesAudience>(meeting?.audience ?? 'everyone');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sessions.media = media;
    if (!media.getSnapshot().camera) void media.start({ mic: true, cam: true });
    // Leaving pre-join without joining releases the camera.
    return () => { if (!sessions.call) { media.stop(); sessions.media = null; } };
  }, [media]);

  if (!meeting) return <NotFound code={code} />;

  const join = async () => {
    setBusy(true);
    try {
      const m = media.getSnapshot();
      const s = await api.calls.join(code, { mic: m.mic, cam: m.cam, notes: notes ?? 'off', audience });
      sessions.call = { code, session: s };
      await navigate({ to: '/call/$code', params: { code } });
    } catch (e) { toast(errorMessage(e), 'x'); setBusy(false); }
  };

  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr]">
      <header className="flex items-center gap-4 px-7 py-[18px]">
        <Logo size={22} /><div className="flex-1" />
        <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} />
        <Button size="sm" variant="ghost" onClick={() => router.history.back()}>Cancel</Button>
      </header>
      <div className="mx-auto grid w-full max-w-[1180px] items-center gap-12 px-7 pb-16 pt-2.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.9fr)]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 0.8, 0.24, 1] }}>
          {session && <DevicePreview media={media} me={session.user} />}
          <DeviceRow media={media} />
        </motion.div>
        <motion.div className="flex flex-col gap-[22px]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 0.8, 0.24, 1] }}>
          <HostSide meeting={meeting} notes={notes} setNotes={setNotes} audience={audience} setAudience={setAudience} busy={busy} onJoin={join} />
          <span className="flex items-center gap-2 text-[13px] text-ink-3"><Icon name="lock" className="size-[15px] text-ok" />Recordings are encrypted before they’re stored · alcove.app/{code}</span>
        </motion.div>
      </div>
    </main>
  );
}

function HostSide({ meeting, notes, setNotes, audience, setAudience, busy, onJoin }: { meeting: Meeting; notes: NotesMode | null; setNotes: (n: NotesMode) => void; audience: NotesAudience; setAudience: (a: NotesAudience) => void; busy: boolean; onJoin: () => void }) {
  const opts: { v: NotesMode; t: string; d: string }[] = [
    { v: 'full', t: 'Notes + transcript', d: 'Summary, decisions, action items and every line' },
    { v: 'notes', t: 'Notes only', d: 'The transcript is deleted once notes are written' },
    { v: 'off', t: 'No notes', d: 'Nothing is recorded. You can start notes later.' }
  ];
  return (
    <>
      <span className="text-[13.5px] font-semibold text-ink-3">{meeting.title}</span>
      <h1 className="text-[40px] leading-[1.04]">Ready to join?</h1>
      <div role="radiogroup" aria-label="Notes for this call" className={`flex flex-col gap-1.5 rounded-[20px] bg-card p-3.5 transition-shadow duration-300 ${notes ? 'shadow-[inset_0_0_0_1px_var(--hair)]' : 'shadow-[inset_0_0_0_1.5px_var(--lamp),0_0_0_5px_color-mix(in_oklab,var(--lamp)_14%,transparent)]'}`}>
        <div className="flex items-baseline justify-between px-1 pb-1.5 pt-0.5"><b className="text-[15px]">{notes ? 'Notes for this call' : 'Take notes in this call?'}</b>{!notes && <span className="text-[13px] text-ink-3">Your default is to ask</span>}</div>
        {opts.map((o) => <RadioRow key={o.v} selected={notes === o.v} onSelect={() => setNotes(o.v)} title={o.t} description={o.d} />)}
        {notes && notes !== 'off' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-hair px-1 pt-2 text-[13.5px] font-semibold text-ink-2">
            Send the notes to<Segmented label="Send the notes to" value={audience} onChange={setAudience} options={[{ value: 'everyone', label: 'Everyone in the call' }, { value: 'host', label: 'Only me' }]} />
          </motion.div>
        )}
      </div>
      <Button size="lg" block loading={busy} onClick={onJoin}>{notes && notes !== 'off' ? 'Join and start notes' : notes ? 'Join now' : 'Join without notes'}</Button>
    </>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="flex max-w-[420px] flex-col items-center gap-3">
        <Logo size={26} />
        <h1 className="mt-4 text-[34px]">No call at that link</h1>
        <p className="m-0 text-ink-2">We couldn’t find <span className="font-mono">{code}</span> among your calls. Check the link, or start a new call.</p>
        <Link to="/home" className="mt-2 inline-flex h-[42px] items-center rounded-xl bg-btn px-[18px] font-semibold text-btn-ink">Back to Alcove</Link>
      </div>
    </main>
  );
}

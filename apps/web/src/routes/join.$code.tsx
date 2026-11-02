import { errorMessage, type Meeting, type NotesAudience, type NotesMode, type Person, type Session } from '@alcove/api';
import { Avatar, AvatarStack, Button, Field, Icon, IconButton, Input, Logo, RadioRow, Segmented, WaitingDots, useTheme, useToast } from '@alcove/ui';
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useState } from 'react';
import { DevicePreview, DeviceRow } from '~/features/call/DevicePreview';
import { api } from '~/lib/api';
import { sessions } from '~/lib/live';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/join/$code')({
  validateSearch: (s: Record<string, unknown>): { instant?: boolean | undefined } => ({ instant: s['instant'] === true || s['instant'] === 'true' ? true : undefined }),
  loader: async ({ context: { queryClient: qc }, params }) => {
    const [session, meeting] = await Promise.all([qc.ensureQueryData(q.session()), qc.fetchQuery(q.byCode(params.code))]);
    const prefs = session?.hasPasskey ? await qc.ensureQueryData(q.prefs()) : null;
    return { session, meeting, prefs };
  },
  component: PreJoin
});

type Mode = 'host' | 'member' | 'guest';

function PreJoin() {
  const { code } = Route.useParams();
  const { instant } = Route.useSearch();
  const { session, meeting, prefs } = Route.useLoaderData();
  const { resolved, toggle } = useTheme();
  const router = useRouter();
  const navigate = useNavigate();
  const toast = useToast();
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [name, setName] = useState('');
  const mode: Mode = !session ? 'guest' : meeting?.isHost ? 'host' : 'member';
  const initialNotes: NotesMode | null = !meeting ? null : meeting.notes !== 'ask' ? meeting.notes : prefs?.notesDefault === 'always' ? prefs.keep : prefs?.notesDefault === 'never' ? 'off' : null;
  const [notes, setNotes] = useState<NotesMode | null>(initialNotes);
  const [audience, setAudience] = useState<NotesAudience>(meeting?.audience ?? 'everyone');
  const [busy, setBusy] = useState(false);

  if (!meeting) return <NotFound code={code} />;
  const me = session ? session.user : { name: name.trim() || 'You' };

  const join = async () => {
    setBusy(true);
    try {
      if (mode === 'guest') await new Promise((r) => setTimeout(r, 1800)); // waiting for the host to admit you
      const s = await api.calls.join(code, { name: mode === 'guest' ? name : undefined, mic, cam, notes: mode === 'host' ? notes ?? 'off' : undefined, audience, instant });
      sessions.call = { code, session: s };
      await navigate({ to: '/call/$code', params: { code } });
    } catch (e) { toast(errorMessage(e), 'x'); setBusy(false); }
  };

  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr]">
      <header className="flex items-center gap-4 px-7 py-[18px]">
        <Logo size={22} /><div className="flex-1" />
        <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label="Switch theme" onClick={toggle} />
        {mode !== 'guest' && <Button size="sm" variant="ghost" onClick={() => router.history.back()}>Cancel</Button>}
      </header>
      <div className="mx-auto grid w-full max-w-[1180px] items-center gap-12 px-7 pb-16 pt-2.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.9fr)]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 0.8, 0.24, 1] }}>
          <DevicePreview me={me} mic={mic} cam={cam} onMic={() => setMic((v) => !v)} onCam={() => setCam((v) => !v)} />
          <DeviceRow mic={mic} onTest={() => toast('Playing a test sound', 'speaker')} />
        </motion.div>
        <motion.div className="flex flex-col gap-[22px]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 0.8, 0.24, 1] }}>
          {!session ? <GuestSide meeting={meeting} name={name} setName={setName} busy={busy} onJoin={join} />
            : meeting.isHost ? <HostSide meeting={meeting} session={session} notes={notes} setNotes={setNotes} audience={audience} setAudience={setAudience} busy={busy} onJoin={join} />
            : <MemberSide meeting={meeting} busy={busy} onJoin={join} />}
          {mode !== 'guest' && <span className="flex items-center gap-2 text-[13px] text-ink-3"><Icon name="lock" className="size-[15px] text-ok" />End-to-end encrypted · alcove.app/{code}</span>}
        </motion.div>
      </div>
    </main>
  );
}

function others(m: Meeting, me?: Session): Person[] { return m.guests.flatMap((g) => (g.rsvp === 'yes' && g.person && g.person.id !== me?.user.id ? [g.person] : [])); }

function HostSide({ meeting, session, notes, setNotes, audience, setAudience, busy, onJoin }: { meeting: Meeting; session: Session; notes: NotesMode | null; setNotes: (n: NotesMode) => void; audience: NotesAudience; setAudience: (a: NotesAudience) => void; busy: boolean; onJoin: () => void }) {
  const here = others(meeting, session);
  const opts: { v: NotesMode; t: string; d: string }[] = [
    { v: 'full', t: 'Notes + transcript', d: 'Summary, decisions, action items and every line' },
    { v: 'notes', t: 'Notes only', d: 'The transcript is deleted once notes are written' },
    { v: 'off', t: 'No notes', d: 'Nothing is recorded. You can start notes later.' }
  ];
  return (
    <>
      <span className="text-[13.5px] font-semibold text-ink-3">{meeting.title}</span>
      <h1 className="text-[40px] leading-[1.04]">Ready to join?</h1>
      <div className="flex items-center gap-2.5 text-[14.5px] text-ink-2">{here.length ? <><AvatarStack people={here} size={28} />{here.length} invited</> : <><Icon name="users" className="text-ink-3" />No one else is here yet</>}</div>
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

function MemberSide({ meeting, busy, onJoin }: { meeting: Meeting; busy: boolean; onJoin: () => void }) {
  const here = others(meeting).slice(0, 2);
  const on = meeting.notes === 'full' || meeting.notes === 'notes';
  return (
    <>
      <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink-3"><Avatar person={meeting.host} size={24} ring={false} />Hosted by {meeting.host.name}</span>
      <h1 className="text-[40px] leading-[1.04]">{meeting.title}</h1>
      {here.length > 0 && <div className="flex items-center gap-2.5 text-[14.5px] text-ink-2"><AvatarStack people={here} size={28} />{here.map((p) => p.name.split(' ')[0]).join(' and ')} {here.length === 1 ? 'is' : 'are'} in the call</div>}
      <div className="flex gap-3 rounded-2xl bg-card p-4 shadow-[inset_0_0_0_1px_var(--hair)]">
        <Icon name="notes" className="mt-px text-ink-2" />
        <div><b className="block text-[14.5px]">{on ? (meeting.notes === 'full' ? 'Notes + transcript are on' : 'Notes are on') : meeting.notes === 'ask' ? 'The host decides on notes' : 'No notes in this call'}</b>
          <span className="text-[13.5px] text-ink-3">{on ? `${meeting.host.name.split(' ')[0]} set this before the call. You’ll get the notes when it ends. Only people in the call can read them.` : meeting.notes === 'ask' ? 'If notes start, everyone sees a notice first.' : 'Nothing is recorded unless the host starts notes. Everyone would see it.'}</span></div>
      </div>
      <Button size="lg" block loading={busy} onClick={onJoin}>Join now</Button>
    </>
  );
}

function GuestSide({ meeting, name, setName, busy, onJoin }: { meeting: Meeting; name: string; setName: (s: string) => void; busy: boolean; onJoin: () => void }) {
  const on = meeting.notes === 'full' || meeting.notes === 'notes';
  return (
    <>
      <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink-3"><Avatar person={meeting.host} size={24} ring={false} />{meeting.host.name} invited you</span>
      <h1 className="text-[40px] leading-[1.04]">{meeting.title}</h1>
      <Field label="Your name" htmlFor="guest-name"><Input id="guest-name" size="lg" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onJoin()} placeholder="How you’ll appear in the call" /></Field>
      {on && <div className="flex gap-3 rounded-2xl bg-card p-4 shadow-[inset_0_0_0_1px_var(--hair)]"><Icon name="notes" className="mt-px text-ink-2" /><div><b className="block text-[14.5px]">This call takes notes</b><span className="text-[13.5px] text-ink-3">{meeting.host.name.split(' ')[0]} turned on notes{meeting.notes === 'full' ? ' and a transcript' : ''}. Everyone in the call gets a copy, including you.</span></div></div>}
      <Button size="lg" block disabled={!name.trim() || busy} onClick={onJoin}>{busy ? <><WaitingDots /> Waiting for {meeting.host.name.split(' ')[0]} to let you in</> : 'Ask to join'}</Button>
      <span className="text-center text-[13px] text-ink-3">No account needed. Have one? <Link to="/welcome" className="font-semibold text-ink underline underline-offset-[3px]">Sign in</Link></span>
    </>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="flex max-w-[420px] flex-col items-center gap-3">
        <Logo size={26} />
        <h1 className="mt-4 text-[34px]">No call at that link</h1>
        <p className="m-0 text-ink-2">We couldn’t find <span className="font-mono">{code}</span>. Check the link, or ask the host to send it again.</p>
        <Link to="/" className="mt-2 inline-flex h-[42px] items-center rounded-xl bg-btn px-[18px] font-semibold text-btn-ink">Go to Alcove</Link>
      </div>
    </main>
  );
}

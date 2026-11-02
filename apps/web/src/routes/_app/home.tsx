import { firstName } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  ActionItemsCard, Bento, Cell, ComingUp, EmptyNotes, EmptyToday, GiftCard, LaterToday, NextCallCard, NoteCard, SetupCard,
  StartTiles, TimeInCalls, WeekCard
} from '~/features/home/widgets';
import { JoinBox } from '~/features/meetings/JoinBox';
import { NewCallMenu } from '~/features/shell/NewCallMenu';
import { api } from '~/lib/api';
import { q, qk } from '~/lib/queries';
import { greeting, isToday, longToday } from '~/lib/time';

export const Route = createFileRoute('/_app/home')({
  loader: ({ context: { queryClient: qc } }) => Promise.all([
    qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.past()), qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.balance())
  ]),
  component: Home
});

function Home() {
  const { data: session } = useQuery(q.session());
  const { data: upcoming = [] } = useQuery(q.upcoming());
  const { data: past = [] } = useQuery(q.past());
  const { data: notes = [] } = useQuery(q.notes());
  const { data: balance } = useQuery(q.balance());
  const firstDays = notes.length === 0 && past.length === 0;
  const name = firstName(session?.user.name ?? '');
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="text-sm font-semibold text-ink-3">{longToday()}</span>
          <h1 className="mt-2 text-[clamp(36px,3.8vw,52px)] leading-none">{firstDays ? `Welcome to Alcove, ${name}.` : `${greeting()}, ${name}.`}</h1>
        </div>
        <div className="flex items-center gap-2.5">{!firstDays && <NewCallMenu size="lg" align="end" />}<JoinBox /></div>
      </header>
      {firstDays ? <FirstDay credits={balance?.balance ?? 0} perMinute={balance?.perMinute ?? 25} upcoming={upcoming} /> : <Dashboard upcoming={upcoming} past={past} notes={notes} />}
    </>
  );
}

function FirstDay({ credits, perMinute, upcoming }: { credits: number; perMinute: number; upcoming: Awaited<ReturnType<typeof api.meetings.upcoming>> }) {
  const { data: steps = [] } = useQuery(q.setup());
  const qc = useQueryClient();
  const toast = useToast();
  const addPasskey = async () => { await api.account.addPasskey().catch((e: unknown) => { toast(e instanceof Error ? e.message : 'Couldn’t add a passkey', 'x'); throw e; }); toast('Passkey added', 'fingerprint'); void qc.invalidateQueries({ queryKey: qk.setup }); };
  return (
    <Bento>
      <Cell span={7}><GiftCard credits={credits} perMinute={perMinute} /></Cell>
      <Cell span={5}><SetupCard steps={steps} onAddPasskey={addPasskey} /></Cell>
      <Cell span={12}><div><h3 className="mb-3 mt-1.5 font-sans text-[16.5px] font-bold tracking-[-.01em]">Start here</h3><StartTiles /></div></Cell>
      <Cell span={6}>{upcoming.length ? <ComingUp meetings={upcoming} /> : <EmptyToday />}</Cell>
      <Cell span={6}><EmptyNotes /></Cell>
    </Bento>
  );
}

function Dashboard({ upcoming, past, notes }: { upcoming: Awaited<ReturnType<typeof api.meetings.upcoming>>; past: Awaited<ReturnType<typeof api.meetings.past>>; notes: Awaited<ReturnType<typeof api.notes.list>> }) {
  const { data: actions = [] } = useQuery(q.openActions());
  const { data: week } = useQuery(q.week());
  const next = upcoming.find((m) => new Date(m.endsAt).getTime() > Date.now());
  const laterToday = upcoming.filter((m) => m !== next && isToday(m.startsAt));
  return (
    <Bento>
      <Cell span={7}>{next ? <NextCallCard meeting={next} /> : <EmptyToday />}</Cell>
      <Cell span={5}><WeekCard meetings={[...past.filter((m) => isToday(m.startsAt)), ...upcoming]} /></Cell>
      <Cell span={4}><LaterToday meetings={laterToday} /></Cell>
      <Cell span={4}><ActionItemsCard items={actions} /></Cell>
      <Cell span={4}>{week ? <TimeInCalls stats={week} /> : <div />}</Cell>
      <Cell span={12}>
        <div>
          <div className="mb-3 mt-2 flex items-center justify-between"><h3 className="font-sans text-[16.5px] font-bold tracking-[-.01em]">Recent notes</h3></div>
          <div className="grid grid-cols-3 gap-3.5 max-[1000px]:grid-cols-1">{notes.slice(0, 3).map((n) => <NoteCard key={n.id} n={n} />)}</div>
        </div>
      </Cell>
    </Bento>
  );
}

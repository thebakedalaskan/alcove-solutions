/*
 * Start a call: one small modal, opened by N, the side panel's button or the phone's plus. Start now goes to the
 * lobby. Schedule for later stays in the same modal and asks one thing at a time: Who, When, Details. Closing asks
 * nothing and drops the draft; a save that fails stays here with the draft intact. Once a call is scheduled it lives
 * in Home's list and opens its card (Card.tsx) from there.
 */
import { errorMessage, type Document, type Meeting, type MeetingInput, type Person } from '@alcove/api';
import { Button, FlowFoot, FlowHead, FlowNote, FlowSteps, FlowView, Modal, WayCard, cn, useSmoothHeight, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { openWhenStarted } from '~/features/call/session/opening';
import { freshCalls, type BoardToOpen, type CallFlow, type StartOptions } from '~/features/shell/context';
import { someNames } from '~/lib/people';
import { q, useCancelCall, useScheduleCall, useStartNow } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';
import { CallCard } from '../list/Card';
import { Details } from './Details';
import { BringFoot, Documents } from './Documents';
import { guestsOf, newDraft, type Draft, type Guests } from './draft';
import { useFloodToCall } from './parts';
import { Who } from './Who';
import { When } from './When';
import { invitationLine, pickerName, shortTime } from '../scheduling/words';

type View = 'choice' | 'who' | 'when' | 'details' | 'documents';
const VIEWS: readonly View[] = ['choice', 'who', 'when', 'details', 'documents'];
const STEPS = ['Who', 'When', 'Details'] as const;
const STEP_OF: Record<View, number> = { choice: -1, who: 0, when: 1, details: 2, documents: 2 };

/**
 * What's open: starting a call, with anyone already picked and anything it brings, or one call's card. `n` starts each opening
 * over.
 */
type Opened = { n: number; kind: 'start'; people: Person[]; name?: string | undefined; later: boolean; documents: Document[]; board: BoardToOpen | null } | { n: number; kind: 'card'; meeting: Meeting; onGone?: (() => void) | undefined };

/** The call modal's state, for the shell to keep and share. */
export function useCallFlowHost(): { flow: CallFlow; opened: Opened | null; open: boolean; close: () => void } {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [open, setOpen] = useState(false);
  const n = useRef(0);
  /* Whoever you're with and what's connected decide what the first view says, so they're ready before it opens. */
  useQuery(q.team());
  useQuery(q.prefs());
  const flow = useMemo<CallFlow>(() => ({
    start: (o: StartOptions = {}) => {
      n.current += 1;
      setOpened({ n: n.current, kind: 'start', people: o.people ?? [], name: o.name, later: o.later === true, documents: o.documents ?? [], board: o.open ?? null });
      setOpen(true);
    },
    open: (meeting, o = {}) => { n.current += 1; setOpened({ n: n.current, kind: 'card', meeting, onGone: o.onGone }); setOpen(true); }
  }), []);
  return { flow, opened, open, close: useCallback(() => setOpen(false), []) };
}

/** The modal itself, for the shell to mount once. */
export function CallFlowHost({ opened, open, close }: { opened: Opened | null; open: boolean; close: () => void }) {
  if (!opened) return null;
  return opened.kind === 'start'
    ? <StartFlow key={opened.n} open={open} onClose={close} people={opened.people} name={opened.name} later={opened.later} documents={opened.documents} board={opened.board} />
    : <CallCard key={opened.n} open={open} onClose={close} meeting={opened.meeting} onGone={opened.onGone} />;
}

function StartFlow({ open, onClose, people, name, later, documents, board }: {
  open: boolean; onClose: () => void; people: Person[]; name: string | undefined; later: boolean; documents: Document[]; board: BoardToOpen | null;
}) {
  const session = useQuery(q.session()).data;
  const team = useQuery(q.team()).data;
  const prefs = useQuery(q.prefs()).data;
  // Connecting in another tab keeps this draft. Check again when the scheduler returns to it.
  const calendar = useQuery({ ...q.calendar(), refetchOnWindowFocus: (query) => open && query.state.data?.needsAccess ? 'always' : false }).data;
  /* Who to suggest is ready by the time Who opens, so the step arrives at its full height. */
  useQuery(q.people(''));
  const toast = useToast();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const me = session?.user.email;
  const [draft, setDraft] = useState<Draft>(() => newDraft(prefs, { people, name, documents }));
  /* With anyone else picked there's no Who to ask: scheduling goes straight to finding a time with them, and Back still reaches it. */
  const scheduleFrom = (tokens: Draft['tokens']): View => (guestsOf(tokens, me).length ? 'when' : 'who');
  const [view, setView] = useState<View>(() => (later ? scheduleFrom(draft.tokens) : 'choice'));
  const [back, setBack] = useState(false);
  const [wide, setWide] = useState(false);
  const [from, setFrom] = useState<View | null>(null);
  /* Who hears about a call: Google sends invitations when it's reachable and allowed to, and a sample calendar stands in for that. A Google sign-in alone isn't access to its calendar. */
  const invites = calendar?.source === 'sample' || (calendar?.source === 'google' && !calendar.needsAccess && prefs?.addToCalendar !== false);
  const guests = useMemo(() => guestsOf(draft.tokens, me), [draft.tokens, me]);
  const change = useCallback((d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d })), []);
  const widened = view === 'when' && wide;
  useSmoothHeight(box, `${view}:${widened}`, widened ? 420 : 240);

  const schedule = useScheduleCall();
  /* A call on its way, or saved with the modal still settling away: the steps hold still, and nothing is sent again. A save that failed can be tried again. */
  const sent = useRef(false);
  const notifyDone = useScheduled();
  const save = async (input: MeetingInput) => {
    if (sent.current) return;
    sent.current = true;
    try {
      const m = await schedule.mutateAsync(input);
      onClose();
      void notifyDone(m, guests);
    } catch (e) {
      sent.current = false;
      throw e;
    }
  };
  const go = (next: View) => { if (sent.current) return; setBack(VIEWS.indexOf(next) < VIEWS.indexOf(view)); setFrom(view); setView(next); };
  const previous = () => go(view === 'documents' ? 'details' : view === 'details' ? 'when' : view === 'when' ? 'who' : 'choice');
  const at = draft.at;
  const label = view === 'choice' ? 'Start a call' : 'Schedule a call';

  return (
    <Modal ref={setBox} open={open} onOpenChange={(o) => { if (!o) onClose(); }} label={label} className={cn('cf-modal', widened && 'is-wide')}>
      <FlowView>
        {view === 'choice'
          ? <Choice people={guestsOf(draft.tokens, me)} name={name} team={!!team} documents={draft.documents} board={board} onClose={onClose} onLater={() => go(scheduleFrom(draft.tokens))} toast={(e) => toast(errorMessage(e), { icon: 'x' })} />
          : <FlowSteps steps={STEPS} at={STEP_OF[view]} busy={schedule.isPending} onBack={previous} onClose={onClose} />}
        {view !== 'choice' && <p className="sr-only" role="status">{`Step ${STEP_OF[view] + 1} of ${STEPS.length}: ${STEPS[STEP_OF[view]] ?? ''}`}</p>}
        {view === 'who' && (
          <Who value={draft} me={me} back={back} onChange={(g: Guests) => change(g)} onNext={(g) => { change(g); go('when'); }}
            foot={({ next, over }) => (
              <FlowFoot lead={!draft.tokens.length ? <Button variant="quiet" onClick={() => go('when')}>Skip, I’ll share a link</Button> : undefined}>
                <Button variant="primary" disabled={over} onClick={next}>Find a time</Button>
              </FlowFoot>
            )} />
        )}
        {view === 'when' && (
          <When draft={draft} change={change} guests={guests} team={!!team} wide={wide} onWide={setWide} back={back} onNext={(picked) => { change({ at: picked }); go('details'); }} />
        )}
        {view === 'details' && at && (
          <Details draft={draft} change={change} guests={guests} at={draft.offer?.[0] ?? at} invites={invites} connectCalendar={calendar?.needsAccess === true && prefs?.addToCalendar !== false} back={back} returning={from === 'documents'} saving={schedule.isPending}
            onWhen={() => go('when')} onWho={() => go('who')} onDocs={() => go('documents')} onSchedule={save} />
        )}
        {view === 'documents' && (
          <Documents picked={draft.documents.map((d) => d.id)} back={back}
            foot={(docs) => <BringFoot count={docs.length} onBring={() => { change({ documents: docs }); go('details'); }} />} />
        )}
      </FlowView>
    </Modal>
  );
}

/**
 * Now or later. Enter starts now and S schedules, unless focus has gone to something else that takes them. What the call brings
 * comes either way; `board`, one of them, opens for you when a call started now is under way, for you to present.
 */
function Choice({ people, name, team, documents, board, onClose, onLater, toast }: {
  people: Person[]; name: string | undefined; team: boolean; documents: readonly Document[]; board: BoardToOpen | null; onClose: () => void; onLater: () => void; toast: (e: unknown) => void;
}) {
  const startNow = useStartNow();
  const { go, flood } = useFloodToCall();
  const now = useRef<HTMLButtonElement>(null);
  const starting = useRef(false);
  const start = (card: Element | null) => {
    if (starting.current) return;
    starting.current = true;
    go(card, async () => {
      const { code } = await startNow.mutateAsync({ ...(people.length ? { guests: people.map((p) => p.email) } : {}), ...(documents.length ? { documents: documents.map((d) => d.id) } : {}) });
      if (board) openWhenStarted(code, board);
      return code;
    })
      .catch(toast)
      .finally(() => { starting.current = false; });
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key.toLowerCase() === 's') { e.preventDefault(); onLater(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); now.current?.click(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onLater]);
  const who = people.length ? name ?? someNames(people, 2) : undefined;
  return (
    <>
      <FlowHead title={who ? `Start a call with ${who}` : 'Start a call'} onClose={onClose} />
      <div className="cf-ways">
        <WayCard ref={now} art="now" title="Start now" kbd="↵" autoFocus aria-keyshortcuts="Enter" onClick={(e) => start(e.currentTarget)}>{team ? 'Ring your team in, or share a link.' : 'Get a link to send to anyone.'}</WayCard>
        <WayCard art="later" title="Schedule for later" kbd="S" aria-keyshortcuts="S" onClick={onLater}>{team ? 'Find a time that works for everyone.' : 'Pick a time and invite people.'}</WayCard>
      </div>
      {board && <FlowNote tone="info" icon="stickyNote">{board.name || 'Untitled board'} comes with this call. Start now and it opens for you, ready to present.</FlowNote>}
      {flood}
    </>
  );
}

/**
 * Says what scheduling did, and only what it did. Google sends invitations; a sample calendar stands in for that;
 * with nothing connected nobody has heard, so the toast says so and offers the link. The row on Home rises either way.
 */
export function useScheduled() {
  const toast = useToast();
  const copy = useCopyLink();
  const cancel = useCancelCall();
  const calendar = useQuery(q.calendar()).data;
  return async (m: Meeting, guests: readonly Person[]) => {
    freshCalls.add(m.id);
    const code = m.seriesCode ?? m.code;
    /* A browser can refuse this so long after the press: then the toast offers the link instead of claiming it. */
    const copied = () => navigator.clipboard?.writeText(`${location.origin}/join/${code}`).then(() => true, () => false) ?? Promise.resolve(false);
    const offerLink = { label: 'Copy link', onClick: () => copy(code) };
    const undo = { label: 'Undo', onClick: () => cancel.mutate({ id: m.id, code: m.code, scope: m.repeat ? 'following' : undefined }, { onError: (e) => toast(errorMessage(e), { icon: 'x' }) }) };
    const at = new Date(m.startsAt);
    if (m.offer) {
      if (await copied()) toast(`Link copied. Send it to ${pickerName(m)} to pick a time.`, { icon: 'link', ms: 6000 });
      else toast(`Send ${pickerName(m)} the link to pick a time.`, { icon: 'link', ms: 9000, action: offerLink });
      return;
    }
    if (!guests.length) {
      const action = m.calendarUrl ? 'On your Google Calendar' : calendar?.source === 'sample' ? 'On your calendar' : 'Scheduled';
      const where = `${action} for ${shortTime(at, new Date())}.`;
      if (await copied()) toast(`${where} Link copied.`, { icon: 'cal', ms: 6000, action: undo });
      else toast(where, { icon: 'cal', ms: 9000, action: offerLink });
      return;
    }
    if (m.calendarUrl) { toast(`On your Google Calendar. ${invitationLine(guests)}`, { icon: 'cal', ms: 6000, action: undo }); return; }
    if (calendar?.source === 'sample') { toast(`On your calendar. ${invitationLine(guests)}`, { icon: 'cal', ms: 6000, action: undo }); return; }
    toast(`Scheduled for ${shortDay(at)}, ${hm(at)}. Nobody’s been told yet.`, { icon: 'cal', ms: 9000, action: offerLink });
  };
}

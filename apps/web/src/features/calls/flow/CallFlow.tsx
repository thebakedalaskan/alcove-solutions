/*
 * Start a call: one small modal, opened by N, the side panel's Start a call or the phone's plus. Start now goes to the
 * lobby. Schedule for later goes to the scheduler on the Calls page (scheduling/Scheduling.tsx), with whoever was picked
 * and whatever the call brings; asking for later from somewhere else goes straight there. Closing asks nothing. Once a
 * call is scheduled, its row opens its page (/calls/upcoming/<ID>). With no notes left, Get Pro (or more hours) puts the
 * modal away for checkout, since no window opens over another, and opens it again with the same people, documents and
 * board once checkout closes.
 */
import { errorMessage, type Document, type NotesSetting, type Person } from '@alcove/api';
import { FlowHead, FlowNote, FlowView, Modal, WayCard, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openWhenStarted } from '~/features/call/session/opening';
import { NoNotesLeftDoor } from '~/features/plans/notesDoors';
import type { BoardToOpen, CallFlow, StartOptions } from '~/features/calls/flow/context';
import { someNames } from '~/lib/people';
import { accountQueries } from '~/features/account/queries';
import { useStartNow } from '~/features/calls/list/queries';
import { teamQueries } from '~/features/team/queries';
import { useOpenScheduling } from '../scheduling/search';
import { useFloodToCall } from './parts';

/** What's open: starting a call, with anyone already picked and anything it brings. `n` starts each opening over. */
type Opened = { n: number; people: Person[]; name?: string | undefined; documents: Document[]; board: BoardToOpen | null };

/**
 * The call modal's state, for the shell to keep and share. Closing keeps what it was opened with, so `back` can open it
 * again as it was (after checkout); the next start replaces it.
 */
export function useCallFlowHost(): { flow: CallFlow; opened: Opened | null; open: boolean; close: () => void; back: () => void } {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [open, setOpen] = useState(false);
  const n = useRef(0);
  const schedule = useOpenScheduling();
  /* Whoever you're with decides what the modal says, so it's ready before it opens. */
  useQuery(teamQueries.team());
  const flow = useMemo<CallFlow>(() => ({
    start: (o: StartOptions = {}) => {
      if (o.later) { schedule({ schedule: 'new', ...(o.documents?.length ? { bring: o.documents.map((d) => d.id) } : {}) }, (o.people ?? []).map((p) => p.email)); return; }
      n.current += 1;
      setOpened({ n: n.current, people: o.people ?? [], name: o.name, documents: o.documents ?? [], board: o.open ?? null });
      setOpen(true);
    }
  }), [schedule]);
  return { flow, opened, open, close: useCallback(() => setOpen(false), []), back: useCallback(() => setOpen(true), []) };
}

/** The modal itself, for the shell to mount once. */
export function CallFlowHost({ opened, open, close, back }: { opened: Opened | null; open: boolean; close: () => void; back: () => void }) {
  if (!opened) return null;
  return <StartFlow key={opened.n} open={open} onClose={close} onBack={back} people={opened.people} name={opened.name} documents={opened.documents} board={opened.board} />;
}

function StartFlow({ open, onClose, onBack, people, name, documents, board }: {
  open: boolean; onClose: () => void; onBack: () => void; people: Person[]; name: string | undefined; documents: Document[]; board: BoardToOpen | null;
}) {
  const team = useQuery(teamQueries.team()).data;
  const me = useQuery(accountQueries.session()).data?.user.email;
  const toast = useToast();
  const schedule = useOpenScheduling();
  const others = people.filter((p) => p.email.toLowerCase() !== me?.toLowerCase());
  const later = () => {
    onClose();
    schedule({ schedule: 'new', ...(documents.length ? { bring: documents.map((d) => d.id) } : {}) }, others.map((p) => p.email));
  };
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} label="Start a call" className="cf-modal">
      <FlowView>
        <Choice people={others} name={name} team={!!team} documents={documents} board={board} onClose={onClose} onBack={onBack} onLater={later} toast={(e) => toast(errorMessage(e), { icon: 'x' })} />
      </FlowView>
    </Modal>
  );
}

/**
 * Now or later. Enter starts now and S schedules, unless focus has gone to something else that takes them. What the call brings
 * comes either way; `board`, one of them, opens for you when a call started now is under way, for you to present.
 */
function Choice({ people, name, team, documents, board, onClose, onBack, onLater, toast }: {
  people: Person[]; name: string | undefined; team: boolean; documents: readonly Document[]; board: BoardToOpen | null;
  onClose: () => void; onBack: () => void; onLater: () => void; toast: (e: unknown) => void;
}) {
  const startNow = useStartNow();
  const { go, flood } = useFloodToCall();
  const now = useRef<HTMLButtonElement>(null);
  const starting = useRef(false);
  /* A call starts with your notes setting, unless it says otherwise (Start without notes). */
  const notesOn = useQuery(accountQueries.prefs()).data?.notesDefault !== 'off';
  const start = (card: Element | null, notes?: NotesSetting) => {
    if (starting.current) return;
    starting.current = true;
    go(card, async () => {
      const { code } = await startNow.mutateAsync({ ...(notes ? { notes } : {}), ...(people.length ? { guests: people.map((p) => p.email) } : {}), ...(documents.length ? { documents: documents.map((d) => d.id) } : {}) });
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
      {/* Checkout takes the modal's place, and gives it back as it was once it closes. */}
      {notesOn && <NoNotesLeftDoor alone beforeCheckout={onClose} afterCheckout={onBack} without={{ label: 'Start without notes', onClick: () => start(now.current, 'off') }} />}
      {flood}
    </>
  );
}

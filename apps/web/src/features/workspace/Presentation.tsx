/*
 * A document being presented, in place of your own page (docs: Calls and recordings › Presenting). Everyone watching gets the
 * audience's view: the document a section at a time, without menus, the list or anyone's caret, and nothing they couldn't
 * see anyway. Whoever's presenting also gets, beside it and for them alone, where they are, Back and Next, their own notes,
 * and Stop presenting, always at the foot. Your own page waits underneath just as you left it, for when it ends or you work
 * on your own. While something's presented and you're not watching, the strip takes the place of a document's head.
 */
import { errorMessage, firstName, type CallPresent, type DocSession, type DocStatus, type LiveStore } from '@alcove/api';
import { DURATION, EASE, WsCantOpen, WsDoc, WsPage, WsPane, WsPresentStrip, WsPresenterView, WsScroll, wsToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { overlayOpen, typing } from '~/lib/keys';
import { useLive } from '~/lib/live';
import { log } from '~/lib/log';
import { q, useSavePresenterNotes } from '~/lib/queries';
import type { Ws, WorkspacePresenting } from './context';
import { useMediaView } from './DocumentMedia';
import { Editor } from './editor/lazy';
import { sectionAt, type DocSection } from './editor/sections';
import { useVideoHandlers } from './playing';
import { openToRead } from './session';
import { nameOf } from './tree';

const plog = log.child({ component: 'presenting' });

/** How long notes wait after the last key before they're kept. */
const NOTES_WAIT = 600;

/**
 * While something's presented where you are and you're working on your own, or can't open it: what takes the place of a
 * document's head, or tops a pane that has none. Nothing outside a call.
 */
export function presentingStrip(p: WorkspacePresenting | undefined): ReactNode {
  const present = p?.present;
  /* A board says so on the board's own surface. */
  if (!p || !present || p.watching || present.kind === 'board') return null;
  const by = firstName(present.by.name);
  const face = p.presenter ?? { name: present.by.name };
  const stop = present.canControl ? p.stop : undefined;
  if (present.name === null) return <WsPresentStrip name={null} presenter={face} by={by} onStop={stop} />;
  return <WsPresentStrip name={present.name || 'Untitled'} presenter={face} by={by} away={p.away} onToggle={() => p.setAway(!p.away)} onStop={stop} />;
}

/** The document being presented, once its first sync is in: read here and never written. */
function useReading(ws: Ws, documentId: string) {
  const { workspaceId, pass } = ws;
  const [opened, setOpened] = useState<{ session: DocSession; ready: boolean; refused: boolean } | null>(null);
  useEffect(() => {
    let left = false;
    let held: DocSession | null = null;
    openToRead(workspaceId, documentId, pass).then((session) => {
      if (left) { session.close(); return; }
      held = session;
      setOpened({ session, ready: false, refused: false });
      session.ready.then(
        () => { if (!left) setOpened({ session, ready: true, refused: false }); },
        () => { if (!left) setOpened({ session, ready: false, refused: true }); }
      );
    }, (e: unknown) => {
      plog.warn('a presented document didn’t open', { workspaceId, documentId, err: e });
      if (!left) setOpened(null);
    });
    return () => { left = true; held?.close(); };
  }, [workspaceId, documentId, pass]);
  return opened;
}

/**
 * Your own notes for presenting a document, kept under your account a moment after you stop typing, and as you leave.
 * Null for someone in the call without an account, who has nowhere to keep them.
 */
function useNotes(ws: Ws, documentId: string): { notes: string | null; setNotes: (text: string) => void } {
  const mine = ws.owner !== null;
  const saved = useQuery({ ...q.presenterNotes(ws.workspaceId, documentId, ws.pass), enabled: mine });
  const save = useSavePresenterNotes(ws.workspaceId, documentId, ws.pass).mutate;
  const [draft, setDraft] = useState<string | null>(null);
  const waiting = useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const say = ws.say;
  const keep = useCallback((text: string) => {
    save(text, { onError: (e: unknown) => { plog.warn('presenter notes weren’t kept', { documentId, err: e }); say(wsToast.failed(errorMessage(e))); } });
  }, [save, documentId, say]);
  useEffect(() => () => {
    const w = waiting.current;
    if (!w) return;
    clearTimeout(w.timer);
    keep(w.text);
  }, [keep]);
  const setNotes = useCallback((text: string) => {
    setDraft(text);
    if (waiting.current) clearTimeout(waiting.current.timer);
    const timer = setTimeout(() => { waiting.current = null; keep(text); }, NOTES_WAIT);
    waiting.current = { text, timer };
  }, [keep]);
  return { notes: mine ? draft ?? saved.data?.text ?? '' : null, setNotes };
}

/** Over your own page while you're watching a presentation, or giving one. Nothing for a board, which presents itself. */
export function Presentation({ ws, presenting }: { ws: Ws; presenting: WorkspacePresenting }) {
  const present = presenting.present;
  if (!present || present.kind !== 'document' || present.id === null) return null;
  return <Presented key={present.id} ws={ws} presenting={presenting} present={present} documentId={present.id} />;
}

function Presented({ ws, presenting, present, documentId }: { ws: Ws; presenting: WorkspacePresenting; present: CallPresent; documentId: string }) {
  const opened = useReading(ws, documentId);
  const status = useLive(opened?.session ?? NO_SESSION);
  const [sections, setSections] = useState<readonly DocSection[]>([]);
  const at = sectionAt(sections, presenting.section);
  const total = sections.length;
  const name = present.name || 'Untitled';
  const mine = present.mine;
  const { notes, setNotes } = useNotes(ws, documentId);
  const people = useQuery({ ...q.workspacePeople(ws.workspaceId), enabled: ws.sent.role !== null }).data;
  const faces = useMemo(() => [...(people ?? []).map((p) => p.person), ...ws.here.map((h) => h.person)], [people, ws.here]);
  const documentName = useCallback((id: string) => { const d = ws.tree.all.get(id); return d && d.trashedAt === null ? nameOf(d) : undefined; }, [ws.tree]);
  const video = useVideoHandlers(ws, documentId, mine);
  const { media } = useMediaView(ws, documentId, video);
  const { move, stop, setAway, inSight } = presenting;

  /* Each section starts at its top, and fades in, 240 ms. */
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const shown = useRef(at);
  useEffect(() => {
    if (shown.current === at) return;
    shown.current = at;
    scroller.current?.scrollTo({ top: 0 });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) page.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION[2] * 1000, easing: `cubic-bezier(${EASE.out.join(', ')})` });
  }, [at]);

  /* Whoever's presenting moves on with → and back with ←, as a clicker's Page Down and Page Up do, while nothing else wants the keys. */
  useEffect(() => {
    if (!mine || !inSight) return;
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target) || overlayOpen() || document.querySelector('.ws-pop')) return;
      const by = e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (by === 0) return;
      e.preventDefault();
      const to = at + by;
      if (to >= 0 && to < total) move(to);
    };
    addEventListener('keydown', keys);
    return () => removeEventListener('keydown', keys);
  }, [mine, inSight, at, total, move]);

  const gone = opened?.refused === true || status.closed === 'access' || status.closed === 'deleted';
  const strip = mine
    ? <WsPresentStrip mine name={name} at={at + 1} total={Math.max(total, 1)} />
    : <WsPresentStrip name={name} presenter={presenting.presenter ?? { name: present.by.name }} by={firstName(present.by.name)} away={false} onToggle={() => setAway(true)} onStop={present.canControl ? stop : undefined} />;
  return (
    <WsPane reading label={`${name}, presented`}>
      <WsDoc>
        {strip}
        {gone ? <WsCantOpen what="document" /> : (
          <WsScroll ref={scroller}>
            <WsPage>
              <div ref={page}>
                {opened?.ready && (
                  <Suspense>
                    <Editor doc={opened.session.doc} awareness={opened.session.awareness} readOnly section={presenting.section} onSections={setSections}
                      titleHint={name} people={faces} documentName={documentName} media={media} />
                  </Suspense>
                )}
              </div>
            </WsPage>
          </WsScroll>
        )}
      </WsDoc>
      {mine && (
        <WsPresenterView at={at + 1} total={Math.max(total, 1)} part={sections[at]?.name || name} next={at + 1 < total ? sections[at + 1]?.name || 'Untitled' : null}
          notes={notes} onNotes={setNotes} onBack={() => move(at - 1)} onNext={() => move(at + 1)} onStop={stop} />
      )}
    </WsPane>
  );
}

/** Before the document has opened, there's nothing to say about it. */
const NO_STATUS: DocStatus = { status: 'saving', refused: null, role: null, trashed: false, closed: null, unsent: false };
const NO_SESSION: LiveStore<DocStatus> = { getSnapshot: () => NO_STATUS, subscribe: () => () => undefined };

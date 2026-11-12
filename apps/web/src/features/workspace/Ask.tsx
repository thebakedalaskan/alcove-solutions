/*
 * Ask, on the bar over a selection. Make this shorter and Turn this into a checklist go to the notes model in confidential
 * compute and land where the words are, however the page has moved by then: the editor holds them while Alcove writes, and
 * the caret steps off them so anyone can keep typing. What was said about this? answers beside the words, from the call
 * you're in, or outside one from every note you have. Nothing here is kept.
 */
import { MAX_DOC_ASK, errorMessage, type AnswerPart, type CallSession, type DocAskAction, type WorkspaceItem } from '@alcove/api';
import { WsAskAnswer, WsAskMenu, WsPopover, wsToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnswerView, useAnswer } from '~/features/notes/answer';
import { api } from '~/lib/api';
import { sessions } from '~/lib/live';
import { q } from '~/lib/queries';
import type { Ws } from './context';
import type { AskDraft, EditorProps } from './editor/types';
import { Sources } from './Sources';

/** How much of the words a question quotes. */
const QUOTED = 120;

const questionAbout = (text: string) => {
  const words = text.replace(/\s+/g, ' ').trim();
  return `What was said about “${words.length > QUOTED ? `${words.slice(0, QUOTED).trimEnd()}…` : words}”?`;
};

/** The call you're in, as an answer that arrives: everything that's been said in it that you may read. */
const askCall = (session: CallSession) => async function* (question: string): AsyncIterable<AnswerPart> {
  yield { type: 'text', text: (await session.askSoFar(question, { kind: 'all' })).text };
};

/** Asks, and shows what comes back, with the notes it's from. There's nowhere to go from here in a call. */
function Said({ ws, question, onGone }: { ws: Ws; question: string; onGone: () => void }) {
  const call = ws.mode === 'call' ? sessions.call?.session : undefined;
  const ask = useMemo(() => (call ? askCall(call) : (text: string) => api.notes.askAll(text)), [call]);
  const refused = useCallback((e: unknown) => { ws.say(wsToast.failed(errorMessage(e))); onGone(); return true; }, [ws.say, onGone]);
  const { answer, ask: run } = useAnswer(ask, refused);
  const notes = useQuery({ ...q.notes(), enabled: !call }).data;
  useEffect(() => { void run(question); }, [run, question]);
  if (!answer) return null;
  return (
    <WsAskAnswer>
      <AnswerView answer={answer} waiting={call ? 'Reading this call' : 'Reading your notes'}>
        {!call && <Sources cites={answer.cites} notes={notes ?? []} onPick={onGone} />}
      </AnswerView>
    </WsAskAnswer>
  );
}

/** What the page needs for Ask: what the editor calls, and the menu that opens against the words. */
export function useAsk(ws: Ws, item: WorkspaceItem): { onAsk: EditorProps['onAsk']; menu: ReactNode } {
  const [draft, setDraft] = useState<AskDraft | null>(null);
  const [said, setSaid] = useState(false);
  /** The words the menu is holding, to let go of however it goes. */
  const asked = useRef<AskDraft | null>(null);
  const { workspaceId, pass, say } = ws;
  const answers = ws.mode === 'call' ? sessions.call !== null : ws.owner !== null;

  const open = useCallback((d: AskDraft) => { asked.current = d; setDraft(d); }, []);
  const putAway = useCallback(() => {
    asked.current?.done();
    asked.current = null;
    setDraft(null);
    setSaid(false);
  }, []);
  useEffect(() => () => { asked.current?.done(); }, []);

  const run = async (d: AskDraft, action: DocAskAction) => {
    asked.current = null;
    setDraft(null);
    if (d.text.length > MAX_DOC_ASK) { d.done(); say(wsToast.failed('That’s more than Alcove can take at once. Select less, and ask again.')); return; }
    d.wait();
    try {
      for await (const part of api.workspaces.ask(workspaceId, item.id, { action, text: d.text }, pass ? { pass } : undefined)) d.write(part);
    } catch (e) {
      say(wsToast.failed(errorMessage(e)));
    } finally {
      d.done();
    }
  };

  /* Against the words the editor holds while it answers, wherever they are now. */
  const at = useMemo(() => {
    if (!draft) return undefined;
    return () => { const r = draft.where(); return new DOMRect(r.left, r.top, r.width, r.height); };
  }, [draft]);
  return {
    onAsk: open,
    menu: draft && (
      <WsPopover open at={at} within={draft.within} label="Ask Alcove" onOpenChange={(to) => { if (!to) putAway(); }}>
        {said ? <Said ws={ws} question={questionAbout(draft.text)} onGone={putAway} /> : (
          <WsAskMenu onShorter={() => { void run(draft, 'shorter'); }} onChecklist={() => { void run(draft, 'checklist'); }} onSaid={answers ? () => setSaid(true) : undefined} />
        )}
      </WsPopover>
    )
  };
}

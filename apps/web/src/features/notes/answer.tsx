/*
 * Answers to questions about notes, as they arrive: one way to ask and follow an answer, and one way to
 * show it. Asking about a note or a series (the ask bar) and asking every note (the palette) all use these.
 */
import { errorMessage, type AnswerPart, type SeriesAnswerPart } from '@alcove/api';
import { Dots, Icon, Words, cn, useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Where an answer comes from: a note and a moment in its recording, in seconds; a shared screen of the note
 * asked about; or, asking across a series, one of its calls, at a moment when it can tell.
 */
export type Cite = Exclude<AnswerPart | SeriesAnswerPart, { type: 'text' }>;
/** An answer so far: the question, the words that have arrived, where they come from, and whether it's finished. */
export interface Answer { q: string; text: string; cites: Cite[]; done: boolean }

/**
 * Asks with `ask` and follows the answer as it arrives. Asking again, or `reset`, leaves the earlier
 * answer behind: anything still arriving for it is dropped. If asking fails, a toast says why, unless
 * whatever asked has gone (the palette was closed) by then, or `refused` says it took care of it.
 */
export function useAnswer(ask: (question: string) => AsyncIterable<AnswerPart | SeriesAnswerPart>, refused?: ((e: unknown, question: string) => boolean) | undefined) {
  const toast = useToast();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const run = useRef(0);
  const shown = useRef(false);
  useEffect(() => { shown.current = true; return () => { shown.current = false; }; }, []);
  const reset = useCallback(() => { run.current++; setAnswer(null); }, []);
  const start = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const id = ++run.current;
    const current = () => shown.current && run.current === id;
    setAnswer({ q, text: '', cites: [], done: false });
    try {
      for await (const part of ask(q)) {
        if (!current()) return;
        setAnswer((a) => a && (part.type === 'text' ? { ...a, text: a.text + part.text } : { ...a, cites: [...a.cites, part] }));
      }
      if (current()) setAnswer((a) => a && { ...a, done: true });
    } catch (e) {
      if (!current()) return;
      setAnswer(null);
      if (!refused?.(e, q)) toast(errorMessage(e), { icon: 'x' });
    }
  }, [ask, refused, toast]);
  return { answer, ask: start, reset };
}

/**
 * An answer as it arrives: the question, then the words (written in once it's finished), then
 * `children`, which say where it comes from. Until the first words arrive it shows `waiting`, if given.
 */
export function AnswerView({ answer, waiting, className, children }: {
  answer: Answer; waiting?: string | undefined; className?: string | undefined; children?: ReactNode;
}) {
  return (
    <div className={cn('answer', className)} aria-live="polite" aria-busy={!answer.done}>
      <div className="q"><Icon name="ask" size={15} /><span>{answer.q}</span></div>
      <p>{answer.done ? <Words text={answer.text} /> : answer.text || <span className="wait">{waiting}<Dots /></span>}</p>
      {children}
    </div>
  );
}

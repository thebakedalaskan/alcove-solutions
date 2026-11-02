import { clock, type AnswerPart, type Note } from '@alcove/api';
import { Button, Chip, Icon, IconButton } from '@alcove/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { api } from '~/lib/api';

export function AskBar({ note, onCite }: { note: Note; onCite: (at: number) => void }) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<{ q: string; parts: AnswerPart[]; done: boolean } | null>(null);
  const run = useRef(0);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    const id = ++run.current;
    setText(''); setAnswer({ q: question, parts: [], done: false });
    for await (const p of api.notes.ask(note.id, question)) {
      if (run.current !== id) return;
      setAnswer((a) => (a ? { ...a, parts: [...a.parts, p] } : a));
    }
    setAnswer((a) => (a ? { ...a, done: true } : a));
  };
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed bottom-0 left-[260px] right-0 z-[24] h-[170px] bg-gradient-to-b from-transparent to-canvas to-60% max-[900px]:left-0" />
      <div className="fixed bottom-[22px] left-[calc(50%+130px)] z-25 flex w-[min(640px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2.5 max-[900px]:left-1/2">
        <AnimatePresence mode="popLayout">
          {answer ? (
            <motion.div key="a" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              role="status" className="flex flex-col gap-3 rounded-[20px] bg-card px-5 py-[18px] shadow-float">
              <div className="flex items-center justify-between"><b>{answer.q}</b><IconButton icon="x" label="Close answer" onClick={() => { run.current++; setAnswer(null); }} /></div>
              <p className="m-0 text-[15.5px] leading-[1.55]">
                {answer.parts.map((p, i) => p.type === 'text' ? <span key={i}>{p.text}</span> : (
                  <button key={i} type="button" onClick={() => onCite(p.at)} className="mx-0.5 inline-flex h-6 items-center gap-1 rounded-[7px] bg-well px-2 align-[1px] font-mono text-xs hover:bg-hair-2">
                    <Icon name="play" className="size-2.5 fill-current stroke-0" />{clock(p.at)}
                  </button>
                ))}
                {!answer.done && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-recpulse bg-ink" />}
              </p>
              <span className="flex items-center gap-1.5 text-[13px] text-ink-3"><Icon name="lock" className="size-3.5" />Answered inside the sealed server, from this {note.kind === 'room' ? 'recording' : 'call'} only.</span>
            </motion.div>
          ) : (
            <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap justify-center gap-1.5">
              {note.suggestedQuestions.map((s) => <Chip key={s} as="button" onClick={() => ask(s)} className="bg-card shadow-[var(--sh-soft),inset_0_0_0_1px_var(--hair)] hover:text-ink hover:shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair-2)]">{s}</Chip>)}
            </motion.div>
          )}
        </AnimatePresence>
        <form onSubmit={(e) => { e.preventDefault(); void ask(text); }} className="flex items-center gap-2.5 rounded-[18px] bg-card py-2 pl-[18px] pr-2 shadow-float">
          <Icon name="chat" className="text-ink-3" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask about this ${note.kind === 'room' ? 'recording' : 'call'}`} aria-label="Ask about these notes" className="h-10 flex-1 border-0 bg-transparent text-[15px] outline-none" />
          <Button type="submit" size="sm" icon="send" aria-label="Ask" disabled={!text.trim()} />
        </form>
      </div>
    </>
  );
}

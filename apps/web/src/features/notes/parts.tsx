/* The pieces of a note page, shared by real notes and the example. */
import { errorMessage, type ActionItem, type AnswerPart, type Chapter, type Person, type Recipient, type Speaker, type TranscriptLine } from '@alcove/api';
import { Avatar, Check, Faces, Icon, Kbd, TimeChip, Words, cn, useToast } from '@alcove/ui';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { listNames, sameEmail, spokenName } from '~/lib/people';
import { position } from '~/lib/time';
import { PROMISE_MANY } from './NoteCard';
import { ROLE } from './meta';

export function DocHead({ title, when, people, chip }: { title: string; when: string; people: Person[]; chip?: ReactNode }) {
  return (
    <>
      {chip}
      <h1>{title}</h1>
      <div className="doc-meta"><span className="mono">{when}</span><span className="who"><Faces people={people} size={26} />{listNames(people)}</span></div>
    </>
  );
}

export function Section({ title, count, children, className, style }: { title: string; count?: ReactNode; children: ReactNode; className?: string | undefined; style?: CSSProperties | undefined }) {
  return (
    <section className={cn('sec', className)} style={style}>
      <div className="sec-h"><h3>{title}</h3>{count !== undefined && <small>{count}</small>}</div>
      {children}
    </section>
  );
}

export function Decisions({ items }: { items: string[] }) {
  return <>{items.map((d, i) => <div key={d} className="dec"><span className="n">{String(i + 1).padStart(2, '0')}</span><span>{d}</span><span /></div>)}</>;
}

export function FollowUps({ actions, me, onToggle }: { actions: ActionItem[]; me: string | undefined; onToggle?: ((a: ActionItem, done: boolean) => void) | undefined }) {
  return (
    <>
      {actions.map((a) => (
        <div key={a.id} className={cn('act', a.done && 'done')}>
          <Check checked={a.done} onChange={(on) => onToggle?.(a, on)} label={`Mark done: ${a.text}`} />
          <span className="t">{a.text}</span>
          {a.owner ? <span className="owner"><Avatar person={a.owner.person ?? { name: a.owner.name }} size={22} />{spokenName(a.owner, me)}</span> : <span />}
          <span className="due">{a.due ?? ''}</span>
        </div>
      ))}
    </>
  );
}

/** The transcript of a written note, folded away under its summary. */
export function Transcript({ lines, seconds, me, onSeek }: { lines: TranscriptLine[]; seconds: number; me: string | undefined; onSeek?: ((s: number) => void) | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tr-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Transcript · {Math.max(1, Math.round(seconds / 60))} min<Icon name="down" size={16} /></button>
      {open && <TranscriptLines lines={lines} me={me} onSeek={onSeek} className="mt-3" />}
    </>
  );
}

const voiceOf = (s: Speaker | undefined) => (s ? (s.person?.email.toLowerCase() ?? `name:${s.name}`) : '');

/** What was said, line by line. A speaker's lines in a row share one name; a room recording names nobody. */
export function TranscriptLines({ lines, me, onSeek, className }: { lines: TranscriptLine[]; me: string | undefined; onSeek?: ((s: number) => void) | undefined; className?: string | undefined }) {
  return (
    <div className={className}>
      {lines.map((l, i) => {
        const time = <TimeChip seconds={l.at} onSeek={onSeek} />;
        if (!l.speaker) return <div key={l.id} className="tr-line plain"><p>{l.text}</p>{time}</div>;
        const more = voiceOf(lines[i - 1]?.speaker) === voiceOf(l.speaker);
        return (
          <div key={l.id} className={cn('tr-line', more && 'more')}>
            {more ? <span /> : <Avatar person={l.speaker.person ?? { name: l.speaker.name }} size={30} />}
            <div className="min-w-0">{!more && <b>{spokenName(l.speaker, me)}</b>}<p>{l.text}</p></div>
            {time}
          </div>
        );
      })}
    </div>
  );
}

export function Chapters({ chapters, pos, onSeek }: { chapters: Chapter[]; pos: number; onSeek?: ((s: number) => void) | undefined }) {
  const current = chapters.findLastIndex((c) => c.at <= pos);
  return (
    <section className="card" aria-labelledby="chH">
      <div className="card-head"><h3 id="chH">Chapters</h3></div>
      <div className="px-2 pb-2.5 pt-1">
        {chapters.map((c, i) => (
          <button key={`${c.at}-${c.title}`} type="button" className={cn('chap', i === Math.max(0, current) && 'on')} onClick={() => onSeek?.(c.at)} disabled={!onSeek}>
            <span className="mono">{position(c.at)}</span><span><b>{c.title}</b><small>{c.summary}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Who has a note, and how they got it. */
export function Recipients({ recipients, me, fresh }: { recipients: Recipient[]; me: string | undefined; fresh?: ReadonlySet<string> | undefined }) {
  return (
    <section className="card access" aria-labelledby="whoH">
      <div className="acc-h"><h4 id="whoH">Who has these notes</h4><span className="cnt">{recipients.length}</span></div>
      <div className="rcpt">
        {recipients.map((r) => (
          <div key={r.person.email} className={cn('rc', fresh?.has(r.person.email) && 'fresh')}>
            <Avatar person={r.person} size={30} />
            <span><b>{r.person.name}{me && sameEmail(r.person, { email: me }) ? <i> (you)</i> : null}</b><small>{ROLE[r.role]}</small></span>
          </div>
        ))}
      </div>
      <div className="seal"><Icon name="lock" size={15} /><span>{PROMISE_MANY}</span></div>
    </section>
  );
}

/** Ask about a call. Answers stream in, with the moments they come from. */
export function AskBar({ suggestions, ask, onSeek }: { suggestions: string[]; ask: (question: string) => AsyncIterable<AnswerPart>; onSeek?: ((s: number) => void) | undefined }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<{ q: string; text: string; cites: number[]; done: boolean } | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); input.current?.focus(); } };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);
  const run = async (question: string) => {
    const qn = question.trim();
    if (!qn) return;
    setText('');
    input.current?.blur();
    setAnswer({ q: qn, text: '', cites: [], done: false });
    try {
      for await (const part of ask(qn)) {
        setAnswer((a) => a && (part.type === 'text' ? { ...a, text: a.text + part.text } : { ...a, cites: [...a.cites, part.at] }));
      }
      setAnswer((a) => a && { ...a, done: true });
    } catch (e) {
      setAnswer(null);
      toast(errorMessage(e), { icon: 'x' });
    }
  };
  return (
    <div className="ask">
      {answer && (
        <div className="answer">
          <div className="q"><Icon name="ask" size={15} />{answer.q}</div>
          <p>{answer.done ? <Words text={answer.text} /> : answer.text || '…'}</p>
          {answer.cites.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{answer.cites.map((c) => <TimeChip key={c} seconds={c} onSeek={onSeek} />)}</div>}
        </div>
      )}
      {focus && suggestions.length > 0 && (
        <div className="ask-sugg">{suggestions.slice(0, 3).map((s) => <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void run(s)}>{s}</button>)}</div>
      )}
      <div className="ask-bar">
        <Icon name="ask" size={19} />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(text); }} placeholder="Ask about this call" autoComplete="off" aria-label="Ask about this call" />
        <Kbd>⌘J</Kbd>
        <button type="button" className="btn btn-primary btn-icon" aria-label="Ask" onClick={() => void run(text)}><Icon name="send" size={17} /></button>
      </div>
    </div>
  );
}

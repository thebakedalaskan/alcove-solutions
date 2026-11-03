/*
 * Catching up during a call: where the conversation has got to, read from the live transcript, for
 * the person asking alone. Nobody else in the call sees it, and none of it is saved. It says what it
 * read, how current it is, and what it can't know (stretches with notes off).
 */
import { errorMessage, type AnswerPart, type CallSession, type CatchUp, type CatchUpItem } from '@alcove/api';
import { Dots, Icon, TimeChip, Words, cn } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { position } from '~/lib/time';

const clog = log.child({ component: 'catch-up' });

const RANGES = [
  { key: '5', minutes: 5, label: 'Last 5 min', reading: 'the last 5 minutes' },
  { key: '15', minutes: 15, label: 'Last 15 min', reading: 'the last 15 minutes' },
  { key: 'all', minutes: undefined, label: 'Whole call', reading: 'the whole call' }
] as const;
type Range = (typeof RANGES)[number];

type Load = { kind: 'reading' } | { kind: 'read'; c: CatchUp } | { kind: 'failed'; message: string };
type Asked = { q: string; parts: AnswerPart[] | null; error: string | null };

/** "just now", or how long ago it was put together, by the call's own clock. */
function ago(asOf: number, elapsed: number): string {
  const m = Math.floor(Math.max(0, elapsed - asOf) / 60);
  return m < 1 ? 'just now' : `${m} min ago`;
}
function gapsText(c: CatchUp): string {
  return c.gaps.map((g) => (g.to >= c.asOf - 1 ? `since ${position(g.from)}` : `from ${position(g.from)} to ${position(g.to)}`)).join(' and ');
}

function Items({ title, items }: { title: string; items: CatchUpItem[] }) {
  if (!items.length) return null;
  return (
    <section className="cu-sec">
      <h4>{title}<span>{items.length}</span></h4>
      <ul>{items.map((x) => <li key={`${x.at ?? 'x'}-${x.text}`}><span>{x.text}</span>{x.at !== undefined && <TimeChip seconds={x.at} />}</li>)}</ul>
    </section>
  );
}

export function CatchUpView({ session, elapsed, onBack }: { session: CallSession; elapsed: number; onBack: () => void }) {
  const [range, setRange] = useState<Range>(RANGES[0]);
  const [load, setLoad] = useState<Load>({ kind: 'reading' });
  const [tries, setTries] = useState(0);
  const [text, setText] = useState('');
  const [asked, setAsked] = useState<Asked | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'reading' });
    session.catchUp(range.minutes).then(
      (c) => { if (alive) setLoad({ kind: 'read', c }); },
      (e: unknown) => {
        clog.warn('catch-up failed', { err: e, range: range.key });
        if (alive) setLoad({ kind: 'failed', message: errorMessage(e) });
      }
    );
    return () => { alive = false; };
  }, [session, range, tries]);

  const ask = async () => {
    const q = text.trim();
    if (!q || asked?.parts === null) return;
    setText('');
    setAsked({ q, parts: null, error: null });
    try {
      const parts = await session.askSoFar(q);
      setAsked({ q, parts, error: null });
    } catch (e) {
      clog.warn('question during a call failed', { err: e });
      setAsked({ q, parts: [], error: errorMessage(e) });
    }
    requestAnimationFrame(() => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }));
  };
  const answer = asked?.parts?.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ') ?? '';
  const cites = asked?.parts?.flatMap((p) => (p.type === 'cite' ? [p.at] : [])) ?? [];

  return (
    <div className="cu">
      <div className="cu-top">
        <button type="button" className="cu-back" onClick={onBack}><Icon name="left" size={15} />Back to live</button>
        <div className="cu-ranges" role="radiogroup" aria-label="How far back">
          {RANGES.map((r) => (
            <button key={r.key} type="button" role="radio" aria-checked={r.key === range.key} className={cn('cu-range', r.key === range.key && 'on')} onClick={() => setRange(r)}>{r.label}</button>
          ))}
        </div>
      </div>
      <div ref={body} className="cu-body">
        {load.kind === 'reading' && <div className="cu-wait"><Dots /><span>Reading {range.reading}…</span></div>}
        {load.kind === 'failed' && (
          <div className="cu-wait">
            <p className="cu-fail"><Icon name="x" size={14} />{load.message}</p>
            <button type="button" className="cu-retry" onClick={() => setTries((n) => n + 1)}>Try again</button>
          </div>
        )}
        {load.kind === 'read' && (
          <>
            {load.c.lines ? (
              <>
                {load.c.summary && <p className="cu-sum">{load.c.summary}</p>}
                <Items title="Decided" items={load.c.decided} />
                <Items title="Suggested, not agreed" items={load.c.proposed} />
                <Items title="Still open" items={load.c.open} />
                <Items title="Next" items={load.c.next} />
              </>
            ) : <p className="cu-none">Nothing was said in {range.reading}.</p>}
            <div className="cu-meta">
              <p><Icon name="clock" size={13} />Read {load.c.lines} {load.c.lines === 1 ? 'line' : 'lines'}{load.c.lines ? `, ${position(load.c.from)} to ${position(load.c.through)} of the recording` : ''}, {ago(load.c.asOf, elapsed)}.</p>
              {load.c.gaps.length > 0 && <p><Icon name="pause" size={13} />Notes were off {gapsText(load.c)} into the call, so that part isn’t here.</p>}
              <p><Icon name="lock" size={13} />Only you see this, and it isn’t saved.</p>
            </div>
          </>
        )}
        {asked && (
          <div className="cu-answer" aria-live="polite">
            <div className="q"><Icon name="ask" size={14} />{asked.q}</div>
            {asked.parts === null ? <Dots /> : asked.error ? <p className="cu-fail">{asked.error}</p> : <p><Words text={answer} /></p>}
            {cites.length > 0 && <div className="cu-cites">{cites.map((c) => <TimeChip key={c} seconds={c} />)}</div>}
          </div>
        )}
      </div>
      <form className="cp-input" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about the call so far" autoComplete="off" aria-label="Ask about the call so far" />
        <button type="submit" className="rb sm" aria-label="Ask" disabled={!text.trim() || asked?.parts === null}><Icon name="send" size={17} /></button>
      </form>
    </div>
  );
}

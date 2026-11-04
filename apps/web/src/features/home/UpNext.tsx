/*
 * The top of Home: the next call with Join, and what happened last time in its series. With nothing ahead
 * (or before your first call) it's the line to start a call now or describe one to schedule it.
 */
import { ArchThumb, Button, ComposerLine, Faces, Icon, IconButton, buttonClass, coverFor } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { NotesFlag, useCopyLink } from '~/features/call/links';
import { useCallLine } from '~/features/shell/callLine';
import { useOpenComposer } from '~/features/shell/context';
import { useMedia } from '~/lib/live';
import { q } from '~/lib/queries';
import { daysFromToday, hm, minutesUntil, noteDay, shortDay, startsLabel } from '~/lib/time';
import { capital, counted, peopleOn, seriesIdOf, started, whoOn, type Ahead } from './day';
import { useMoveToAlcove } from './parts';

/** The next call: when, who, Join (J), its link and changes, and last time's notes when it's part of a series. */
export function UpNext({ next, now }: { next: Ahead; now: number }) {
  const me = useQuery(q.session()).data?.user.email;
  const h = useId();
  const going = started(next, now);
  const series = seriesIdOf(next);
  const people = peopleOn(next, me);
  const day = daysFromToday(new Date(next.startsAt), new Date(now));
  return (
    <section className="ac-card hm-next" aria-labelledby={h}>
      <ArchThumb cover={coverFor(next.id)} />
      <div className="hm-next-head">
        <div className="ac-eyebrow">{going ? <b>Happening now</b> : <>Up next ·<b>{startsLabel(next.startsAt, now)}</b></>}</div>
        <h3 id={h} className="ac-clamp-2" title={next.title}>{next.title}</h3>
      </div>
      <div className="hm-next-meta">
        <span className="ac-mono">{day === 0 ? '' : `${shortDay(new Date(next.startsAt))} · `}{hm(next.startsAt)} – {hm(next.endsAt)}</span>
        <span className="who">{people.length > 0 && <Faces people={people} size={26} max={3} />}<span className="ac-clamp-1">{whoOn(next, me)}</span></span>
        {next.kind === 'call' && <NotesFlag notes={next.call.notes} className="flag" />}
      </div>
      {next.kind === 'call' ? <CallActs next={next} /> : <EventActs next={next} />}
      {next.kind === 'call' && (
        <p className="hm-next-notes"><NotesFlag notes={next.call.notes} />{next.call.notes === 'on' ? 'Everyone invited gets them after' : 'Nothing is recorded'}</p>
      )}
      <Ring startsAt={next.startsAt} going={going} now={now} />
      {series && <LastTime seriesId={series} next={next} />}
    </section>
  );
}

function CallActs({ next }: { next: Extract<Ahead, { kind: 'call' }> }) {
  const copy = useCopyLink();
  const open = useOpenComposer();
  const m = next.call;
  return (
    <div className="hm-next-acts">
      <Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ variant: 'primary', size: 'lg' })} aria-keyshortcuts="J" data-tour="join">
        <Icon name="video" />Join<span className="kb" aria-hidden="true">J</span>
      </Link>
      <Button variant="secondary" size="lg" icon="link" className="hm-copy" onClick={() => copy(m.code)}><span className="lbl">Copy link</span></Button>
      {m.status === 'scheduled' && m.isOrganizer && <IconButton icon="pen" label="Change this call" aria-haspopup="dialog" onClick={() => open({ meeting: m })} />}
    </div>
  );
}

function EventActs({ next }: { next: Extract<Ahead, { kind: 'event' }> }) {
  const e = next.event;
  const alcove = useMoveToAlcove();
  return (
    <div className="hm-next-acts">
      {e.join && (
        <a href={e.join.url} target="_blank" rel="noreferrer" className={buttonClass({ variant: 'primary', size: 'lg' })} aria-keyshortcuts="J">
          <Icon name="video" />Join on {e.join.label}<span className="kb" aria-hidden="true">J</span>
        </a>
      )}
      {e.isOrganizer && <Button variant={e.join ? 'secondary' : 'primary'} size="lg" icon="video" loading={alcove.busy} onClick={() => void alcove.move(e)}>Use Alcove instead</Button>}
      <a href={e.calendarUrl} target="_blank" rel="noreferrer" className="ac-icon-btn" aria-label="Open in Google Calendar" title="Open in Google Calendar"><Icon name="cal" /></a>
    </div>
  );
}

/** The countdown: it fills over the last quarter of an hour before the call. */
function Ring({ startsAt, going, now }: { startsAt: string; going: boolean; now: number }) {
  const mins = minutesUntil(startsAt, now);
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 350); return () => clearTimeout(t); }, []);
  const C = 226.2;
  const offset = going ? 0 : C * Math.min(1, mins / 15);
  const [n, unit] = going ? ['Now', 'live'] : mins < 60 ? [String(mins), 'min'] : mins < 1440 ? [String(Math.floor(mins / 60)), Math.floor(mins / 60) === 1 ? 'hour' : 'hours'] : [String(Math.floor(mins / 1440)), Math.floor(mins / 1440) === 1 ? 'day' : 'days'];
  return (
    <div className="hm-ring" role="img" aria-label={going ? 'Happening now' : `Starts ${startsLabel(startsAt, now)}`}>
      <svg viewBox="0 0 84 84" aria-hidden="true"><circle className="bg" cx="42" cy="42" r="36" /><circle className="fg" cx="42" cy="42" r="36" strokeDasharray={C} strokeDashoffset={armed ? offset : C} /></svg>
      <b aria-hidden="true">{n}<small>{unit}</small></b>
    </div>
  );
}

/** What last time's notes said, and what's still open from them. */
/**
 * The series' latest call before this one, as your notes have it (its summary comes from the notes list).
 * A call or meeting outside a series has no last time: titles alone don't make one.
 */
function LastTime({ seriesId, next }: { seriesId: string; next: Ahead }) {
  const id = useId();
  const calls = useQuery(q.series(seriesId)).data?.notes;
  const notes = useQuery(q.notes()).data;
  const before = new Date(next.startsAt).getTime();
  const last = calls?.find((c) => c.meetingId !== next.id && new Date(c.startedAt).getTime() < before);
  const n = last && notes?.find((x) => x.id === last.id);
  if (!n) return null;
  const open = n.openActions ? `${capital(counted(n.openActions, 'follow-up'))} ${n.openActions === 1 ? 'is' : 'are'} still open.` : n.totalActions ? 'Its follow-ups are done.' : '';
  const said = n.status !== 'ready' ? 'The notes are still being written.' : n.excerpt || 'Nothing was said while notes were on.';
  return (
    <Link to="/notes/$noteId" params={{ noteId: n.id }} className="hm-last" aria-labelledby={`${id}k ${id}go`} aria-describedby={`${id}p`}>
      <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} />
      <span className="min-w-0">
        <span className="k" id={`${id}k`}>Last time · {noteDay(n.startedAt)}</span>
        <p id={`${id}p`}>{said}{open && <span> {open}</span>}</p>
      </span>
      <span className={buttonClass({ variant: 'quiet', size: 'sm' })} id={`${id}go`}>Read the notes<Icon name="right" size={16} /></span>
    </Link>
  );
}

/**
 * The line to start a call now or describe one to schedule it, as New call reads it. Before your first
 * call it says so. A name it can't find an address for opens New call with the sentence, to add one.
 */
export function StartCall({ first }: { first: boolean }) {
  const open = useOpenComposer();
  const h = useId();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const line = useCallLine({ text });
  const go = async () => {
    const stop = await line.submit(() => setText(''));
    if (stop) open({ text });
  };
  const label = line.p.when ? 'Schedule' : 'Start now';
  // A phone has no Enter key to mention, and less room to say it in.
  const phone = useMedia('(max-width: 860px)');
  return (
    <section className="ac-card hm-start" aria-labelledby={h}>
      <ArchThumb cover="first" />
      <div className="hm-start-head">
        <div className="ac-eyebrow">{first ? 'Your first call' : 'Nothing scheduled'}</div>
        <h3 id={h}>Start one now, or describe it to schedule it</h3>
      </div>
      <div className="hm-start-body">
        <p>Share the link with anyone. Everyone you invite gets the notes, written in confidential compute.</p>
        <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
          <ComposerLine icon="video" className="hm-line" action={(
            <Button type="submit" variant="primary" loading={line.busy} aria-label={label}>
              <span className="lbl">{label}</span><span className="kb" aria-hidden="true">↵</span><Icon name="right" className="go" />
            </Button>
          )}>
            <input ref={input} className="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={phone ? 'Describe the call' : 'Describe the call, or press Enter'}
              aria-label="Describe the call, or press Enter to start now" autoComplete="off" spellCheck={false} enterKeyHint="go" />
          </ComposerLine>
        </form>
        <div className="try">Try {line.tries.map((t) => <button key={t.text} type="button" onClick={() => { setText(t.text); input.current?.focus(); }}>{t.label}</button>)}</div>
      </div>
    </section>
  );
}

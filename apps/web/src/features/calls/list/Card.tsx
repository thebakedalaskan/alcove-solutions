/*
 * A scheduled call's card: one card, opened from its row, for the organizer and for people invited. Who's coming, notes,
 * documents, the link and Join. For the organizer every row opens to change it: only what changed is sent, and in a
 * series a change asks whether it's for this call or this and later calls. Cancelling asks once, in place.
 */
import { errorMessage, type Calendar, type ChangeScope, type Meeting, type MeetingInput, type NotesChoices, type NotesSetting, type Patch, type Rsvp } from '@alcove/api';
import { Avatar, Button, EmptyState, Faces, FlowBody, FlowFoot, FlowRow, FlowSteps, FlowView, IconButton, Modal, NotesSwitches, ScopeBar, TimeCard, TimeCardWaiting, buttonClass, cn, useSmoothHeight, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { log } from '~/lib/log';
import { callName, sameEmail } from '~/lib/people';
import { useMyModelUnencrypted } from '~/lib/aiModels';
import { q, useAnswerCall, useCancelCall, usePendingRsvp, useScheduleCall, useUpdateCall } from '~/lib/queries';
import { hm, shortDay, timeZone } from '~/lib/time';
import { useTimes } from '../scheduling/availability';
import { localWeekday } from '../scheduling/times';
import { BroughtRow, BringFoot, Documents, docNames } from '../flow/Documents';
import { NOT_REPEATING, guestsOf, repeatInput, tokensFor, type Guests, type Repeating } from '../flow/draft';
import { Failed, useFloodToCall } from '../flow/parts';
import { Who } from '../flow/Who';
import { Length, RepeatRow, StartEnd, Week } from '../flow/When';
import { answersLine, cancelNote, cancelledLine, dayWord, freeLine, notesWord, repeatLineHere, restoredLine, shortTime, timeLine, waitingLine, whenLine } from '../scheduling/words';

const clog = log.child({ component: 'call-card' });

type View = 'card' | 'who' | 'time' | 'notes' | 'documents' | 'name' | 'people' | 'brought';

const minutesOf = (m: Meeting) => Math.max(5, Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000));

/** "7 people get the update.", "Jamie gets the update.", or that nobody has heard. Only a connected calendar tells anyone. */
function toldLine(m: Meeting, source: Calendar['source'] | undefined): string {
  if (!m.guestCount) return '';
  if (!m.calendarUrl && source !== 'sample') return 'Nobody’s been told yet.';
  const [one] = m.guests;
  return m.guestCount === 1 && one ? `${callName(one)} gets the update.` : `${m.guestCount} people get the update.`;
}
/** Whether a change reaches the call's calendar event, which is what tells anyone (`showsOnEvent` on the server). Documents and what the notes keep don't. */
const reachesEvent = (p: Patch<MeetingInput>) => [p.title, p.startsAt, p.durationMinutes, p.guests, p.notes, p.repeat].some((v) => v !== undefined);
const TELLS_EVERYONE = 'Everyone invited gets the update.';
/** Beside the button, before anything is saved. */
function willTell(m: Meeting, source: Calendar['source'] | undefined): string {
  if (!m.guestCount) return '';
  return !m.calendarUrl && source !== 'sample' ? 'Nobody’s told until you send them the link.' : TELLS_EVERYONE;
}
/** The fields of a patch as the call has them now, to put back with Undo. */
function undoOf(m: Meeting, input: Patch<MeetingInput>): Patch<MeetingInput> {
  return {
    ...('title' in input ? { title: m.title } : {}), ...('startsAt' in input ? { startsAt: m.startsAt } : {}), ...('durationMinutes' in input ? { durationMinutes: minutesOf(m) } : {}),
    ...('guests' in input ? { guests: m.guests.map((g) => g.email) } : {}), ...('notes' in input ? { notes: m.notes } : {}), ...('choices' in input ? { choices: m.choices } : {}),
    ...('documents' in input ? { documents: m.documents.map((d) => d.id) } : {})
  };
}
/** A series' repeat, as the row that changes it holds it. */
function repeatingOf(m: Meeting): Repeating {
  const rule = m.repeat?.rule;
  if (!rule || !m.repeat) return NOT_REPEATING;
  const { until } = m.repeat;
  if (rule.every === 'month') return { kind: 'month', days: [], until };
  if (rule.weeks === 2) return { kind: 'two-weeks', days: [], until };
  return rule.days.length === 1 ? { kind: 'week', days: [], until } : { kind: 'days', days: rule.days, until };
}

export function CallCard({ open, onClose, meeting, onGone }: { open: boolean; onClose: () => void; meeting: Meeting; onGone: (() => void) | undefined }) {
  /* What the row knew shows at once, and every opening reads the call: answers given in Google only arrive that way. */
  const m = useQuery({ ...q.meeting(meeting.id), initialData: meeting, refetchOnMount: 'always' }).data;
  const calendar = useQuery(q.calendar()).data;
  const session = useQuery(q.session()).data;
  const update = useUpdateCall();
  const toast = useToast();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>('card');
  const [back, setBack] = useState(false);
  const [wide, setWide] = useState(false);
  const [scope, setScope] = useState<ChangeScope>('this');
  const [failed, setFailed] = useState<unknown>(null);
  const gone = useRef(false);
  const series = !!m.repeat;
  const widened = view === 'time' && wide;
  useSmoothHeight(box, `${view}:${widened}`, widened ? 420 : 240);

  const step = (v: View) => { setBack(v === 'card'); setFailed(null); setView(v); };
  /*
   * Puts a change back. The card has gone by then, and a mutation's own callbacks go with it, so a refusal is said from the
   * promise. There can be one: a document the organizer has lost and has just taken off can't go back on.
   */
  const undo = (input: Patch<MeetingInput>, applied: ChangeScope | undefined) => update.mutateAsync({ id: m.id, input: undoOf(m, input), scope: applied }).catch((e: unknown) => {
    clog.warn('undoing a change to a call failed', { err: e, meetingId: m.id });
    toast(`Couldn’t undo that. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
  });
  /* Everything saved here is said the same way: what happened, who heard, and Undo while there's one to give. */
  const save = async (input: Patch<MeetingInput>, said: string) => {
    if (update.isPending) return;
    if (!Object.keys(input).length) { step('card'); return; }
    setFailed(null);
    try {
      const applied = series ? scope : undefined;
      const next = await update.mutateAsync({ id: m.id, input, scope: applied });
      onClose();
      const told = reachesEvent(input) ? toldLine(next, calendar?.source) : '';
      toast(`${said}${told ? ` ${told}` : ''}`, { icon: 'cal', ms: 6000, action: scope === 'this' && !input.repeat ? { label: 'Undo', onClick: () => void undo(input, applied) } : undefined });
    } catch (e) {
      setFailed(e);
    }
  };
  const scopeBar = series ? <ScopeBar value={scope} onChange={setScope} /> : null;
  const fail = failed !== null ? <Failed error={failed} /> : null;
  const told = willTell(m, calendar?.source);
  const steps = <FlowSteps steps={[]} at={0} onBack={() => step('card')} onClose={onClose} />;
  const saving = update.isPending;

  return (
    <Modal ref={setBox} open={open} onOpenChange={(o) => { if (!o) onClose(); }} label={m.title} className={cn('cf-modal', widened && 'is-wide')} focusSelf
      onCloseFocus={() => { if (!gone.current || !onGone) return false; onGone(); return true; }}>
      <FlowView>
        {view === 'card' && <Summary m={m} back={back} onClose={onClose} onOpen={step} me={session?.user.email} onCancelled={() => { gone.current = true; onClose(); }} />}
        {view === 'who' && <>{steps}<ChangeWho m={m} me={session?.user.email} scopeBar={scopeBar} fail={fail} told={told} saving={saving} onSave={save} /></>}
        {view === 'time' && <>{steps}<ChangeTime m={m} scope={scope} scopeBar={scopeBar} fail={fail} told={told} saving={saving} wide={wide} onWide={setWide} onSave={save} /></>}
        {view === 'notes' && <>{steps}<ChangeNotes m={m} scopeBar={scopeBar} fail={fail} told={told} saving={saving} onSave={save} /></>}
        {view === 'documents' && (
          <>
            {steps}
            <Documents picked={m.documents.map((d) => d.id)} brought={m.documents} back={false} foot={(_, ids) => (
              <>{scopeBar}{fail}<BringFoot count={ids.length} busy={saving} onBring={() => {
                const before = m.documents.map((d) => d.id);
                if (ids.length === before.length && ids.every((id) => before.includes(id))) step('card');
                else void save({ documents: ids }, 'Saved.');
              }} /></>
            )} />
          </>
        )}
        {view === 'name' && <>{steps}<ChangeName m={m} scopeBar={scopeBar} fail={fail} told={told} saving={saving} onSave={save} /></>}
        {view === 'people' && <>{steps}<Attending m={m} /></>}
        {view === 'brought' && <>{steps}<Brought m={m} /></>}
      </FlowView>
    </Modal>
  );
}

/** The card itself. */
function Summary({ m, back, me, onClose, onOpen, onCancelled }: { m: Meeting; back: boolean; me: string | undefined; onClose: () => void; onOpen: (v: View) => void; onCancelled: () => void }) {
  const navigate = useNavigate();
  const copy = useCopyLink();
  const toast = useToast();
  const { go, flood } = useFloodToCall();
  const cancel = useCancelCall();
  const restore = useScheduleCall();
  const answer = useAnswerCall();
  const answering = usePendingRsvp(m.id);
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<ChangeScope>('this');
  const [failed, setFailed] = useState<unknown>(null);
  const at = new Date(m.startsAt);
  const minutes = minutesOf(m);
  const yours = m.isOrganizer;
  const changeable = yours && m.status === 'scheduled';
  const offered = m.offer?.times;
  /* Invited to a call that offers times: there's no time to answer yet, and its link is where a time gets picked. */
  const picking = !!offered && !yours;
  const repeats = m.repeat ? repeatLineHere(m.repeat, at) : undefined;
  const code = m.seriesCode ?? m.code;
  const people = m.guests.filter((g) => !me || !sameEmail(g, { email: me }));
  const faces = yours ? people : [m.organizer, ...people];
  const laterToo = !!m.repeat && scope === 'following';

  /*
   * Undo makes a new call with the same details: a new link, and answers from nothing. The card has gone by then, and
   * a mutation's own callbacks go with it, so what happened is said from the promise. A new call brings only what you
   * can open, which leaves out anything you've lost since.
   */
  const scheduleAgain = () => restore.mutateAsync({ title: m.title, startsAt: m.startsAt, durationMinutes: minutes, guests: m.guests.map((g) => g.email), notes: m.notes, choices: m.choices, joinMuted: m.joinMuted, documents: m.documents.flatMap((d) => (d.name === null ? [] : [d.id])) }).then(
    (next) => { toast(restoredLine(next), { icon: 'cal', ms: 9000, action: { label: 'Copy link', onClick: () => copy(next.code) } }); },
    (e: unknown) => {
      clog.warn('scheduling a cancelled call again failed', { err: e, meetingId: m.id });
      toast(`Couldn’t schedule the call again. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
    }
  );
  const cancelCall = async () => {
    setFailed(null);
    const applied = m.repeat ? scope : undefined;
    try {
      await cancel.mutateAsync({ id: m.id, code: m.code, scope: applied });
      onCancelled();
      /* One call comes back as it was, with a new link; a call in a series can't rejoin it. */
      const again = !m.repeat && !m.offer ? { label: 'Undo', onClick: () => void scheduleAgain() } : undefined;
      toast(cancelledLine(m, applied === 'following'), { icon: 'trash', ms: 6000, action: again });
    } catch (e) {
      setFailed(e);
    }
  };

  return (
    <>
      <FlowBody back={back} className="cf-card-h">
        <div className="cf-card-top">
          <div className="min-w-0">
            <h2 className="ac-clamp-2" title={m.title}>{m.title}</h2>
            <p className="when">{offered ? `${offered.length} times offered · ${waitingLine(m)}` : `${timeLine(at, minutes)}${repeats ? ` · ${repeats}` : ''}`}</p>
          </div>
          <span className="end">
            {changeable && <IconButton icon="pen" size={17} label="Rename this call" onClick={() => onOpen('name')} />}
            <IconButton icon="x" label="Close" onClick={onClose} />
          </span>
        </div>
        {!yours && !offered && <Answer value={m.rsvp} saving={answering} onAnswer={(a) => { void answer.mutateAsync({ id: m.id, answer: a }).catch((e: unknown) => toast(`Couldn’t confirm your answer. ${errorMessage(e)}`, { icon: 'x' })); }} />}
        <div className="cf-rows" style={{ marginTop: 14 }}>
          <FlowRow icon="people" title={m.guestCount ? `${m.guestCount} invited` : 'Just you'} sub={!m.guestCount ? 'Share the link to bring people in' : picking ? undefined : answersLine(m.rsvps)}
            end={faces.length ? <Faces people={faces} size={24} max={4} /> : undefined} onClick={changeable ? () => onOpen('who') : m.guestCount ? () => onOpen('people') : undefined} />
          {changeable && !offered && <FlowRow icon="cal" title="Change the time" sub={`${shortDay(at)} at ${hm(at)}${repeats ? `, ${repeats.charAt(0).toLowerCase()}${repeats.slice(1)}` : ''}`} onClick={() => onOpen('time')} />}
          {offered && <FlowRow icon="calClock" title="Times offered" sub={offered.map((t) => `${shortDay(new Date(t))}, ${hm(t)}`).join(' · ')} />}
          <FlowRow icon="notes" on={m.notes === 'on'} title={notesWord(m)} sub={m.notes === 'off' ? 'Nothing is recorded' : yours ? 'Everyone invited gets them' : 'You get them after the call'} onClick={changeable ? () => onOpen('notes') : undefined} />
          <FlowRow icon="fileText" title={m.documents.length ? `${m.documents.length} ${m.documents.length === 1 ? 'document' : 'documents'}` : 'Documents'} sub={m.documents.length ? docNames(m.documents) : changeable ? 'Bring something to the call' : 'Nothing was brought'}
            onClick={changeable ? () => onOpen('documents') : m.documents.length ? () => onOpen('brought') : undefined} />
          {m.seriesId && <FlowRow icon="repeat" title="What carries over" sub="What earlier calls in the series decided and left open" onClick={() => { const seriesId = m.seriesId; onClose(); if (seriesId) void navigate({ to: '/notes/series/$seriesId', params: { seriesId } }); }} />}
        </div>
      </FlowBody>
      {failed !== null && <Failed error={failed} />}
      {asking ? (
        <div className="cf-confirm">
          <span>Cancel {laterToo ? 'this and later calls' : 'this call'}? {cancelNote(m, laterToo)}</span>
          {m.repeat && <ScopeBar label="Cancel" value={scope} onChange={setScope} />}
          <span className="row">
            <span className="acts">
              <Button variant="quiet" size="sm" onClick={() => setAsking(false)}>Keep it</Button>
              <Button size="sm" loading={cancel.isPending} onClick={() => void cancelCall()}>Cancel the call</Button>
            </span>
          </span>
        </div>
      ) : (
        <FlowFoot lead={changeable ? <Button variant="quiet" icon="trash" onClick={() => setAsking(true)}>Cancel this call</Button> : undefined}>
          <Button variant={offered && yours ? 'primary' : 'secondary'} icon="link" onClick={() => copy(code)}>Copy link</Button>
          {picking && <Link to="/join/$code" params={{ code: m.code }} className={buttonClass({ variant: 'primary' })} onClick={onClose}>Pick a time</Link>}
          {!offered && <Button variant="primary" icon="video" onClick={(e) => { go(e.currentTarget, () => Promise.resolve(m.code)).catch((err) => toast(errorMessage(err), { icon: 'x' })); }}>Join</Button>}
        </FlowFoot>
      )}
      {flood}
    </>
  );
}

/** Are you coming? The organizer sees the answer. */
function Answer({ value, saving, onAnswer }: { value: Rsvp | null; saving: boolean; onAnswer: (a: Rsvp) => void }) {
  const choices: { value: Rsvp; label: string }[] = [{ value: 'yes', label: 'Yes' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }];
  return (
    <div className="cf-sumrow">
      <b>Are you coming?{saving && <small className="cf-answer-state" role="status">Saving…</small>}</b>
      <div className="cf-ans" role="group" aria-label="Are you coming?">
        {choices.map((c) => <button key={c.value} type="button" aria-pressed={value === c.value} onClick={() => onAnswer(c.value)}>{c.label}</button>)}
      </div>
    </div>
  );
}

/** What each change view shares. */
interface Change { m: Meeting; scopeBar: ReactNode; fail: ReactNode; told: string; saving: boolean; onSave: (input: Patch<MeetingInput>, said: string) => Promise<void> }

function ChangeWho({ m, me, scopeBar, fail, told, saving, onSave }: Change & { me: string | undefined }) {
  const [value, setValue] = useState<Guests>(() => ({ tokens: tokensFor(m.guests), unread: [] }));
  const save = (g: Guests) => {
    const next = guestsOf(g.tokens, me).map((p) => p.email.toLowerCase());
    const before = new Set(m.guests.map((p) => p.email.toLowerCase()));
    void onSave(next.length === before.size && next.every((e) => before.has(e)) ? {} : { guests: next }, 'Saved.');
  };
  return (
    <Who value={value} onChange={setValue} me={me} back={false} onNext={save} heading="Who’s coming?"
      foot={({ next, over }) => <>{scopeBar}{fail}<FlowFoot summary={told}><Button variant="primary" disabled={over} loading={saving} onClick={next}>Save</Button></FlowFoot></>} />
  );
}

function ChangeTime({ m, scope, scopeBar, fail, told, saving, wide, onWide, onSave }: Change & { scope: ChangeScope; wide: boolean; onWide: (w: boolean) => void }) {
  const emails = useMemo(() => m.guests.map((g) => g.email), [m.guests]);
  const current = useMemo(() => new Date(m.startsAt), [m.startsAt]);
  const [minutes, setMinutes] = useState(minutesOf(m));
  const [picked, setPicked] = useState<Date | null>(null);
  const [repeat, setRepeat] = useState<Repeating>(() => repeatingOf(m));
  const times = useTimes(emails, minutes, m);
  const chosen = picked ?? current;
  const series = !!m.repeat;
  /* What repeats from here, when that's what this change does: later calls of a series, or a call becoming one. */
  const carries = repeat.kind !== 'none' && (series ? scope === 'following' : true);
  const moved = chosen.getTime() !== current.getTime();
  const longer = minutes !== minutesOf(m);
  const reRepeated = carries && (!series || moved || JSON.stringify(repeat) !== JSON.stringify(repeatingOf(m)));
  const zone = m.repeat?.timeZone ?? timeZone();
  const save = () => {
    /* The call's old day stops counting: it's the new one that repeats, beside any others picked. */
    const was = localWeekday(current, zone);
    const next = reRepeated ? repeatInput({ ...repeat, days: repeat.days.filter((d) => d !== was) }, chosen, zone) : null;
    void onSave({
      ...(moved ? { startsAt: chosen.toISOString() } : {}), ...(longer ? { durationMinutes: minutes } : {}), ...(next ? { repeat: next } : {})
    }, moved ? `Moved to ${shortTime(chosen, times.now)}.` : 'Saved.');
  };
  const changed = moved || longer || reRepeated;
  const others = m.guestCount;
  return (
    <>
      <FlowBody>
        <h2>Move this call</h2>
        <p className="cf-sub">{times.loading ? 'Reading calendars…' : whenLine({ guests: m.guests, slots: times.slots, source: times.source, failed: times.failed, unknown: times.unknown })}</p>
        <div className={cn(wide && 'cf-split')}>
          <div className="min-w-0">
            <div className="cf-times" aria-busy={times.loading}>
              {times.loading ? [0, 1, 2].map((i) => <TimeCardWaiting key={i} />) : <MoveCards times={times} current={current} chosen={chosen} onPick={setPicked} />}
            </div>
            <StartEnd at={chosen} minutes={minutes} onChange={(c) => { setPicked(c.at); setMinutes(c.minutes); }} />
            <div className="cf-bar">
              <Length minutes={minutes} onChange={setMinutes} />
              {!wide && <button type="button" className="lk" onClick={() => onWide(true)}>Pick another time</button>}
            </div>
          </div>
          {wide && <Week emails={emails} chosen={chosen} minutes={minutes} onPick={setPicked} onMinutes={setMinutes} except={m} />}
        </div>
        {(!series || scope === 'following') && <div className="cf-rows"><RepeatRow repeat={repeat} at={chosen} zone={zone} keep={series} onChange={setRepeat} /></div>}
      </FlowBody>
      {scopeBar}
      {fail}
      <FlowFoot summary={told}>
        <Button variant="primary" disabled={!changed} loading={saving} onClick={save}>{!moved ? 'Save' : told === TELLS_EVERYONE ? `Move and tell ${others} ${others === 1 ? 'person' : 'people'}` : 'Move'}</Button>
      </FlowFoot>
    </>
  );
}

/**
 * The time it's at ("Now") and the best others, or what was picked from the week (or typed) in place of the last of them:
 * soonest first, so the tick is all that says which is picked.
 */
function MoveCards({ times, current, chosen, onPick }: { times: ReturnType<typeof useTimes>; current: Date; chosen: Date; onPick: (at: Date) => void }) {
  const others = times.slots.filter((s) => s.at.getTime() !== current.getTime());
  const listed = others.some((s) => s.at.getTime() === chosen.getTime()) || chosen.getTime() === current.getTime();
  const shown = listed ? others.slice(0, 2) : [...others.slice(0, 1), times.slot(chosen)];
  /* "All free" is about everyone, so it takes reading everyone. */
  const cards = [{ at: current, note: 'Now' }, ...shown.map((s) => ({ at: s.at, note: freeLine(s) || (s.of > 1 && !times.unknown ? 'All free' : '') }))];
  return <>{cards.sort((a, b) => a.at.getTime() - b.at.getTime()).map(({ at, note }) => (
    <TimeCard key={at.getTime()} day={dayWord(at, times.now)} time={hm(at)} note={note} picked={chosen.getTime() === at.getTime()} onClick={() => onPick(at)} />
  ))}</>;
}

function ChangeNotes({ m, scopeBar, fail, told, saving, onSave }: Change) {
  const unencrypted = useMyModelUnencrypted();
  const [notes, setNotes] = useState<NotesSetting>(m.notes);
  const [choices, setChoices] = useState<NotesChoices>(m.choices);
  const sameChoices = (['keepTranscript', 'keepRecording', 'allowScreens'] as const).every((k) => choices[k] === m.choices[k]);
  const changed = notes !== m.notes || !sameChoices;
  return (
    <>
      <FlowBody>
        <h2>Notes</h2>
        <div className="cf-rows" style={{ borderTop: 0 }}><NotesSwitches modelPrivate={!unencrypted} notes={notes} choices={choices} onNotes={setNotes} onChoices={setChoices} /></div>
      </FlowBody>
      {scopeBar}
      {fail}
      <FlowFoot summary={notes !== m.notes ? told : undefined}>
        <Button variant="primary" disabled={!changed} loading={saving} onClick={() => void onSave({ ...(notes !== m.notes ? { notes } : {}), ...(sameChoices ? {} : { choices }) }, 'Saved.')}>Save</Button>
      </FlowFoot>
    </>
  );
}

function ChangeName({ m, scopeBar, fail, told, saving, onSave }: Change) {
  const [title, setTitle] = useState(m.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  const name = title.trim();
  const changed = name !== '' && name !== m.title;
  const save = () => { if (changed) void onSave({ title: name }, 'Saved.'); };
  return (
    <>
      <FlowBody>
        <input ref={input} className="cf-title" type="text" aria-label="Name the call" value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }} />
      </FlowBody>
      {scopeBar}
      {fail}
      <FlowFoot summary={told}><Button variant="primary" disabled={!changed} loading={saving} onClick={save}>Save</Button></FlowFoot>
    </>
  );
}

/** Who's invited, for someone who can't change it. Past 25 people only the count is shown to them. */
function Attending({ m }: { m: Meeting }) {
  return (
    <FlowBody>
        <h2>{m.guestCount} invited</h2>
        <p className="cf-sub">{answersLine(m.rsvps)}</p>
        <div className="cf-list">
          <div className="cf-row"><span className="cf-face"><Avatar person={m.organizer} size={36} /></span><span className="min-w-0"><b className="ac-clamp-1">{m.organizer.name}</b><small>Organizer</small></span></div>
          {m.guests.map((g) => <div key={g.email} className="cf-row"><span className="cf-face"><Avatar person={g} size={36} /></span><span className="min-w-0"><b className="ac-clamp-1">{g.name}</b><small className="ac-clamp-1">{g.email}</small></span></div>)}
        </div>
        {!m.guests.length && m.guestCount > 0 && <p className="cf-sub">Names aren’t shown on a call this big.</p>}
    </FlowBody>
  );
}

/** What was brought, for someone who can't change it. */
function Brought({ m }: { m: Meeting }) {
  return (
    <FlowBody>
        <h2>Documents</h2>
        {m.documents.length ? <div className="cf-docs">{m.documents.map((d) => <BroughtRow key={d.id} d={d} />)}</div> : <EmptyState title="Nothing was brought">Documents show here when the organizer adds them.</EmptyState>}
    </FlowBody>
  );
}

/*
 * The organizer's lobby: the pre-join on the night stage, where a call is settled before it starts. While it hasn't
 * started, its name, its notes and what they keep can change here (LobbyNotes.tsx), and Join waits for what's still
 * saving; once it's live they're read-only, as the call shows them. On a team you pick who to ring, and they hear it the
 * moment you join. Copy link, quietly under Join, is for anyone else: the address you're on is the call's link too.
 * Backing out of a call started just now cancels it: it was never on anyone's calendar, and nobody has been told. Once
 * its link has been copied, somebody may have been: then it stays, for anyone with the link.
 */
import { errorMessage, firstName, type CallSession, type CaptureState, type Meeting, type Person, type Team } from '@alcove/api';
import { Button, Faces, Icon, IconButton, Notice, useRaisedToasts, useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useCopyLink } from '~/features/call/session/links';
import { JoinRefused } from './JoinProblem';
import { LobbyNotes } from './LobbyNotes';
import { PrejoinCapture } from './PrejoinCapture';
import { PrejoinCarry } from './PrejoinCarry';
import { JoinMuted, PrejoinMain, type Prejoining } from './PrejoinMedia';
import { api } from '~/lib/api';
import { sessions } from '~/features/call/session/handoff';
import { log } from '~/lib/log';
import { listNames, sameEmail, someNames } from '~/lib/people';
import { useCancelCall, useUpdateCall } from '~/features/calls/list/queries';
import { daysFromToday, hm, minutesUntil, shortDay } from '~/lib/time';
import { LobbyRing } from './LobbyRing';
import { ringable } from '../ringing/ringWords';

const llog = log.child({ component: 'lobby' });

const copiedKey = (code: string) => `alcove.link-copied.${code}`;
/** Remembers that this tab copied a call's link. It's kept for the tab, past this page: coming Back or reloading and then leaving mustn't cancel the call either. */
function rememberCopied(code: string): void {
  try {
    sessionStorage.setItem(copiedKey(code), '1');
  } catch (e) {
    llog.debug('copied link not kept', { err: e });
  }
}
function linkCopied(code: string): boolean {
  try {
    return sessionStorage.getItem(copiedKey(code)) !== null;
  } catch (e) {
    llog.debug('copied link not readable', { err: e });
    return false;
  }
}

/**
 * The call's name, which can be changed in place until it starts: Enter or leaving the field saves, Escape puts it back.
 * Its save goes to `track`, as the notes' do; once Join is pressed (`locked`) there's no pen.
 */
function LobbyName({ meeting, editable, locked, track }: { meeting: Meeting; editable: boolean; locked: boolean; track: (saving: Promise<boolean>) => void }) {
  const update = useUpdateCall();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // What's on its way: shown until the call says it's saved, or the save fails and the old name comes back.
  const [saving, setSaving] = useState<string | null>(null);
  const undo = useRef(false);
  const pen = useRef<HTMLButtonElement>(null);
  const backToPen = useRef(false);
  const title = meeting.title;
  useEffect(() => { if (saving === title) setSaving(null); }, [saving, title]);
  // Finished from the keyboard, the focus carries on from where the field was.
  useEffect(() => { if (!editing && backToPen.current) { backToPen.current = false; pen.current?.focus(); } }, [editing]);
  const save = (value: string) => {
    const next = value.trim();
    if (!next || next === title) return;
    setSaving(next);
    track(update.mutateAsync({ id: meeting.id, input: { title: next } }).then(() => true, (e: unknown) => {
      llog.warn('renaming the call failed', { err: e, meetingId: meeting.id });
      setSaving(null);
      toast(`Couldn’t rename the call, so it’s still ${title}. ${errorMessage(e)}`, { icon: 'x', ms: 6000 });
      return false;
    }));
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    undo.current = e.key === 'Escape';
    backToPen.current = true;
    e.currentTarget.blur();
  };
  if (editing && editable) {
    return (
      <div className="rg-name">
        <input autoFocus defaultValue={saving ?? title} maxLength={160} aria-label="The call’s name" onFocus={(e) => e.currentTarget.select()} onKeyDown={keys}
          onBlur={(e) => { if (!undo.current) save(e.currentTarget.value); undo.current = false; setEditing(false); }} />
      </div>
    );
  }
  return (
    <div className="rg-name">
      <h1 className="ac-clamp-2">{saving ?? title}</h1>
      {editable && !locked && <IconButton ref={pen} icon="pen" size={16} label="Rename the call" onClick={() => setEditing(true)} />}
    </div>
  );
}

/** The most people one ring can go to. */
const RING_AT_ONCE = 20;
/** Rings everyone picked, once the organizer is in. If it fails they're still in the call, and they're told once. */
function ringIn(session: CallSession, people: Person[], told: (text: string) => void) {
  const emails = people.map((p) => p.email);
  const rounds = Array.from({ length: Math.ceil(emails.length / RING_AT_ONCE) }, (_, i) => emails.slice(i * RING_AT_ONCE, (i + 1) * RING_AT_ONCE));
  Promise.all(rounds.map((round) => session.ring(round))).catch((e: unknown) => {
    llog.warn('ringing from the lobby failed', { err: e, people: people.length });
    told(`Couldn’t ring ${someNames(people)}. You’re in the call, and you can try again from People.`);
  });
}

export function Lobby({ meeting, me, capture, team, standIn, media }: { meeting: Meeting; me: Person; capture: CaptureState | null; team: Team | null; standIn: string | null; media: Prejoining }) {
  const navigate = useNavigate();
  const copy = useCopyLink();
  const toast = useToast();
  const cancel = useCancelCall();
  useRaisedToasts();
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);

  const settling = meeting.status === 'scheduled';
  const people = ringable(team, me);
  const onATeam = people.length > 0;
  const started = meeting.instant && settling;
  const ringing = started && onATeam;
  // Whoever the call was started with comes picked. Only people on Alcove can be rung.
  const [picked, setPicked] = useState<Person[]>(() => (ringing ? meeting.guests.flatMap((g) => people.find((p) => sameEmail(p, g)) ?? []) : []));

  /*
   * Backing out of a call started just now cancels it, once: leaving this page any way but by joining, unless its link
   * was copied. A reload never gets here. React comes straight back after the first unmount in development, which puts
   * that off for a moment. `gone`: the lobby isn't on screen any more, so a Join still waiting on a save doesn't go on.
   */
  const leaving = useRef<{ joined: boolean; started: boolean; gone: boolean; id: string; code: string; timer?: ReturnType<typeof setTimeout> | undefined }>({ joined: false, started, gone: false, id: meeting.id, code: meeting.code });
  leaving.current.started = started;
  const cancelCall = cancel.mutateAsync;
  useEffect(() => {
    const l = leaving.current;
    l.gone = false;
    clearTimeout(l.timer);
    return () => {
      l.gone = true;
      l.timer = setTimeout(() => {
        if (l.joined || !l.started || linkCopied(l.code)) return;
        llog.info('backed out of a call nobody joined', { meetingId: l.id });
        cancelCall({ id: l.id, code: l.code }).catch((e: unknown) => llog.warn('couldn’t cancel a call nobody joined', { err: e, meetingId: l.id }));
      }, 0);
    };
  }, [cancelCall]);

  /* What the lobby is still saving (its name, its notes and what they keep), each saying whether it was saved. */
  const saves = useRef(new Set<Promise<boolean>>());
  const track = (saving: Promise<boolean>) => {
    saves.current.add(saving);
    const done = () => { saves.current.delete(saving); };
    void saving.then(done, done);
  };

  const giveLink = () => { copy(meeting.code); rememberCopied(meeting.code); };
  const { m } = media;
  const join = async () => {
    setJoining(true);
    setProblem(null);
    // The call starts as the lobby shows it: what's still saving gets there first, and nothing switches meanwhile. A change
    // that couldn't be saved has gone back and said so, and joining waits for another press. Left meanwhile, it's not joined.
    const saved = await Promise.allSettled([...saves.current]);
    if (leaving.current.gone) return;
    if (!saved.every((r) => r.status === 'fulfilled' && r.value)) { setJoining(false); return; }
    leaving.current.joined = true;
    try {
      const s = await api.calls.join(meeting.code, { mic: m.mic, cam: m.cam });
      sessions.call = { code: meeting.code, session: s };
      ringIn(s, ringing ? picked : [], (text) => toast(text, { icon: 'x', ms: 8000 }));
      await navigate({ to: '/call/$code', params: { code: meeting.code }, replace: true });
    } catch (e) {
      leaving.current.joined = false;
      setProblem(e);
      setJoining(false);
    }
  };

  const guests = meeting.guests;
  const now = meeting.status === 'live' || Math.abs(minutesUntil(meeting.startsAt)) <= 2;
  const day = daysFromToday(new Date(meeting.startsAt)) === 0 ? '' : `${shortDay(new Date(meeting.startsAt))} · `;
  return (
    <div className="pj">
      <PrejoinMain media={media} me={me} className="rg-in" />
      <div className="pj-side rg-side rg-in b">
        <LobbyName meeting={meeting} editable={settling} locked={joining} track={track} />
        {!started && <div className="pj-time ac-time">{now ? 'Starting now' : `${day}${hm(meeting.startsAt)} – ${hm(meeting.endsAt)}`}</div>}
        {!started && (
          <div className="presence">
            {guests.length ? <><Faces people={guests} size={28} /><span>{listNames(guests)} {guests.length > 1 ? 'are' : 'is'} invited</span></>
              : <span className="nobody"><Icon name="link" size={16} />Just you on this call so far.</span>}
          </div>
        )}
        {settling ? <LobbyNotes meeting={meeting} who={ringing ? 'Everyone you ring gets them' : 'Everyone invited gets them'} locked={joining} track={track} />
          : <PrejoinCapture notes={meeting.notes} choices={meeting.choices} capture={capture} audience={{ kind: 'organizer', guests }} organizerName={me.name} />}
        {meeting.joinMuted && <JoinMuted />}
        {ringing && <LobbyRing people={people} picked={picked} onChange={setPicked} />}
        {standIn && <Notice icon="people" className="pj-standin">{firstName(standIn)} is hosting while you’re away. Joining makes you the host again.</Notice>}
        <Button variant="primary" size="lg" icon="video" className="join" loading={joining} onClick={() => void join()}>{standIn ? 'Join and host' : ringing && picked.length ? `Join and ring ${picked.length}` : 'Join'}</Button>
        {problem !== null && <JoinRefused error={problem} />}
        <div className="pj-sub"><button type="button" onClick={giveLink}><Icon name="link" size={15} />Copy link</button></div>
        <PrejoinCarry code={meeting.code} me={me.email} />
      </div>
    </div>
  );
}

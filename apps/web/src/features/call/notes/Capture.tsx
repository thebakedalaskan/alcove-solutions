/*
 * What the call captures, in the call (docs: Calls and recordings › What's captured). The notes sign in the top bar
 * opens what's captured: each kind of capture, who changed it and when, who gets the notes, and the organizer's
 * controls (pause and resume, notes on and off), or for anyone else a way to ask for notes. Asks reach the organizer
 * as a toast and in People; whoever asked hears the answer. In a breakout room it shows the room's capture, and the
 * organizer pauses or carries on there; asks for notes stay the call's. The state is the server's (CallState.capture),
 * read with useLive() by the call screen and never copied here; only the organizer's own pause on its way is this
 * screen's.
 */
import { errorMessage, notesAreOn, type CallRole, type CallState, type NotesRequest, type Person } from '@alcove/api';
import { Avatar, Button, CaptureParts, CaptureSign, Faces, Icon, IconButton, Popover, Switch, cn, useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { captureHere, changedLine } from '~/lib/capture';
import { callName, listNames } from '~/lib/people';
import { hm } from '~/lib/time';
import { capital } from '~/lib/words';

/** What the screen does when someone changes what's captured: the organizer's controls, and anyone else's ask. */
export interface CaptureControls {
  /** The organizer: notes on or off. */
  notes: (on: boolean) => void;
  /** The organizer: hold all capture, or carry on. */
  pause: () => void;
  resume: () => void;
  /** The organizer: have shared screens read for the notes, or stop it. */
  screens: (on: boolean) => void;
  /** Anyone else: ask for notes, or take the ask back. */
  ask: (up: boolean) => void;
  /** The organizer, in a breakout room: pause notes there, or carry on. The call's notes don't change. */
  room: (paused: boolean) => void;
}

/** The notes sign in the top bar, the same for everyone; it opens what's captured. */
export function CaptureButton({ state, role, getting, controls, pausing, onOpenNotes }: {
  state: CallState;
  /** How you're in the call: whether you get the notes depends on it. */
  role: CallRole;
  /** Who gets the notes, as far as you can tell (the organizer knows everyone invited). */
  getting: Person[];
  controls: CaptureControls;
  /** The organizer's pause is on its way: their browser has stopped capturing, and the call hasn't answered yet. */
  pausing: boolean;
  onOpenNotes: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = captureHere(state.capture);
  const changing = pausing && c.mode !== 'paused';
  const requested = !notesAreOn(c.mode) && c.requests.length > 0;
  const label = changing ? 'Pausing notes' : c.mode === 'on' ? 'Notes on' : c.mode === 'unavailable' ? 'Notes unavailable' : c.mode === 'paused' ? 'Notes paused' : requested ? 'Notes requested' : 'Notes off';
  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="start" label="What’s captured" className="ic-capture"
      anchor={<button type="button" className="ic-sign" aria-label={`${label}. What’s captured`}><CaptureSign mode={c.mode} requested={requested} pausing={changing} stage /></button>}>
      <CaptureDetails state={state} role={role} getting={getting} controls={controls} done={() => setOpen(false)} onOpenNotes={onOpenNotes} />
    </Popover>
  );
}

function CaptureDetails({ state, role, getting, controls, done, onOpenNotes }: {
  state: CallState; role: CallRole; getting: Person[]; controls: CaptureControls; done: () => void; onOpenNotes: () => void;
}) {
  const call = state.capture;
  const c = captureHere(call);
  const host = state.isOrganizer;
  // Asks and the organizer's notes controls follow the call's notes; in a breakout room, what's shown is the room's.
  const on = notesAreOn(call.mode);
  const roomName = call.room ? roomNameOf(state) : null;
  // The room's own pause, not the call's: only the organizer carries on there, and nobody asks for it.
  const roomHeld = call.room !== null && c.mode === 'paused' && call.mode !== 'paused';
  const name = organizerName(state);
  const when = changedLine(c, name);
  const askers = call.requests.map((r) => askerOf(state, r));
  const mine = !host ? call.asked : null;
  const run = (f: () => void) => () => { done(); f(); };
  return (
    <>
      <div className="cap-h"><CaptureSign mode={c.mode} requested={!notesAreOn(c.mode) && c.requests.length > 0} />{when && <span className="when">{when}</span>}</div>
      <p className="cap-said">{saidFor(state, c, name)}</p>
      <CaptureParts capture={c} taker={state.isHost ? 'you' : takerName(state)} />
      {/* The call's shared screens, so it's the call's state, and not shown in a breakout room, where nothing shared is read. */}
      {host && !call.room && call.mode !== 'off' && (
        <div className="cap-screens">
          <span><b>Read shared screens</b><small>What anyone shares is read for the notes, from their own browser. Cameras never are.</small></span>
          <Switch checked={call.screen.mode !== 'off'} label="Read shared screens for the notes" onChange={(on) => controls.screens(on)} />
        </div>
      )}
      <div className="cap-facts">
        <div className="sealed"><Icon name="sealed" size={15} /><span>Written in confidential compute. Alcove can’t read the notes.</span></div>
        <div>
          <Icon name="people" size={15} />
          {roomName ? <span>What’s said in {roomName} goes into the call’s notes as its own section, for everyone who gets them.</span> : <>
            <span>{host ? 'The notes go to you and everyone invited.' : role === 'invited' ? 'The notes go to everyone invited, you included.' : 'The notes go to the people invited.'}</span>
            {host && getting.length > 0 && <Faces people={getting} size={18} max={4} />}
          </>}
        </div>
        <div><Icon name="lock" size={15} /><span>Cameras and chat are encrypted end to end and never captured.</span></div>
      </div>
      {host && askers.length > 0 && !on && (
        <div className="cap-ask"><Faces people={askers} size={22} max={3} /><span className="t">{listNames(askers)} asked for notes.</span></div>
      )}
      {mine?.state === 'asking' && (
        <div className="cap-ask"><Icon name="hand" size={16} /><span className="t">You asked {name} for notes.</span><Button size="sm" variant="quiet" onClick={run(() => controls.ask(false))}>Take it back</Button></div>
      )}
      {mine?.state === 'declined' && !on && (
        <div className="cap-ask"><Icon name="clock" size={16} /><span className="t">{capital(name)} said not now at {hm(mine.at)}.</span></div>
      )}
      {(host || (!on && mine?.state !== 'asking')) && (
        <div className="cap-acts">
          {host && on && call.room && !roomHeld && <Button size="sm" icon="pause" onClick={run(() => controls.room(true))}>Pause notes here</Button>}
          {host && roomHeld && <Button size="sm" variant="primary" icon="play" onClick={run(() => controls.room(false))}>Resume notes here</Button>}
          {host && on && !call.room && <><Button size="sm" icon="pause" onClick={run(controls.pause)}>Pause notes</Button><Button size="sm" variant="quiet" onClick={run(() => controls.notes(false))}>Turn off</Button></>}
          {host && call.mode === 'paused' && <><Button size="sm" variant="primary" icon="play" onClick={run(controls.resume)}>Resume notes</Button><Button size="sm" variant="quiet" onClick={run(() => controls.notes(false))}>Turn off</Button></>}
          {host && call.mode === 'off' && <Button size="sm" variant="primary" onClick={run(() => controls.notes(true))}>Turn on notes</Button>}
          {!host && <Button size="sm" variant="primary" icon="hand" onClick={run(() => controls.ask(true))}>Ask for notes</Button>}
        </div>
      )}
      <button type="button" className="cap-open" onClick={run(onOpenNotes)}><Icon name="notesPen" size={16} />Open the notes<Icon name="right" size={15} /></button>
    </>
  );
}

/**
 * What's captured right now, in a sentence: what everyone says is recorded and transcribed (through the browser of
 * whoever hosts, the organizer or someone standing in for them, from what it hears), less whatever it can't do now;
 * nothing while paused, until the organizer resumes; and while notes are off, that what was transcribed before is
 * still read for the notes. In a breakout room (`c` is the room's), what's said is transcribed by the room's scribe, a
 * browser in the room, named (yours, if it's you), and goes into the call's notes as the room's own section; nothing
 * there is recorded.
 */
function saidFor(state: CallState, c: CallState['capture'], name: string): string {
  const mine = state.isHost;
  const by = takerName(state);
  const browser = mine ? 'your browser' : `${by}’s browser`;
  const until = state.isOrganizer ? 'you resume' : `${name} resumes`;
  if (c.room) {
    const room = roomNameOf(state);
    if (c.mode === 'paused') return state.capture.mode === 'paused' ? `Nothing is recorded, transcribed or sent to the AI until ${until}.` : `Notes are paused in ${room}. Nothing said here is transcribed or sent to the AI until ${until}.`;
    if (c.mode === 'off') return state.notes.everOn ? `Nothing said in ${room} is transcribed now. What was transcribed here before goes into the call’s notes as the room’s section.` : `Nothing said in ${room} is transcribed.`;
    if (c.mode === 'unavailable') return `Notes are on, but nobody’s browser here can transcribe ${room} right now, so nothing said here is captured.`;
    return `What’s said here is transcribed by ${roomScribe(state, c)} and goes into the call’s notes as ${room}’s own section. Live, only the people here see it. Nothing here is recorded.`;
  }
  if (c.mode === 'paused') return `Nothing is recorded, transcribed or sent to the AI until ${until}.`;
  if (c.mode === 'off') return state.notes.everOn ? 'Nothing new is recorded or transcribed. What was transcribed before is still read for the notes.' : 'Nothing from this call is recorded or written down.';
  // Out of the call, the host's own recorder keeps going and sends what it held, but nobody else is heard.
  // Shared screens are read from each presenter's own browser, so they carry on meanwhile.
  if (c.mode === 'unavailable' && c.away) return mine ? 'Your browser isn’t in the call right now, so what others say isn’t transcribed until it’s back.' : `Notes are on, but ${by}’s browser isn’t in the call right now, so nothing ${c.screen.mode === 'on' ? 'said ' : ''}is captured until it’s back.`;
  if (c.mode === 'unavailable') return `Notes are on, but ${browser} can’t record or listen right now, so nothing is captured.`;
  if (c.recording.mode === 'on' && c.transcript.mode === 'on') return 'What everyone says, you included, is recorded and transcribed for the notes.';
  if (c.transcript.mode === 'on') return `What everyone says is transcribed for the notes. It isn’t recorded: ${browser} can’t record right now.`;
  return `What everyone says is recorded for the notes. Nothing is transcribed: ${browser} can’t listen right now.`;
}

/**
 * Whose browser transcribes the breakout room you're in (`c`, the room's capture), to say mid-sentence: yours, someone's
 * by name, or, while the room has none, a browser here.
 */
export function roomScribe(state: CallState, c: CallState['capture'] = state.capture): string {
  const id = c.room?.scribe ?? null;
  if (id === null) return 'a browser here';
  if (id === state.participants.find((p) => p.isMe)?.id) return 'your browser';
  const p = state.participants.find((x) => x.id === id)?.person;
  return `${p ? capital(callName(p)) : 'someone here'}’s browser`;
}
/** The breakout room you're in, by name. */
const roomNameOf = (state: CallState): string => state.breakouts.open?.rooms.find((r) => r.id === state.capture.room?.id)?.name ?? 'this room';

/** Whoever asked, as the call shows them. */
export function askerOf(state: CallState, r: NotesRequest): Person {
  return state.participants.find((p) => p.id === r.participantId)?.person ?? { id: r.participantId, name: 'Someone', email: '' };
}

/**
 * Asks for notes as they come: the organizer hears about each new one once, with a way to turn notes on (or resume
 * them); whoever asked hears when the organizer says not now. Saying yes is notes coming on, which everyone hears.
 */
export function useCaptureAlerts(state: CallState, controls: CaptureControls) {
  const toast = useToast();
  const c = state.capture;
  const heard = useRef(new Set<string>());
  const live = useRef(controls);
  live.current = controls;
  useEffect(() => {
    if (!state.isOrganizer) return;
    for (const r of c.requests) {
      if (heard.current.has(r.id)) continue;
      heard.current.add(r.id);
      const paused = c.mode === 'paused';
      toast(`${callName(askerOf(state, r))} asked for notes`, {
        icon: 'notesPen', ms: 12_000, action: { label: paused ? 'Resume' : 'Turn on', onClick: () => (paused ? live.current.resume() : live.current.notes(true)) }
      });
    }
  }, [c.requests, c.mode, state, toast]);
  // Said no to before this screen opened (a reload): already told.
  const told = useRef(c.asked?.state === 'declined' ? c.asked.at : null);
  const name = organizerName(state);
  useEffect(() => {
    const a = c.asked;
    if (state.isOrganizer || a?.state !== 'declined' || told.current === a.at) return;
    told.current = a.at;
    toast(`${capital(name)} said not now to notes`, { icon: 'notesPen', ms: 5000 });
  }, [c.asked, name, state.isOrganizer, toast]);
}

/** Asks for notes, for the organizer in People: who asked and when, Not now for each, and notes on (or resumed) for everyone. */
export function NotesAsks({ state, controls, decline, after }: {
  state: CallState; controls: CaptureControls;
  decline: (requestId: string) => Promise<void>;
  /** Something is listed above it. */
  after: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const c = state.capture;
  if (!state.isOrganizer || notesAreOn(c.mode) || !c.requests.length) return null;
  const paused = c.mode === 'paused';
  const no = (r: NotesRequest, p: Person) => {
    setBusy(r.id);
    decline(r.id).then(() => toast(`${callName(p)} was told not now`, { icon: 'check' }), (e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setBusy(null));
  };
  return (
    <>
      <div className={cn('ac-eyebrow ic-cap-h', after && 'mt')}>Asking for notes · {c.requests.length}</div>
      {c.requests.map((r) => {
        const p = askerOf(state, r);
        return (
          <div key={r.id} data-call-action={r.id} tabIndex={-1} className="ic-prow is-asking">
            <Avatar person={p} size={36} />
            <div className="min-w-0"><b>{p.name}</b><small>Asked at {hm(r.at)}</small></div>
            <div className="st">
              <IconButton icon="x" label={`Say not now to ${callName(p)}`} disabled={busy === r.id} onClick={() => no(r, p)} />
              <Button size="sm" variant="secondary" onClick={() => (paused ? controls.resume() : controls.notes(true))}>{paused ? 'Resume notes' : 'Turn on notes'}</Button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** "Asked for notes", on the asker's row in People, for everyone. */
export const askedTag = (state: CallState, participantId: string): string => (!notesAreOn(state.capture.mode) && state.capture.requests.some((r) => r.participantId === participantId) ? 'Asked for notes' : '');

/** The organizer's first name for a sentence, from the call itself (they may be away from it), or "the organizer" for someone not let in yet. */
export function organizerName(state: CallState): string {
  const p = state.participants.find((x) => x.isOrganizer)?.person ?? (state.host.organizer.name ? state.host.organizer : undefined);
  return p ? callName(p) : 'the organizer';
}
/** Whose browser takes the notes, by first name: whoever hosts (someone standing in while the organizer is away), else the organizer. */
function takerName(state: CallState): string {
  const p = state.participants.find((x) => x.id === state.host.id)?.person;
  return p ? callName(p) : organizerName(state);
}
/** Where the call is captured, to start a sentence: "Your browser" for whoever hosts, "Art’s browser" (or a stand-in's) for everyone else. */
export const notesBrowser = (state: CallState): string => (state.isHost ? 'Your browser' : `${capital(takerName(state))}’s browser`);

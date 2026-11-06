import { MAIN_PLACE, notesAreOn, type CallSession, type CallState } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import type { CallRoom } from '../media/livekit';
import type { LocalMedia } from '../media/media';
import { NotesRecorder } from './recorder';
import { CallEars, canListen } from './speech';
import type { CaptureControls } from './Capture';

const clog = log.child({ component: 'call' });

interface NotesCaptureInput {
  session: CallSession;
  state: CallState;
  crypto: ReturnType<CallSession['crypto']['getSnapshot']>;
  media: LocalMedia;
  room: CallRoom;
  departing: boolean;
}


interface CaptureFeedback {
  failed: (error: unknown) => void;
  notesEnabled: () => void;
  notesAsked: (up: boolean) => void;
}

interface CaptureDeparture {
  /** Sends the final permitted recording and speech before the session changes. */
  flush: () => Promise<readonly unknown[]>;
  /** Applies the departure's capture cleanup; handoff keeps its session UI transition between audio and speech. */
  finish: (afterAudio?: (() => void) | undefined) => void;
  /** A failed session transition keeps the same recorder and piece numbering. */
  rollback: () => void;
}

interface NotesCapture {
  uploadError: string | null;
  heardProblem: string | null;
  pausing: boolean;
  controls: (feedback: CaptureFeedback) => CaptureControls;
  departure: (reason: 'move' | 'leave' | 'hand-off') => CaptureDeparture;
  discardDisplaced: () => void;
}

/** Follows who this browser may record and transcribe, and owns capture cleanup. */
export function useNotesCapture({ session, state, crypto, media, room, departing }: NotesCaptureInput): NotesCapture {
  const toast = useToast();
  const self = session.ticket.identity;
  const hosting = state.isHost;
  const organizer = state.isOrganizer;
  const on = notesAreOn(state.capture.mode);
  const live = state.phase === 'in-call';
  const [turningOff, setTurningOff] = useState(false);
  const [pausing, setPausing] = useState(false);
  const winding = departing || turningOff;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  // The host's browser reports the capture it can provide.
  const [cantRecord, setCantRecord] = useState(false);
  const [cantListen, setCantListen] = useState(() => !canListen());
  /*
   * The call's notes. In the host's browser (the organizer's, or a stand-in's), from what it hears: its own microphone
   * and the people in its part of the call, as their tracks arrived (nobody's volume here, nor the speaker, changes
   * that). The recorder mixes them into one recording, so playing the notes back sounds like the call; while the host is
   * in a breakout room the recording is silent (hush, below). The live transcript hears each voice on its own, under
   * their own name: the host's browser in the main room, and in each breakout room its scribe's, a browser the call picks
   * among the people sent there, whose lines go into the call's notes as the room's own section. Both run while notes are
   * on; paused or off, they stop and drop whatever wasn't sent: the server refuses it anyway.
   */
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => session.appendAudio(p), setUploadError, setCantRecord);
  const ears = useRef<CallEars | null>(null);
  if (!ears.current) ears.current = new CallEars((c, speaker) => session.transcribe(c, speaker), setHeardProblem, setCantListen);
  const micTrack = media.micTrack();
  const segment = state.notes.recording.segment;
  // Who's heard changes as people come and go, mute, switch microphones, or move between rooms.
  const heardKey = room.heard().map((h) => `${h.identity}:${h.track.id}`).join(' ');
  // Once this browser is ending the call, handing it on or turning notes off, the last audio and speech are on their
  // way: nothing starts recording or listening again meanwhile, as people drop out of the room or anyone mutes.
  const capturing = hosting && on && live && !winding;
  useEffect(() => {
    const r = recorder.current;
    if (!r) return;
    // In a breakout room it records silence (hush, below): the call's recording has the main room's talk.
    if (capturing) r.start([...(micTrack ? [{ identity: self, track: micTrack }] : []), ...room.heard()], segment);
    else if (!on || !hosting) r.discard();
  }, [capturing, hosting, on, segment, micTrack, room, self, heardKey]);
  // Nothing is heard while this browser is between two parts of the call: it holds neither part's keys.
  const settledHere = crypto.status === 'in';
  // Nobody is heard in a breakout room the organizer paused: what was held is dropped, and the segment carries on.
  const roomHeld = state.capture.room?.mode === 'paused';
  // This browser hears the part of the call it's in for the transcript: the host's the main room, a room's scribe its room.
  const scribe = !hosting && state.capture.room !== null && state.capture.room.scribe === self;
  const hearsHere = scribe || (hosting && crypto.place === MAIN_PLACE);
  // A stand-in hosting from inside a breakout room (everyone invited was in one): nothing can hear the main room until
  // rooms close, and whoever hosts is never a room's scribe. The organizer visiting a room goes back when they choose.
  const hostingFromRoom = hosting && !organizer && crypto.place !== MAIN_PLACE;
  // Everyone else is heard whether or not this browser has a microphone of its own. A browser that stops hearing its
  // part of the call (the host going into a room, a scribe moved or replaced) sends what it heard there first.
  // Once this browser is leaving, or the host is ending the call or the organizer turning notes off, the last speech is
  // on its way: nothing starts listening again meanwhile, as people drop out of the room or anyone mutes.
  useEffect(() => {
    const e = ears.current;
    if (!e) return;
    if (!on) { e.stop(); return; }
    if (winding) return;
    if (roomHeld) e.quiet();
    else e.follow(segment, live && hearsHere && settledHere ? [...(micTrack ? [{ identity: self, track: micTrack, own: true }] : []), ...room.heard().map((h) => ({ ...h, own: false }))] : []);
  }, [on, winding, live, segment, micTrack, room, self, heardKey, settledHere, roomHeld, hearsHere]);
  // A scribe is told: their browser sends what's said in their room, for its section of the call's notes.
  const wasScribe = useRef(false);
  useEffect(() => {
    if (scribe && !wasScribe.current && on) toast('Your browser now hears this room for the notes: what’s said here goes into the call’s notes as this room’s section', { icon: 'notesPen', ms: 6000 });
    wasScribe.current = scribe;
  }, [scribe, on, toast]);
  const wasFromRoom = useRef(false);
  useEffect(() => {
    if (hostingFromRoom && !wasFromRoom.current && on) toast('You’re hosting from a breakout room, so nobody’s browser hears the main room for the notes until everyone is back', { icon: 'notesPen', ms: 6000 });
    wasFromRoom.current = hostingFromRoom;
  }, [hostingFromRoom, on, toast]);
  useEffect(() => () => ears.current?.stop(), []);
  /*
   * What this browser can't capture while notes are on, which everyone is told: the recording when the recorder
   * couldn't start or failed (without a microphone of the organizer's own it still records everyone else), the
   * transcript without a way to listen, and both while a stand-in hosts from a breakout room. It's said again whenever
   * it changes, and after every change to notes, which forgets it.
   */
  const cant = (['recording', 'transcript'] as const).filter((p) => hostingFromRoom || (p === 'recording' ? cantRecord : cantListen));
  const cantKey = cant.join(' ');
  const toldKey = (['recording', 'transcript'] as const).filter((p) => state.capture[p].mode === 'unavailable').join(' ');
  useEffect(() => {
    // A tab that's out of the call (someone else hosts now) has nothing to say: it's letting go of its microphone.
    if (!hosting || !live || !on || cantKey === toldKey || crypto.status === 'away' || crypto.status === 'removed') return;
    clog.info('saying what this browser can’t capture', { parts: cantKey || 'none' });
    session.setUnavailable(cant).catch((e: unknown) => clog.warn('could not say what this browser can’t capture', { err: e, parts: cantKey || 'none' }));
  }, [hosting, live, on, cantKey, toldKey, session, crypto.status]);
  /*
   * Moving to another part of the call ends every clip in progress (the server places each where its speaker was when
   * it began, so none may span two parts), and the recording that goes into the notes hears nothing while the host is
   * in a breakout room: a room's talk reaches the notes only through its own transcript.
   */
  useEffect(() => {
    ears.current?.mark();
    recorder.current?.hush(crypto.place !== MAIN_PLACE);
  }, [crypto.place]);

  const controls = (feedback: CaptureFeedback): CaptureControls => {
    /*
     * Turning notes off keeps everything said while they were on and nothing after, like ending the call: capture stops
     * at once, what was recorded and heard until then is sent first, and nothing starts again while the server turns
     * them off. If it can't, the same recorder carries on, so its pieces stay in order in the same segment.
     */
    const switchNotes = async (v: boolean) => {
      const r = recorder.current;
      if (!v && on) {
        setTurningOff(true);
        await Promise.all([r?.pause(), ears.current?.flush()]);
      }
      try {
        await session.setNotes(v);
      } catch (e) {
        if (!v) r?.release();
        feedback.failed(e);
        return;
      } finally {
        setTurningOff(false);
      }
      if (!v) r?.discard();
      if (v) feedback.notesEnabled();
    };
    /*
     * Pausing stops everything at once: nothing more is recorded or heard, and nothing held is sent. Once the server has
     * paused, what was held is dropped, and the server refuses anything that arrives after it; if it couldn't, notes
     * are still on, so the same recorder and voices carry on and send it. Resuming is only ever the organizer's
     * choice. Anyone else asks.
     */
    return {
      notes: (v) => void switchNotes(v),
      pause: () => {
        const r = recorder.current;
        const e = ears.current;
        r?.hold();
        e?.hold();
        setPausing(true);
        session.pause().then(() => { r?.discard(); e?.stop(); }, (err: unknown) => {
          clog.warn('pausing notes failed; capture carries on', { err });
          r?.release();
          e?.release();
          feedback.failed(err);
        }).finally(() => setPausing(false));
      },
      resume: () => { session.resume().catch(feedback.failed); },
      screens: (v) => { session.setScreens(v).catch(feedback.failed); },
      // One breakout room: the voices there hold still while the pause is on its way, and what they held is dropped
      // once the server has paused the room. The recording and the call's notes carry on.
      room: (paused) => {
        const id = state.capture.room?.id;
        if (!id) return;
        const e = ears.current;
        if (paused) { e?.hold(); setPausing(true); }
        session.pauseRoom(id, paused).then(() => { if (paused) e?.quiet(); }, (err: unknown) => {
          if (paused) { clog.warn('pausing notes in the room failed; capture carries on', { err }); e?.release(); }
          feedback.failed(err);
        }).finally(() => { if (paused) setPausing(false); });
      },
      ask: (up) => {
        session.requestNotes(up).then(() => feedback.notesAsked(up), feedback.failed);
      }
    };
  };

  /** A displaced tab cannot submit more audio or speech to the call that continued elsewhere. */
  const discardDisplaced = useCallback(() => {
    if (recorder.current?.running) clog.info('notes recording stopped here: the call went on elsewhere');
    recorder.current?.discard();
    ears.current?.stop();
  }, []);

  const departure = (reason: 'move' | 'leave' | 'hand-off'): CaptureDeparture => {
    // Leaving as a participant only flushes speech; handoff always owns the recording. A move drains it to a stop.
    const r = reason === 'leave' && !hosting ? null : recorder.current;
    return {
      // Return Promise.all itself: the caller retains the original await boundary before changing the session.
      flush: () => reason === 'move'
        ? Promise.all([hosting ? recorder.current?.flush() : undefined, ears.current?.flush()])
        : Promise.all([r?.pause(), ears.current?.flush()]),
      finish: (afterAudio) => {
        if (reason === 'move') {
          recorder.current?.stop();
          ears.current?.stop();
          return;
        }
        r?.discard();
        afterAudio?.();
        if (reason === 'hand-off') ears.current?.stop();
      },
      rollback: () => { r?.release(); }
    };
  };

  return { uploadError, heardProblem, pausing, controls, departure, discardDisplaced };
}

/*
 * What a call captures, shown the same way wherever it appears: the notes sign, each kind of capture with its
 * state, and the summary someone sees before they join. The state comes from the call (CaptureState); only the
 * organizer changes it, and their browser says what it can't capture. Crimson only ever means notes are on and
 * capturing.
 */
import type { CaptureMode, CaptureState, NotesChoices, NotesSetting } from '@alcove/api';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { NotesSign, RecDot, Unencrypted } from './primitives';

/**
 * The notes sign, in the same place for everyone: on is the crimson sign with its pulsing dot, paused shows the
 * pause mark, unavailable (notes on, but the browser taking the notes can't capture anything) the caution mark, and off is
 * quiet, or says "Notes requested" while someone in the call has asked for them (`requested`; a pause says so
 * first). `pausing` is the organizer's own, while their pause is on its way: their browser has already stopped
 * capturing. `stage` is for the night call stage.
 */
export function CaptureSign({ mode, requested = false, pausing = false, stage = false, className }: {
  mode: CaptureMode; requested?: boolean; pausing?: boolean; stage?: boolean; className?: string | undefined;
}) {
  if (pausing) return <span className={cn('ac-capture-sign is-paused is-changing', stage && 'is-stage', className)} aria-busy="true"><Icon name="pause" size={13} />Pausing…</span>;
  if (mode === 'on') return <NotesSign stage={stage} className={className}>Notes on</NotesSign>;
  if (mode === 'off' && requested) return <NotesSign requested stage={stage} className={className}>Notes requested</NotesSign>;
  const [icon, text]: [IconName, string] = mode === 'paused' ? ['pause', 'Notes paused'] : mode === 'unavailable' ? ['alert', 'Notes unavailable'] : ['notesPen', 'Notes off'];
  return (
    <span className={cn('ac-capture-sign', mode !== 'off' && `is-${mode}`, stage && 'is-stage', className)}>
      <Icon name={icon} size={13} />{text}
    </span>
  );
}

const MODE: Record<CaptureMode, string> = { on: 'On', paused: 'Paused', off: 'Off', unavailable: 'Unavailable' };
/** On, paused, unavailable or off, as a small mark beside each kind of capture. */
export function CaptureModeMark({ mode, stage = false }: { mode: CaptureMode; stage?: boolean }) {
  return (
    <span className={cn('ac-capture-mode', `is-${mode}`, stage && 'is-stage')}>
      {mode === 'on' ? <RecDot /> : mode === 'paused' ? <Icon name="pause" size={11} /> : mode === 'unavailable' ? <Icon name="alert" size={11} /> : null}{MODE[mode]}
    </span>
  );
}

/**
 * Whose browser takes the notes, as said in a sentence: "the organizer" (the default), "the host" while someone stands
 * in for them, a first name, or "you".
 */
const whose = (taker: string) => (taker === 'you' ? 'your' : `${taker}’s`);
const hears = (taker: string) => (taker === 'you' ? 'you hear' : `${taker} hears`);

const PARTS: { key: 'recording' | 'transcript' | 'ai' | 'screen'; icon: IconName; label: string; detail: (taker: string) => string }[] = [
  { key: 'recording', icon: 'mic', label: 'Recording', detail: (t) => `Everyone ${hears(t)}, encrypted` },
  { key: 'transcript', icon: 'transcript', label: 'Transcript', detail: (t) => `Everyone ${hears(t)}, as text` },
  { key: 'ai', icon: 'sealed', label: 'AI notes', detail: () => 'Written from the transcript' },
  { key: 'screen', icon: 'screen', label: 'Shared screens', detail: () => 'Not read' }
];
/**
 * What a kind of capture does now: what the browser taking the notes can't capture says so, the notes model keeps reading
 * what was transcribed while notes are off, and shared screens say when they're read. In a breakout room nothing is
 * recorded or read from shared screens; what's said is heard by one browser there, its scribe, for the room's own
 * section of the notes.
 */
function detailOf(p: (typeof PARTS)[number], c: CaptureState, taker: string): string {
  if (c.room && p.key === 'recording') return 'Never in a breakout room';
  if (c.room && p.key === 'transcript' && c.transcript.mode !== 'unavailable') return 'By one browser here, for this room’s notes';
  if (c.room && p.key === 'transcript') return 'Nobody here can transcribe right now';
  if (c.room && p.key === 'ai') return 'Catching up here, and this room’s notes';
  if (c.room && p.key === 'screen') return 'Never read in a breakout room';
  if (p.key === 'ai' && c.ai.mode === 'on' && c.transcript.mode === 'off') return 'Reads what was transcribed earlier';
  if (p.key === 'recording' && c.recording.mode === 'unavailable') return 'Can’t record right now';
  if (p.key === 'transcript' && c.transcript.mode === 'unavailable') return 'Can’t listen right now';
  if (p.key === 'screen' && c.screen.mode !== 'off') return 'Read for the notes, never cameras';
  return p.detail(taker);
}
/** Each kind of capture, what it is, and whether it's on, paused, unavailable or off right now. */
export function CaptureParts({ capture, taker = 'the organizer', stage = false, className }: {
  capture: CaptureState;
  /** Whose browser takes the notes, as said in a sentence: "the organizer" (the default), "the host", a first name, or "you". */
  taker?: string | undefined;
  stage?: boolean; className?: string | undefined;
}) {
  return (
    <ul className={cn('ac-capture-parts', stage && 'is-stage', className)} aria-label="What’s captured">
      {PARTS.map((p) => (
        <li key={p.key}>
          <Icon name={p.icon} size={16} />
          <span className="what"><b>{p.label}</b><small>{detailOf(p, capture, taker)}</small></span>
          <CaptureModeMark mode={capture[p.key].mode} stage={stage} />
        </li>
      ))}
    </ul>
  );
}

/** What a call won't keep, in a line each: said wherever someone decides whether to join it. */
export function keptLines(c: NotesChoices): string[] {
  return [...(c.keepTranscript ? [] : ['The transcript is deleted after the notes are written.']), ...(c.keepRecording ? [] : ['The recording is deleted when the call ends.'])];
}

/**
 * What a call captures, for someone about to join it, on the night stage, each fact once: the sign, one sentence on what
 * happens to what they say (it follows every state), what won't be kept, and who gets the notes. Before the organizer
 * starts the call it says what will happen. Never anyone's name or anything that was said.
 */
export function CaptureSummary({ notes, choices, capture, who, taker = 'the organizer', className }: {
  /** Notes as the call was scheduled. */
  notes: NotesSetting;
  /** What the notes keep. */
  choices: NotesChoices;
  /** What's captured now; null until the call has started. */
  capture: CaptureState | null;
  /** Who gets the notes, said for the person looking (the organizer, someone invited, someone asking); by default, the people invited. */
  who?: ReactNode;
  /** Whose browser takes the notes once the call has started: "the organizer" (the default), or "the host" while someone stands in for them. */
  taker?: string | undefined;
  className?: string | undefined;
}) {
  const mode: CaptureMode = capture ? capture.mode : notes === 'on' ? 'on' : 'off';
  const shared = capture?.screen.mode === 'on';
  const said: ReactNode = !capture
    ? notes === 'on' ? 'When the call starts, what everyone says, you included, is recorded and transcribed for the notes.' : 'Nothing is recorded. The organizer can turn notes on during the call.'
    : mode === 'on' ? `${onLine(capture)}${shared ? ' What anyone shares on screen is read for them too.' : ''}`
      : mode === 'unavailable' && capture.away ? `Notes are on, but ${whose(taker)} browser isn’t in the call right now, so nothing ${shared ? 'said ' : ''}is captured until it’s back.${shared ? ' What anyone shares on screen is still read for the notes.' : ''}`
      : mode === 'unavailable' ? shared ? `Notes are on, but ${whose(taker)} browser can’t record or listen right now, so nothing said is captured. What anyone shares on screen is still read for the notes.`
        : `Notes are on, but ${whose(taker)} browser can’t record or listen right now, so nothing is captured.`
        : mode === 'paused' ? 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.'
          : 'Nothing is recorded. The organizer can turn notes on during the call, and you can ask them to.';
  return (
    <div className={cn('ac-capture-sum', className)}>
      <CaptureSign mode={mode} stage />
      <p>{said}</p>
      {mode !== 'off' && keptLines(choices).length > 0 && <p>{keptLines(choices).join(' ')}</p>}
      {mode !== 'off' && (capture && !capture.modelPrivate
        ? <p className="fine"><Icon name="shieldOff" size={15} />Written by an AI model outside a secure enclave, so Alcove can’t guarantee the notes stay private. <Unencrypted compact /> {who ?? 'The people invited get them.'}</p>
        : <p className="fine"><Icon name="sealed" size={15} />Written by an AI model in confidential compute. {who ?? 'The people invited get them.'}</p>)}
    </div>
  );
}

/** What notes on means for someone about to join, leaving out whatever the browser taking the notes can't capture now. */
function onLine(c: CaptureState): string {
  if (c.recording.mode === 'on' && c.transcript.mode === 'on') return 'What everyone says, you included, is recorded and transcribed for the notes.';
  if (c.transcript.mode === 'on') return 'What everyone says, you included, is transcribed for the notes. It isn’t recorded right now.';
  return 'What everyone says, you included, is recorded for the notes. Nothing is transcribed right now.';
}

/** Where nothing was captured, between the lines of a transcript or the chapters of a note: "Paused 10:02–10:05". */
export function CaptureGapMark({ label, detail = 'Nothing was recorded', className }: { label: string; detail?: string; className?: string | undefined }) {
  return (
    <div className={cn('ac-capture-gap', className)} role="note">
      <Icon name="pause" size={13} /><b>{label}</b><span>{detail}</span>
    </div>
  );
}

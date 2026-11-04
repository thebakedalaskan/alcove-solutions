/*
 * What a call captures, shown the same way wherever it appears: the notes sign, each kind of capture with its
 * state, and the summary someone sees before they join. The state comes from the call (CaptureState); only the
 * organizer changes it, and their browser says what it can't capture. Crimson only ever means notes are on and
 * capturing.
 */
import type { CaptureMode, CaptureState, NotesSetting } from '@alcove/api';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { NotesSign, RecDot } from './primitives';

/**
 * The notes sign, in the same place for everyone: on is the crimson sign with its pulsing dot, paused shows the
 * pause mark, unavailable (notes on, but the organizer's browser can't capture anything) the caution mark, and off is
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

const PARTS: { key: 'recording' | 'transcript' | 'ai' | 'screen'; icon: IconName; label: string; short: string; detail: string }[] = [
  { key: 'recording', icon: 'mic', label: 'Recording', short: 'Recording', detail: 'The organizer’s microphone, encrypted' },
  { key: 'transcript', icon: 'transcript', label: 'Transcript', short: 'Transcript', detail: 'Everyone the organizer hears, as text' },
  { key: 'ai', icon: 'sealed', label: 'AI notes', short: 'AI notes', detail: 'Written from the transcript' },
  { key: 'screen', icon: 'screen', label: 'Shared screens', short: 'Screens', detail: 'Not read' }
];
/**
 * What a kind of capture does now: what the organizer's browser can't capture says so, and the notes model keeps
 * reading what was transcribed while notes are off. In a breakout room nothing is recorded, what's said is heard only
 * while the organizer is there, and nothing goes into the notes.
 */
function detailOf(p: (typeof PARTS)[number], c: CaptureState): string {
  if (c.room && p.key === 'recording') return 'Never in a breakout room';
  if (c.room && p.key === 'transcript' && c.transcript.mode !== 'unavailable') return 'Only while the organizer is here';
  if (c.room && p.key === 'ai') return 'Catching up here, never the notes';
  if (p.key === 'ai' && c.ai.mode === 'on' && c.transcript.mode === 'off') return 'Reads what was transcribed earlier';
  if (p.key === 'recording' && c.recording.mode === 'unavailable') return 'Can’t record right now';
  if (p.key === 'transcript' && c.transcript.mode === 'unavailable') return 'Can’t listen right now';
  return p.detail;
}
/**
 * Each kind of capture, what it is, and whether it's on, paused, unavailable or off right now. `compact` says it in a
 * row of small marks, for where there's little room (before joining, on a phone).
 */
export function CaptureParts({ capture, stage = false, compact = false, className }: { capture: CaptureState; stage?: boolean; compact?: boolean; className?: string | undefined }) {
  if (compact) {
    return (
      <ul className={cn('ac-capture-chips', stage && 'is-stage', className)} aria-label="What’s captured">
        {PARTS.map((p) => {
          const mode = capture[p.key].mode;
          return (
            <li key={p.key} className={cn('ac-capture-chip', `is-${mode}`)}>
              {mode === 'on' ? <RecDot /> : <Icon name={mode === 'paused' ? 'pause' : mode === 'unavailable' ? 'alert' : p.icon} size={12} />}{p.short} {MODE[mode].toLowerCase()}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className={cn('ac-capture-parts', stage && 'is-stage', className)} aria-label="What’s captured">
      {PARTS.map((p) => (
        <li key={p.key}>
          <Icon name={p.icon} size={16} />
          <span className="what"><b>{p.label}</b><small>{detailOf(p, capture)}</small></span>
          <CaptureModeMark mode={capture[p.key].mode} stage={stage} />
        </li>
      ))}
    </ul>
  );
}

/**
 * What a call captures, for someone about to join it, on the night stage: the sign, what happens to what they say,
 * each kind of capture once the call has started, and who gets the notes. Before the organizer starts the call it
 * says what will happen. Never anyone's name or anything that was said.
 */
export function CaptureSummary({ notes, capture, who, className }: {
  /** Notes as the call was scheduled. */
  notes: NotesSetting;
  /** What's captured now; null until the call has started. */
  capture: CaptureState | null;
  /** Who gets the notes, said for the person looking (the organizer, someone invited, someone asking); by default, the people invited. */
  who?: ReactNode;
  className?: string | undefined;
}) {
  const mode: CaptureMode = capture ? capture.mode : notes === 'on' ? 'on' : 'off';
  const said: ReactNode = !capture
    ? notes === 'on' ? 'When the call starts, what everyone says, you included, is transcribed for the notes, and the organizer’s microphone is recorded.' : 'Nothing is recorded. The organizer can turn notes on during the call.'
    : mode === 'on' ? onLine(capture)
      : mode === 'unavailable' ? 'Notes are on, but the organizer’s browser can’t record or listen right now, so nothing is captured.'
        : mode === 'paused' ? 'The organizer paused notes. Nothing is recorded, transcribed or sent to the AI until they resume.'
          : 'Nothing is recorded. The organizer can turn notes on during the call, and you can ask them to.';
  return (
    <div className={cn('ac-capture-sum', className)}>
      <CaptureSign mode={mode} stage />
      <p>{said}</p>
      {capture && mode !== 'off' && <CaptureParts capture={capture} stage compact />}
      {mode !== 'off' && <p className="fine"><Icon name="sealed" size={15} />Written in confidential compute, so Alcove can’t read the notes. {who ?? 'The people invited get them.'}</p>}
    </div>
  );
}

/** What notes on means for someone about to join, leaving out whatever the organizer's browser can't capture now. */
function onLine(c: CaptureState): string {
  if (c.recording.mode === 'on' && c.transcript.mode === 'on') return 'What everyone says, you included, is transcribed for the notes, and the organizer’s microphone is recorded.';
  if (c.transcript.mode === 'on') return 'What everyone says, you included, is transcribed for the notes. The organizer’s microphone isn’t recorded right now.';
  return 'The organizer’s microphone is recorded for the notes. Nothing is transcribed right now.';
}

/** Where nothing was captured, between the lines of a transcript or the chapters of a note: "Paused 10:02–10:05". */
export function CaptureGapMark({ label, detail = 'Nothing was recorded', className }: { label: string; detail?: string; className?: string | undefined }) {
  return (
    <div className={cn('ac-capture-gap', className)} role="note">
      <Icon name="pause" size={13} /><b>{label}</b><span>{detail}</span>
    </div>
  );
}

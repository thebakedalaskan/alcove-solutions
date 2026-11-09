import type { CallTimerSegment } from '@alcove/api';
import { Button, IconButton, Select, cn } from '@alcove/ui';

export const timerDuration = (seconds: number): string => {
  const rounded = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
};
export const timerTotal = (segments: readonly CallTimerSegment[]): number => segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
export const newTimerSegment = (number: number): CallTimerSegment => ({ id: crypto.randomUUID(), label: `Segment ${number}`, durationSeconds: 300, presenter: null });
export const validTimerPlan = (segments: readonly CallTimerSegment[]): boolean => segments.length > 0 && segments.length <= 50 && segments.every((s) => s.label.trim().length > 0 && s.label.trim().length <= 120 && Number.isInteger(s.durationSeconds) && s.durationSeconds >= 1 && s.durationSeconds <= 86400);

/** Controlled edits keep the host's unsaved plan separate from the live snapshot. */
export function TimerPlan({ segments, onChange, lockedThrough = -1, activeIndex = -1, busy = false, focusFirst = false }: {
  segments: CallTimerSegment[]; onChange?: ((segments: CallTimerSegment[]) => void) | undefined; lockedThrough?: number; activeIndex?: number; busy?: boolean; focusFirst?: boolean;
}) {
  const change = (id: string, patch: Partial<CallTimerSegment>) => onChange?.(segments.map((segment) => segment.id === id ? { ...segment, ...patch } : segment));
  const move = (index: number, by: number) => {
    const next = [...segments];
    const item = next[index];
    if (!item || index + by <= lockedThrough || index + by < 0 || index + by >= next.length) return;
    next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange?.(next);
  };
  return <div className="ac-timer-plan" aria-label="Timer segments">{segments.map((segment, index) => {
    const editable = onChange !== undefined && index > lockedThrough;
    return <section className={cn('ac-timer-segment', index === activeIndex && 'is-current')} key={segment.id} aria-label={`Segment ${index + 1}`}>
      {editable ? <div className="ac-timer-fields">
        <label className="ac-timer-field is-wide">Segment {index + 1} name<input aria-label={`Segment ${index + 1} name`} autoFocus={focusFirst && index === lockedThrough + 1} value={segment.label} maxLength={120} disabled={busy} onChange={(e) => change(segment.id, { label: e.target.value })} /></label>
        <label className="ac-timer-field">Duration in seconds<input aria-label={`Segment ${index + 1} seconds`} type="number" min={1} max={86400} step={1} value={segment.durationSeconds} disabled={busy} onChange={(e) => change(segment.id, { durationSeconds: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0 })} /></label>
        <div className="ac-timer-field"><span>Quick duration</span><Select label={`Segment ${index + 1} quick duration`} value={String(segment.durationSeconds)} disabled={busy} options={[60, 120, 300, 600, 900, 1800].map((seconds) => ({ value: String(seconds), label: `${seconds / 60} min` }))} placeholder="Custom" onChange={(value) => change(segment.id, { durationSeconds: Number(value) })} /></div>
        <label className="ac-timer-field is-wide">Presenter (optional)<input aria-label={`Segment ${index + 1} presenter`} value={segment.presenter ?? ''} maxLength={120} placeholder="Name of the presenter" disabled={busy} onChange={(e) => change(segment.id, { presenter: e.target.value.trim() ? e.target.value : null })} /></label>
      </div> : <div className="summary"><span className="number">{index + 1}</span><div className="description"><b className="ac-clamp-2">{segment.label}</b><small className="ac-clamp-2">{segment.presenter ? `${segment.presenter} · ` : ''}{timerDuration(segment.durationSeconds)}{index === activeIndex ? ' · Current' : index <= lockedThrough ? ' · Already timed' : ''}</small></div></div>}
      {onChange && <div className="tools">
        <IconButton icon="up" label={`Move segment ${index + 1} up`} disabled={busy || !editable || index - 1 <= lockedThrough} onClick={() => move(index, -1)} />
        <IconButton icon="down" label={`Move segment ${index + 1} down`} disabled={busy || !editable || index === segments.length - 1} onClick={() => move(index, 1)} />
        <IconButton icon="copy" label={`Duplicate segment ${index + 1}`} disabled={busy || segments.length >= 50} onClick={() => { const next = [...segments]; next.splice(Math.max(index + 1, lockedThrough + 1), 0, { ...segment, id: crypto.randomUUID() }); onChange(next); }} />
        <IconButton icon="trash" label={`Remove segment ${index + 1}`} disabled={busy || !editable} onClick={() => onChange(segments.filter((s) => s.id !== segment.id))} />
      </div>}
    </section>;
  })}{onChange && <Button size="sm" icon="plus" disabled={busy || segments.length >= 50} onClick={() => onChange([...segments, newTimerSegment(segments.length + 1)])}>Add segment</Button>}</div>;
}

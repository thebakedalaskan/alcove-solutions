import { errorCode, errorMessage, type CallTimerPreset, type CallTimerSegment } from '@alcove/api';
import { Button, EmptyState, IconButton, Modal, Notice, useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { q, useTimerPresets } from '~/lib/queries';
import { log } from '~/lib/log';
import { newTimerSegment, TimerPlan, timerDuration, timerTotal, validTimerPlan } from './TimerPlan';

const tlog = log.child({ component: 'timer-presets' });
interface PresetDraft { id: string | null; revision: number | null; name: string; segments: CallTimerSegment[] }

/** A preset is copied into a call, so editing either never changes the other. */
export function TimerPresets({ onUse, initialSegments }: { onUse?: ((preset: CallTimerPreset) => void) | undefined; initialSegments?: CallTimerSegment[] | undefined }) {
  const presets = useQuery(q.timerPresets());
  const changes = useTimerPresets();
  const toast = useToast();
  const [draft, setDraft] = useState<PresetDraft | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const pending = useRef(false);
  const focused = useRef<HTMLElement | null>(null);
  const editing = useRef(false);
  const begin = (value: PresetDraft) => { setStale(false); focused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDraft(value); };
  useEffect(() => {
    if (editing.current && !draft && focused.current?.isConnected) focused.current.focus();
    editing.current = draft !== null;
  }, [draft]);
  const run = async (action: () => Promise<unknown>, after: () => void) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await action(); after(); }
    catch (err) { if (errorCode(err) === 'conflict' || errorCode(err) === 'not-found') { setStale(true); setReplacing(null); setRemoving(null); } tlog.warn('timer preset action failed', { err }); toast(errorMessage(err), { icon: 'x' }); }
    finally { pending.current = false; setBusy(false); }
  };
  if (draft) return <form className="ac-timer-section" onSubmit={(event) => {
    event.preventDefault();
    if (!validTimerPlan(draft.segments) || !draft.name.trim()) return;
    const input = { name: draft.name.trim(), segments: draft.segments.map((segment) => ({ ...segment, label: segment.label.trim(), presenter: segment.presenter?.trim() || null })) };
    const { id, revision } = draft;
    void run(() => id !== null && revision !== null ? changes.update.mutateAsync({ id, input: { ...input, expectedRevision: revision } }) : changes.create.mutateAsync(input), () => { setDraft(null); toast('Timer preset saved', { icon: 'check' }); });
  }}>
    <div className="ac-timer-section-head"><h3>{draft.id ? 'Edit timer preset' : 'New timer preset'}</h3><Button size="xs" variant="quiet" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div>
    {stale && <Notice icon="alert">This preset changed elsewhere. Your draft is kept here. Cancel and reopen it to edit the latest saved version.</Notice>}
    <label className="ac-timer-field">Preset name<input aria-label="Preset name" autoFocus value={draft.name} maxLength={120} required disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <p className="ac-timer-note">{timerDuration(timerTotal(draft.segments))} total planned · Changes stay in this preset.</p>
    <TimerPlan segments={draft.segments} busy={busy} onChange={(segments) => setDraft({ ...draft, segments })} />
    <Button variant="primary" type="submit" size="sm" loading={busy} disabled={stale || !validTimerPlan(draft.segments) || !draft.name.trim()}>Save preset</Button>
  </form>;
  return <div className="ac-timer-library">
    <p className="ac-timer-note">Prepare an agenda before the call. Load a copy during a call; the saved preset stays yours.</p>
    {presets.isPending ? <p className="ac-timer-note" role="status">Reading your presets…</p> : presets.isError ? <Notice icon="alert">Couldn’t read your timer presets. <Button size="xs" variant="quiet" onClick={() => void presets.refetch()}>Try again</Button></Notice> : !presets.data.length ? <EmptyState art={null} title="No timer presets yet">Give your next agenda a name and keep its timing here.</EmptyState> : presets.data.map((preset) => <section className="ac-timer-preset" key={preset.id}>
      <div className="ac-timer-preset-head"><b className="ac-clamp-2">{preset.name}</b><span className="ac-time ac-timer-note">{timerDuration(timerTotal(preset.segments))}</span></div>
      <p>{preset.segments.length} {preset.segments.length === 1 ? 'segment' : 'segments'} · {preset.segments.map((segment) => segment.label).join(' → ')}</p>
      {replacing === preset.id && initialSegments ? <><p>Replace this saved preset with this call’s current plan?</p><div className="ac-timer-actions"><Button size="xs" disabled={busy} onClick={() => setReplacing(null)}>Keep preset</Button><Button size="xs" loading={busy} onClick={() => void run(() => changes.update.mutateAsync({ id: preset.id, input: { name: preset.name, segments: initialSegments, expectedRevision: preset.revision } }), () => { setReplacing(null); toast('Saved preset updated from this call', { icon: 'check' }); })}>Replace saved plan</Button></div></> : removing === preset.id ? <><p>Delete this preset? Copies in calls are kept.</p><div className="ac-timer-actions"><Button size="xs" disabled={busy} onClick={() => setRemoving(null)}>Keep preset</Button><Button size="xs" loading={busy} onClick={() => void run(() => changes.remove.mutateAsync(preset.id), () => setRemoving(null))}>Delete preset</Button></div></> : <div className="ac-timer-actions">
        {onUse && <Button size="xs" disabled={busy} onClick={() => onUse(preset)}>Use copy</Button>}
        {initialSegments && validTimerPlan(initialSegments) && <Button size="xs" variant="quiet" disabled={busy} onClick={() => setReplacing(preset.id)}>Replace with this plan</Button>}
        <Button size="xs" variant="quiet" disabled={busy} onClick={() => begin({ id: preset.id, revision: preset.revision, name: preset.name, segments: structuredClone(preset.segments) })}>Edit / rename</Button>
        <Button size="xs" variant="quiet" disabled={busy} onClick={() => begin({ id: null, revision: null, name: `${preset.name} copy`.slice(0, 120), segments: preset.segments.map((segment) => ({ ...segment, id: crypto.randomUUID() })) })}>Duplicate</Button>
        <IconButton icon="trash" label={`Delete preset ${preset.name}`} disabled={busy} onClick={() => setRemoving(preset.id)} />
      </div>}
    </section>)}
    <Button size="sm" icon="plus" onClick={() => begin({ id: null, revision: null, name: '', segments: initialSegments?.length ? structuredClone(initialSegments) : [newTimerSegment(1)] })}>{initialSegments?.length ? 'Save this plan as a preset' : 'New preset'}</Button>
  </div>;
}

/** The organizer can prepare reusable timing before joining, without starting the countdown. */
export function TimerPresetPreparation() {
  const [open, setOpen] = useState(false);
  return <><Button size="sm" icon="timer" onClick={() => setOpen(true)}>Prepare timer presets</Button><Modal open={open} onOpenChange={setOpen} label="Timer presets" className="ac-timer-library-sheet"><div className="ac-timer-library-head"><h2>Timer presets</h2><IconButton icon="x" label="Close timer presets" onClick={() => setOpen(false)} /></div><div className="ac-timer-library-body"><TimerPresets /></div></Modal></>;
}

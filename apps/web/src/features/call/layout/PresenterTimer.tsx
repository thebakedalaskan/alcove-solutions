import { errorMessage, type CallSession, type CallState, type CallTimerControl, type CallTimerSegment } from '@alcove/api';
import { Button, CallTimerReadout, EmptyState, Notice, Switch, Tabs, useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';
import { newTimerSegment, TimerPlan, timerDuration, timerTotal, validTimerPlan } from './TimerPlan';
import { TimerPresets } from './TimerPresets';
import type { PresenterTimer } from './usePresenterTimer';

const tlog = log.child({ component: 'presenter-timer' });
interface PlanDraft { expectedRevision: number | null; segments: CallTimerSegment[] }

export function PresenterTimerPanel({ session, state, timer, ready }: { session: CallSession; state: CallState; timer: PresenterTimer; ready: boolean }) {
  const [tab, setTab] = useState<'call' | 'presets'>('call');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const toast = useToast();
  const panel = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const edited = useRef(false);
  const saved = useRef(false);
  useEffect(() => {
    if (edited.current && !draft) {
      if (saved.current) {
        saved.current = false;
        panel.current?.scrollTo({ top: 0 });
        panel.current?.querySelector<HTMLButtonElement>('.ac-call-timer-readout button')?.focus({ preventScroll: true });
      } else editButton.current?.focus();
    }
    edited.current = draft !== null;
  }, [draft]);
  const { sequence, segment, next } = timer;
  const host = state.isHost;
  const disabled = busy || !ready;
  const run = async (action: () => Promise<void>, after?: () => void) => {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    try { await action(); after?.(); }
    catch (err) { tlog.warn('presenter timer action failed', { err, callId: state.callId }); toast(errorMessage(err), { icon: 'x' }); }
    finally { pending.current = false; setBusy(false); }
  };
  const control = (action: CallTimerControl['action'], seconds?: number) => {
    if (!sequence) return;
    const input: CallTimerControl = action === 'add-time' ? { expectedRevision: sequence.revision, action, seconds: seconds ?? 60 } : { expectedRevision: sequence.revision, action };
    void run(() => session.controlTimer(input));
  };
  const edit = () => setDraft({ expectedRevision: sequence?.revision ?? null, segments: sequence ? structuredClone(sequence.segments) : [newTimerSegment(1)] });
  const lockedThrough = sequence && sequence.status !== 'ready' && sequence.status !== 'finished' ? sequence.activeIndex : -1;
  return <div className="ac-timer-panel" ref={panel}>
    {host && <Tabs label="Presenter timer" value={tab} onChange={setTab} options={[{ value: 'call', label: 'This call' }, { value: 'presets', label: 'Your presets' }]} />}
    {!ready && <Notice icon="wifi">Reconnecting. The countdown continues; controls return when you’re connected.</Notice>}
    {tab === 'presets' && host ? <TimerPresets initialSegments={sequence?.segments} onUse={sequence && sequence.status !== 'ready' && sequence.status !== 'finished' ? undefined : (preset) => { setDraft({ expectedRevision: sequence?.revision ?? null, segments: preset.segments.map((s) => ({ ...s, id: crypto.randomUUID() })) }); setTab('call'); }} /> : <>
      {sequence && segment ? <CallTimerReadout time={timer.time} label={segment.label} status={timer.status} tone={timer.tone} presenter={segment.presenter} next={sequence.status === 'finished' ? null : next?.label ?? null} planned={timerDuration(timerTotal(sequence.segments))} position={sequence.status === 'finished' ? `${sequence.segments.length} segments complete` : `Segment ${sequence.activeIndex + 1} of ${sequence.segments.length}`}>
        {host && <>
          <div className="ac-timer-actions">
            {sequence.status !== 'finished' && <Button variant={draft ? 'secondary' : 'primary'} size="sm" icon={sequence.status === 'running' ? 'pause' : 'play'} disabled={disabled || (sequence.status === 'ready' && draft !== null)} onClick={() => control(sequence.status === 'ready' ? 'start' : sequence.status === 'running' ? 'pause' : 'resume')}>{sequence.status === 'ready' ? 'Start timer' : sequence.status === 'running' ? 'Pause' : 'Resume'}</Button>}
            {sequence.status !== 'ready' && sequence.status !== 'finished' && <Button size="sm" icon="plus" disabled={disabled} onClick={() => control('add-time', 60)}>Add 1 min</Button>}
          </div>
          {sequence.status !== 'ready' && sequence.status !== 'finished' && <div className="ac-timer-actions"><Button variant="quiet" size="xs" icon="reset" disabled={disabled} onClick={() => control('restart')}>Restart segment</Button><Button variant="quiet" size="xs" icon="live" disabled={disabled} onClick={() => control('skip')}>Skip</Button><Button size="xs" iconRight="right" disabled={disabled} onClick={() => control('advance')}>{next ? 'Next segment' : 'Finish sequence'}</Button></div>}
        </>}
      </CallTimerReadout> : <EmptyState art={null} title="Give each turn its time">{host ? 'Build a sequence, or load a copy of one of your presets.' : 'When the host starts a timer, everyone here sees the same countdown.'}</EmptyState>}
      {timer.mine && (timer.warning || timer.overtime) && <Notice icon="alert"><strong>{timer.overtime ? 'Your time is up.' : 'Your turn is nearly over.'}</strong> {timer.overtime ? 'The timer keeps counting over time until the host moves on.' : 'You have 30 seconds or less left.'}</Notice>}
      <span className="sr-only" role="status" aria-live="polite">{timer.mine && timer.overtime ? 'Your time is up.' : timer.mine && timer.warning ? 'Your turn has 30 seconds or less left.' : timer.status}</span>
      {sequence && <p className="ac-timer-note">The host moves to each segment. At zero, the timer stays on this turn and counts over time.</p>}
      {host && draft ? <form className="ac-timer-section" onSubmit={(event) => {
        event.preventDefault();
        if (!validTimerPlan(draft.segments)) return;
        void run(() => session.setTimerSequence({ expectedRevision: draft.expectedRevision, segments: draft.segments.map((s) => ({ ...s, label: s.label.trim(), presenter: s.presenter?.trim() || null })) }), () => { saved.current = true; setDraft(null); toast('Timer plan saved for this call', { icon: 'check' }); });
      }}>
        <div className="ac-timer-section-head"><h3>{sequence ? 'Edit upcoming timing' : 'Plan this call'}</h3><Button size="xs" variant="quiet" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div>
        {lockedThrough >= 0 && <p className="ac-timer-note">The current turn and past segments stay as timed. Upcoming segments can change.</p>}
        {draft.expectedRevision !== (sequence?.revision ?? null) && <Notice icon="alert">The timer changed while you edited. Cancel and reopen the editor to use its latest timing.</Notice>}
        <TimerPlan segments={draft.segments} lockedThrough={lockedThrough} activeIndex={sequence?.activeIndex ?? -1} busy={disabled} focusFirst onChange={(segments) => setDraft({ ...draft, segments })} />
        <Button variant="primary" size="sm" type="submit" disabled={disabled || !validTimerPlan(draft.segments) || draft.expectedRevision !== (sequence?.revision ?? null)} loading={busy}>Save timer plan</Button>
      </form> : <section className="ac-timer-section"><div className="ac-timer-section-head"><h3>Sequence{sequence ? ` · ${timerDuration(timerTotal(sequence.segments))}` : ''}</h3>{host && <Button ref={editButton} size="xs" variant="quiet" icon={sequence ? 'pen' : 'plus'} disabled={disabled} onClick={edit}>{sequence?.status === 'finished' ? 'Plan another sequence' : sequence ? 'Edit plan' : 'Build sequence'}</Button>}</div>{sequence && <TimerPlan segments={sequence.segments} activeIndex={sequence.status === 'finished' ? -1 : sequence.activeIndex} lockedThrough={lockedThrough} />}</section>}
    </>}
    <div className="ac-timer-cue"><span>Sound when time is up<small>Only for you. Respects your call sound and quiet settings.</small></span><Switch label="Sound when time is up" checked={timer.cue} onChange={timer.changeCue} /></div>
  </div>;
}

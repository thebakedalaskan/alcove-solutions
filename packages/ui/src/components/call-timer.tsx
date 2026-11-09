import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Icon } from './icon';

export type CallTimerTone = 'ready' | 'running' | 'paused' | 'warning' | 'overtime' | 'finished';

/** The shared countdown stays a button: its details can always be reopened. */
export function CallTimerButton({ time, label, status, tone, on, compact = false, onClick, className }: {
  time: string; label: string; status: string; tone: CallTimerTone; on: boolean; compact?: boolean; onClick: () => void; className?: string;
}) {
  return <button type="button" className={cn('ac-call-timer-button', `is-${tone}`, on && 'is-on', compact && 'is-compact', className)} aria-label={`Timer: ${label}, ${time}, ${status}. Open timer`} aria-pressed={on} onClick={onClick}>
    <Icon name={tone === 'overtime' || tone === 'warning' ? 'alert' : tone === 'paused' ? 'pause' : 'timer'} size={16} /><b className="ac-time">{time}</b>{!compact && <span className="ac-clamp-1">{label}</span>}{(tone === 'overtime' || tone === 'paused') && <small>{tone === 'overtime' ? 'Over time' : 'Paused'}</small>}
  </button>;
}

/** Current, next and planned time have the same hierarchy on every call layout. */
export function CallTimerReadout({ time, label, status, tone, presenter, next, planned, position, children }: {
  time: string; label: string; status: string; tone: CallTimerTone; presenter: string | null; next: string | null; planned: string; position: string; children?: ReactNode;
}) {
  return <section className={cn('ac-call-timer-readout', `is-${tone}`)} aria-label="Current timer">
    <div className="ac-call-timer-meta"><span>{position}</span><span><Icon name={tone === 'overtime' || tone === 'warning' ? 'alert' : tone === 'paused' ? 'pause' : tone === 'finished' ? 'check' : 'timer'} size={14} />{status}</span></div>
    <h3 className="ac-clamp-2">{label}</h3><div className="ac-call-timer-clock" aria-label={`${time}, ${status}`}>{time}</div>
    {presenter && <p className="ac-call-timer-presenter"><Icon name="presenter" size={15} /><span className="ac-clamp-2">{presenter}</span></p>}
    {children}<div className="ac-call-timer-next"><span>Next</span><b className="ac-clamp-2">{next ?? 'Last segment'}</b></div><div className="ac-call-timer-total"><span>Total planned</span><b className="ac-time">{planned}</b></div>
  </section>;
}

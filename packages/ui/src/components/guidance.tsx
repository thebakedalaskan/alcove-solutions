/* The tour: one card, one idea per slide, and coachmarks on the real interface. */
import { Dialog as RDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from './primitives';

/**
 * One slide of the in-app tour: dawn-sky art, a display-s title, one sentence and the step dots.
 * Skippable on every slide. The next button says where it goes ("Show me notes").
 */
export function TourDialog({ open, onOpenChange, art, title, children, step, steps, next, onSkip }: {
  open: boolean; onOpenChange: (open: boolean) => void; art?: ReactNode; title: string; children: ReactNode;
  step: number; steps: number; next: { label: string; onClick: () => void }; onSkip: () => void;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ac-scrim" />
        <RDialog.Content className="ac-dialog">
          <div className="art" aria-hidden="true">{art}</div>
          <div className="body">
            <RDialog.Title className="ac-display-s">{title}</RDialog.Title>
            <RDialog.Description>{children}</RDialog.Description>
          </div>
          <div className="foot">
            <span className="ac-steps" aria-label={`Step ${step + 1} of ${steps}`}>{Array.from({ length: steps }, (_, i) => <i key={i} className={cn(i === step && 'is-on')} />)}</span>
            {step < steps - 1 && <Button variant="quiet" size="sm" onClick={onSkip}>Skip</Button>}
            <Button variant="primary" size="sm" iconRight={step < steps - 1 ? 'right' : undefined} onClick={next.onClick}>{next.label}</Button>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Points at one part of the interface; give the target the `ac-spot` class. Two lines at most. */
export function Coachmark({ title, children, className }: { title: string; children: ReactNode; className?: string | undefined }) {
  return <div className={cn('ac-coach', className)} role="note"><b>{title}</b>{children}</div>;
}

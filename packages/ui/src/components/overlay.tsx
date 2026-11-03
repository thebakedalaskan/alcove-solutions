import { Dialog as RDialog, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';

/** A panel anchored to what opened it. `stage` is for the always-night call stage. */
export function Popover({ open, onOpenChange, anchor, children, align = 'start', side = 'bottom', stage = false, label, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; children: ReactNode;
  align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; stage?: boolean; label: string; className?: string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{anchor}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content side={side} align={align} sideOffset={8} collisionPadding={12} aria-label={label} className={cn('ac-pop', stage && 'is-stage', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
export const PopoverClose = RPopover.Close;

/** A single sheet that drops from the top: one input, never a stack of forms. */
export function Sheet({ open, onOpenChange, label, children, className }: { open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode; className?: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ac-scrim" />
        <RDialog.Content aria-describedby={undefined} className={cn('ac-sheet', className)}>
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>;
}
export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal><RTooltip.Content side={side} sideOffset={8} className="ac-tip">{label}</RTooltip.Content></RTooltip.Portal>
    </RTooltip.Root>
  );
}

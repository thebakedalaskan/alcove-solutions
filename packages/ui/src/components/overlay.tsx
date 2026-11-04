import { Dialog as RDialog, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * A panel anchored to what opened it. `stage` is for the always-night call stage. `takeFocus={false}` for one that
 * opens as you hover or focus its anchor, so focus stays there and Tab carries on past it.
 */
export function Popover({ open, onOpenChange, anchor, children, align = 'start', side = 'bottom', stage = false, takeFocus = true, label, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; anchor: ReactNode; children: ReactNode;
  align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; stage?: boolean; takeFocus?: boolean; label: string; className?: string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{anchor}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content side={side} align={align} sideOffset={8} collisionPadding={12} aria-label={label} className={cn('ac-pop', stage && 'is-stage', className)}
          onOpenAutoFocus={takeFocus ? undefined : (e) => e.preventDefault()}>
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

/**
 * A modal over the page: centred for a choice that needs room (what to share), or rising from the
 * bottom for a quick decision (leaving a call). The rest of the page waits behind a veil.
 */
export function Modal({ open, onOpenChange, label, children, placement = 'center', className }: {
  open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode; placement?: 'center' | 'bottom'; className?: string | undefined;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ac-scrim" />
        <RDialog.Content aria-describedby={undefined} className={cn('ac-modal', placement === 'bottom' && 'is-bottom', className)}>
          <RDialog.Title className="sr-only">{label}</RDialog.Title>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

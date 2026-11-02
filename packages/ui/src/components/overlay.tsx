import { Dialog as RDialog, DropdownMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Icon, type IconName } from './icon';
import { IconButton } from './primitives';

/* ---------- Dialog ---------- */
export function Dialog({ open, onOpenChange, title, description, children, width = 520, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-[color-mix(in_oklab,#0B0A08_42%,transparent)] backdrop-blur-[3px]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </RDialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-5">
              <RDialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
                <motion.div style={{ width: `min(${width}px, 100%)` }}
                  className="pointer-events-auto max-h-[calc(100vh-40px)] overflow-auto rounded-3xl bg-card shadow-float outline-none"
                  initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
                  <div className="flex items-center justify-between px-6 pb-1.5 pt-[22px]">
                    <RDialog.Title className="font-display text-[22px] font-extrabold tracking-[-.03em]">{title}</RDialog.Title>
                    <RDialog.Close asChild><IconButton icon="x" label="Close" /></RDialog.Close>
                  </div>
                  {description ? <RDialog.Description className="px-6 text-[14.5px] text-ink-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
                  <div className="flex flex-col gap-[18px] px-6 pb-6 pt-3">{children}</div>
                  {footer && <div className="flex justify-end gap-2 px-6 pb-6">{footer}</div>}
                </motion.div>
              </RDialog.Content>
            </div>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

/* ---------- Menu ---------- */
export interface MenuItem { icon: IconName; label: string; description?: string; shortcut?: string; onSelect: () => void }
export function Menu({ trigger, items, align = 'start' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={8}
          className="z-50 w-[310px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-2xl bg-card p-1.5 shadow-float data-[state=open]:animate-[menuin_.28s_var(--ease-spring)_both]">
          {items.map((it, i) => (
            <DropdownMenu.Item key={it.label} onSelect={it.onSelect}
              className="grid cursor-pointer grid-cols-[36px_1fr_auto] items-center gap-3 rounded-[11px] p-2.5 outline-none transition-colors data-[highlighted]:bg-well animate-rise"
              style={{ animationDelay: `${i * 40}ms`, animationDuration: '.35s' }}>
              <span className="grid size-9 place-items-center rounded-[10px] bg-well"><Icon name={it.icon} /></span>
              <span><b className="block text-[14.5px] font-semibold">{it.label}</b>{it.description && <span className="text-[12.5px] text-ink-3">{it.description}</span>}</span>
              {it.shortcut && <kbd className="font-mono text-[11.5px] text-ink-3">{it.shortcut}</kbd>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ---------- Popover ---------- */
export function Popover({ open, onOpenChange, trigger, children, side = 'top', className }: {
  open: boolean; onOpenChange: (o: boolean) => void; trigger: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content side={side} sideOffset={12}
          className={cn('z-50 flex w-[340px] flex-col gap-3 rounded-[18px] bg-[#1E1B17] p-4 text-stage-ink shadow-float outline-none data-[state=open]:animate-pop', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/* ---------- Tooltip ---------- */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={250}>{children}</RTooltip.Provider>;
}
export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={8} className="z-[60] rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-canvas shadow-lift data-[state=delayed-open]:animate-pop">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

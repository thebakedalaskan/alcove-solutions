import type { ReactNode } from 'react';
import { cn } from '../cn';

/* Small built-in illustrations for empty states and start tiles. Pure CSS, theme-aware. */

export function EmptyCalendarArt() {
  return (
    <div className="relative h-[116px] w-[180px] animate-float">
      <span className="absolute inset-x-5 inset-y-2 grid grid-cols-5 gap-1.5 overflow-hidden rounded-2xl bg-card px-3 pb-3 pt-[30px] shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair)]">
        <span className="absolute inset-x-0 top-0 h-5 bg-lamp" />
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={cn('rounded-md shadow-[inset_0_0_0_1.5px_var(--hair-2)]', i === 2 ? 'bg-well shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'bg-[repeating-linear-gradient(-45deg,transparent_0_4px,var(--hair)_4px_5px)]')} />
        ))}
      </span>
    </div>
  );
}

export function EmptyNotesArt() {
  const sheet = 'absolute left-11 top-2.5 h-[100px] w-24 rounded-xl bg-card shadow-[var(--sh-soft),inset_0_0_0_1px_var(--hair)]';
  return (
    <div className="relative h-[116px] w-[180px] animate-float">
      <span className={cn(sheet, '-translate-x-5 translate-y-1.5 -rotate-[10deg] opacity-60')} />
      <span className={cn(sheet, 'translate-x-[18px] translate-y-1 rotate-[7deg] opacity-80')} />
      <span className={cn(sheet, 'flex flex-col gap-[7px] px-3 py-3.5 shadow-[var(--sh-lift),inset_0_0_0_1px_var(--hair)]')}>
        <b className="h-2 w-[70%] rounded bg-ink" /><i className="h-[5px] rounded-sm bg-hair-2" /><i className="h-[5px] rounded-sm bg-hair-2" /><i className="h-[5px] w-[60%] rounded-sm bg-hair-2" />
      </span>
    </div>
  );
}

export function CallArt() {
  return (
    <div className="relative grid h-[132px] grid-cols-2 gap-1.5 overflow-hidden rounded-[15px] bg-[#15120F] p-2.5 pb-9">
      {['#4A3B2F,#221C17', '#3D5A4C,#1B241F', '#5E4569,#241B29', '#4A3B2F,#221C17'].map((g, i) => (
        <i key={i} className={cn('rounded-lg transition-transform duration-400 ease-soft group-hover:-translate-y-0.5', i === 0 && 'shadow-[0_0_0_1.5px_#F5F1EA]')} style={{ background: `linear-gradient(150deg, ${g})` }} />
      ))}
      <span className="absolute bottom-[9px] left-1/2 flex -translate-x-1/2 gap-[5px]"><b className="size-[18px] rounded-full bg-[#2E2924]" /><b className="size-[18px] rounded-full bg-[#2E2924]" /><b className="h-[18px] w-[30px] rounded-[9px] bg-rec" /></span>
    </div>
  );
}

export function InviteArt() {
  const card = 'absolute left-1/2 top-[22px] flex w-[150px] flex-col gap-1.5 rounded-xl bg-white p-3 shadow-[0_12px_30px_-12px_rgba(60,35,0,.4)] transition-[rotate,translate] duration-400 ease-soft';
  return (
    <div className="relative h-[132px] overflow-hidden rounded-[15px] bg-lamp-soft">
      <span className={cn(card, '-translate-x-[38%] translate-y-2 rotate-6 opacity-70 group-hover:-translate-x-[30%] group-hover:rotate-[10deg]')}><b className="h-2 w-[70%] rounded bg-[#17140F]" /><i className="h-[5px] w-[90%] rounded-sm bg-[#E6E1D9]" /></span>
      <span className={cn(card, 'z-[1] -translate-x-1/2 -rotate-[4deg] group-hover:-translate-x-[62%] group-hover:-rotate-[8deg]')}>
        <b className="h-2 w-[70%] rounded bg-[#17140F]" /><i className="h-[5px] w-[90%] rounded-sm bg-[#E6E1D9]" /><i className="h-[5px] w-[55%] rounded-sm bg-[#E6E1D9]" /><em className="mt-1 h-[18px] w-16 rounded-md bg-[#FFA62B]" />
      </span>
    </div>
  );
}

export function RoomArt() {
  return (
    <div className="flex h-[132px] items-center justify-center gap-[5px] rounded-[15px] bg-well">
      {Array.from({ length: 18 }, (_, i) => (
        <i key={i} className="h-[20%] w-[5px] rounded-sm bg-ink animate-[rwv_1.4s_ease-in-out_infinite]" style={{ animationDelay: `${-((i * 0.37) % 1.4)}s`, animationDuration: i % 4 === 0 ? '1.1s' : undefined }} />
      ))}
    </div>
  );
}

export function EmptyState({ art, title, children, actions, className }: { art: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center', className)}>
      {art}
      <b className="mt-2.5 font-display text-xl font-bold tracking-[-.02em]">{title}</b>
      {children && <p className="mb-2.5 max-w-[44ch] text-[14.5px] text-ink-2">{children}</p>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

import type { Person, PortraitHair, PortraitStyle } from '@alcove/api';
import type { ReactNode } from 'react';
import { cn } from '../cn';

/** Illustrated portrait, drawn on a 64px grid. Used at 20px in stacks and at 400px in call tiles. */
export function PortraitArt({ p, background = true }: { p: PortraitStyle; background?: boolean }) {
  const backs: Partial<Record<PortraitHair, ReactNode>> = {
    long: <path d="M18 30c0-11 6-17.5 14-17.5S46 19 46 30v20H18z" fill={p.hair} />,
    bob: <path d="M18.5 29c0-10.5 6-16.5 13.5-16.5S45.5 18.5 45.5 29v10.5c0 1.5-1.2 2.5-2.7 2.5H21.2c-1.5 0-2.7-1-2.7-2.5z" fill={p.hair} />,
    afro: <circle cx="32" cy="24" r="16" fill={p.hair} />,
    bun: <circle cx="32" cy="11" r="5.2" fill={p.hair} />
  };
  const back = backs[p.style];
  const fronts: Record<PortraitHair, ReactNode> = {
    short: <path d="M20.6 27.5C20 18 25.6 14 32 14s12 4 11.4 13.5c-1.8-4.6-6-7-11.4-7s-9.6 2.4-11.4 7z" fill={p.hair} />,
    swept: <path d="M20.4 28c-.8-9.6 4.6-14.2 12-14.2 6.6 0 11.4 3.6 11.2 11.2-4.2-1-9.8-3.4-13.4-6.6-1.6 4-5.6 7.2-9.8 9.6z" fill={p.hair} />,
    curly: <g fill={p.hair}>{[[21.5, 22], [24.5, 17.6], [29, 15], [34, 14.8], [38.8, 16.8], [42.2, 21]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4.4" />)}</g>,
    long: <path d="M20.6 28.5C20.4 18.5 25.6 14 32 14s11.6 4.5 11.4 14.5C40 24 36 21.4 31 20.6c-2.6 3.4-6.4 6-10.4 7.9z" fill={p.hair} />,
    bob: <path d="M20.6 29C20 18.8 25.6 14 32.4 14c6.4 0 11.4 4.4 11 13.6-5.8-.6-11-3-14.2-6.4-1.6 3.6-4.6 6.2-8.6 7.8z" fill={p.hair} />,
    afro: <path d="M21 26c1-7 5.4-10.4 11-10.4S42 19 43 26c-3.4-2.6-7-3.6-11-3.6S24.4 23.4 21 26z" fill={p.hair} />,
    bun: <path d="M20.8 27.4C20.4 18.6 25.8 14.2 32 14.2s11.6 4.4 11.2 13.2c-2.6-4-6.6-6.2-11.2-6.2s-8.6 2.2-11.2 6.2z" fill={p.hair} />
  };
  const front = fronts[p.style];
  return (
    <>
      {background && <rect width="64" height="64" fill={p.bg} />}
      {back}
      <path d="M9 64c1.6-11 10-17 23-17s21.4 6 23 17z" fill={p.shirt} />
      <path d="M27.6 38h8.8v9.4c0 2.4-2 4-4.4 4s-4.4-1.6-4.4-4z" fill={p.skin} style={{ filter: 'brightness(.9)' }} />
      <ellipse cx="20.8" cy="30" rx="2" ry="2.8" fill={p.skin} />
      <ellipse cx="43.2" cy="30" rx="2" ry="2.8" fill={p.skin} />
      <ellipse cx="32" cy="29" rx="11.4" ry="13.2" fill={p.skin} />
      {p.beard && <path d="M20.8 29.5c.6 10.4 5.4 14 11.2 14s10.6-3.6 11.2-14c-1.8 4.8-5 6.6-11.2 6.6S22.6 34.3 20.8 29.5z" fill={p.hair} />}
      {front}
      <circle cx="27.6" cy="30" r="1.35" fill="#2A1D15" />
      <circle cx="36.4" cy="30" r="1.35" fill="#2A1D15" />
      {!p.beard && <path d="M29.6 35.4q2.4 1.8 4.8 0" fill="none" stroke="#2A1D15" strokeWidth="1.2" strokeLinecap="round" opacity=".75" />}
      {p.glasses && <g fill="none" stroke="#2A1D15" strokeWidth="1.1"><circle cx="27.4" cy="30" r="3.4" /><circle cx="36.6" cy="30" r="3.4" /><path d="M30.8 30h2.4" /></g>}
    </>
  );
}

const TILE = ['#E8DCCB', '#DCE4DA', '#E4DAE6', '#DAE1EA'];
type Who = Pick<Person, 'name'> & { portrait?: PortraitStyle | undefined; email?: string | undefined };

export type { Who as AvatarPerson };
export function Avatar({ person, size = 30, ring = true, className }: { person: Who; size?: number; ring?: boolean; className?: string }) {
  const label = person.name || person.email || '?';
  const h = [...label].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (
    <span
      title={label}
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-display font-bold text-[#3A322B]', ring && 'ring-2 ring-[var(--avatar-ring,var(--card))]', className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: person.portrait ? undefined : TILE[h % TILE.length] }}
    >
      {person.portrait ? <svg viewBox="0 0 64 64" className="size-full" aria-hidden="true"><PortraitArt p={person.portrait} /></svg> : label[0]?.toUpperCase()}
    </span>
  );
}

export function AvatarStack({ people, size = 26, max = 4, className }: { people: Who[]; size?: number; max?: number; className?: string }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className={cn('group/stack inline-flex items-center', className)}>
      {shown.map((p, i) => (
        <span key={(p.email ?? p.name) + i} className="transition-transform duration-300 ease-soft group-hover/stack:translate-x-[calc(var(--i)*2px)]" style={{ marginLeft: i ? -size * 0.28 : 0, '--i': i }}>
          <Avatar person={p} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-well font-semibold text-ink-2 ring-2 ring-[var(--avatar-ring,var(--card))]" style={{ width: size, height: size, marginLeft: -size * 0.28, fontSize: size * 0.36 }}>+{more}</span>
      )}
    </span>
  );
}

/** A camera tile: a softly lit room behind the person, who breathes a little and moves when talking. */
export function CameraScene({ person, speaking = false, className }: { person: Who; speaking?: boolean; className?: string }) {
  const p = person.portrait;
  const room = p?.room ?? ['#9C8A78', '#3A322B', '#D8C7B4'];
  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)} style={{ background: `linear-gradient(170deg, ${room[1]}, #0F0C0A 92%)` }}>
      <i className="absolute right-[-4%] top-[-10%] h-[60%] w-[46%] rounded-full opacity-85 blur-[46px] animate-[drift_9s_ease-in-out_infinite_alternate]" style={{ background: room[2], '--dx': '-6%', '--dy': '5%' }} />
      <i className="absolute left-[-14%] top-[10%] h-[56%] w-[60%] rounded-full opacity-85 blur-[46px] animate-[drift_9s_ease-in-out_-4s_infinite_alternate]" style={{ background: room[0], '--dx': '7%', '--dy': '-4%' }} />
      <span className="absolute inset-x-0 bottom-[30%] h-px bg-white/[.07]" />
      {p ? (
        <svg viewBox="8 6 48 58" preserveAspectRatio="xMidYMax meet" aria-hidden="true"
          className={cn('absolute bottom-0 left-1/2 h-[74%] w-auto -translate-x-1/2 origin-bottom drop-shadow-[0_20px_40px_rgba(0,0,0,.35)]', speaking ? 'animate-[talk_.9s_ease-in-out_infinite]' : 'animate-breathe')}>
          <PortraitArt p={p} background={false} />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center"><Avatar person={person} size={104} ring={false} /></div>
      )}
    </div>
  );
}

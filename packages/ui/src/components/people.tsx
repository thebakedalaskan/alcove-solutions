import type { Person, PortraitHair, PortraitStyle } from '@alcove/api';
import { useState, type CSSProperties } from 'react';
import { cn } from '../cn';

/** Darker or lighter by `amt` (-1..1) of full scale, for shading. */
function shade(hex: string, amt: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return hex;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const HAIR_BACK: Partial<Record<PortraitHair, string>> = {
  long: 'M62 100C57 58 78 49 100 49C122 49 143 58 138 100L147 176C135 168 122 162 114 156H86C78 162 65 168 53 176Z',
  bob: 'M61 102C58 62 79 51 100 51C121 51 142 62 139 102L140 132C132 130 126 125 124 119H76C74 125 68 130 60 132Z',
  wavy: 'M63 106C57 64 79 51 100 51C122 51 143 64 137 106C142 120 134 129 129 134C127 121 125 112 123 106H77C75 114 73 123 71 134C65 127 58 119 63 106Z'
};
const HAIR_FRONT: Partial<Record<PortraitHair, string>> = {
  long: 'M100 57C80 57 67 70 66 99C71 84 81 70 100 65ZM100 57C120 57 133 70 134 99C129 84 119 70 100 65Z',
  short: 'M66 95C63 66 81 53 102 53C124 53 139 67 135 95C132 82 126 74 115 72C103 70 88 72 78 78C72 82 68 88 66 95ZM83 60C92 49 113 49 123 58C112 55 98 57 89 64Z',
  bun: 'M66 97C64 68 80 56 100 56C120 56 136 68 134 97C130 80 118 68 100 68C82 68 70 80 66 97Z',
  buzz: 'M67 93C66 68 82 58 100 58C118 58 134 68 133 93C128 78 116 70 100 70C84 70 72 78 67 93Z',
  side: 'M66 95C64 66 82 54 104 55C126 56 138 70 134 95C130 79 120 69 106 70L95 66C82 70 70 80 66 95Z',
  bob: 'M68 92C70 66 84 57 100 57C116 57 130 66 132 92C124 81 112 76 100 76C88 76 76 81 68 92Z',
  wavy: 'M68 95C66 70 82 58 100 58C117 58 132 66 134 90C126 76 116 72 104 74C94 70 80 78 68 95Z'
};
const CURLS_BACK = [[69, 86, 16], [79, 65, 17], [100, 57, 18], [121, 65, 17], [131, 86, 16], [63, 108, 13], [137, 108, 13], [68, 127, 11], [132, 127, 11]] as const;
const CURLS_FRONT = [[83, 70, 10], [100, 65, 11], [117, 70, 10]] as const;

/** One illustrated person in a 200 × 200 box centred on x = 100. */
export function PortraitArt({ p }: { p: PortraitStyle }) {
  const skinDark = shade(p.skin, -0.12);
  const hairDark = shade(p.hair, -0.06);
  const shirtDark = shade(p.shirt, -0.1);
  const back = HAIR_BACK[p.style];
  const front = HAIR_FRONT[p.style];
  return (
    <g>
      {p.style === 'curly' ? <g fill={p.hair}>{CURLS_BACK.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />)}</g> : back && <path d={back} fill={p.hair} />}
      <path d="M26 240C28 180 61 152 100 152C139 152 172 180 174 240Z" fill={p.shirt} />
      <path d="M26 240C28 180 61 152 100 152C76 160 56 186 52 240Z" fill={shirtDark} opacity=".35" />
      <path d="M88 122V148C92 153 108 153 112 148V122Z" fill={p.skin} />
      <path d="M88 130C95 138 105 138 112 130V124C105 132 95 132 88 124Z" fill={skinDark} opacity=".45" />
      <path d="M85 151C90 160 110 160 115 151C110 154 90 154 85 151Z" fill={shirtDark} opacity=".5" />
      <ellipse cx="67" cy="101" rx="5.5" ry="8" fill={skinDark} />
      <ellipse cx="133" cy="101" rx="5.5" ry="8" fill={skinDark} />
      <ellipse cx="100" cy="97" rx="33" ry="38.5" fill={p.skin} />
      <path d="M100 58.5C118 58.5 133 75 133 97C133 120 118 135.5 100 135.5C112 128 120 112 120 97C120 80 112 66 100 58.5Z" fill={skinDark} opacity=".18" />
      {p.beard && <><path d="M69 106C71 131 85 144 100 144C115 144 129 131 131 106C127 119 116 126 100 127C84 126 73 119 69 106Z" fill={p.hair} opacity=".92" /><path d="M90 118Q100 113 110 118Q100 121 90 118Z" fill={p.hair} /></>}
      <circle cx="83" cy="113" r="6.5" fill="#F07C7C" opacity=".16" />
      <circle cx="117" cy="113" r="6.5" fill="#F07C7C" opacity=".16" />
      <ellipse cx="88" cy="100" rx="3.1" ry="3.8" fill="#2A201B" />
      <ellipse cx="112" cy="100" rx="3.1" ry="3.8" fill="#2A201B" />
      <circle cx="89.1" cy="98.8" r=".9" fill="#fff" opacity=".7" />
      <circle cx="113.1" cy="98.8" r=".9" fill="#fff" opacity=".7" />
      <path d="M80 89.5Q88 85 95.5 88.5M104.5 88.5Q112 85 120 89.5" stroke={hairDark} strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".9" />
      <path d="M100 103Q96.5 112 101 114.5" stroke={skinDark} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".75" />
      <path d="M91 121.5Q100 128 109 121.5" stroke="#7A3A2E" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {p.style === 'curly' ? <g fill={p.hair}>{CURLS_FRONT.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />)}</g> : front && <path d={front} fill={p.hair} />}
      {p.style === 'bun' && <><circle cx="100" cy="47" r="15" fill={p.hair} /><ellipse cx="100" cy="60" rx="9" ry="3" fill={hairDark} opacity=".6" /></>}
      {p.glasses && (
        <>
          <g fill="rgb(255 255 255 / .12)" stroke="#2A201B" strokeWidth="2.2"><rect x="76.5" y="92" width="21" height="16" rx="6" /><rect x="102.5" y="92" width="21" height="16" rx="6" /></g>
          <path d="M97.5 99.5H102.5" stroke="#2A201B" strokeWidth="2.2" />
        </>
      )}
      {p.earrings && <><circle cx="67" cy="112.5" r="2.7" fill="#FFC35E" /><circle cx="133" cy="112.5" r="2.7" fill="#FFC35E" /></>}
    </g>
  );
}

export type AvatarPerson = Pick<Person, 'name'> & { email?: string | undefined; photoUrl?: string | undefined; portrait?: PortraitStyle | undefined };

/**
 * A round avatar: the person's photo, else their illustrated portrait, else their initial. A photo
 * that doesn't load (gone, blocked, offline) falls back the same way.
 */
export function Avatar({ person, size = 32, className, style }: { person: AvatarPerson; size?: number; className?: string; style?: CSSProperties }) {
  const label = person.name || person.email || '?';
  const [failed, setFailed] = useState<string | null>(null);
  const photo = person.photoUrl && person.photoUrl !== failed ? person.photoUrl : undefined;
  return (
    <span className={cn('av', className)} style={{ '--s': `${size}px`, ...style }} title={label}>
      {photo ? <img src={photo} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(photo)} />
        : person.portrait ? <svg viewBox="0 0 200 200" aria-hidden="true"><rect width="200" height="200" fill={person.portrait.bg} /><g transform="translate(0 6)"><PortraitArt p={person.portrait} /></g></svg>
          : <span className="grid size-full place-items-center font-display font-bold text-ink-2" style={{ fontSize: size * 0.42 }}>{label.charAt(0).toUpperCase()}</span>}
    </span>
  );
}

/** Overlapping faces, with "+n" when there are more than `max`. */
export function Faces({ people, size = 28, max = 4, className }: { people: AvatarPerson[]; size?: number; max?: number; className?: string }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className={cn('faces', className)} style={{ '--s': `${size}px` }}>
      {shown.map((p, i) => <Avatar key={`${p.email ?? p.name}-${i}`} person={p} size={size} />)}
      {more > 0 && <span className="more">+{more}</span>}
    </span>
  );
}

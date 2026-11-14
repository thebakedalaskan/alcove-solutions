/*
 * Everyone in the demo world, from the design canvas (docs/design/canvas/appdata.js, data-team.js, Faces.dc.html): you are
 * Art Vandelay at Vandelay Industries, and every other person is made up too. Never put a real person's name here.
 * People drawn without a portrait on the canvas have none here either, so they show their initial. A portrait Alcove draws
 * from a seed, as it does for a team's glimpse, is `portraitFrom`.
 */
import type { Person, PortraitHair, PortraitStyle, Team } from '@alcove/api';

export const COMPANY = { name: 'Vandelay Industries', domain: 'vandelay.industries' } as const;

/** Someone at the company, as its directory lists them. */
export interface Colleague { person: Person; title: string; onAlcove: boolean; invited: boolean }

const at = (first: string) => `${first.toLowerCase()}@${COMPANY.domain}`;
const someone = (name: string, email: string, portrait?: PortraitStyle | undefined): Person => ({ id: email, name, email, ...(portrait ? { portrait } : {}) });

/** You. Your ID is your account's, as the session gives it. */
export const ME_ID = 'o-art-vandelay';
export const ART: Person = {
  id: ME_ID, name: 'Art Vandelay', email: at('art'),
  portrait: { skin: '#E9C4A3', hair: '#3A2A22', style: 'short', shirt: '#4B3C9E', bg: '#FFE3CF', glasses: true }
};

export const PRIYA = someone('Priya Raman', at('priya'), { skin: '#B47A55', hair: '#1A120E', style: 'bun', shirt: '#9C4A86', bg: '#F8D6E4', earrings: true });
export const KOFI = someone('Kofi Asante', at('kofi'), { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true });
export const AIKO = someone('Aiko Tanaka', at('aiko'), { skin: '#F0D0B4', hair: '#15110F', style: 'bob', shirt: '#D98CB8', bg: '#E8E2FF' });
export const MAYA = someone('Maya Chen', at('maya'), { skin: '#F1CBA8', hair: '#231813', style: 'long', shirt: '#4859D6', bg: '#E2E7FF' });
export const INES = someone('Ines Moreau', at('ines'));
export const LENA = someone('Lena Fischer', at('lena'), { skin: '#F3D6BE', hair: '#B87B43', style: 'wavy', shirt: '#6A4FC9', bg: '#FBE3EE' });
export const SAM = someone('Sam Ortiz', at('sam'), { skin: '#8A5A3C', hair: '#1B1310', style: 'side', shirt: '#4A6BD6', bg: '#FFEBD8' });
export const DIEGO = someone('Diego Ruiz', at('diego'), { skin: '#C68A62', hair: '#2A1B12', style: 'curly', shirt: '#C0587A', bg: '#FFE1C8', beard: true });
export const THEO = someone('Theo Martin', at('theo'), { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true });
export const NADIA = someone('Nadia Haddad', at('nadia'), { skin: '#D9A47E', hair: '#2B1B14', style: 'long', shirt: '#8E3B6E', bg: '#FCE0EA', earrings: true });
export const OMAR = someone('Omar Farouk', at('omar'), { skin: '#A86F4C', hair: '#1E1612', style: 'short', shirt: '#2F3C9E', bg: '#E3E5FF', beard: true, glasses: true });
export const ELENA = someone('Elena Petrova', at('elena'), { skin: '#F4D9C4', hair: '#8C5A2E', style: 'bob', shirt: '#7A4FD0', bg: '#FFE6D6', glasses: true });
export const TOM = someone('Tom Becker', at('tom'), { skin: '#EFCDB0', hair: '#C08A4B', style: 'side', shirt: '#3E57B8', bg: '#FFF0D9' });
export const ZARA = someone('Zara Ahmed', at('zara'), { skin: '#9C6644', hair: '#120D0B', style: 'curly', shirt: '#B04F7E', bg: '#EDE4FF', earrings: true });
export const FELIX = someone('Felix Wagner', at('felix'), { skin: '#F2D2B6', hair: '#6B4A2F', style: 'buzz', shirt: '#574AB8', bg: '#DDE6FF', glasses: true });

/** People outside the company Art has calls with. */
export const JONAS = someone('Jonas Weber', 'jonas@weber.design', { skin: '#F3D8C1', hair: '#C7A066', style: 'side', shirt: '#2A2845', bg: '#E2E0F3', glasses: true });
export const ANA = someone('Ana Souza', 'ana@souza.law', { skin: '#C7926C', hair: '#2A1A12', style: 'bob', shirt: '#7A5BD6', bg: '#E9DBFA', earrings: true });
/** On Jonas's team at Weber Design, and on Ana's at Souza Law: the teams that invite Art. */
export const LOTTE = someone('Lotte Brandt', 'lotte@weber.design', { skin: '#F2D3BC', hair: '#D9B26F', style: 'long', shirt: '#3F4FB8', bg: '#E4F0FF' });
export const MALIK = someone('Malik Osei', 'malik@weber.design', { skin: '#6E4630', hair: '#120C0A', style: 'buzz', shirt: '#B4507A', bg: '#FFE6D2', beard: true });
export const BRUNO = someone('Bruno Lima', 'bruno@souza.law', { skin: '#C9946E', hair: '#3A271B', style: 'short', shirt: '#4C3FA8', bg: '#E6E2FF', glasses: true });

/** The companies the world knows, by their address's domain: a team made for someone there is named for theirs. */
const COMPANIES: readonly { domain: string; name: string }[] = [COMPANY, { domain: 'weber.design', name: 'Weber Design' }, { domain: 'souza.law', name: 'Souza Law' }];
/** The company someone's address is at, if the world knows it: null for a personal address. */
export const companyOf = (email: string): string | null => COMPANIES.find((c) => email.trim().toLowerCase().endsWith(`@${c.domain}`))?.name ?? null;

/** The directory, as the canvas has it: five on Alcove, three not yet, Diego marked invited for the stories of a list's rows. */
export const DIRECTORY: readonly Colleague[] = [
  { person: PRIYA, title: 'Product', onAlcove: true, invited: false },
  { person: KOFI, title: 'Design lead', onAlcove: true, invited: false },
  { person: AIKO, title: 'Engineering', onAlcove: true, invited: false },
  { person: MAYA, title: 'Finance', onAlcove: true, invited: false },
  { person: INES, title: 'Co-founder', onAlcove: true, invited: false },
  { person: LENA, title: 'Research', onAlcove: false, invited: false },
  { person: SAM, title: 'Product design', onAlcove: false, invited: false },
  { person: DIEGO, title: 'Sales', onAlcove: false, invited: true }
];

/** Twenty-four more, for the company with thirty people on Alcove (the canvas's `many`). */
const MORE: readonly (readonly [Person, string])[] = [
  [THEO, 'Engineering'], [NADIA, 'Legal'], [OMAR, 'Security'], [ELENA, 'Data'], [TOM, 'Support'], [ZARA, 'Marketing'], [FELIX, 'Engineering'],
  [someone('Milo Grant', at('milo')), 'Operations'], [someone('Jamie Lee', at('jamie')), 'Partnerships'], [someone('Ruth Okoye', at('ruth')), 'People'],
  [someone('Ivan Sokolov', at('ivan')), 'Engineering'], [someone('Mei Lin', at('mei')), 'Design'], [someone('Pablo Ortega', at('pablo')), 'Sales'],
  [someone('Hana Novak', at('hana')), 'Research'], [someone('Noor Rahimi', at('noor')), 'Finance'], [someone('Erik Lund', at('erik')), 'Engineering'],
  [someone('Tess Ward', at('tess')), 'Support'], [someone('Yuki Sato', at('yuki')), 'Design'], [someone('Caleb Stone', at('caleb')), 'Sales'],
  [someone('Ines Costa', at('ines.costa')), 'Marketing'], [someone('Rafael Dias', at('rafael')), 'Engineering'], [someone('Greta Holm', at('greta')), 'Legal'],
  [someone('Luca Moretti', at('luca')), 'Data'], [someone('Amara Obi', at('amara')), 'People']
];
export const MANY: readonly Colleague[] = [...DIRECTORY, ...MORE.map(([person, title]): Colleague => ({ person, title, onAlcove: true, invited: false }))];

/**
 * The company as `people.team()` gives it: everyone but you. Whether someone's `invited` is never kept here: it's whether the
 * team Art is on has a live invitation for them, worked out as it's asked for (src/api/account/team-invitations.ts).
 */
export const teamOf = (people: readonly Colleague[]): Team => ({
  name: COMPANY.name, domain: COMPANY.domain,
  members: people.map((c) => ({ person: c.person, title: c.title, onAlcove: c.onAlcove, invited: false }))
});

/** Everyone the world knows, by address. */
export const EVERYONE: readonly Person[] = [ART, ...MANY.map((c) => c.person), JONAS, LOTTE, MALIK, ANA, BRUNO];
export const byEmail = (email: string): Person | undefined => EVERYONE.find((p) => p.email === email.trim().toLowerCase());
/** Someone by address: who the world knows, or a stranger named by their address. */
export const personAt = (email: string): Person => byEmail(email) ?? { id: email.trim().toLowerCase(), name: email.trim().toLowerCase(), email: email.trim().toLowerCase() };

/* ---------- a portrait drawn from a seed ---------- */

/** The palettes Alcove draws a portrait in (apps/api/src/features/profile/portraits.ts). */
const SKINS = ['#F1D3B8', '#E8C2A0', '#D9AA86', '#C7926C', '#B47A55', '#7B4F35', '#F3D8C1'] as const;
const HAIRS = ['#1D1612', '#3A2318', '#5B3B25', '#141010', '#9A5A2E', '#C7A066', '#2B2019'] as const;
const BGS = ['#DCD8FF', '#D5DEFF', '#F8D6E4', '#FFE1C4', '#D4E4FF', '#E9DBFA', '#FCDCD5'] as const;
const SHIRTS = ['#5847E0', '#2E3A8C', '#9C4A86', '#3D35A8', '#4F6FD6', '#C2577A', '#7A5BD6'] as const;
const STYLES: readonly PortraitHair[] = ['long', 'short', 'bun', 'curly', 'bob', 'wavy', 'side', 'buzz'];
/** Wall top, wall bottom and the warm light in the room behind someone on camera. */
const ROOMS: readonly [string, string, string][] = [
  ['#EADFF0', '#CDBEDD', '#FFF1DE'], ['#D4DBF3', '#AEB8DF', '#E8ECFB'], ['#F0D5E1', '#D6AEC3', '#F8EEF3'],
  ['#CEC6EA', '#A79BD2', '#F5EEFB'], ['#D1E0F5', '#A8BFE4', '#EEF4FD'], ['#F5DDD2', '#DDB9AD', '#FBEDE6']
];

/** Nine numbers from 0 to 255 from some words, the same every time: their FNV-1a hash, stirred by xorshift. */
function bytesOf(seed: string): number[] {
  let h = 0x811c9dc5;
  for (const c of seed.trim().toLowerCase()) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  if (h === 0) h = 0x9e3779b9;
  return Array.from({ length: 9 }, () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h & 0xff;
  });
}
/**
 * How someone looks when Alcove draws them from a seed, the same every time, in the server's palettes and as its `portraitFor`
 * picks them: what a team's glimpse shows of everyone on it but whoever sent it, drawn from their member ID, which names
 * nobody (src/world/plans/team-invitations.ts › glimpseOf). Its hash isn't the server's: a story only needs it to be stable.
 */
export function portraitFrom(seed: string): PortraitStyle {
  const h = bytesOf(seed);
  const pick = <T>(xs: readonly T[], i: number, fallback: T): T => xs[(h[i] ?? 0) % xs.length] ?? fallback;
  return {
    bg: pick(BGS, 0, '#DCD8FF'), skin: pick(SKINS, 1, '#F1D3B8'), hair: pick(HAIRS, 2, '#1D1612'), shirt: pick(SHIRTS, 3, '#5847E0'),
    style: pick(STYLES, 4, 'short'), glasses: (h[5] ?? 0) % 4 === 0, beard: (h[7] ?? 0) % 5 === 0, earrings: (h[8] ?? 0) % 4 === 1,
    room: pick(ROOMS, 6, ['#EADFF0', '#CDBEDD', '#FFF1DE'])
  };
}

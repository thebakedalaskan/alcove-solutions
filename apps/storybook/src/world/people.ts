/*
 * Everyone in the demo world, from the design canvas (docs/design/canvas/appdata.js, data-team.js, Faces.dc.html): you are
 * Art Vandelay at Vandelay Industries, and every other person is made up too. Never put a real person's name here.
 * People drawn without a portrait on the canvas have none here either, so they show their initial.
 */
import type { Person, PortraitStyle, Team } from '@alcove/api';

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

/** The directory, as the canvas has it: five on Alcove, three not yet, Diego asked already. */
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

/** The team as `people.team()` gives it: everyone but you. */
export const teamOf = (people: readonly Colleague[]): Team => ({
  name: COMPANY.name, domain: COMPANY.domain,
  members: people.map((c) => ({ person: c.person, title: c.title, onAlcove: c.onAlcove, invited: c.invited }))
});

/** Everyone the world knows, by address. */
export const EVERYONE: readonly Person[] = [ART, ...MANY.map((c) => c.person), JONAS, ANA];
export const byEmail = (email: string): Person | undefined => EVERYONE.find((p) => p.email === email.trim().toLowerCase());
/** Someone by address: who the world knows, or a stranger named by their address. */
export const personAt = (email: string): Person => byEmail(email) ?? { id: email.trim().toLowerCase(), name: email.trim().toLowerCase(), email: email.trim().toLowerCase() };

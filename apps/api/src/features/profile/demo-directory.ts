/*
 * The demo company's directory, a stand-in until company SSO is connected (features/account/demo.ts): everyone at
 * vandelay.industries shares Art's company directory, and the people outside it he's had calls with. Their names and
 * portraits are how they appear (./portraits.ts), and who's on a team (features/meetings/people.ts).
 */
import type { PortraitStyle } from '@alcove/api';

export const COMPANY = { name: 'Vandelay Industries', domain: 'vandelay.industries' } as const;
/** The company directory a work account at Vandelay Industries can see. */
export const inCompany = (email: string) => email.endsWith(`@${COMPANY.domain}`);

export interface Contact { name: string; title?: string; email: string; onAlcove: boolean; portrait: PortraitStyle }

const ROOM = {
  warm: ['#EADFF0', '#CDBEDD', '#FFF1DE'], peri: ['#D4DBF3', '#AEB8DF', '#E8ECFB'], rose: ['#F0D5E1', '#D6AEC3', '#F8EEF3'], dusk: ['#CEC6EA', '#A79BD2', '#F5EEFB'],
  sky: ['#D1E0F5', '#A8BFE4', '#EEF4FD'], mist: ['#E0DDEE', '#BEB8D6', '#F2F0F9'], lilac: ['#E2D6F2', '#C3AEE0', '#F4EEFB'], peach: ['#F5DDD2', '#DDB9AD', '#FBEDE6']
} as const satisfies Record<string, [string, string, string]>;

/** Colleagues, as a company directory would list them. Theo, Kofi, Aiko and Maya already use Alcove. */
export const TEAM: readonly Contact[] = [
  { name: 'Theo Martin', title: 'Engineering', email: 'theo@vandelay.industries', onAlcove: true, portrait: { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true, room: [...ROOM.peri] } },
  { name: 'Kofi Asante', title: 'Design lead', email: 'kofi@vandelay.industries', onAlcove: true, portrait: { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true, room: [...ROOM.dusk] } },
  { name: 'Sam Ortiz', title: 'Product design', email: 'sam@vandelay.industries', onAlcove: false, portrait: { skin: '#DDB08B', hair: '#2B2019', style: 'wavy', shirt: '#C2577A', bg: '#FCDCD5', room: [...ROOM.peach] } },
  { name: 'Lena Fischer', title: 'Research', email: 'lena@vandelay.industries', onAlcove: false, portrait: { skin: '#F0CDB0', hair: '#9A5A2E', style: 'bob', shirt: '#4A5A9C', bg: '#DCE3FB', room: [...ROOM.peri] } },
  { name: 'Aiko Tanaka', title: 'Design', email: 'aiko@vandelay.industries', onAlcove: true, portrait: { skin: '#F0D0B4', hair: '#15110F', style: 'bob', shirt: '#D98CB8', bg: '#E8E2FF', room: [...ROOM.lilac] } },
  { name: 'Maya Chen', title: 'Product', email: 'maya@vandelay.industries', onAlcove: true, portrait: { skin: '#F1CBA8', hair: '#231813', style: 'long', shirt: '#4859D6', bg: '#E2E7FF', room: [...ROOM.sky] } }
];

/** People outside the company Art has had calls with, as his calendar would show them. */
export const MET: readonly Contact[] = [
  { name: 'Priya Raman', email: 'priya@lumen.health', onAlcove: false, portrait: { skin: '#B47A55', hair: '#1A120E', style: 'bun', shirt: '#9C4A86', bg: '#F8D6E4', earrings: true, room: [...ROOM.rose] } },
  { name: 'Inès Moreau', email: 'ines@lumen.health', onAlcove: false, portrait: { skin: '#D9AA86', hair: '#3A2318', style: 'curly', shirt: '#4F6FD6', bg: '#D4E4FF', room: [...ROOM.sky] } },
  { name: 'Ana Souza', email: 'ana@souza.law', onAlcove: false, portrait: { skin: '#C7926C', hair: '#2A1A12', style: 'bob', shirt: '#7A5BD6', bg: '#E9DBFA', earrings: true, room: [...ROOM.lilac] } },
  { name: 'Jonas Weber', email: 'jonas@weber.design', onAlcove: false, portrait: { skin: '#F3D8C1', hair: '#C7A066', style: 'side', shirt: '#2A2845', bg: '#E2E0F3', glasses: true, room: [...ROOM.mist] } }
];

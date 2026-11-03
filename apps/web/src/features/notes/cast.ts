/*
 * The people in Alcove's example calls: the welcome page's scenes and the example note on Home.
 * Illustrated, so they can't be mistaken for real users.
 */
import type { AvatarPerson } from '@alcove/ui';

export const CAST = {
  theo: { name: 'Theo Martin', portrait: { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true } },
  priya: { name: 'Priya Raman', portrait: { skin: '#B47A55', hair: '#1A120E', style: 'bun', shirt: '#9C4A86', bg: '#F8D6E4', earrings: true } },
  kofi: { name: 'Kofi Asante', portrait: { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true } },
  maya: { name: 'Maya Chen', portrait: { skin: '#F1CBA8', hair: '#231813', style: 'long', shirt: '#4859D6', bg: '#E2E7FF' } },
  lena: { name: 'Lena Fischer', portrait: { skin: '#F3D6BE', hair: '#B87B43', style: 'wavy', shirt: '#6A4FC9', bg: '#FBE3EE' } },
  diego: { name: 'Diego Ruiz', portrait: { skin: '#C68A62', hair: '#2A1B12', style: 'curly', shirt: '#C0587A', bg: '#FFE1C8', beard: true } },
  aiko: { name: 'Aiko Tanaka', portrait: { skin: '#F0D0B4', hair: '#15110F', style: 'bob', shirt: '#D98CB8', bg: '#E8E2FF' } }
} satisfies Record<string, AvatarPerson>;
export type CastId = keyof typeof CAST;

export const firstOf = (id: CastId): string => CAST[id].name.split(' ')[0] ?? CAST[id].name;

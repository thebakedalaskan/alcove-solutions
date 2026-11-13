/*
 * Photos from a sign-in provider, as the demo world has them: drawn, since it has no photographs. One picture of someone by
 * a window in the evening light, as it comes for most people (a rectangle) and as it comes for people who cut theirs to a
 * circle before giving it to their provider (a square whose corners are see-through).
 */

/** The picture, drawn on 120 × 130. */
const PICTURE = `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DB8DE"/><stop offset="1" stop-color="#E9D3C2"/></linearGradient>
<radialGradient id="window" cx=".78" cy=".18" r=".62"><stop offset="0" stop-color="#FFF4DD" stop-opacity=".9"/><stop offset="1" stop-color="#FFF4DD" stop-opacity="0"/></radialGradient>
</defs>
<rect width="120" height="130" fill="url(#sky)"/><rect width="120" height="130" fill="url(#window)"/>
<path d="M6 130C9 102 30 90 60 90C90 90 111 102 114 130Z" fill="#2A2845"/>
<path d="M50 76H70V93C66 99 54 99 50 93Z" fill="#E2BB9C"/>
<ellipse cx="60" cy="57" rx="21" ry="25" fill="#F3D8C1"/>
<path d="M38 55C37 35 48 27 61 27C75 27 84 36 82 54C78 44 71 40 61 40C51 40 44 45 38 55Z" fill="#C7A066"/>
<g fill="none" stroke="#2A201B" stroke-width="2"><rect x="44" y="52" width="14" height="10" rx="4"/><rect x="62" y="52" width="14" height="10" rx="4"/><path d="M58 57H62"/></g>
<path d="M53 71Q60 75 67 71" stroke="#9A5A48" stroke-width="2" fill="none" stroke-linecap="round"/>`;

const svg = (frame: string, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${frame}>${body}</svg>`)}`;

/** A photo as most people's come: the whole picture. */
export const PHOTO = svg('viewBox="0 0 120 130"', PICTURE);

/** The same photo cut to a circle: a 120px square, the circle touching its edges, its corners see-through. */
export const ROUND_PHOTO = svg('viewBox="0 5 120 120" width="120" height="120"',
  `<clipPath id="round"><circle cx="60" cy="65" r="60"/></clipPath><g clip-path="url(#round)">${PICTURE}</g>`);

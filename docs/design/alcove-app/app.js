/* Alcove clickable prototype. Plain JS: one state object, one view per screen, small "parts" re-rendered in place. */
(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- icons ---------- */
const P = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micoff: '<path d="M15 9.4V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M5 11a7 7 0 0 0 11.7 5.2M19 11a7 7 0 0 1-.5 2.6M12 18v3M3.5 3.5l17 17"/>',
  cam: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  camoff: '<path d="M16 15.5v-1l5 3v-9l-5 3V9a3 3 0 0 0-3-3H9.6M5.3 6.3A3 3 0 0 0 3 9v6a3 3 0 0 0 3 3h7a3 3 0 0 0 2.2-1M3.5 3.5l17 17"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M8 21h8M12 17v4M12 13.5V8M9.5 10.5L12 8l2.5 2.5"/>',
  notes: '<path d="M6.5 3h8l4 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5.5 19.5V4.5A1.5 1.5 0 0 1 7 3z"/><path d="M14 3v4.5h4.5M9 12.5h6.5M9 16h4.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  leave: '<path d="M3.2 14.2c4.9-4.6 12.7-4.6 17.6 0l-2.1 2.4-3.4-1.3v-2.6a10.5 10.5 0 0 0-6.6 0v2.6l-3.4 1.3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.6A6.5 6.5 0 0 1 21.5 20"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  send: '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
  kbd: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7.5l8 5.5 8-5.5"/>',
  fp: '<path d="M12 11.5v2.6c0 2.3-.6 4.4-1.7 6.2M8.6 7.5A5 5 0 0 1 17 11.2v1.6c0 1.5-.2 2.9-.6 4.2M7 11.3c0-.6.1-1.2.3-1.7M7 14.6v-.9M4.6 8.6A8 8 0 0 1 19.8 10.4M20 14v-.6M4 12.5v1.6c0 1.8.5 3.5 1.4 4.9M14.3 20.6c.4-1 .7-2.1.9-3.2"/>',
  share: '<path d="M12 3.5v11M7.5 8l4.5-4.5L16.5 8M5 13.5V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-4.5"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  msg: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17H10l-5 3.5V6.5A1.5 1.5 0 0 1 5 5z"/>',
  room: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13"/>',
  hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7.5a7 7 0 0 1-7 7h-.5A5.5 5.5 0 0 1 5 17.6l-1.6-3.3a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  ok: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-4.9"/>'
};
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

/* The mark: an arched niche with a lamp burning low inside it. */
const mark = (s = 28, c = '') => `<svg class="mark ${c}" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true">
  <path class="niche" d="M6 29.5V15.2C6 9.6 10.5 5 16 5s10 4.6 10 10.2v14.3z"/>
  <path class="spill" d="M6 29.5V15.2C6 9.6 10.5 5 16 5s10 4.6 10 10.2v14.3z"/>
  <circle class="flame" cx="16" cy="21.2" r="4"/></svg>`;
const logo = (s = 24) => `<span class="logo" style="--s:${s}px">${mark(s)}<span class="wm">alcove</span></span>`;

/* ---------- data ---------- */
const PEOPLE = {
  MC: { n: 'Maya Chen', bg: '#F3D9C4', skin: '#EDC7A6', hair: '#1F1A17', style: 'bob', shirt: '#C2623A', room: ['#C98A5E', '#5D3F31', '#E8C29C'] },
  BO: { n: 'Ben Ortiz', bg: '#CFE3D6', skin: '#B9835A', hair: '#2A1C14', style: 'curly', beard: true, shirt: '#2F5D4B', room: ['#5F8C76', '#26352D', '#A8C2A4'] },
  PR: { n: 'Priya Raman', bg: '#E6D4EC', skin: '#A86F4C', hair: '#1B1311', style: 'long', shirt: '#6E3F80', room: ['#9A6FA8', '#35263F', '#D7B3C6'] },
  JW: { n: 'Jon Weiss', bg: '#D3DEEC', skin: '#F0CFB4', hair: '#B5562B', style: 'short', glasses: true, shirt: '#34507A', room: null },
  AK: { n: 'Ama Kusi', bg: '#EFE2C2', skin: '#7A4A30', hair: '#18110E', style: 'afro', shirt: '#A07A2C', room: null },
  LS: { n: 'Leo Sato', bg: '#D6E0E6', skin: '#E3B996', hair: '#26211E', style: 'swept', shirt: '#4F6B8A', room: null },
  DA: { n: 'Dana Ruiz', bg: '#F4E1CF', skin: '#F2D3BA', hair: '#D9A95B', style: 'bun', shirt: '#8A5A44', room: null }
};
/* Illustrated portraits. Same art at 20px in a stack and at 400px in a call tile. */
function portrait(p, withBg = true) {
  const hairBack = {
    long: `<path d="M18 30c0-11 6-17.5 14-17.5S46 19 46 30v20H18z" fill="${p.hair}"/>`,
    bob: `<path d="M18.5 29c0-10.5 6-16.5 13.5-16.5S45.5 18.5 45.5 29v10.5c0 1.5-1.2 2.5-2.7 2.5H21.2c-1.5 0-2.7-1-2.7-2.5z" fill="${p.hair}"/>`,
    afro: `<circle cx="32" cy="24" r="16" fill="${p.hair}"/>`,
    bun: `<circle cx="32" cy="11" r="5.2" fill="${p.hair}"/>`
  }[p.style] || '';
  const hairFront = {
    short: `<path d="M20.6 27.5C20 18 25.6 14 32 14s12 4 11.4 13.5c-1.8-4.6-6-7-11.4-7s-9.6 2.4-11.4 7z" fill="${p.hair}"/>`,
    swept: `<path d="M20.4 28c-.8-9.6 4.6-14.2 12-14.2 6.6 0 11.4 3.6 11.2 11.2-4.2-1-9.8-3.4-13.4-6.6-1.6 4-5.6 7.2-9.8 9.6z" fill="${p.hair}"/>`,
    curly: [[21.5, 22], [24.5, 17.6], [29, 15], [34, 14.8], [38.8, 16.8], [42.2, 21]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.4" fill="${p.hair}"/>`).join(''),
    long: `<path d="M20.6 28.5C20.4 18.5 25.6 14 32 14s11.6 4.5 11.4 14.5C40 24 36 21.4 31 20.6c-2.6 3.4-6.4 6-10.4 7.9z" fill="${p.hair}"/>`,
    bob: `<path d="M20.6 29C20 18.8 25.6 14 32.4 14c6.4 0 11.4 4.4 11 13.6-5.8-.6-11-3-14.2-6.4-1.6 3.6-4.6 6.2-8.6 7.8z" fill="${p.hair}"/>`,
    afro: `<path d="M21 26c1-7 5.4-10.4 11-10.4S42 19 43 26c-3.4-2.6-7-3.6-11-3.6S24.4 23.4 21 26z" fill="${p.hair}"/>`,
    bun: `<path d="M20.8 27.4C20.4 18.6 25.8 14.2 32 14.2s11.6 4.4 11.2 13.2c-2.6-4-6.6-6.2-11.2-6.2s-8.6 2.2-11.2 6.2z" fill="${p.hair}"/>`
  }[p.style] || '';
  return `${withBg ? `<rect width="64" height="64" fill="${p.bg}"/>` : ''}
    ${hairBack}
    <path d="M9 64c1.6-11 10-17 23-17s21.4 6 23 17z" fill="${p.shirt}"/>
    <path d="M27.6 38h8.8v9.4c0 2.4-2 4-4.4 4s-4.4-1.6-4.4-4z" fill="${p.skin}" style="filter:brightness(.9)"/>
    <ellipse cx="20.8" cy="30" rx="2" ry="2.8" fill="${p.skin}"/><ellipse cx="43.2" cy="30" rx="2" ry="2.8" fill="${p.skin}"/>
    <ellipse cx="32" cy="29" rx="11.4" ry="13.2" fill="${p.skin}"/>
    ${p.beard ? `<path d="M20.8 29.5c.6 10.4 5.4 14 11.2 14s10.6-3.6 11.2-14c-1.8 4.8-5 6.6-11.2 6.6S22.6 34.3 20.8 29.5z" fill="${p.hair}"/>` : ''}
    ${hairFront}
    <circle cx="27.6" cy="30" r="1.35" fill="#2A1D15"/><circle cx="36.4" cy="30" r="1.35" fill="#2A1D15"/>
    <path d="M29.6 35.4q2.4 1.8 4.8 0" fill="none" stroke="#2A1D15" stroke-width="1.2" stroke-linecap="round" opacity="${p.beard ? 0 : .75}"/>
    ${p.glasses ? `<g fill="none" stroke="#2A1D15" stroke-width="1.1"><circle cx="27.4" cy="30" r="3.4"/><circle cx="36.6" cy="30" r="3.4"/><path d="M30.8 30h2.4"/></g>` : ''}`;
}
const GUEST_BG = ['#E8DCCB', '#DCE4DA', '#E4DAE6', '#DAE1EA'];
const av = (k, s = 30) => {
  const p = PEOPLE[k];
  if (p) return `<span class="av" style="--s:${s}px" title="${p.n}"><svg viewBox="0 0 64 64" aria-hidden="true">${portrait(p)}</svg></span>`;
  const t = String(k); const h = [...t].reduce((x, c) => x + c.charCodeAt(0), 0);
  return `<span class="av av-txt" style="--s:${s}px;background:${GUEST_BG[h % 4]}" title="${esc(t)}">${esc(t[0].toUpperCase())}</span>`;
};
const avs = (ks, s = 26, max = 4) => `<span class="avs" style="--s:${s}px">${ks.slice(0, max).map((k) => av(k, s)).join('')}${ks.length > max ? `<span class="av av-more" style="--s:${s}px">+${ks.length - max}</span>` : ''}</span>`;
const NOTE_LABEL = { full: 'Notes + transcript', notes: 'Notes only', off: 'No notes', ask: 'Ask at start' };

const CALL_SCRIPT = [
  [1, 'Okay. Harbor\u2019s legal team signed the data agreement last night.'],
  [2, 'Great, so the only open question is where the pilot data lives.'],
  [0, 'It stays in their region. The notes service runs in their own cloud account.'],
  [3, 'Do their people need to install anything?'],
  [1, 'No. They join from a link, same as we do.'],
  [0, 'Let me share the timeline so we can lock dates.', 'share'],
  [2, 'Let\u2019s lock the kickoff for November tenth.'],
  [0, 'Agreed. I\u2019ll send the invite today.', 'act0'],
  [3, 'I\u2019ll draft the go/no-go criteria before the data review.', 'act1'],
  [1, 'We should also ask them who owns the notes after the pilot.'],
  [2, 'I\u2019ll add that to the agreement as a question.', 'act2']
];
const SCREEN_LINES = [
  'Pilot timeline \u2014 Kickoff Nov 10 \u00b7 Data review Nov 24 \u00b7 Go/no-go Dec 8',
  'Owners column \u2014 Maya: kickoff \u00b7 Jon: criteria \u00b7 Priya: agreement'
];
const LIVE_ITEMS = {
  share: ['dec', 'Pilot data stays in Harbor\u2019s region'],
  act0: ['act', 'Maya \u2014 send the kickoff invite'],
  act1: ['act', 'Jon \u2014 draft go/no-go criteria'],
  act2: ['act', 'Priya \u2014 add data ownership question']
};
const ROOM_SCRIPT = [
  [2, 'Let\u2019s start with runway. That\u2019s the first thing they\u2019ll ask.'],
  [1, 'Eighteen months at current burn.'],
  [2, 'Say exactly that, then go straight to hiring.'],
  [1, 'We hold at four roles until the pilot results are in.'],
  [2, 'Good. Move runway up to slide two.'],
  [1, 'I\u2019ll add the Harbor timeline after the product section.'],
  [2, 'I\u2019ll open, you take product and the pilot.'],
  [2, 'I\u2019ll send the final deck Thursday morning.']
];

const DOCS = {
  call: {
    kind: 'call', date: 'Mon, Nov 2 \u00b7 09:00', dur: '32 min', people: ['MC', 'BO', 'PR', 'JW'],
    summary: 'Harbor\u2019s legal team signed the data agreement, which clears the way for the pilot. Pilot data stays in Harbor\u2019s region, with the notes service running in Harbor\u2019s own cloud account. Harbor staff join from a link and install nothing. Kickoff is November 10, the data review November 24 and the go/no-go December 8.',
    decisions: ['Kickoff is November 10.', 'Pilot data stays in Harbor\u2019s region.', 'Harbor staff join by link. Nothing to install.'],
    actions: [['MC', 'Send the kickoff invite', 'Today'], ['JW', 'Draft the go/no-go criteria', 'Nov 21'], ['PR', 'Add the data ownership question to the agreement', 'Nov 6'], ['BO', 'Confirm cloud account access with Harbor IT', 'Nov 6']],
    chapters: [['00:08', 'Data agreement', 'Legal signed it last night.'], ['04:12', 'Where the data lives', 'Harbor\u2019s region, Harbor\u2019s cloud account.'], ['11:30', 'Pilot timeline', 'Shared on screen. Three dates agreed.'], ['19:20', 'Owners and next steps', 'Four action items, one open question.']],
    screen: { at: '11:30', by: 'Maya', title: 'Pilot timeline', text: 'Kickoff Nov 10 \u00b7 Data review Nov 24 \u00b7 Go/no-go Dec 8. Owners: Maya (kickoff), Jon (criteria), Priya (agreement).' },
    transcript: [['00:08', 'BO', 'Okay. Harbor\u2019s legal team signed the data agreement last night.'], ['00:15', 'PR', 'Great, so the only open question is where the pilot data lives.'], ['04:12', 'MC', 'It stays in their region. The notes service runs in their own cloud account.'], ['05:50', 'JW', 'Do their people need to install anything?'], ['06:05', 'BO', 'No. They join from a link, same as we do.'], ['11:30', 'MC', 'Let me share the timeline so we can lock dates.'], ['11:42', 'MC', 'Kickoff on the tenth, data review on the twenty-fourth, go/no-go on December eighth.'], ['12:10', 'PR', 'Let\u2019s lock the kickoff for November tenth.'], ['12:16', 'MC', 'Agreed. I\u2019ll send the invite today.'], ['19:20', 'JW', 'I\u2019ll draft the go/no-go criteria before the data review.'], ['21:40', 'BO', 'We should also ask them who owns the notes after the pilot.'], ['22:02', 'PR', 'I\u2019ll add that to the agreement as a question.'], ['23:15', 'BO', 'And I\u2019ll confirm cloud access with their IT this week.']],
    qa: [['When is the go/no-go?', 'December 8. It was on the pilot timeline Maya shared {11:42}, and Jon is drafting the criteria before the data review on November 24 {19:20}.'], ['Does Harbor need to install anything?', 'No. Ben said Harbor staff join from a link, the same way the team does {06:05}.'], ['Who owns the notes after the pilot?', 'Still open. Ben raised it {21:40} and Priya is adding it to the agreement as a question {22:02}.']]
  },
  solo: {
    kind: 'solo', title: 'Board prep with Dana', date: 'Sun, Nov 1 \u00b7 16:05', dur: '28 min', people: ['MC'],
    summary: 'A run-through of Thursday\u2019s board update. Lead with runway: eighteen months at current burn. Hiring holds at four roles until the Harbor pilot results are in. Dana opens; Maya covers product and the pilot.',
    decisions: ['Lead with runway: 18 months at current burn.', 'Hiring holds at four roles until pilot results.'],
    actions: [['MC', 'Move runway to slide 2', 'Wed'], ['MC', 'Add the Harbor timeline after product', 'Wed'], ['DA', 'Send the final deck to the board', 'Thu 9:00']],
    chapters: [['00:04', 'Runway', 'Open with the number.'], ['03:40', 'Hiring', 'Four roles until the pilot reads out.'], ['09:18', 'Product and pilot', 'Timeline goes after product.'], ['14:30', 'Who presents what', 'Dana opens, Maya follows.']],
    screen: null,
    transcript: [['00:04', 'S2', 'Let\u2019s start with runway. That\u2019s the first thing they\u2019ll ask.'], ['00:11', 'S1', 'Eighteen months at current burn.'], ['00:15', 'S2', 'Say exactly that, then go straight to hiring.'], ['03:40', 'S1', 'We hold at four roles until the pilot results are in.'], ['03:52', 'S2', 'Good. Move runway up to slide two.'], ['09:18', 'S1', 'I\u2019ll add the Harbor timeline after the product section.'], ['14:30', 'S2', 'I\u2019ll open, you take product and the pilot.'], ['26:02', 'S2', 'I\u2019ll send the final deck Thursday morning.']],
    qa: [['What\u2019s our runway?', 'Eighteen months at current burn {00:11}.'], ['What changes on the slides?', 'Runway moves to slide two {03:52}, and the Harbor timeline goes after the product section {09:18}.'], ['Who opens the meeting?', 'Dana opens, then you take product and the pilot {14:30}.']]
  }
};

/* ---------- state ---------- */
const S = {
  screen: 'welcome',
  dark: document.documentElement.classList.contains('dark'),
  name: 'Maya Chen', pk: 'idle', notesDefault: 'ask', keep: 'full',
  credits: 8500, code: '', menu: false, dialog: null, map: false, copied: false,
  acct: null, oauth: null, cal: { google: true, outlook: false, icloud: false },
  events: [
    { id: 'e1', t: '10:30', end: '11:00', d: 'in 12 min', title: 'Weekly product sync', who: ['BO', 'PR', 'JW'], notes: 'full', host: 'Ben', now: true,
      guests: [['BO', 'yes'], ['PR', 'yes'], ['JW', 'yes']] },
    { id: 'e2', t: '13:00', end: '13:45', d: '45 min', title: '1:1 with Jon', who: ['JW'], notes: 'off', host: 'you', guests: [['JW', 'yes']] },
    { id: 'e3', t: '16:00', end: '16:30', d: '30 min', title: 'Design crit', who: ['PR', 'AK', 'LS'], notes: 'ask', host: 'you', guests: [['PR', 'yes'], ['AK', 'pending'], ['LS', 'no']] }
  ],
  later: [
    { id: 'e4', day: 'Tomorrow', date: 'Tue, Nov 3', t: '09:30', end: '10:00', title: 'Harbor kickoff prep', who: ['BO', 'PR'], notes: 'full', host: 'you', guests: [['BO', 'yes'], ['PR', 'yes'], ['dana@northwind.vc', 'pending']] },
    { id: 'e5', day: 'Thursday', date: 'Thu, Nov 5', t: '14:00', end: '15:00', title: 'Board update', who: ['BO'], notes: 'notes', host: 'you', guests: [['dana@northwind.vc', 'yes'], ['r.ito@lumen.capital', 'yes'], ['k.osei@fieldstone.com', 'pending'], ['BO', 'yes']] },
    { id: 'e6', day: 'Friday', date: 'Fri, Nov 6', t: '11:00', end: '11:45', title: 'Interview: Sam Lee', who: ['LS'], notes: 'off', host: 'you', guests: [['sam.lee@fastmail.com', 'yes'], ['LS', 'yes']] }
  ],
  past: [
    { k: 'call', keep: 'full', title: 'Harbor pilot review', when: 'Today \u00b7 09:00', dur: '32 min', who: ['BO', 'PR', 'JW'], p: 'Legal signed the data agreement. Kickoff set for November 10.', acts: 4 },
    { k: 'solo', keep: 'full', title: 'Board prep with Dana', when: 'Sun, Nov 1 \u00b7 16:05', dur: '28 min', who: ['MC'], p: 'Lead with runway. Hiring holds at four roles until the pilot reads out.', acts: 3 },
    { k: null, keep: 'off', title: 'Design crit', when: 'Fri, Oct 30 \u00b7 16:00', dur: '41 min', who: ['PR', 'AK', 'LS'], p: '', acts: 0 },
    { k: 'call', keep: 'notes', title: 'Harbor legal sync', when: 'Thu, Oct 29 \u00b7 11:00', dur: '25 min', who: ['BO', 'PR'], p: 'Agreement language settled. Transcript deleted after notes.', acts: 2 }
  ],
  fresh: false, firstCall: false, pk2: false,
  mt: { view: 'upcoming', sel: 'e3', confirm: false }, lib: { f: 'all', q: '' },
  chatDraft: '', topup: 1,
  usage: [['Harbor pilot review', 'Today \u00b7 32 min of notes', -800], ['Board prep with Dana', 'Sun \u00b7 28 min in the room', -700], ['Welcome credits', 'Nov 1', 10000]],
  sched: { edit: null, title: '', day: 1, time: '10:30', dur: 30, guests: ['ben@harbor.health'], gdraft: '', notes: 'full', who: 'everyone' },
  link: { code: 'kpw-rnzq-hte', notes: 'ask' },
  pj: { mode: 'host', title: 'Maya\u2019s call', host: 'you', notes: null, who: 'everyone', mic: true, cam: true, gname: '', wait: false },
  call: null,
  rec: null,
  end: null,
  doc: { kind: 'call', title: 'Harbor pilot review', keep: 'full', done: {}, q: '' }
};
const first = () => (S.name.trim().split(/\s+/)[0] || 'there');

const DEMO = JSON.stringify({ events: S.events, later: S.later, past: S.past, usage: S.usage, credits: S.credits });
function setFresh(on) {
  if (on) { Object.assign(S, { fresh: true, events: [], later: [], past: [], usage: [['Welcome credits', 'Today', 10000]], credits: 10000, firstCall: false, hdone: {} }); }
  else { Object.assign(S, JSON.parse(DEMO), { fresh: false, firstCall: true }); }
  S.mt.sel = (S.events[0] || S.later[0] || {}).id;
}
/* ---------- timers + rendering ---------- */
const T = [];
const every = (f, ms) => T.push(setInterval(f, ms));
const after = (f, ms) => T.push(setTimeout(f, ms));
const clearTimers = () => { T.forEach((id) => { clearInterval(id); clearTimeout(id); }); T.length = 0; };

let SC = {};
let vtPrev = null;
function render() {
  let ran = false;
  const run = () => { if (ran) return; ran = true; renderNow(); };
  const shellToShell = vtPrev && $('.shell') && ['home', 'meetings', 'library', 'account', 'notes'].includes(S.screen);
  vtPrev = S.screen;
  if (document.startViewTransition && !RM && $('#app').innerHTML) {
    document.documentElement.classList.toggle('vt-shell', !!shellToShell);
    try { document.startViewTransition(run); setTimeout(run, 300); return; } catch (e) { /* fall through */ }
  }
  run();
}
function renderNow() {
  clearTimers();
  const sc = SC[S.screen];
  $('#app').innerHTML = sc.view();
  renderLayer(true);
  renderMap();
  window.scrollTo(0, 0);
  try { history.replaceState(null, '', '#' + S.screen); } catch (e) { /* sandboxed */ }
  if (sc.mount) sc.mount();
}
function up(...names) {
  const parts = SC[S.screen].parts || {};
  names.forEach((n) => { const el = $(`[data-r="${n}"]`); if (el && parts[n]) el.outerHTML = parts[n](); });
}
function go(s) { S.menu = false; renderMenu(); S.dialog = null; S.screen = s; render(); }
let lastLayer = '';
function renderLayer(force) {
  const l = $('#layer');
  const same = !force && S.dialog && lastLayer === S.dialog;
  l.classList.toggle('still', !!same);
  lastLayer = S.dialog || '';
  l.innerHTML = S.dialog ? DLG[S.dialog]() : '';
}
function toast(msg, icon = 'check') {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = ic(icon) + `<span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2600);
}
function applyTheme() {
  document.documentElement.classList.toggle('dark', S.dark);
  try { localStorage.setItem('alcove-theme', S.dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
  $$('[data-themeic]').forEach((b) => { b.innerHTML = ic(S.dark ? 'sun' : 'moon'); b.setAttribute('aria-label', S.dark ? 'Use light theme' : 'Use dark theme'); });
}
const themeBtn = (cls = 'iconbtn') => `<button class="${cls}" data-a="theme" data-themeic aria-label="${S.dark ? 'Use light theme' : 'Use dark theme'}">${ic(S.dark ? 'sun' : 'moon')}</button>`;
const seg = (k, opts, cur, upd = '') => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button role="radio" aria-checked="${String(v) === String(cur)}" class="${String(v) === String(cur) ? 'on' : ''}" data-a="set" data-k="${k}" data-v="${v}" ${upd ? `data-up="${upd}"` : ''}>${l}</button>`).join('')}</div>`;
function setPath(k, v) {
  const ks = k.split('.'); let o = S;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  const old = o[ks[ks.length - 1]];
  o[ks[ks.length - 1]] = typeof old === 'number' ? Number(v) : v;
}
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------- shared bits ---------- */
const NAV = [['home', 'Home', 'grid'], ['meetings', 'Meetings', 'cal'], ['library', 'Notes', 'notes']];
const shell = (body, cls = '') => `<div class="shell">
  <aside class="sb">
    <button class="sb-logo" data-a="go" data-v="home" aria-label="Alcove home">${logo(24)}</button>
    <button class="btn btn-pri btn-block sb-new" data-a="menu">${ic('plus')} New call</button>
    <nav class="sb-nav" aria-label="Main">${NAV.map(([k, l, i]) => {
      const on = S.screen === k || (k === 'library' && S.screen === 'notes');
      const n = k === 'meetings' ? S.events.length + S.later.length : 0;
      return `<button class="${on ? 'on' : ''}" data-a="go" data-v="${k}" ${on ? 'aria-current="page"' : ''}>${on ? '<span class="pill"></span>' : ''}${ic(i)}<span>${l}</span>${n ? `<em>${n}</em>` : ''}</button>`;
    }).join('')}
      <button data-a="mapgo" data-v="recorder">${ic('room')}<span>Record in the room</span></button></nav>
    <div class="sp"></div>
    <button class="sb-credits ${S.screen === 'account' ? 'on' : ''}" data-a="go" data-v="account">
      <span class="row"><span>Credits</span><b class="mono" data-credits>${S.credits.toLocaleString('en-US')}</b></span>
      <span class="cc-bar"><i style="width:${Math.min(100, S.credits / 100)}%"></i></span>
      <span class="small">About ${(S.credits / 1500).toFixed(1).replace('.0', '')} hours of notes</span>
    </button>
    <div class="sb-me">${av('MC', 34)}<span><b>${esc(S.name)}</b><span>${esc(S.acct ? S.acct.email : 'maya.chen@gmail.com')}</span></span>${themeBtn()}</div>
  </aside>
  <main class="main ${cls}">${body}</main>
</div>`;
function initials(n) { const p = n.trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
/* A camera tile: a softly lit room behind the person, who breathes a little. */
const camView = (k) => {
  const p = PEOPLE[k] || PEOPLE.MC; const c = p.room || ['#9C8A78', '#3A322B', '#D8C7B4'];
  return `<div class="cam" style="background:linear-gradient(170deg, ${c[1]}, #0F0C0A 92%)">
    <i class="b" style="background:${c[2]};width:46%;height:60%;right:-4%;top:-10%;--dx:-6%;--dy:5%"></i>
    <i class="b" style="background:${c[0]};width:60%;height:56%;left:-14%;top:10%;--dx:7%;--dy:-4%;animation-delay:-4s"></i>
    <span class="shelf"></span>
    <svg class="person" viewBox="8 6 48 58" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${portrait(p, false)}</svg>
  </div>`;
};
/* ---------- onboarding ---------- */
const obTop = () => `<div class="ob-top">${logo(22)}<span class="small muted">${S.acct ? `${ic('check')} ${S.acct.email}` : ''}</span>${themeBtn()}</div>`;

SC.welcome = {
  parts: { sibtns: () => SC.signin.parts.sibtns() },
  view: () => `<div class="screen ob-dark">
    <div class="ob-hero">
      <div class="hero-mark">${mark(120, 'big')}</div>
      <div class="wm hero-wm">alcove</div>
      <p>Private video calls, with notes only the people in the call can read.</p>
      ${SC.signin.parts.sibtns()}
      <button class="tlink dim" data-a="mapgo" data-v="m-guest">Joining from a link? You don’t need an account.</button>
    </div>
    <div class="ob-fine">${ic('lock')} Calls are end-to-end encrypted. Notes are written inside a sealed server Alcove can’t read.</div>
  </div>`
};
const PROV = {
  google: ['Google', 'G', 'maya.chen@gmail.com'],
  microsoft: ['Microsoft', 'M', 'maya.chen@outlook.com'],
  apple: ['Apple', 'A', 'maya.chen@icloud.com']
};
SC.signin = {
  parts: {
    sibtns: () => `<div class="si-btns ${S.screen === 'welcome' ? 'dark' : ''}" data-r="sibtns">${Object.keys(PROV).map((k) => {
      const [n, g] = PROV[k]; const busy = S.oauth === k;
      return `<button class="btn btn-sec btn-lg btn-block prov ${busy ? 'busy' : ''}" data-a="oauth" data-v="${k}" ${S.oauth ? 'disabled' : ''}><span class="pg pg-${k}">${g}</span>${busy ? `<span class="spin"></span> Waiting for ${n}…` : `Continue with ${n}`}</button>`;
    }).join('')}</div>`
  }
};
SC.calendar = {
  parts: {
    calrows: () => `<div class="calrows" data-r="calrows">${[['google', 'Google Calendar', 'G'], ['outlook', 'Outlook', 'M'], ['icloud', 'iCloud Calendar', 'A']].map(([k, n, g]) => `<div class="calrow">
      <span class="pg pg-${k === 'outlook' ? 'microsoft' : k === 'icloud' ? 'apple' : 'google'}">${g}</span>
      <span><b>${n}</b><span>${S.cal[k] ? (S.acct && ((k === 'google' && S.acct.provider === 'Google') || (k === 'outlook' && S.acct.provider === 'Microsoft') || (k === 'icloud' && S.acct.provider === 'Apple')) ? 'Connected when you signed in' : 'Connected') : 'Not connected'}</span></span>
      <button class="switch ${S.cal[k] ? 'on' : ''}" role="switch" aria-checked="${S.cal[k]}" aria-label="${n}" data-a="caltog" data-v="${k}"><i></i></button></div>`).join('')}</div>`
  }
};
function invitePreview(e) {
  const from = S.acct ? S.acct.email : 'maya.chen@gmail.com';
  const nl = e.notes === 'off' ? 'This call won’t take notes.' : e.notes === 'ask' ? 'The host decides on notes when the call starts. You’ll see it before you join.' : `This call takes ${e.notes === 'full' ? 'notes and a transcript' : 'notes (no transcript is kept)'}. Everyone in the call gets a copy.`;
  return `<div class="email">
    <div class="em-h">${av('MC', 34)}<div><b>${esc(S.name)}</b><span>${esc(from)}</span></div><span class="em-t">Invitation</span></div>
    <div class="em-b">
      <b class="em-title">${esc(e.title)}</b>
      <span class="em-when">${e.date} · ${e.t} – ${e.end}</span>
      <span class="em-join">${ic('cam')} Join with Alcove</span>
      <span class="mono em-link">alcove.app/${S.link.code}</span>
      <div class="em-note">${ic('notes')}<span>${nl}</span></div>
      <div class="em-rsvp"><span>Going?</span><i>Yes</i><i>Maybe</i><i>No</i></div>
    </div></div>`;
}

SC.passkey = {
  view: () => `<div class="screen ob">${obTop()}
    <div class="ob-body"><div class="ob-split">
      <div class="ob-copy st">
        ${S.acct ? `<span class="chip ok">${ic('check')} Signed in as ${S.acct.email}</span>` : ''}
        <h1>Now lock your notes<br>with a passkey.</h1>
        <p>${S.acct ? S.acct.provider : 'Your account'} signs you in and sends your invites. The passkey is different: it\u2019s the only key to your notes, and it never leaves this device.</p>
        <div class="field"><label for="nm">Your name</label><input id="nm" class="input input-lg" data-in="name" value="${esc(S.name)}" autocomplete="name"></div>
        <div data-r="pkbtn">${SC.passkey.parts.pkbtn()}</div>
      </div>
      <div class="passkey ${S.pk === 'done' ? 'scan done' : ''}" data-pk>
        <div class="fp">${ic('fp')}<svg class="ring" viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="85"/></svg></div>
        <div class="pk-name" data-pkname>${esc(S.name || 'Your name')}</div>
        <span class="cap" data-cap>${S.pk === 'done' ? 'Passkey saved on this Mac' : 'Touch ID, Face ID or a security key'}</span>
      </div>
    </div></div></div>`,
  parts: {
    pkbtn: () => `<div class="pk-acts" data-r="pkbtn">${S.pk === 'done'
      ? `<button class="btn btn-pri btn-lg" data-a="arrive">Open Alcove ${ic('right')}</button><span class="chip ok">${ic('check')} Passkey created</span>`
      : `<button class="btn btn-pri btn-lg" data-a="passkey" ${S.pk === 'scan' ? 'disabled' : ''}>${ic('fp')} ${S.pk === 'scan' ? 'Waiting for your device\u2026' : 'Create passkey'}</button>`}</div>`
  }
};

/* ---------- new call menu (floats above everything) ---------- */
function renderMenu() {
  let mc = document.getElementById('menuc');
  if (!mc) { mc = document.createElement('div'); mc.id = 'menuc'; document.body.appendChild(mc); }
  mc.innerHTML = S.menu ? `<div class="menu" role="menu" style="left:${S.menu.x}px;top:${S.menu.y}px">
    <button role="menuitem" data-a="instant"><span class="mi">${ic('cam')}</span><span><b>Start a call now</b><span class="d">Opens full screen with a link to share</span></span><span class="kbd">N</span></button>
    <button role="menuitem" data-a="dialog" data-v="link"><span class="mi">${ic('link')}</span><span><b>Get a link to share</b><span class="d">For now or for later</span></span></button>
    <button role="menuitem" data-a="dialog" data-v="sched"><span class="mi">${ic('cal')}</span><span><b>Schedule for later</b><span class="d">Invites go out from your calendar</span></span></button>
  </div>` : '';
}
/* ---------- home ---------- */
const notesChip = (m) => m === 'off' ? `<span class="nc off">${ic('x')}No notes</span>` : m === 'ask' ? `<span class="nc">${ic('notes')}Ask at start</span>` : `<span class="nc on">${ic('notes')}${NOTE_LABEL[m]}</span>`;
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

const joinbox = () => `<label class="joinbox">${ic('kbd')}<input placeholder="Enter a code or link" data-in="code" value="${esc(S.code)}" aria-label="Call code or link"><button class="btn btn-sm ${S.code ? 'btn-pri' : 'btn-ghost'}" data-a="join" data-joinbtn>Join</button></label>`;
const WEEK = [
  ['Mon', 2, [['09:00', 32, 'Harbor pilot review', 1], ['10:30', 30, 'Weekly product sync', 1], ['13:00', 45, '1:1 with Jon', 0], ['16:00', 30, 'Design crit', 1]]],
  ['Tue', 3, [['09:30', 30, 'Harbor kickoff prep', 1]]],
  ['Wed', 4, []],
  ['Thu', 5, [['14:00', 60, 'Board update', 1]]],
  ['Fri', 6, [['11:00', 45, 'Interview: Sam Lee', 0]]]
];
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const weekWidget = () => {
  const d0 = 8 * 60, span = 10 * 60; let n = 0;
  return `<div class="wk">${WEEK.map(([d, num, evs], di) => `<div class="wk-day ${di === 0 ? 'today' : ''}">
    <span class="wk-h"><b>${d}</b><span>${num}</span></span>
    <div class="wk-col">${di === 0 ? `<i class="wk-now" style="top:${((10 * 60 + 18 - d0) / span * 100).toFixed(1)}%"></i>` : ''}
      ${evs.map(([t, len, title, notes]) => `<span class="wk-ev ${notes ? 'n' : ''} ${di === 0 && toMin(t) < 10 * 60 + 18 ? 'past' : ''}" style="top:${((toMin(t) - d0) / span * 100).toFixed(1)}%;height:${(len / span * 100).toFixed(1)}%;animation-delay:${(0.25 + (n++) * 0.06).toFixed(2)}s" title="${t} ${title}"></span>`).join('')}
    </div></div>`).join('')}</div>`;
};
const MINIS = {
  call: `<div class="ill ill-call"><i></i><i></i><i></i><i></i><span class="ill-bar"><b></b><b></b><b class="r"></b></span></div>`,
  sched: `<div class="ill ill-sched"><span class="ill-inv"><b></b><i></i><i class="s"></i><em></em></span><span class="ill-inv b2"><b></b><i></i><i class="s"></i></span></div>`,
  room: `<div class="ill ill-room">${'<i></i>'.repeat(18)}</div>`
};
const startTiles = () => `<div class="starts">
  <button class="start" data-a="instant">${MINIS.call}<b>Start a call now</b><span>Opens full screen with a link to share</span></button>
  <button class="start" data-a="dialog" data-v="sched">${MINIS.sched}<b>Schedule a call</b><span>Invites go out from your calendar</span></button>
  <button class="start" data-a="mapgo" data-v="recorder">${MINIS.room}<b>Record in the room</b><span>Notes from a conversation around you</span></button>
</div>`;
const emptyArt = {
  today: `<div class="ea ea-cal"><span class="ea-card">${'<i></i>'.repeat(5)}</span></div>`,
  notes: `<div class="ea ea-notes"><span></span><span></span><span><b></b><i></i><i></i><i class="s"></i></span></div>`
};
const setupSteps = () => [
  [true, `Signed in with ${S.acct ? S.acct.provider : 'Google'}`, ''],
  [true, 'Passkey saved on this Mac', ''],
  [!!(S.acct && S.acct.provider !== 'email') || S.cal.google, `${S.acct && S.acct.provider === 'Microsoft' ? 'Outlook' : S.acct && S.acct.provider === 'Apple' ? 'iCloud' : 'Google'} Calendar connected`, ''],
  [S.firstCall, 'Have your first call', 'instant'],
  [S.pk2, 'Add a passkey on a second device', 'addpk']
];

SC.home = {
  view: () => S.fresh ? SC.home.fresh() : SC.home.full(),
  fresh: () => {
    const st = setupSteps(); const done = st.filter((x) => x[0]).length;
    return shell(`<header class="hh st"><div><span class="today">Monday, November 2</span><h1>Welcome to Alcove, ${esc(first())}.</h1></div><div class="hh-acts">${joinbox()}</div></header>
    <div class="bento">
      <section class="w w-gift span7"><div class="gift-glow"></div>
        <span class="chip lit">${ic('check')} Added to your account</span>
        <div class="gift-num mono" data-count="10000">0</div>
        <p><b>free credits.</b> That’s about 6½ hours of notes. Calls themselves are always free, with or without notes.</p>
      </section>
      <section class="w w-setup span5">
        <div class="w-h"><h3>Getting set up</h3><span class="ring" style="--p:${done / st.length}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="v" cx="18" cy="18" r="15"/></svg><b>${done}/${st.length}</b></span></div>
        ${st.map(([ok, t, act]) => `<div class="step ${ok ? 'done' : ''}"><span class="ck">${ic('check')}</span><span>${t}</span>${!ok && act ? `<button class="btn btn-sec btn-sm" data-a="${act}">${act === 'instant' ? 'Start' : 'Add'}</button>` : ''}</div>`).join('')}
      </section>
      <section class="w span12 w-plain"><div class="w-h"><h3>Start here</h3></div>${startTiles()}</section>
      ${(() => { const up2 = allMeetings(); return up2.length ? `<section class="w span6"><div class="w-h"><h3>Coming up</h3><button class="btn btn-ghost btn-sm" data-a="go" data-v="meetings">Meetings ${ic('right')}</button></div>${up2.map((e) => `<button class="lt fresh-in" data-a="msel-go" data-v="${e.id}"><span class="mono">${e.t}</span><span><b>${esc(e.title)}</b><span class="small muted">${e.day} \u00b7 ${e.guests.length} invited</span></span>${notesChip(e.notes)}</button>`).join('')}</section>`
        : `<section class="w w-empty span6">${emptyArt.today}<b>Nothing scheduled yet</b><p>Calls you schedule, and calls you\u2019re invited to from your calendar, show up here.</p><button class="btn btn-sec btn-sm" data-a="dialog" data-v="sched">${ic('cal')} Schedule a call</button></section>`; })()}
      ${(() => { const ns = S.past.filter((m) => m.k); return ns.length ? `<section class="w span6"><div class="w-h"><h3>Your notes</h3><button class="btn btn-ghost btn-sm" data-a="go" data-v="library">All notes ${ic('right')}</button></div>${ns.slice(0, 2).map((m) => `<button class="rn-card fresh-in" data-a="openpast" data-v="${S.past.indexOf(m)}"><span class="lc-top"><span class="chip">${ic(m.k === 'solo' ? 'room' : 'cam')}${m.k === 'solo' ? 'In the room' : 'Call'}</span><span class="small muted">${m.when}</span></span><b>${esc(m.title)}</b><p>${m.p}</p></button>`).join('')}</section>`
        : `<section class="w w-empty span6">${emptyArt.notes}<b>No notes yet</b><p>After a call with notes on, the summary, decisions and action items appear here. Only people in the call can read them.</p><button class="btn btn-sec btn-sm" data-a="instant">${ic('cam')} Start a call</button></section>`; })()}
    </div>`);
  },
  full: () => {
    const next = S.events.find((e) => e.now) || S.events[0];
    const later = S.events.filter((e) => e !== next);
    const notes = S.past.filter((x) => x.k);
    return shell(`<header class="hh st"><div><span class="today">Monday, November 2</span><h1>${greet()}, ${esc(first())}.</h1></div>
      <div class="hh-acts"><button class="btn btn-pri btn-lg" data-a="menu">${ic('plus')} New call</button>${joinbox()}</div></header>
    <div class="bento">
      ${next ? `<section class="w w-next span7">
        <div class="wn-glow"></div>
        <div class="wn-top"><span class="chip">${next.now ? 'Up next' : 'Today'}</span><span class="wn-cd"><span class="mono" data-countdown>${next.now ? '11:42' : next.t}</span>${next.now ? '<small>until it starts</small>' : ''}</span></div>
        <h2>${esc(next.title)}</h2>
        <p class="wn-when">${next.t} – ${next.end} · ${next.host === 'you' ? 'You’re hosting' : 'Hosted by Ben Ortiz'}</p>
        <div class="wn-who">${avs(next.who, 34)}<span>${next.guests.filter((g) => g[1] === 'yes').length} going</span></div>
        <div class="wn-foot">${notesChip(next.notes)}<div class="sp"></div><button class="btn wn-copy" data-a="copy">${ic('link')} Copy link</button><button class="btn btn-lg wn-join" data-a="mstart" data-v="${next.id}">${ic('cam')} Join</button></div>
      </section>` : `<section class="w w-empty span7">${emptyArt.today}<b>Nothing else today</b><p>Your calendar is clear.</p></section>`}
      <section class="w w-week span5"><div class="w-h"><h3>This week</h3><button class="btn btn-ghost btn-sm" data-a="go" data-v="meetings">${S.events.length + S.later.length + 1} calls ${ic('right')}</button></div>${weekWidget()}
        <div class="wk-key"><span><i class="n"></i>Notes on</span><span><i></i>No notes</span></div></section>
      <section class="w span4"><div class="w-h"><h3>Later today</h3></div>
        ${later.length ? later.map((e) => `<button class="lt" data-a="msel-go" data-v="${e.id}"><span class="mono">${e.t}</span><span><b>${esc(e.title)}</b>${notesChip(e.notes)}</span>${avs(e.who, 22, 3)}</button>`).join('') : '<p class="muted small">Nothing else today.</p>'}</section>
      <section class="w span4 mytodos"><div class="w-h"><h3>Your action items</h3><span class="small muted">${3 - Object.values(S.hdone || {}).filter(Boolean).length} open</span></div>
        ${[['Send the kickoff invite', 'Harbor pilot review', 'Today', 0], ['Move runway to slide 2', 'Board prep with Dana', 'Wed', 1], ['Add the Harbor timeline after product', 'Board prep', 'Wed', 1]].map(([t, f, due, pi], i) => `<div class="todo ${S.hdone && S.hdone[i] ? 'done' : ''}"><button class="cbx" data-a="hometodo" data-v="${i}" aria-label="Mark done">${ic('check')}</button><span class="tx">${t}<button class="from" data-a="openpast" data-v="${pi}">${f}</button></span><span class="own">${due}</span></div>`).join('')}</section>
      <section class="w span4 w-stats"><div class="w-h"><h3>Time in calls</h3><span class="small muted">Last 7 days</span></div>
        <div class="st-big"><span class="mono" data-count="263" data-fmt="hm">0h 0m</span></div>
        <div class="bars">${[['T', 55], ['W', 82], ['T', 25], ['F', 41], ['S', 0], ['S', 28], ['M', 32]].map(([d, v], i) => `<span class="${i === 6 ? 'today' : ''}"><i style="height:${Math.max(4, v / 82 * 100)}%;animation-delay:${(.3 + i * .05).toFixed(2)}s" title="${v} min"></i><em>${d}</em></span>`).join('')}</div>
        <div class="st-row"><span><b>${notes.length}</b> notes</span><span><b>9</b> action items</span><span><b>1</b> in the room</span></div></section>
      <section class="w span12 w-plain"><div class="w-h"><h3>Recent notes</h3><button class="btn btn-ghost btn-sm" data-a="go" data-v="library">All notes ${ic('right')}</button></div>
        <div class="rn">${notes.slice(0, 3).map((m) => `<button class="rn-card" data-a="openpast" data-v="${S.past.indexOf(m)}">
          <span class="lc-top"><span class="chip">${ic(m.k === 'solo' ? 'room' : 'cam')}${m.k === 'solo' ? 'In the room' : 'Call'}</span><span class="small muted">${m.when}</span></span>
          <b>${m.title}</b><p>${m.p}</p><span class="lc-foot">${avs(m.who, 24)}<span>${m.acts} action items</span><span class="sp"></span><span class="small muted">${m.dur}</span></span></button>`).join('')}</div></section>
    </div>`);
  },
  mount: () => { countUps(); if (!S.fresh) startCountdown(); }
};
function countUps() {
  $$('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count); const hm = el.dataset.fmt === 'hm';
    const f = (v) => hm ? `${Math.floor(v / 60)}h ${Math.round(v % 60)}m` : Math.round(v).toLocaleString('en-US');
    if (RM) { el.textContent = f(end); return; }
    const t0 = performance.now(); const d = 1400;
    const step = (t) => { if (!el.isConnected) return; const k = Math.min(1, (t - t0) / d); el.textContent = f(end * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(step); };
    after(() => requestAnimationFrame(step), 300);
  });
}
function startCountdown() {
  const el = $('[data-countdown]'); if (!el || !/:/.test(el.textContent) || !S.events.some((e) => e.now)) return;
  S.cd = S.cd == null ? 702 : S.cd;
  const draw = () => { el.textContent = S.cd > 0 ? fmt(S.cd) : 'Now'; };
  draw(); every(() => { if (S.cd > 0) S.cd--; draw(); }, 1000);
}

/* ---------- meetings ---------- */
const EMAIL = { BO: 'ben@harbor.health', PR: 'priya@alcove.team', JW: 'jon@alcove.team', AK: 'ama@alcove.team', LS: 'leo@alcove.team', MC: 'maya.chen@gmail.com' };
const DATES = ['Mon, Nov 2', 'Tue, Nov 3', 'Wed, Nov 4', 'Thu, Nov 5', 'Fri, Nov 6'];
const allMeetings = () => S.events.map((e) => Object.assign(e, { day: 'Today', date: DATES[0] })).concat(S.later);
const findM = (id) => allMeetings().find((m) => m.id === id);
const addMins = (t, m) => { const [h, x] = t.split(':').map(Number); const v = h * 60 + x + m; return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const RSVP = { yes: ['ok', 'Going'], pending: ['', 'Invited'], no: ['bad', 'Declined'] };
const guestRow = ([g, st], host) => {
  const p = PEOPLE[g]; const r = RSVP[st];
  return `<div class="grow">${p ? av(g) : `<span class="av" style="background:#8C8276">${g[0].toUpperCase()}</span>`}
    <span><b>${p ? p.n : esc(g)}</b><span>${p ? EMAIL[g] : 'Guest · no account'}</span></span>
    <span class="chip ${r[0]}">${r[1]}</span>${host && st === 'pending' ? `<button class="btn btn-ghost btn-sm" data-a="resend" data-v="${esc(g)}">Resend</button>` : ''}</div>`;
};

SC.meetings = {
  view: () => shell(`<div class="mtg">
      <div class="mtg-h st">
        <h1>Meetings</h1>
        <div class="sp"></div>
        ${seg('mt.view', [['upcoming', 'Upcoming'], ['past', 'Past']], S.mt.view, 'mbody')}
        <button class="btn btn-pri" data-a="dialog" data-v="sched">${ic('plus')} Schedule</button>
      </div>
      ${SC.meetings.parts.mbody()}
    </div>`),
  parts: {
    mbody: () => {
      if (S.mt.view === 'past' && !S.past.length) return `<div class="w w-empty big" data-r="mbody">${emptyArt.notes}<b>No past calls</b><p>Calls you\u2019ve had will be listed here, with their notes if notes were on.</p></div>`;
      if (S.mt.view === 'past') {
        return `<div class="past st" data-r="mbody">${S.past.map((m, i) => `<div class="prow2">
          <span class="when mono">${m.when.replace(' · ', '<br>')}</span>
          <span><b>${m.title}</b><span class="meta">${avs(m.who)}${m.dur}${m.k === 'solo' ? ' · in the room' : ''}</span></span>
          ${m.k ? `<span class="nc on">${ic('notes')}${m.keep === 'full' ? 'Notes + transcript' : 'Notes only'}</span>` : `<span class="nc off">${ic('x')}No notes</span>`}
          ${m.k ? `<button class="btn btn-sec btn-sm" data-a="openpast" data-v="${i}">Open notes</button>` : '<span></span>'}
        </div>`).join('')}</div>`;
      }
      if (!allMeetings().length) return `<div class="w w-empty big" data-r="mbody">${emptyArt.today}<b>No meetings yet</b><p>Schedule a call and the invite goes out from ${esc(S.acct ? S.acct.email : 'your calendar')}. Calls you\u2019re invited to show up here too.</p><div class="row-c"><button class="btn btn-pri" data-a="dialog" data-v="sched">${ic('cal')} Schedule a call</button><button class="btn btn-sec" data-a="instant">${ic('cam')} Start one now</button></div></div>`;
      const groups = {};
      allMeetings().forEach((m) => { (groups[m.day] = groups[m.day] || []).push(m); });
      return `<div class="mtg-b" data-r="mbody">
        <div class="mlist st">${Object.keys(groups).map((d) => `<p class="grp">${d}<span>${groups[d][0].date}</span></p>${groups[d].map((m) => `<button class="mrow ${S.mt.sel === m.id ? 'on' : ''}" data-a="msel" data-v="${m.id}">
          <span class="t mono">${m.t}</span><span><b>${esc(m.title)}</b><span class="meta">${m.host === 'you' ? 'You’re hosting' : 'Hosted by ' + m.host} · ${m.guests.length} ${m.guests.length === 1 ? 'guest' : 'guests'}</span></span>${notesChip(m.notes)}</button>`).join('')}`).join('')}</div>
        ${SC.meetings.parts.mdet()}
      </div>`;
    },
    mdet: () => {
      const m = findM(S.mt.sel) || allMeetings()[0];
      if (!m) return '<section class="mdet" data-r="mdet"><p class="muted">Nothing scheduled.</p></section>';
      const mine = m.host === 'you'; const yes = m.guests.filter((g) => g[1] === 'yes').length;
      return `<section class="mdet" data-r="mdet">
        <div class="md-h">
          <span class="eyebrow">${m.day} · ${m.date}</span>
          <h2>${esc(m.title)}</h2>
          <span class="md-when">${ic('clock')}${m.t} – ${m.end} · ${mine ? 'You’re hosting' : 'Hosted by ' + (m.host === 'Ben' ? 'Ben Ortiz' : m.host)}</span>
          <div class="md-acts">
            ${m.day === 'Today' ? `<button class="btn btn-pri" data-a="mstart" data-v="${m.id}">${ic('cam')} ${mine ? 'Start' : 'Join'}</button>` : ''}
            <button class="btn btn-sec" data-a="copy">${ic('link')} Copy link</button>
            ${mine ? `<button class="btn btn-sec" data-a="medit" data-v="${m.id}">Edit</button><button class="btn btn-ghost danger" data-a="mcancel">Cancel</button>` : ''}
          </div>
          ${S.mt.confirm ? `<div class="confirm">${ic('mail')}<span>Cancel this call for everyone? Guests get an email and it leaves their calendars.</span><button class="btn btn-sec btn-sm" data-a="mkeep">Keep it</button><button class="btn btn-sm btn-bad" data-a="mdel" data-v="${m.id}">Cancel call</button></div>` : ''}
        </div>
        <div class="md-grid">
          <div class="md-box"><h4>Notes</h4>
            ${mine ? `<div class="nopts two-c">${[['ask', 'Ask at start'], ['full', 'Notes + transcript'], ['notes', 'Notes only'], ['off', 'No notes']].map(([v, b]) => `<button class="nopt sm ${m.notes === v ? 'on' : ''}" data-a="mnotes" data-v="${v}"><b>${b}</b></button>`).join('')}</div>
              <span class="small muted">${m.notes === 'off' ? 'Nothing is recorded. You can still start notes from inside the call.' : m.notes === 'ask' ? 'You’ll pick when you join. Guests see your choice.' : `Up to ${(((Number(m.end.split(':')[0]) * 60 + Number(m.end.split(':')[1])) - (Number(m.t.split(':')[0]) * 60 + Number(m.t.split(':')[1]))) * 25).toLocaleString('en-US')} credits. Guests see this before they join.`}</span>`
              : `<div class="notice">${ic('notes')}<div><b>${NOTE_LABEL[m.notes]}</b><span>Set by the host. You’ll get the notes after the call.</span></div></div>`}
          </div>
          <div class="md-box"><h4>Guests <span>${yes} of ${m.guests.length} going</span></h4>${m.guests.map((g) => guestRow(g, mine)).join('')}
            ${mine ? `<button class="btn btn-ghost btn-sm" data-a="medit" data-v="${m.id}">${ic('plus')} Add guests</button>` : ''}</div>
        </div>
        <div class="md-box"><h4>${mine ? 'What guests received' : 'Your invite'}</h4>${invitePreview(m)}</div>
      </section>`;
    }
  }
};

/* ---------- notes library ---------- */
SC.library = {
  view: () => shell(`<div class="lib">
      <div class="lib-h st">
        <h1>Notes</h1>
        <label class="search">${ic('msg', 'muted')}<input data-in="lib.q" placeholder="Search notes and transcripts" value="${esc(S.lib.q)}" aria-label="Search notes"></label>
        ${seg('lib.f', [['all', 'All'], ['call', 'Calls'], ['solo', 'In the room']], S.lib.f, 'grid')}
      </div>
      ${SC.library.parts.grid()}
      <p class="small muted center">${ic('lock')} Search runs inside the sealed server. Alcove can’t see what you search for.</p>
    </div>`),
  parts: {
    grid: () => {
      const q = S.lib.q.trim().toLowerCase();
      const items = S.past.map((m, i) => [m, i]).filter(([m]) => m.k && (S.lib.f === 'all' || m.k === S.lib.f) && (!q || (m.title + ' ' + m.p).toLowerCase().includes(q)));
      if (!S.past.some((m) => m.k)) return `<div class="w w-empty big" data-r="grid">${emptyArt.notes}<b>Your notes will live here</b><p>Turn notes on in a call, or record a conversation in the room. Each one gets a summary, decisions, action items and, if you keep it, the transcript.</p><div class="row-c"><button class="btn btn-pri" data-a="instant">${ic('cam')} Start a call</button><button class="btn btn-sec" data-a="mapgo" data-v="recorder">${ic('room')} Record in the room</button></div></div>`;
      return `<div class="libgrid" data-r="grid">${items.length ? items.map(([m, i], n) => `<button class="libcard ${n === 0 && !q && S.lib.f === 'all' ? 'big' : ''}" data-a="openpast" data-v="${i}">
        <span class="lc-top"><span class="chip">${ic(m.k === 'solo' ? 'room' : 'cam')}${m.k === 'solo' ? 'In the room' : 'Call'}</span><span class="small muted">${m.when}</span></span>
        <b>${m.title}</b><p>${m.p}</p>
        <span class="lc-foot">${avs(m.who)}<span>${m.acts} action items</span><span class="sp"></span><span class="small muted">${m.keep === 'full' ? 'Transcript kept' : 'Notes only'}</span></span>
      </button>`).join('') : `<div class="empty">${ic('notes')}<b>No notes match</b><span>Try another word, or clear the filter.</span></div>`}</div>`;
    }
  }
};

/* ---------- account ---------- */
SC.account = {
  view: () => {
    const a = S.acct || { provider: 'Google', email: 'maya.chen@gmail.com' };
    const hrs = S.credits / 25 / 60;
    return shell(`<div class="acc">
      <h1 class="st">Account</h1>
      <div class="acc-grid st">
        <section class="panel credit-card">
          <span class="small muted">Credits</span>
          <div class="cc-num mono">${S.credits.toLocaleString('en-US')}</div>
          <span class="muted">About ${hrs >= 1 ? hrs.toFixed(1).replace('.0', '') + ' hours' : Math.round(hrs * 60) + ' minutes'} of notes left. Calls are always free.</span>
          <div class="cc-bar"><i style="width:${Math.min(100, S.credits / 100)}%"></i></div>
          <button class="btn btn-pri" data-a="dialog" data-v="topup">${ic('plus')} Add credits</button>
          <div class="usage">${(S.usage || []).map(([t, w, v]) => `<div><span><b>${t}</b><span>${w}</span></span><span class="mono ${v > 0 ? 'pos' : ''}">${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US')}</span></div>`).join('')}</div>
        </section>
        <div class="acc-col">
          <section class="panel"><div class="panel-h"><h3>Profile</h3></div>
            <div class="prof">${av('MC', 56)}<span><b>${esc(S.name)}</b><span>${esc(a.email)} · signed in with ${a.provider}</span></span></div></section>
          <section class="panel"><div class="panel-h"><h3>Calendars</h3><span class="small muted">Invites go out from these</span></div>${SC.calendar.parts.calrows()}</section>
          <section class="panel"><div class="panel-h"><h3>Notes defaults</h3></div>
            <div class="defrow"><span>When a call starts</span>${seg('notesDefault', [['ask', 'Ask me'], ['always', 'Always'], ['never', 'Only when I start']], S.notesDefault, 'x')}</div>
            <div class="defrow"><span>When notes are on, keep</span>${seg('keep', [['full', 'Notes + transcript'], ['notes', 'Notes only']], S.keep, 'x')}</div></section>
          <section class="panel"><div class="panel-h"><h3>Passkeys</h3><button class="btn btn-ghost btn-sm" data-a="addpk">${ic('plus')} Add a device</button></div>
            <div class="grow">${ic('fp')}<span><b>MacBook Pro</b><span>This device · created Nov 2</span></span><span class="chip ok">Active</span></div>
            <p class="small muted">Your notes can only be unlocked with a passkey. Add a second device so you don’t lose access.</p></section>
          <button class="btn btn-ghost" data-a="signout">Sign out</button>
        </div>
      </div>
    </div>`);
  },
  parts: { calrows: () => SC.calendar.parts.calrows() }
};

/* ---------- dialogs ---------- */
const DAYS = ['Today', 'Tomorrow', 'Wed 4', 'Thu 5', 'Fri 6'];
const DLG = {
  link: () => `<div class="scrim" data-a="closebg"><div class="dialog" role="dialog" aria-label="Your call link">
    <div class="dialog-h"><h3>Your call link</h3><button class="iconbtn" data-a="close" aria-label="Close">${ic('x')}</button></div>
    <div class="dialog-b">
      <p class="muted">Send it to anyone you want in the call. It works now or later, until you delete it.</p>
      <div class="linkbox"><span class="mono">alcove.app/<b>${S.link.code}</b><span class="frag">#k=Hq3vT9xW2m</span></span>
        <button class="btn btn-pri btn-sm" data-a="copy">${ic(S.copied ? 'check' : 'copy')} ${S.copied ? 'Copied' : 'Copy'}</button></div>
      <p class="fine">${ic('lock')} The part after # is the call\u2019s key. Browsers never send it to our servers, so only people with the link can see or hear the call.</p>
      <div class="field"><label>Notes for this call</label>${seg('link.notes', [['ask', 'Ask at start'], ['full', 'Notes + transcript'], ['notes', 'Notes only'], ['off', 'Off']], S.link.notes)}</div>
      <div class="row-end"><button class="btn btn-sec" data-a="close">Done</button><button class="btn btn-pri" data-a="linkjoin">Join now</button></div>
    </div></div></div>`,
  sched: () => {
    const s = S.sched;
    const cost = s.notes === 'off' ? 'Calls are free. With notes off, no credits are used.' : `Up to ${(s.dur * 25).toLocaleString('en-US')} credits if notes run the whole call. You have ${S.credits.toLocaleString('en-US')}.`;
    return `<div class="scrim" data-a="closebg"><div class="dialog dialog-w" role="dialog" aria-label="Schedule a call">
    <div class="dialog-h"><h3>${s.edit ? 'Edit call' : 'Schedule a call'}</h3><button class="iconbtn" data-a="close" aria-label="Close">${ic('x')}</button></div>
    <div class="dialog-b">
      <input class="input input-title" placeholder="Call title" data-in="sched.title" value="${esc(s.title)}" aria-label="Call title">
      <div class="field"><label>Day</label>${seg('sched.day', DAYS.map((d, i) => [i, d]), s.day)}</div>
      <div class="two">
        <div class="field"><label for="tm">Start</label><input id="tm" class="input mono" data-in="sched.time" value="${s.time}"></div>
        <div class="field"><label>Length</label>${seg('sched.dur', [[15, '15m'], [30, '30m'], [45, '45m'], [60, '1h']], s.dur)}</div>
      </div>
      <div class="field"><label for="gi">Guests</label>
        <div class="guests">${s.guests.map((g, i) => `<span class="gchip">${esc(g)}<button data-a="rmguest" data-v="${i}" aria-label="Remove ${esc(g)}">${ic('x')}</button></span>`).join('')}
          <input id="gi" data-in="sched.gdraft" placeholder="${s.guests.length ? 'Add another' : 'Email address'}" value="${esc(s.gdraft)}"></div>
        <span class="small muted">Guests don\u2019t need an account. They join from the link in the invite.</span></div>
      <div class="field"><label>Notes</label>
        <div class="nopts">${[['full', 'Notes + transcript', 'Summary, decisions, actions and every line'], ['notes', 'Notes only', 'Transcript deleted once notes are written'], ['off', 'No notes', 'Nothing is recorded']].map(([v, b, d]) => `<button class="nopt ${s.notes === v ? 'on' : ''}" data-a="set" data-k="sched.notes" data-v="${v}" aria-pressed="${s.notes === v}"><b>${b}</b><span>${d}</span></button>`).join('')}</div>
      </div>
      <div class="whorow ${s.notes === 'off' ? 'dim' : ''}"><span>Send the notes to</span>${seg('sched.who', [['everyone', 'Everyone invited'], ['me', 'Only me']], s.who)}</div>
      <p class="fine">${ic('wave')} ${cost}</p>
      <div class="sendfrom">${ic('mail')}<span>Invites go out from <b>${esc(S.acct ? S.acct.email : 'maya.chen@gmail.com')}</b> through ${S.cal.outlook && !S.cal.google ? 'Outlook' : 'Google Calendar'}. Guests can RSVP from their own calendar.</span></div>
      <div class="row-end"><button class="btn btn-sec" data-a="close">Cancel</button><button class="btn btn-pri" data-a="schedule">${s.edit ? 'Save and update invites' : 'Schedule and send invites'}</button></div>
    </div></div></div>`;
  },
  topup: () => `<div class="scrim" data-a="closebg"><div class="dialog" role="dialog" aria-label="Add credits">
    <div class="dialog-h"><h3>Add credits</h3><button class="iconbtn" data-a="close" aria-label="Close">${ic('x')}</button></div>
    <div class="dialog-b">
      <p class="muted">Pay in USDC from any wallet or chain. Credits never expire.</p>
      <div class="packs">${[[0, 10000, 10, ''], [1, 50000, 45, 'Save 10%'], [2, 100000, 80, 'Save 20%']].map(([i, c, u, t]) => `<button class="pack ${S.topup === i ? 'on' : ''}" data-a="set" data-k="topup" data-v="${i}"><b class="mono">${c.toLocaleString('en-US')}</b><span>${u} USDC</span><em>${t || '\u2248 ' + Math.round(c / 25 / 60) + ' hours of notes'}</em></button>`).join('')}</div>
      <p class="fine">${ic('lock')} Payment is matched to your account inside the sealed server. Alcove can\u2019t link a payment to your calls.</p>
      <div class="row-end"><button class="btn btn-sec" data-a="close">Cancel</button><button class="btn btn-pri" data-a="buy">Pay ${[10, 45, 80][S.topup]} USDC</button></div>
    </div></div></div>`,
  evnotes: () => {
    const e = S.events[S.evi];
    return `<div class="scrim" data-a="closebg"><div class="dialog" role="dialog" aria-label="Notes for ${esc(e.title)}">
    <div class="dialog-h"><h3>${esc(e.title)}</h3><button class="iconbtn" data-a="close" aria-label="Close">${ic('x')}</button></div>
    <div class="dialog-b">
      <p class="muted">Today at ${e.t}. Change notes up until the call starts. Guests see the setting on their join screen.</p>
      <div class="nopts four">${[['ask', 'Ask at start', 'Decide when you join'], ['full', 'Notes + transcript', 'Keep every line'], ['notes', 'Notes only', 'Transcript deleted after'], ['off', 'No notes', 'Nothing recorded']].map(([v, b, d]) => `<button class="nopt ${e.notes === v ? 'on' : ''}" data-a="setev" data-v="${v}"><b>${b}</b><span>${d}</span></button>`).join('')}</div>
      <div class="row-end"><button class="btn btn-pri" data-a="close">Done</button></div>
    </div></div></div>`;
  }
};

/* ---------- pre-join ---------- */
SC.prejoin = {
  view: () => `<div class="screen pj">
    <header class="top">${logo(22)}<div class="sp"></div>${themeBtn()}${S.pj.mode !== 'guest' ? `<button class="btn btn-ghost btn-sm" data-a="go" data-v="home">Cancel</button>` : ''}</header>
    <div class="pj-body">
      <div class="pj-left st">
        ${SC.prejoin.parts.preview()}
        <div class="devices">
          <span class="dev">${ic('mic')}MacBook Pro Microphone<span class="meter" data-meter>${'<i></i>'.repeat(7)}</span></span>
          <span class="dev">${ic('cam')}FaceTime HD Camera</span>
          <button class="dev" data-a="testspk">${ic('speaker')}Test speakers</button>
        </div>
      </div>
      ${SC.prejoin.parts.side()}
    </div></div>`,
  parts: {
    preview: () => `<div class="preview" data-r="preview">
      ${S.pj.cam ? camView('MC') : `<div class="camoff">Camera is off</div>`}
      <span class="pv-name">${esc(S.pj.mode === 'guest' ? (S.pj.gname || 'You') : S.name)}</span>
      <div class="pv-bar">
        <button class="pv-btn ${S.pj.mic ? '' : 'off'}" data-a="pjtog" data-v="mic" aria-pressed="${!S.pj.mic}" aria-label="${S.pj.mic ? 'Mute microphone' : 'Unmute microphone'}">${ic(S.pj.mic ? 'mic' : 'micoff')}</button>
        <button class="pv-btn ${S.pj.cam ? '' : 'off'}" data-a="pjtog" data-v="cam" aria-pressed="${!S.pj.cam}" aria-label="${S.pj.cam ? 'Turn camera off' : 'Turn camera on'}">${ic(S.pj.cam ? 'cam' : 'camoff')}</button>
      </div></div>`,
    side: () => {
      const p = S.pj;
      if (p.mode === 'guest') {
        return `<div class="pj-side st" data-r="side">
          <span class="eyebrow">${av('BO')} Ben Ortiz invited you</span>
          <h1>Harbor pilot review</h1>
          <div class="field"><label for="gn">Your name</label><input id="gn" class="input input-lg" data-in="pj.gname" value="${esc(p.gname)}" placeholder="How you\u2019ll appear in the call"></div>
          <div class="notice">${ic('notes')}<div><b>This call takes notes</b><span>Ben turned on notes and a transcript. Everyone in the call gets a copy, including you.</span></div></div>
          <button class="btn btn-pri btn-lg btn-block" data-a="askjoin" ${p.wait || !p.gname.trim() ? 'disabled' : ''}>${p.wait ? `<span class="spin"></span> Waiting for Ben to let you in` : 'Ask to join'}</button>
          <span class="small muted center">No account needed. Have one? <button class="tlink" data-a="mapgo" data-v="m-join">Sign in</button></span>
        </div>`;
      }
      if (p.mode === 'join') {
        return `<div class="pj-side st" data-r="side">
          <span class="eyebrow">${av('BO')} Hosted by Ben Ortiz</span>
          <h1>${esc(p.title === 'Maya\u2019s call' ? 'Weekly product sync' : p.title)}</h1>
          <div class="who-here"><span class="avs">${av('BO')}${av('PR')}</span>Ben and Priya are in the call</div>
          <div class="notice">${ic('notes')}<div><b>Notes + transcript are on</b><span>Ben set this before the call. You\u2019ll get the notes when it ends. Only people in the call can read them.</span></div></div>
          <button class="btn btn-pri btn-lg btn-block" data-a="joincall">Join now</button>
          <span class="lock-line">${ic('lock')} End-to-end encrypted \u00b7 alcove.app/${S.link.code}</span>
        </div>`;
      }
      const opts = [['full', 'Notes + transcript', 'Summary, decisions, action items and every line'], ['notes', 'Notes only', 'The transcript is deleted once notes are written'], ['off', 'No notes', 'Nothing is recorded. You can start notes later.']];
      return `<div class="pj-side st" data-r="side">
        <span class="eyebrow">${esc(p.title)}</span>
        <h1>Ready to join?</h1>
        <div class="who-here">${ic('users', 'muted')}No one else is here yet</div>
        <div class="pickn ${p.notes ? '' : 'ask'}">
          <div class="pickn-h"><b>${p.notes ? 'Notes for this call' : 'Take notes in this call?'}</b>${p.notes ? '' : '<span class="small muted">Your default is to ask</span>'}</div>
          ${opts.map(([v, b, d]) => `<button class="nrow ${p.notes === v ? 'on' : ''}" data-a="set" data-k="pj.notes" data-v="${v}" data-up="side" aria-pressed="${p.notes === v}"><span class="radio" aria-hidden="true"></span><span><b>${b}</b><span>${d}</span></span></button>`).join('')}
          ${p.notes && p.notes !== 'off' ? `<div class="whorow"><span>Send the notes to</span>${seg('pj.who', [['everyone', 'Everyone in the call'], ['me', 'Only me']], p.who, 'side')}</div>` : ''}
        </div>
        <button class="btn btn-pri btn-lg btn-block" data-a="joincall">${p.notes && p.notes !== 'off' ? 'Join and start notes' : p.notes ? 'Join now' : 'Join without notes'}</button>
        <span class="lock-line">${ic('lock')} End-to-end encrypted \u00b7 alcove.app/${S.link.code}</span>
      </div>`;
    }
  },
  mount: () => {
    every(() => {
      const bars = $$('[data-meter] i');
      bars.forEach((b, i) => { b.style.height = S.pj.mic ? (3 + Math.round(Math.random() * (i % 3 === 1 ? 14 : 10))) + 'px' : '3px'; });
    }, 140);
  }
};

/* ---------- the call ---------- */
function newCall(o) {
  const notes = o.notes || 'off';
  S.call = {
    title: o.title, mode: o.mode || 'host', guest: !!o.guest, mic: S.pj.mic, cam: S.pj.cam, share: false,
    panel: notes !== 'off' ? 'notes' : null, tab: 'live', notes, who: o.who || 'everyone', paused: false,
    t: o.t || 0, si: 0, shi: 0, lines: [], items: [], pop: null, talk: o.instant ? 0 : 1, everOn: notes !== 'off',
    present: o.instant ? ['MC'] : TILES.slice(), ready: !!o.instant, msg: '', unread: 0, hand: false,
    chat: o.instant ? [] : [['PR', 'Deck is attached to the invite if anyone needs it.', '00:20'], ['BO', 'Thanks. Can everyone hear me ok?', '00:41']],
    banner: notes !== 'off' ? (o.mode === 'host' ? 'You started notes. Everyone in the call can see they\u2019re on.' : `${o.host || 'The host'} turned on notes for this call. Everyone gets a copy.`) : null
  };
}
const TILES = ['MC', 'BO', 'PR', 'JW'];
const notesOn = () => S.call.notes !== 'off';

SC.call = {
  view: () => `<div class="call" data-theme-lock>
    ${SC.call.parts.top()}
    <div class="call-mid">${SC.call.parts.stage()}${SC.call.parts.side()}</div>
    ${SC.call.parts.bot()}
    ${SC.call.parts.pop()}
    ${SC.call.parts.banner()}
    ${SC.call.parts.ready()}
  </div>`,
  parts: {
    top: () => {
      const c = S.call;
      return `<div class="call-top" data-r="top">
        <b>${esc(c.title)}</b><span class="tm" data-tm>${fmt(c.t)}</span>
        <span class="enc">${ic('lock')}Encrypted</span>
        <div class="sp"></div>
        ${notesOn() ? `<button class="chip rec" data-a="notespop">${c.paused ? `${ic('pause')}Notes paused` : `<i class="rec-dot"></i>${c.notes === 'full' ? 'Transcribing' : 'Taking notes'}`}</button>` : ''}
        <span class="chip">${ic('users')}${c.present.length}</span>${c.hand ? `<span class="chip">${ic('hand')}Hand raised</span>` : ''}
      </div>`;
    },
    stage: () => {
      const c = S.call;
      const tile = (k, i) => {
        const p = PEOPLE[k]; const me = k === 'MC';
        const showCam = me ? c.cam : !!p.room;
        const muted = me ? !c.mic : k === 'JW';
        return `<div class="tile ${c.talk === i && c.present.length > 1 ? 'talk' : ''}" data-tile="${i}">
          ${showCam ? camView(k) : `<div class="initials">${av(k, 104)}</div>`}
          <span class="wave"><i></i><i></i><i></i></span>
          <span class="lbl">${muted ? ic('micoff') : ''}${me && c.hand ? ic('hand') : ''}${me ? 'You' : p.n}</span></div>`;
      };
      return `<div class="stage ${c.share ? 'share' : ''} n${c.present.length}" data-r="stage">
        ${c.share ? `<div class="sharescreen">
          <div class="ss-top"><span class="chip">${ic('screen')}You\u2019re presenting</span><button class="btn btn-sm ss-stop" data-a="share">Stop presenting</button></div>
          <small>Harbor pilot \u00b7 Q4</small><h2>Pilot timeline</h2>
          <div class="rows">
            <div><span>Kickoff</span><i style="width:24%"></i><em>Nov 10</em></div>
            <div><span>Data review</span><i style="width:56%;margin-left:22%"></i><em>Nov 24</em></div>
            <div><span>Go / no-go</span><i style="width:18%;margin-left:76%"></i><em>Dec 8</em></div>
          </div>
          <div class="kpis"><div><b>3</b><span>clinics</span></div><div><b>120</b><span>staff on calls</span></div><div><b>4 wks</b><span>to go/no-go</span></div><div><b>0</b><span>installs needed</span></div></div>
          <div class="owners"><span>${av('MC')} Kickoff</span><span>${av('JW')} Criteria</span><span>${av('PR')} Agreement</span></div>
          ${notesOn() && !c.paused ? `<span class="reading">${ic('notes')} Notes include this screen</span>` : ''}
        </div>` : ''}
        ${c.present.map((k) => tile(k, TILES.indexOf(k))).join('')}
        ${c.present.length === 1 && !c.share ? `<div class="alone"><span class="dots3"><i></i><i></i><i></i></span>Waiting for others to join</div>` : ''}
      </div>`;
    },
    side: () => {
      const c = S.call;
      if (!c.panel) return '<div data-r="side" hidden></div>';
      if (c.panel === 'chat') {
        return `<aside class="call-side" data-r="side"><div class="cs-h"><b>Chat</b><button class="iconbtn dk" data-a="panel" data-v="chat" aria-label="Close">${ic('x')}</button></div>
          <div class="cs-body chat" data-chat>${c.chat.length ? c.chat.map(chatHTML).join('') : '<div class="cs-wait">No messages yet</div>'}</div>
          <div class="cs-foot"><div class="chatbox"><input data-in="call.msg" placeholder="Send a message" aria-label="Chat message" value="${esc(c.msg)}"><button class="iconbtn dk" data-a="chatsend" aria-label="Send">${ic('send')}</button></div>
          <span class="small">${ic('lock')} End-to-end encrypted. Chat isn\u2019t added to the notes.</span></div></aside>`;
      }
      if (c.panel === 'people') {
        return `<aside class="call-side" data-r="side"><div class="cs-h"><b>People</b><button class="iconbtn dk" data-a="panel" data-v="people" aria-label="Close">${ic('x')}</button></div>
          <div class="cs-body">${c.present.map((k) => `<div class="prow">${av(k)}<span><b>${k === 'MC' ? esc(S.name) + ' (you)' : PEOPLE[k].n}</b><span>${k === 'MC' && c.mode === 'host' ? 'Host' : k === 'BO' && c.mode !== 'host' ? 'Host' : c.guest && k === 'MC' ? 'Guest' : ''}</span></span>${(k === 'MC' ? !c.mic : k === 'JW') ? ic('micoff') : ic('mic')}</div>`).join('')}</div>
          <div class="cs-foot"><span class="small">${notesOn() ? `Everyone here can see that notes are on. Notes go to ${c.who === 'me' ? 'the host only' : 'everyone in the call'}.` : 'Notes are off for this call.'}</span></div></aside>`;
      }
      const body = !notesOn()
        ? `<div class="cs-empty">${ic('notes')}<b>Notes are off</b><p>Start notes and Alcove transcribes from that moment on, not before. Everyone sees a notice.</p><button class="btn btn-sm cs-start" data-a="notespop">Start notes</button>${c.lines.length ? `<span class="small">Notes so far are kept.</span>` : ''}</div>`
        : c.tab === 'live'
          ? (c.lines.length ? c.lines.map(lineHTML).join('') : `<div class="cs-wait"><span class="meter dk">${'<i></i>'.repeat(5)}</span>Listening\u2026</div>`)
          : notesSoFar();
      return `<aside class="call-side" data-r="side">
        <div class="cs-h"><b>Notes</b><button class="iconbtn dk" data-a="panel" data-v="notes" aria-label="Close">${ic('x')}</button></div>
        ${notesOn() ? `<div class="cs-tabs">${[['live', c.notes === 'full' ? 'Transcript' : 'Live'], ['notes', 'Notes so far']].map(([v, l]) => `<button class="${c.tab === v ? 'on' : ''}" data-a="tab" data-v="${v}">${l}</button>`).join('')}</div>` : ''}
        <div class="cs-body" data-lines>${body}</div>
        ${notesOn() ? `<div class="cs-foot"><span class="small">${ic('lock')} ${c.notes === 'notes' ? 'Used to write the notes, then deleted.' : 'Kept with the notes.'} Notes go to ${c.who === 'me' ? 'the host only' : 'everyone in the call'}.</span></div>` : ''}
      </aside>`;
    },
    bot: () => {
      const c = S.call;
      const cb = (a, icon, tip, cls = '', v = '') => `<button class="cb ${cls}" data-a="${a}" ${v ? `data-v="${v}"` : ''} aria-label="${tip}">${ic(icon)}<span class="tip">${tip}</span></button>`;
      return `<div class="call-bot" data-r="bot">
        <span class="left mono">${S.link.code}</span>
        ${cb('ctog', c.mic ? 'mic' : 'micoff', c.mic ? 'Mute (M)' : 'Unmute (M)', c.mic ? '' : 'off', 'mic')}
        ${cb('ctog', c.cam ? 'cam' : 'camoff', c.cam ? 'Camera off (V)' : 'Camera on (V)', c.cam ? '' : 'off', 'cam')}
        ${cb('share', 'screen', c.share ? 'Stop presenting' : 'Present your screen', c.share ? 'on' : '')}
        ${cb('notespop', 'notes', notesOn() ? (c.paused ? 'Notes paused' : 'Notes are on') : 'Start notes', notesOn() ? 'notes-on' + (c.paused ? ' paused' : '') : '')}
        ${cb('hand', 'hand', c.hand ? 'Lower hand' : 'Raise hand', c.hand ? 'on' : '')}
        <button class="leave" data-a="leave">${ic('leave')}<span>Leave</span></button>
        <div class="right">
          ${cb('panel', 'notes', 'Notes panel', c.panel === 'notes' ? 'sel' : '', 'notes')}
          ${cb('panel', 'users', 'People', c.panel === 'people' ? 'sel' : '', 'people')}
          <span class="cbw">${cb('panel', 'msg', 'Chat (C)', c.panel === 'chat' ? 'sel' : '', 'chat')}${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</span>
        </div>
      </div>`;
    },
    pop: () => {
      const c = S.call;
      if (!c.pop) return '<div data-r="pop" hidden></div>';
      if (c.pop === 'start') {
        return `<div class="popover" data-r="pop" role="dialog" aria-label="Start notes">
          <b>Start notes?</b>
          <p>Everyone in the call sees that notes are on. Alcove transcribes from now, not what was said before.</p>
          ${seg('call.startmode', [['full', 'Notes + transcript'], ['notes', 'Notes only']], c.startmode || 'full', 'pop')}
          <div class="row"><button class="btn btn-sec btn-sm" data-a="popclose">Cancel</button><button class="btn btn-pri btn-sm" data-a="notesstart">Start notes</button></div></div>`;
      }
      return `<div class="popover" data-r="pop" role="dialog" aria-label="Notes">
        <b>${c.paused ? 'Notes are paused' : 'Notes are on'}</b>
        <p>${c.paused ? 'Nothing is transcribed while paused. Everyone sees that notes are paused.' : `${c.notes === 'full' ? 'Notes and the transcript' : 'Notes'} go to ${c.who === 'me' ? 'the host only' : 'everyone in the call'} when it ends. Pause for anything that shouldn\u2019t be in them.`}</p>
        <div class="row"><button class="btn btn-sec btn-sm" data-a="notesstop">Stop notes</button><button class="btn btn-pri btn-sm" data-a="notespause">${c.paused ? 'Resume' : 'Pause'}</button></div></div>`;
    },
    ready: () => {
      const c = S.call;
      return c.ready ? `<div class="ready" data-r="ready" role="dialog" aria-label="Your call is ready">
        <div class="rd-h"><b>Your call is ready</b><button class="iconbtn dk" data-a="readyx" aria-label="Close">${ic('x')}</button></div>
        <p>Share this link with the people you want in the call. Anyone without it can\u2019t find it.</p>
        <div class="rd-link"><span class="mono">alcove.app/${S.link.code}</span><button class="iconbtn dk" data-a="copy" aria-label="Copy link">${ic('copy')}</button></div>
        <div class="chatbox"><input data-in="call.invite" placeholder="Invite by email" aria-label="Invite by email"><button class="btn btn-sm rd-send" data-a="callinvite">Invite</button></div>
        <span class="small">${ic('lock')} Joined as ${esc(S.name)} \u00b7 ${notesOn() ? 'notes are on' : 'notes are off'}</span>
      </div>` : '<div data-r="ready" hidden></div>';
    },
    banner: () => {
      const c = S.call;
      return c.banner ? `<div class="banner-call" data-r="banner" role="status"><i class="rec-dot"></i><span>${c.banner}</span><button class="btn btn-sm" data-a="banner">Got it</button></div>` : '<div data-r="banner" hidden></div>';
    }
  },
  mount: () => {
    const c = S.call;
    if (c.banner) after(() => { if (S.call === c) { c.banner = null; up('banner'); } }, 5200);
    every(() => { c.t++; const el = $('[data-tm]'); if (el) el.textContent = fmt(c.t); }, 1000);
    if (c.present.length === 1) after(() => { if (S.call !== c) return; c.present = TILES.slice(); c.ready = false; up('stage', 'top', 'ready'); if (c.panel === 'people') up('side'); toast('Ben, Priya and Jon joined', 'users'); }, RM ? 1500 : 7000);
    every(() => {
      const pool = [1, 2, 3, 0].filter((i) => c.present.includes(TILES[i]) && i !== 3 && !(i === 0 && !c.mic));
      if (!pool.length) return;
      let n = pool[Math.floor(Math.random() * pool.length)];
      if (n === c.talk) n = pool[(pool.indexOf(n) + 1) % pool.length];
      c.talk = n;
      if (c.present.length > 1) $$('[data-tile]').forEach((t) => t.classList.toggle('talk', Number(t.dataset.tile) === n));
    }, 3100);
    every(() => feedLine(c), RM ? 4000 : 2700);
  }
};
const chatHTML = ([k, t, ts], i, arr, fresh) => `<div class="msg ${k === 'MC' ? 'mine' : ''} ${fresh === true ? 'new' : ''}"><b>${k === 'MC' ? 'You' : PEOPLE[k].n}<small>${ts}</small></b><p>${esc(t)}</p></div>`;
function pushChat(c, m) {
  c.chat.push(m);
  const box = $('[data-chat]');
  if (box && c.panel === 'chat') { const w = box.querySelector('.cs-wait'); if (w) w.remove(); box.insertAdjacentHTML('beforeend', chatHTML(m, 0, 0, true)); box.scrollTop = box.scrollHeight; }
  else { c.unread++; up('bot'); }
}
const lineHTML = (l, fresh) => l.screen
  ? `<div class="ln screen ${fresh ? 'new' : ''}"><b>${ic('screen')}On screen<small>${l.ts}</small></b><p>${l.text}</p></div>`
  : `<div class="ln ${fresh ? 'new' : ''}"><b>${l.who}<small>${l.ts}</small></b><p>${l.text}</p></div>`;
const notesSoFar = () => {
  const c = S.call;
  const dec = c.items.filter((i) => i[0] === 'dec'); const act = c.items.filter((i) => i[0] === 'act');
  return `<div class="cs-sec"><h4>Summary so far</h4><p class="cs-sum">${c.lines.length < 3 ? 'Alcove writes a running summary once there\u2019s enough to go on.' : 'Harbor signed the data agreement. The open question is where pilot data lives; the team agreed it stays in Harbor\u2019s region.'}</p></div>
    <div class="cs-sec"><h4>Decisions</h4>${dec.length ? dec.map((d) => `<div class="item">${ic('check')}${d[1]}</div>`).join('') : '<p class="cs-sum">None yet</p>'}</div>
    <div class="cs-sec"><h4>Action items</h4>${act.length ? act.map((d) => `<div class="item">${ic('flag')}${d[1]}</div>`).join('') : '<p class="cs-sum">None yet</p>'}</div>`;
};
function feedLine(c) {
  if (S.screen !== 'call' || !notesOn() || c.paused) return;
  let line;
  if (c.share && c.shi < SCREEN_LINES.length && c.si % 2 === 0 && !c.lastScreen) {
    line = { screen: true, ts: fmt(c.t), text: SCREEN_LINES[c.shi++] }; c.lastScreen = true;
  } else {
    const [w, text, tag] = CALL_SCRIPT[c.si % CALL_SCRIPT.length]; c.si++; c.lastScreen = false;
    line = { who: w === 0 ? (c.guest ? (S.pj.gname || 'You') : S.name) : PEOPLE[TILES[w]].n, ts: fmt(c.t), text };
    if (tag && LIVE_ITEMS[tag] && !c.items.some((i) => i[1] === LIVE_ITEMS[tag][1])) c.items.push(LIVE_ITEMS[tag]);
    if (tag === 'share' && c.si <= CALL_SCRIPT.length && !c.share && c.mode === 'host') toast('Tip: present your screen and the notes include it', 'screen');
  }
  c.lines.push(line);
  const box = $('[data-lines]');
  if (!box || S.call.panel !== 'notes') return;
  if (c.tab === 'live') {
    const w = box.querySelector('.cs-wait'); if (w) w.remove();
    box.insertAdjacentHTML('beforeend', lineHTML(line, true));
    box.scrollTo({ top: box.scrollHeight, behavior: RM ? 'auto' : 'smooth' });
  } else { box.innerHTML = notesSoFar(); }
}

/* ---------- ended ---------- */
SC.ended = {
  view: () => {
    const e = S.end;
    if (e.none) {
      return `<div class="screen ended"><div class="ended-card st">
        ${mark(48)}<h1>You left the call</h1><p class="muted">${esc(e.title)} \u00b7 ${e.mins} min. No notes were taken.</p>
        <div class="row-c"><button class="btn btn-sec btn-lg" data-a="rejoin">Rejoin</button><button class="btn btn-pri btn-lg" data-a="go" data-v="home">Back to home</button></div>
      </div></div>`;
    }
    return `<div class="screen ended"><div class="ended-card st">
      ${mark(48, 'pulse')}
      <h1>Writing your notes</h1>
      <p class="muted">${esc(e.title)} \u00b7 ${e.sub}</p>
      <div class="progress"><i data-prog></i></div>
      <div class="steps-l">${e.steps.map((s, i) => `<div data-step="${i}"><span class="ck">${ic('check')}</span>${s}</div>`).join('')}</div>
      <p class="small muted">You can leave this page. The notes will be waiting on your home screen.</p>
    </div></div>`;
  },
  mount: () => {
    const e = S.end; if (e.none) return;
    let i = 0; const n = e.steps.length;
    const tick = () => {
      if (S.screen !== 'ended') return;
      const el = $(`[data-step="${i}"]`); if (el) el.classList.add('done');
      i++; $('[data-prog]').style.width = Math.round((i / n) * 100) + '%';
      if (i < n) after(tick, RM ? 300 : 850);
      else after(() => openNotes(e.kind), RM ? 300 : 900);
    };
    after(tick, RM ? 100 : 500);
  }
};

/* ---------- notes ---------- */
function openNotes(kind, keep) {
  const d = DOCS[kind];
  if (S.end && S.end.kind === kind && S.end.add) {
    S.past.unshift(kind === 'solo' ? { k: 'solo', keep: 'full', title: S.end.title, when: 'Today \u00b7 just now', dur: S.end.dur, who: ['MC'], p: DOCS.solo.summary.split('. ').slice(0, 2).join('. ') + '.', acts: 3 }
      : { k: 'call', keep: keep || 'full', title: S.end.title, when: 'Today \u00b7 just now', dur: S.end.dur, who: ['BO', 'PR', 'JW'], p: 'Legal signed the data agreement. Kickoff set for November 10.', acts: 4 });
    S.end.add = false; S.firstCall = true;
  }
  S.doc = { kind, title: kind === 'call' ? (S.call && S.call.title) || 'Harbor pilot review' : (S.rec && S.rec.title) || d.title, keep: keep || (kind === 'call' && S.call ? (S.call.notes === 'notes' && !S.call.keptFull ? 'notes' : 'full') : 'full'), done: {}, q: '', answer: null };
  if (kind === 'call' && S.call) S.call = null;
  go('notes');
}
const tsLink = (ts) => `<button class="tsbtn" data-a="ts" data-v="${ts}">${ic('play')}${ts}</button>`;
const tsify = (s) => s.replace(/\{(\d\d:\d\d)\}/g, (_, t) => tsLink(t));
const ownerName = (k) => k === 'DA' ? 'Dana' : k === 'MC' ? first() : PEOPLE[k].n.split(' ')[0];
const ownerAv = (k) => av(k, 24);

SC.notes = {
  view: () => {
    const d = DOCS[S.doc.kind]; const keepT = S.doc.keep === 'full';
    const toc = [['d-sum', 'Summary'], ['d-dec', 'Decisions'], ['d-act', 'Action items'], ['d-chap', 'Chapters']].concat(d.screen ? [['d-scr', 'On screen']] : []).concat([['d-tr', 'Transcript']]);
    return shell(`<div class="doc-bar"><button class="btn btn-ghost btn-sm" data-a="go" data-v="library">${ic('left')} All notes</button><div class="sp"></div><button class="btn btn-sec btn-sm" data-a="sharenotes">${ic('share')} Share</button></div>
      <div class="notes">
        <nav class="toc" aria-label="Sections">${toc.map(([id, l]) => `<button data-a="jump" data-v="${id}">${l}</button>`).join('')}</nav>
        <article class="doc st">
          <header class="doc-h">
            <div class="doc-meta">${d.kind === 'solo' ? `<span class="chip">${ic('room')}Recorded in the room</span>` : `<span class="chip">${ic('cam')}Call</span>`}<span class="chip">${ic('notes')}${keepT ? 'Notes + transcript' : 'Notes only'}</span></div>
            <h1>${esc(S.doc.title)}</h1>
            <div class="doc-meta"><span>${d.date}</span><i class="dotsep"></i><span>${d.dur}</span><i class="dotsep"></i>${avs(d.people)}<span>${d.kind === 'solo' ? 'Only you can read these' : 'Shared with the 4 people in the call'}</span></div>
          </header>
          <section class="summary" id="d-sum"><p>${d.summary}</p></section>
          <section class="dsec" id="d-dec"><h2>Decisions</h2>${d.decisions.map((x) => `<div class="decision">${ic('ok')}<span>${x}</span></div>`).join('')}</section>
          <section class="dsec" id="d-act"><h2>Action items</h2>${d.actions.map(([k, t, due], i) => `<button class="todo ${S.doc.done[i] ? 'done' : ''}" data-a="todo" data-v="${i}" aria-pressed="${!!S.doc.done[i]}"><span class="cbx">${ic('check')}</span><span class="tx">${t}</span><span class="own">${ownerAv(k)}${ownerName(k)} \u00b7 ${due}</span></button>`).join('')}</section>
          <section class="dsec" id="d-chap"><h2>Chapters</h2><div class="chapters">${d.chapters.map(([ts, b, s]) => `<button class="chap" data-a="ts" data-v="${ts}"><span class="ts">${ts}</span><span><b>${b}</b><span>${s}</span></span></button>`).join('')}</div></section>
          ${d.screen ? `<section class="dsec" id="d-scr"><h2>On screen</h2><div class="slide"><div class="th"><small>Pilot timeline</small><i style="width:30%"></i><i style="width:60%;margin-left:25%"></i><i style="width:22%;margin-left:72%"></i></div><div><b>${d.screen.title}</b><p class="small muted">Shared by ${d.screen.by} at ${tsLink(d.screen.at)}</p><p>${d.screen.text}</p></div></div></section>` : ''}
          <section class="dsec" id="d-tr"><h2>Transcript</h2>${keepT ? `<div class="tr">${d.transcript.map(([ts, k, t]) => `<div class="ln2" data-ts="${ts}"><span class="ts">${ts}</span><div><b>${k === 'S1' ? 'Speaker 1' : k === 'S2' ? 'Speaker 2' : PEOPLE[k].n}</b><p>${t}</p></div></div>`).join('')}</div>`
            : `<div class="gone">${ic('trash')}<div><b>Not kept for this call</b><span>The transcript was deleted inside the sealed server as soon as these notes were written. Times above still point to when things were said.</span></div></div>`}</section>
        </article>
      </div>
      ${SC.notes.parts.ask()}`, 'notes-main');
  },
  parts: {
    ask: () => {
      const d = DOCS[S.doc.kind]; const a = S.doc.answer;
      return `<div class="askwrap" data-r="ask">
        ${a ? `<div class="answer" role="status"><div class="ans-h"><b>${esc(a.q)}</b><button class="iconbtn" data-a="ansclose" aria-label="Close answer">${ic('x')}</button></div><p data-ans></p><span class="small muted">${ic('lock')} Answered inside the sealed server, from this call only.</span></div>`
          : `<div class="asksug">${d.qa.map(([q], i) => `<button class="chip" data-a="askq" data-v="${i}">${q}</button>`).join('')}</div>`}
        <div class="askbar">${ic('msg', 'muted')}<input data-in="doc.q" placeholder="Ask about this ${S.doc.kind === 'solo' ? 'recording' : 'call'}" aria-label="Ask about this call" value="${esc(S.doc.q)}"><button class="btn btn-pri btn-sm" data-a="ask" aria-label="Ask">${ic('send')}</button></div>
      </div>`;
    }
  }
};
function answer(i) {
  const d = DOCS[S.doc.kind]; const [q, a] = d.qa[i];
  S.doc.answer = { q: S.doc.q.trim() || q }; S.doc.q = '';
  up('ask');
  const box = $('[data-ans]');
  const parts = a.split(/(\{\d\d:\d\d\})/).flatMap((p) => /^\{/.test(p) ? [p] : p.split(/(?<=\s)/));
  if (RM) { box.innerHTML = tsify(a); return; }
  let k = 0; let html = '';
  const id = setInterval(() => {
    if (!box.isConnected || k >= parts.length) { clearInterval(id); return; }
    const p = parts[k++]; html += /^\{/.test(p) ? tsLink(p.slice(1, -1)) : esc(p);
    box.innerHTML = html;
  }, 45);
  T.push(id);
}
function jumpTs(ts) {
  if (S.doc.keep !== 'full') { toast('The transcript wasn\u2019t kept for this call', 'trash'); return; }
  const lines = $$('.ln2'); const toSec = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
  let best = lines[0];
  lines.forEach((l) => { if (toSec(l.dataset.ts) <= toSec(ts)) best = l; });
  if (!best) return;
  best.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
  $$('.ln2.hl').forEach((l) => l.classList.remove('hl'));
  best.classList.add('hl');
  setTimeout(() => best.classList.remove('hl'), 2400);
}

/* ---------- recorder ---------- */
SC.recorder = {
  view: () => `<div class="recorder">
    <div class="rec-main">
      <div class="rec-top"><button class="btn btn-ghost btn-sm" data-a="recdiscard">${ic('x')} Discard</button><div class="sp"></div>${themeBtn()}</div>
      <input class="rec-title" data-in="rec.title" value="${esc(S.rec.title)}" aria-label="Recording title">
      <div data-r="recchip">${SC.recorder.parts.recchip()}</div>
      <div class="bigwave ${S.rec.paused ? 'paused' : ''}" data-bw>${'<i></i>'.repeat(56)}</div>
      <div class="rec-time" data-tm>${fmt(S.rec.t)}</div>
      <div data-r="recacts">${SC.recorder.parts.recacts()}</div>
      <p class="rec-fine">${ic('lock')} Audio is encrypted on this device in 5-second pieces and transcribed inside the sealed server. Only you can read the result.</p>
    </div>
    <aside class="rec-tr"><div class="h"><b>Transcript</b><span class="chip">${ic('lock')}Only you</span></div><div class="b" data-lines>${S.rec.lines.length ? S.rec.lines.map((l) => lineHTML(l)).join('') : `<div class="cs-wait light"><span class="meter">${'<i></i>'.repeat(5)}</span>Listening\u2026</div>`}</div></aside>
  </div>`,
  parts: {
    recchip: () => `<span class="chip rec" data-r="recchip">${S.rec.paused ? `${ic('pause')}Paused` : '<i class="rec-dot"></i>Recording in the room'}</span>`,
    recacts: () => `<div class="rec-acts" data-r="recacts"><button class="btn btn-sec btn-lg" data-a="recpause">${ic(S.rec.paused ? 'play' : 'pause')} ${S.rec.paused ? 'Resume' : 'Pause'}</button><button class="btn btn-pri btn-lg" data-a="recstop">${ic('notes')} Stop and write notes</button></div>`
  },
  mount: () => {
    const r = S.rec; const bars = $$('[data-bw] i'); let ph = 0;
    every(() => {
      if (r.paused) { bars.forEach((b) => { b.style.transform = 'scaleY(.06)'; }); return; }
      ph += 0.35;
      bars.forEach((b, i) => {
        const env = Math.sin(i / bars.length * Math.PI);
        const v = Math.max(.06, env * (0.25 + 0.75 * Math.abs(Math.sin(ph + i * 0.45) * Math.cos(ph * 0.7 + i * 0.13))) * (0.6 + Math.random() * 0.4));
        b.style.transform = `scaleY(${v.toFixed(3)})`;
      });
    }, RM ? 600 : 110);
    every(() => { if (!r.paused) { r.t++; const el = $('[data-tm]'); if (el) el.textContent = fmt(r.t); } }, 1000);
    every(() => {
      if (r.paused || r.i >= ROOM_SCRIPT.length) return;
      const [w, text] = ROOM_SCRIPT[r.i++]; const l = { who: 'Speaker ' + w, ts: fmt(r.t), text };
      r.lines.push(l);
      const box = $('[data-lines]'); if (!box) return;
      const wt = box.querySelector('.cs-wait'); if (wt) wt.remove();
      box.insertAdjacentHTML('beforeend', lineHTML(l, true));
      box.scrollTo({ top: box.scrollHeight, behavior: RM ? 'auto' : 'smooth' });
    }, 3200);
  }
};

/* ---------- prototype map ---------- */
const MAP = [
  ['First run', [['welcome', 'Welcome and sign in'], ['passkey', 'Passkey'], ['m-fresh', 'Home, first day'], ['m-fresh-mtg', 'Meetings, empty'], ['m-fresh-lib', 'Notes, empty']]],
  ['App', [['m-home', 'Home, a few weeks in'], ['m-menu', 'New call menu'], ['m-link', 'Get a link to share'], ['m-sched', 'Schedule with email invites'], ['m-mtg', 'Meetings'], ['m-edit', 'Edit a meeting'], ['m-past', 'Past meetings'], ['m-lib', 'Notes library'], ['m-acct', 'Account and credits'], ['m-topup', 'Add credits']]],
  ['Joining', [['m-host', 'Pre-join, your call'], ['m-join', 'Pre-join, someone else\u2019s call'], ['m-guest', 'Guest opens a link']]],
  ['In the call', [['m-instant', 'Instant call, waiting for people'], ['m-call-on', 'Notes on'], ['m-chat', 'Chat'], ['m-call-off', 'Notes off'], ['m-call-start', 'Starting notes mid-call'], ['m-call-share', 'Presenting a screen']]],
  ['After the call', [['m-ended', 'Writing the notes'], ['m-notes', 'Notes + transcript'], ['m-notes-only', 'Notes only']]],
  ['In the room', [['recorder', 'Recorder'], ['m-solo', 'Room recording notes']]]
];
let mapKey = 'welcome';
function renderMap() {
  $('#mapc').innerHTML = `<button class="map-btn" data-a="map" aria-expanded="${S.map}" aria-label="All screens">${ic('grid')}<span>Screens</span></button>
  ${S.map ? `<div class="map" role="menu">${MAP.map(([h, items]) => `<p>${h}</p>${items.map(([k, l]) => `<button class="s ${mapKey === k ? 'on' : ''}" data-a="mapgo" data-v="${k}">${l}</button>`).join('')}`).join('')}
    <div class="row"><span class="small muted">Theme</span>${seg('maptheme', [['light', 'Light'], ['dark', 'Dark']], S.dark ? 'dark' : 'light')}</div></div>` : ''}`;
}
function mapgo(k) {
  mapKey = k; S.map = false;
  const host = () => { S.pj = Object.assign(S.pj, { mode: 'host', title: 'Maya\u2019s call', notes: S.notesDefault === 'always' ? S.keep : S.notesDefault === 'never' ? 'off' : null, wait: false }); };
  switch (k) {
    case 'm-menu': S.dialog = null; go('home'); setTimeout(() => { const b = $('[data-a="menu"]', $('.main')) || $('[data-a="menu"]'); if (b) A.menu(b, { stopPropagation() {} }); }, 50); return;
    case 'm-link': S.screen = 'home'; S.menu = false; S.dialog = 'link'; S.copied = false; render(); return;
    case 'm-sched': S.screen = 'home'; S.menu = false; S.dialog = 'sched'; render(); return;
    case 'm-evnotes': S.screen = 'home'; S.menu = false; S.evi = 2; S.dialog = 'evnotes'; render(); return;
    case 'm-host': host(); go('prejoin'); return;
    case 'm-fresh': setFresh(true); go('home'); return;
    case 'm-fresh-mtg': setFresh(true); S.mt.view = 'upcoming'; go('meetings'); return;
    case 'm-fresh-lib': setFresh(true); go('library'); return;
    case 'm-home': if (S.fresh || !S.events.length) setFresh(false); go('home'); return;
    case 'm-mtg': if (S.fresh) setFresh(false); S.mt.view = 'upcoming'; S.mt.sel = 'e3'; go('meetings'); return;
    case 'm-lib': if (S.fresh) setFresh(false); go('library'); return;
    case 'm-acct': if (S.fresh) setFresh(false); go('account'); return;
    case 'm-edit': if (S.fresh) setFresh(false); S.screen = 'meetings'; S.mt.view = 'upcoming'; S.mt.sel = 'e4'; S.dialog = null; render(); A.medit({ dataset: { v: 'e4' } }); return;
    case 'm-past': if (S.fresh) setFresh(false); S.mt.view = 'past'; go('meetings'); return;
    case 'm-topup': S.screen = 'account'; S.dialog = 'topup'; render(); return;
    case 'm-instant': S.pj.mic = true; S.pj.cam = true; newCall({ title: 'Maya\u2019s call', notes: 'off', mode: 'host', instant: true }); go('call'); return;
    case 'm-chat': newCall({ title: 'Weekly product sync', notes: 'full', mode: 'join', host: 'Ben', t: 300 }); S.call.banner = null; S.call.panel = 'chat'; S.call.msg = ''; go('call'); return;
    case 'm-join': S.pj.mode = 'join'; S.pj.wait = false; go('prejoin'); return;
    case 'm-guest': S.pj.mode = 'guest'; S.pj.wait = false; S.pj.gname = ''; go('prejoin'); return;
    case 'm-call-on': newCall({ title: 'Weekly product sync', notes: 'full', mode: 'join', host: 'Ben', t: 64 }); S.call.banner = null; go('call'); return;
    case 'm-call-off': newCall({ title: 'Maya\u2019s call', notes: 'off', mode: 'host', t: 12 }); go('call'); return;
    case 'm-call-start': newCall({ title: 'Maya\u2019s call', notes: 'off', mode: 'host', t: 95 }); S.call.pop = 'start'; S.call.panel = 'notes'; go('call'); return;
    case 'm-call-share': newCall({ title: 'Harbor pilot review', notes: 'full', mode: 'host', t: 690 }); S.call.banner = null; S.call.share = true; S.call.si = 5; go('call'); return;
    case 'm-ended': S.call = { title: 'Harbor pilot review', notes: 'full', everOn: true }; endCall(); return;
    case 'm-notes': S.call = null; S.doc = { kind: 'call', title: 'Harbor pilot review', keep: 'full', done: {}, q: '', answer: null }; go('notes'); return;
    case 'm-notes-only': S.call = null; S.doc = { kind: 'call', title: 'Harbor pilot review', keep: 'notes', done: {}, q: '', answer: null }; go('notes'); return;
    case 'recorder': S.rec = { t: 0, paused: false, lines: [], i: 0, title: 'Board prep with Dana' }; go('recorder'); return;
    case 'm-solo': S.rec = null; openNotes('solo'); return;
    default: go(k);
  }
}
function endCall() {
  const c = S.call;
  const mins = Math.max(1, Math.round((c.t || 1920) / 60));
  if (!c.everOn) { S.end = { none: true, title: c.title, mins }; go('ended'); return; }
  const keepFull = c.notes === 'full' || c.keptFull;
  S.end = {
    kind: 'call', add: true, dur: mins + ' min', title: c.title, sub: `4 people \u00b7 ${c.t ? mins + ' min' : '32 min'}`,
    steps: ['Call ended', 'Audio and screen frames sealed in the notes server', 'Summary, decisions and action items written', keepFull ? 'Transcript saved with the notes' : 'Transcript deleted', c.who === 'me' ? 'Notes saved for you' : 'Notes sent to everyone in the call']
  };
  S.credits = Math.max(0, S.credits - Math.max(25, mins * 25));
  S.usage.unshift([c.title, `Today \u00b7 ${mins} min of notes`, -Math.max(25, mins * 25)]);
  go('ended');
}

/* ---------- actions ---------- */
const A = {
  go: (el) => { mapKey = el.dataset.v; go(el.dataset.v); },
  mapgo: (el) => mapgo(el.dataset.v),
  map: () => { S.map = !S.map; renderMap(); },
  theme: () => { S.dark = !S.dark; applyTheme(); renderMap(); },
  set: (el) => {
    const k = el.dataset.k; const v = el.dataset.v;
    if (k === 'maptheme') { S.dark = v === 'dark'; applyTheme(); renderMap(); return; }
    setPath(k, v);
    const sg = el.closest('.seg'); if (sg) $$('button', sg).forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    if (el.dataset.up) up(...el.dataset.up.split(','));
    else if (S.dialog) renderLayer();
  },
  arrive: () => { setFresh(true); go('home'); },
  passkey: () => {
    if (!S.name.trim()) { $('#nm').focus(); toast('Add your name first', 'x'); return; }
    S.pk = 'scan'; up('pkbtn');
    const card = $('[data-pk]'); card.classList.add('scan'); $('[data-cap]').textContent = 'Touch the sensor\u2026';
    after(() => { S.pk = 'done'; card.classList.add('done'); $('[data-cap]').textContent = 'Passkey saved on this Mac'; up('pkbtn'); }, RM ? 200 : 1500);
  },
  menu: (el, ev) => { ev.stopPropagation(); if (S.menu) { S.menu = false; renderMenu(); return; } const r = el.getBoundingClientRect(); S.menu = { x: Math.min(r.left, innerWidth - 320), y: r.bottom + 8 }; renderMenu(); },
  instant: () => {
    S.pj = Object.assign(S.pj, { mode: 'host', title: 'Maya\u2019s call', notes: S.notesDefault === 'always' ? S.keep : S.notesDefault === 'never' ? 'off' : null, wait: false });
    mapKey = 'm-host'; go('prejoin');
  },
  dialog: (el) => { S.menu = false; renderMenu(); S.dialog = el.dataset.v; S.copied = false; renderLayer(true); const f = $('#layer input'); if (f && el.dataset.v === 'sched') setTimeout(() => f.focus(), 60); },
  close: () => { S.dialog = null; renderLayer(true); },
  closebg: (el, ev) => { if (ev.target === el) A.close(); },
  copy: () => {
    const txt = `https://alcove.app/${S.link.code}#k=Hq3vT9xW2m`;
    try { navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) { /* ignore */ }
    S.copied = true; renderLayer(); toast('Link copied');
  },
  linkjoin: () => {
    const n = S.link.notes;
    S.pj = Object.assign(S.pj, { mode: 'host', title: 'Maya\u2019s call', notes: n === 'ask' ? null : n, wait: false });
    go('prejoin');
  },
  rmguest: (el) => { S.sched.guests.splice(Number(el.dataset.v), 1); renderLayer(); $('#gi').focus(); },
  schedule: () => {
    const s = S.sched;
    if (s.gdraft.trim()) { s.guests.push(s.gdraft.trim()); s.gdraft = ''; }
    const title = s.title.trim() || 'Untitled call';
    const guests = s.guests.map((g) => { const k = Object.keys(EMAIL).find((x) => EMAIL[x] === g); return [k || g, 'pending']; });
    const m = { id: s.edit || 'n' + Date.now(), t: s.time, end: addMins(s.time, s.dur), d: s.dur + ' min', title, who: guests.map((g) => PEOPLE[g[0]] ? g[0] : 'LS').slice(0, 3), notes: s.notes, host: 'you', fresh: true, guests, day: s.day === 0 ? 'Today' : s.day === 1 ? 'Tomorrow' : DATES[s.day].split(',')[0], date: DATES[s.day] };
    if (s.edit) {
      const old = findM(s.edit);
      m.guests = guests.map(([k]) => { const o = old.guests.find((g) => g[0] === k); return o || [k, 'pending']; });
      S.events = S.events.filter((e) => e.id !== s.edit); S.later = S.later.filter((e) => e.id !== s.edit);
    }
    if (s.day === 0) S.events.push(m); else S.later.push(m);
    S.later.sort((x, y) => DATES.indexOf(x.date) - DATES.indexOf(y.date) || x.t.localeCompare(y.t));
    S.events.sort((x, y) => x.t.localeCompare(y.t));
    S.dialog = null; renderLayer(true);
    S.mt.sel = m.id;
    if (S.screen === 'home') up('upcoming'); if (S.screen === 'meetings') { S.mt.view = 'upcoming'; render(); }
    const n = guests.length;
    toast(s.edit ? `Saved. ${n} ${n === 1 ? 'guest was' : 'guests were'} emailed the change.` : `${title} \u00b7 ${DAYS[s.day]} at ${s.time}. Invite sent to ${n} ${n === 1 ? 'person' : 'people'}.`, 'mail');
    S.sched = Object.assign(S.sched, { edit: null, title: '', guests: [], gdraft: '' });
  },
  medit: (el) => {
    const m = findM(el.dataset.v);
    const mins = (Number(m.end.split(':')[0]) * 60 + Number(m.end.split(':')[1])) - (Number(m.t.split(':')[0]) * 60 + Number(m.t.split(':')[1]));
    S.sched = { edit: m.id, title: m.title, day: Math.max(0, DATES.indexOf(m.date)), time: m.t, dur: [15, 30, 45, 60].includes(mins) ? mins : 30, guests: m.guests.map(([g]) => EMAIL[g] || g), gdraft: '', notes: m.notes === 'ask' ? 'full' : m.notes, who: 'everyone' };
    S.dialog = 'sched'; renderLayer(true);
  },
  'msel-go': (el) => { S.mt.sel = el.dataset.v; S.mt.view = 'upcoming'; go('meetings'); },
  msel: (el) => { S.mt.sel = el.dataset.v; S.mt.confirm = false; $$('.mrow').forEach((r) => r.classList.toggle('on', r.dataset.v === S.mt.sel)); up('mdet'); },
  mnotes: (el) => { const m = findM(S.mt.sel); m.notes = el.dataset.v; up('mbody'); toast(`Notes set to \u201c${NOTE_LABEL[m.notes]}\u201d. Guests see it on their invite.`, 'notes'); },
  mcancel: () => { S.mt.confirm = true; up('mdet'); },
  mkeep: () => { S.mt.confirm = false; up('mdet'); },
  mdel: (el) => {
    const id = el.dataset.v; const m = findM(id);
    S.events = S.events.filter((e) => e.id !== id); S.later = S.later.filter((e) => e.id !== id);
    S.mt.confirm = false; S.mt.sel = (allMeetings()[0] || {}).id; up('mbody');
    toast(`${m.title} cancelled. ${m.guests.length} ${m.guests.length === 1 ? 'guest was' : 'guests were'} emailed.`, 'mail');
  },
  mstart: (el) => {
    const m = findM(el.dataset.v);
    if (m.host === 'you') { S.pj = Object.assign(S.pj, { mode: 'host', title: m.title, notes: m.notes === 'ask' ? null : m.notes, wait: false }); }
    else { S.pj = Object.assign(S.pj, { mode: 'join', title: m.title, wait: false }); }
    go('prejoin');
  },
  resend: (el) => toast(`Invite sent again to ${el.dataset.v.includes('@') ? el.dataset.v : PEOPLE[el.dataset.v].n}`, 'mail'),
  openpast: (el) => { const m = S.past[Number(el.dataset.v)]; S.call = null; S.rec = null; openNotes(m.k, m.keep); S.doc.title = m.title; render(); },
  oauth: (el) => {
    const k = el.dataset.v; S.oauth = k; up('sibtns');
    after(() => {
      const [n, , e] = PROV[k]; S.acct = { provider: n, email: e }; S.oauth = null;
      S.cal = { google: k === 'google', outlook: k === 'microsoft', icloud: k === 'apple' };
      go('passkey');
    }, RM ? 300 : 1600);
  },
  siemail: () => {
    const v = (S.siemail || '').trim();
    if (!/.+@.+\..+/.test(v)) { $('[data-in="siemail"]').focus(); toast('Enter your email address', 'mail'); return; }
    S.acct = { provider: 'email', email: v }; S.cal = { google: false, outlook: false, icloud: false }; go('passkey');
  },
  caltog: (el) => { const k = el.dataset.v; S.cal[k] = !S.cal[k]; up('calrows'); if (S.cal[k]) toast(`${{ google: 'Google Calendar', outlook: 'Outlook', icloud: 'iCloud Calendar' }[k]} connected`, 'cal'); },
  buy: () => { const add = [10000, 50000, 100000][S.topup]; S.credits += add; S.usage.unshift(['Credits added', 'Paid ' + [10, 45, 80][S.topup] + ' USDC', add]); S.dialog = null; renderLayer(true); if (S.screen === 'account') render(); toast(`${add.toLocaleString('en-US')} credits added`); },
  addpk: () => { S.pk2 = true; toast('Passkey added on iPhone', 'fp'); if (S.screen === 'home') render(); },
  signout: () => { S.acct = null; S.pk = 'idle'; go('welcome'); },
  evnotes: (el) => { S.evi = Number(el.dataset.v); S.dialog = 'evnotes'; renderLayer(true); },
  setev: (el) => { S.events[S.evi].notes = el.dataset.v; renderLayer(); up('upcoming'); },
  join: () => {
    if (!S.code.trim()) { const i = $('[data-in="code"]'); i && i.focus(); return; }
    S.pj.mode = 'join'; S.pj.wait = false; mapKey = 'm-join'; go('prejoin');
  },
  joinev: (el) => { const e = S.events[Number(el.dataset.v)]; S.pj.mode = 'join'; S.pj.wait = false; S.pj.title = e.title; go('prejoin'); },
  opennotes: (el) => { S.call = null; S.rec = null; openNotes(el.dataset.v); },
  pjtog: (el) => { const k = el.dataset.v; S.pj[k] = !S.pj[k]; up('preview'); },
  testspk: () => toast('Playing a test sound', 'speaker'),
  askjoin: () => {
    S.pj.wait = true; up('side');
    after(() => { newCall({ title: 'Harbor pilot review', notes: 'full', mode: 'guest', guest: true, host: 'Ben' }); go('call'); }, RM ? 400 : 2200);
  },
  joincall: () => {
    const p = S.pj;
    if (p.mode === 'join') newCall({ title: p.title === 'Maya\u2019s call' ? 'Weekly product sync' : p.title, notes: 'full', mode: 'join', host: 'Ben' });
    else newCall({ title: p.title, notes: p.notes || 'off', who: p.who, mode: 'host', instant: p.title === 'Maya\u2019s call' });
    go('call');
  },
  ctog: (el) => { const k = el.dataset.v; S.call[k] = !S.call[k]; up('bot', 'stage'); },
  share: () => { const c = S.call; c.share = !c.share; up('stage', 'bot'); if (c.share && notesOn() && !c.paused) toast('Notes will include what\u2019s on your screen', 'screen'); },
  hand: () => { const c = S.call; c.hand = !c.hand; up('bot', 'top', 'stage'); },
  chatsend: () => {
    const c = S.call; const t = (c.msg || '').trim(); if (!t) { const i = $('[data-in="call.msg"]'); i && i.focus(); return; }
    c.msg = ''; const i = $('[data-in="call.msg"]'); if (i) { i.value = ''; i.focus(); }
    pushChat(c, ['MC', t, fmt(c.t)]);
    if (c.present.length > 1) after(() => { if (S.call === c) pushChat(c, ['PR', 'Got it, thanks.', fmt(c.t)]); }, 2400);
  },
  readyx: () => { S.call.ready = false; up('ready'); },
  callinvite: () => {
    const i = $('[data-in="call.invite"]'); const v = i ? i.value.trim() : '';
    if (!/.+@.+/.test(v)) { i && i.focus(); return; }
    i.value = ''; toast(`Invite sent to ${v}`, 'mail');
  },
  panel: (el) => { const v = el.dataset.v; const c = S.call; c.panel = c.panel === v ? null : v; if (c.panel === 'chat') c.unread = 0; up('side', 'bot'); const b = $('[data-chat]'); if (b) b.scrollTop = b.scrollHeight; },
  tab: (el) => { S.call.tab = el.dataset.v; up('side'); const b = $('[data-lines]'); if (b) b.scrollTop = b.scrollHeight; },
  notespop: () => { const c = S.call; c.pop = c.pop ? null : (notesOn() ? 'on' : 'start'); up('pop'); },
  popclose: () => { S.call.pop = null; up('pop'); },
  notesstart: () => {
    const c = S.call; c.notes = c.startmode || 'full'; if (c.notes === 'full') c.keptFull = true; c.paused = false; c.pop = null; c.everOn = true; c.panel = 'notes'; c.tab = 'live';
    c.banner = 'You started notes. Everyone in the call can see they\u2019re on.';
    up('top', 'side', 'bot', 'pop', 'banner', 'stage');
    after(() => { if (S.call === c) { c.banner = null; up('banner'); } }, 4800);
  },
  notespause: () => {
    const c = S.call; c.paused = !c.paused; c.pop = null;
    c.banner = c.paused ? 'Notes paused. Nothing is transcribed until someone resumes.' : 'Notes resumed.';
    up('top', 'bot', 'pop', 'banner', 'stage');
    after(() => { if (S.call === c) { c.banner = null; up('banner'); } }, 3600);
  },
  notesstop: () => {
    const c = S.call; c.notes = 'off'; c.paused = false; c.pop = null;
    c.banner = 'Notes stopped. What was captured so far is kept.';
    up('top', 'side', 'bot', 'pop', 'banner', 'stage');
    after(() => { if (S.call === c) { c.banner = null; up('banner'); } }, 3600);
  },
  banner: () => { S.call.banner = null; up('banner'); },
  leave: () => endCall(),
  rejoin: () => { newCall({ title: S.end.title, notes: 'off', mode: 'host' }); go('call'); },
  jump: (el) => { const t = document.getElementById(el.dataset.v); if (t) t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }); },
  todo: (el) => { const i = el.dataset.v; S.doc.done[i] = !S.doc.done[i]; el.classList.toggle('done', !!S.doc.done[i]); el.setAttribute('aria-pressed', String(!!S.doc.done[i])); },
  ts: (el) => jumpTs(el.dataset.v),
  askq: (el) => answer(Number(el.dataset.v)),
  ask: () => {
    const q = S.doc.q.trim().toLowerCase(); if (!q) { $('[data-in="doc.q"]').focus(); return; }
    const d = DOCS[S.doc.kind];
    const score = (s) => s.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && q.includes(w)).length;
    let best = 0; d.qa.forEach((x, i) => { if (score(x[0] + ' ' + x[1]) > score(d.qa[best][0] + ' ' + d.qa[best][1])) best = i; });
    answer(best);
  },
  hometodo: (el) => { S.hdone = S.hdone || {}; const i = el.dataset.v; S.hdone[i] = !S.hdone[i]; el.closest('.todo').classList.toggle('done', S.hdone[i]); if (S.hdone[i]) toast('Done. Marked off in the notes too.'); },
  ansclose: () => { S.doc.answer = null; up('ask'); },
  sharenotes: () => toast(DOCS[S.doc.kind].kind === 'solo' ? 'Only you can read these notes. Sharing makes a copy for the people you pick.' : 'Link copied. Only people who were in the call can open it.', 'link'),
  recpause: () => { S.rec.paused = !S.rec.paused; up('recchip', 'recacts'); $('[data-bw]').classList.toggle('paused', S.rec.paused); },
  recstop: () => {
    const r = S.rec; const mins = Math.max(1, Math.round(r.t / 60));
    S.end = { kind: 'solo', add: true, dur: (r.t < 60 ? 1 : mins) + ' min', title: r.title, sub: `Recorded in the room \u00b7 ${r.t < 60 ? r.t + ' sec' : mins + ' min'}`, steps: ['Recording stopped', 'Last audio piece sealed and uploaded', 'Transcript and speakers worked out', 'Summary, decisions and action items written', 'Saved. Only you can read it.'] };
    S.credits = Math.max(0, S.credits - mins * 25);
    S.usage.unshift([r.title, `Today \u00b7 ${mins} min in the room`, -mins * 25]);
    go('ended');
  },
  recdiscard: () => { S.rec = null; go('home'); toast('Recording discarded. Nothing was kept.', 'trash'); }
};

/* ---------- events ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-a]');
  if (S.menu && !(el && el.dataset.a === 'menu')) { S.menu = false; renderMenu(); }
  if (S.map && !ev.target.closest('.map') && !(el && el.dataset.a === 'map')) { S.map = false; renderMap(); }
  if (S.screen === 'call' && S.call && S.call.pop && !ev.target.closest('.popover') && !(el && el.dataset.a === 'notespop')) { S.call.pop = null; up('pop'); }
  if (!el || el.disabled) return;
  const f = A[el.dataset.a];
  if (f) f(el, ev);
});
document.addEventListener('input', (ev) => {
  const el = ev.target; const k = el.dataset && el.dataset.in; if (!k) return;
  setPath(k, el.value);
  if (k === 'name') { const n = $('[data-pkname]'); if (n) n.textContent = el.value || 'Your name'; }
  if (k === 'code') { const b = $('[data-joinbtn]'); if (b) { b.classList.toggle('btn-pri', !!el.value.trim()); b.classList.toggle('btn-ghost', !el.value.trim()); } }
  if (k === 'pj.gname') { const b = $('[data-a="askjoin"]'); if (b && !S.pj.wait) b.disabled = !el.value.trim(); const n = $('.pv-name'); if (n) n.textContent = el.value || 'You'; }
});
document.addEventListener('keydown', (ev) => {
  const el = ev.target; const k = el.dataset && el.dataset.in;
  if (ev.key === 'Escape') {
    if (S.dialog) { A.close(); return; }
    if (S.menu) { S.menu = false; renderMenu(); return; }
    if (S.map) { S.map = false; renderMap(); return; }
    if (S.screen === 'call' && S.call.pop) { S.call.pop = null; up('pop'); return; }
  }
  if (ev.key === 'Enter') {
    if (k === 'code') { ev.preventDefault(); A.join(); }
    if (k === 'sched.gdraft') { ev.preventDefault(); const v = el.value.trim(); if (v) { S.sched.guests.push(v); S.sched.gdraft = ''; renderLayer(); $('#gi').focus(); } }
    if (k === 'doc.q') { ev.preventDefault(); A.ask(); }
    if (k === 'pj.gname' && el.value.trim()) { ev.preventDefault(); A.askjoin(); }
    if (k === 'call.msg') { ev.preventDefault(); A.chatsend(); }
    if (k === 'call.invite') { ev.preventDefault(); A.callinvite(); }
    if (k === 'siemail') { ev.preventDefault(); A.siemail(); }
    return;
  }
  if (ev.key === 'Backspace' && k === 'sched.gdraft' && !el.value && S.sched.guests.length) { S.sched.guests.pop(); renderLayer(); $('#gi').focus(); return; }
  if (!k && S.screen === 'call' && S.call && !ev.metaKey && !ev.ctrlKey && el.tagName !== 'INPUT') {
    const key = ev.key.toLowerCase();
    if (key === 'm') { S.call.mic = !S.call.mic; up('bot', 'stage'); toast(S.call.mic ? 'Microphone on' : 'Muted', S.call.mic ? 'mic' : 'micoff'); return; }
    if (key === 'v') { S.call.cam = !S.call.cam; up('bot', 'stage'); return; }
    if (key === 'c') { A.panel({ dataset: { v: 'chat' } }); return; }
  }
  if (!k && S.screen === 'home' && !S.dialog && (ev.key === 'n' || ev.key === 'N') && !ev.metaKey && !ev.ctrlKey) A.instant();
});

/* ---------- boot ---------- */
const h = (location.hash || '').slice(1);
const known = ['welcome', 'passkey', 'home', 'meetings', 'library', 'account', 'notes'];
if (known.includes(h)) { S.screen = h; mapKey = h; }
else if (h === 'recorder' || h === 'prejoin' || h === 'call' || h === 'ended') { mapgo({ recorder: 'recorder', prejoin: 'm-host', call: 'm-call-on', ended: 'm-ended' }[h]); }
if (!SC[S.screen]) S.screen = 'welcome';
if (!$('#app').innerHTML) render();
window.addEventListener('hashchange', () => {
  const x = (location.hash || '').slice(1);
  if (!x || x === S.screen) return;
  if (known.includes(x)) { mapKey = x; go(x); }
  else if (x === 'recorder') mapgo('recorder');
});
applyTheme();
})();

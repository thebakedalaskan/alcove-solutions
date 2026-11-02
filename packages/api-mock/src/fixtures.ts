import type { Meeting, Note, Person, PortraitStyle } from '@alcove/api';

const P = (id: string, name: string, email: string, portrait: PortraitStyle): Person => ({ id, name, email, portrait });

export const PEOPLE = {
  maya: P('u-maya', 'Maya Chen', 'maya.chen@gmail.com', { bg: '#F3D9C4', skin: '#EDC7A6', hair: '#1F1A17', style: 'bob', shirt: '#C2623A', room: ['#C98A5E', '#5D3F31', '#E8C29C'] }),
  ben: P('u-ben', 'Ben Ortiz', 'ben@harbor.health', { bg: '#CFE3D6', skin: '#B9835A', hair: '#2A1C14', style: 'curly', beard: true, shirt: '#2F5D4B', room: ['#5F8C76', '#26352D', '#A8C2A4'] }),
  priya: P('u-priya', 'Priya Raman', 'priya@alcove.team', { bg: '#E6D4EC', skin: '#A86F4C', hair: '#1B1311', style: 'long', shirt: '#6E3F80', room: ['#9A6FA8', '#35263F', '#D7B3C6'] }),
  jon: P('u-jon', 'Jon Weiss', 'jon@alcove.team', { bg: '#D3DEEC', skin: '#F0CFB4', hair: '#B5562B', style: 'short', glasses: true, shirt: '#34507A' }),
  ama: P('u-ama', 'Ama Kusi', 'ama@alcove.team', { bg: '#EFE2C2', skin: '#7A4A30', hair: '#18110E', style: 'afro', shirt: '#A07A2C' }),
  leo: P('u-leo', 'Leo Sato', 'leo@alcove.team', { bg: '#D6E0E6', skin: '#E3B996', hair: '#26211E', style: 'swept', shirt: '#4F6B8A' }),
  dana: P('u-dana', 'Dana Ruiz', 'dana@northwind.vc', { bg: '#F4E1CF', skin: '#F2D3BA', hair: '#D9A95B', style: 'bun', shirt: '#8A5A44' })
} satisfies Record<string, Person>;

export const CONTACTS: Person[] = Object.values(PEOPLE);
export const findPerson = (email: string) => CONTACTS.find((p) => p.email.toLowerCase() === email.toLowerCase());

const MIN = 60_000;
const at = (base: Date, dayOffset: number, h: number, m: number) => {
  const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d;
};
const iso = (d: Date) => d.toISOString();
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);
let codeN = 0;
export const makeCode = () => {
  const a = 'abcdefghijkmnpqrstuvwxyz';
  const pick = (n: number) => Array.from({ length: n }, () => a[Math.floor(Math.random() * a.length)]).join('');
  codeN++;
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
};

const guest = (p: Person, rsvp: 'yes' | 'pending' | 'no' = 'yes') => ({ email: p.email, person: p, rsvp });

/** Demo meetings are placed relative to now so the app always looks lived in. */
export function demoMeetings(now = new Date()): Meeting[] {
  const next = plus(now, 12);
  const m = (id: string, title: string, start: Date, minutes: number, rest: Partial<Meeting>): Meeting => ({
    id, title, startsAt: iso(start), endsAt: iso(plus(start, minutes)), host: PEOPLE.maya, isHost: true, guests: [],
    notes: 'full', audience: 'everyone', code: rest.code ?? makeCode(), status: 'scheduled', ...rest
  });
  return [
    m('m-harbor', 'Harbor pilot review', plus(now, -150), 32, { status: 'ended', duration: 32 * 60, noteId: 'n-harbor', guests: [guest(PEOPLE.ben), guest(PEOPLE.priya), guest(PEOPLE.jon)] }),
    m('m-sync', 'Weekly product sync', next, 30, { host: PEOPLE.ben, isHost: false, code: 'kpw-rnzq-hte', guests: [guest(PEOPLE.ben), guest(PEOPLE.priya), guest(PEOPLE.jon)] }),
    m('m-jon', '1:1 with Jon', plus(now, 150), 45, { notes: 'off', guests: [guest(PEOPLE.jon)] }),
    m('m-crit', 'Design crit', plus(now, 330), 30, { notes: 'ask', guests: [guest(PEOPLE.priya), guest(PEOPLE.ama, 'pending'), guest(PEOPLE.leo, 'no')] }),
    m('m-kick', 'Harbor kickoff prep', at(now, 1, 9, 30), 30, { guests: [guest(PEOPLE.ben), guest(PEOPLE.priya), guest(PEOPLE.dana, 'pending')] }),
    m('m-board', 'Board update', at(now, 3, 14, 0), 60, { notes: 'notes', guests: [guest(PEOPLE.dana), { email: 'r.ito@lumen.capital', rsvp: 'yes' }, { email: 'k.osei@fieldstone.com', rsvp: 'pending' }, guest(PEOPLE.ben)] }),
    m('m-sam', 'Interview: Sam Lee', at(now, 4, 11, 0), 45, { notes: 'off', guests: [{ email: 'sam.lee@fastmail.com', rsvp: 'yes' }, guest(PEOPLE.leo)] }),
    m('m-crit-old', 'Design crit', at(now, -3, 16, 0), 41, { status: 'ended', duration: 41 * 60, notes: 'off', guests: [guest(PEOPLE.priya), guest(PEOPLE.ama), guest(PEOPLE.leo)] }),
    m('m-legal', 'Harbor legal sync', at(now, -4, 11, 0), 25, { status: 'ended', duration: 25 * 60, notes: 'notes', noteId: 'n-legal', guests: [guest(PEOPLE.ben), guest(PEOPLE.priya)] })
  ];
}

const sp = (p: Person) => ({ name: p.name, person: p });

export const CALL_SCRIPT: { who: keyof typeof PEOPLE; text: string; tag?: 'share' | 'dec' | 'act0' | 'act1' | 'act2' }[] = [
  { who: 'ben', text: 'Okay. Harbor’s legal team signed the data agreement last night.' },
  { who: 'priya', text: 'Great, so the only open question is where the pilot data lives.' },
  { who: 'maya', text: 'It stays in their region. The notes service runs in their own cloud account.', tag: 'dec' },
  { who: 'jon', text: 'Do their people need to install anything?' },
  { who: 'ben', text: 'No. They join from a link, same as we do.' },
  { who: 'maya', text: 'Let me share the timeline so we can lock dates.', tag: 'share' },
  { who: 'priya', text: 'Let’s lock the kickoff for November tenth.' },
  { who: 'maya', text: 'Agreed. I’ll send the invite today.', tag: 'act0' },
  { who: 'jon', text: 'I’ll draft the go/no-go criteria before the data review.', tag: 'act1' },
  { who: 'ben', text: 'We should also ask them who owns the notes after the pilot.' },
  { who: 'priya', text: 'I’ll add that to the agreement as a question.', tag: 'act2' }
];
export const LIVE_ITEMS = {
  dec: 'Pilot data stays in Harbor’s region',
  act0: 'Maya — send the kickoff invite',
  act1: 'Jon — draft go/no-go criteria',
  act2: 'Priya — add data ownership question'
} as const;
export const SCREEN_LINES = [
  { title: 'Pilot timeline', text: 'Kickoff Nov 10 · Data review Nov 24 · Go/no-go Dec 8' },
  { title: 'Owners', text: 'Maya: kickoff · Jon: criteria · Priya: agreement' }
];
export const ROOM_SCRIPT: { speaker: string; text: string }[] = [
  { speaker: 'Speaker 2', text: 'Let’s start with runway. That’s the first thing they’ll ask.' },
  { speaker: 'Speaker 1', text: 'Eighteen months at current burn.' },
  { speaker: 'Speaker 2', text: 'Say exactly that, then go straight to hiring.' },
  { speaker: 'Speaker 1', text: 'We hold at four roles until the pilot results are in.' },
  { speaker: 'Speaker 2', text: 'Good. Move runway up to slide two.' },
  { speaker: 'Speaker 1', text: 'I’ll add the Harbor timeline after the product section.' },
  { speaker: 'Speaker 2', text: 'I’ll open, you take product and the pilot.' },
  { speaker: 'Speaker 2', text: 'I’ll send the final deck Thursday morning.' }
];

const t = (mmss: string) => { const [m, s] = mmss.split(':').map(Number); return (m ?? 0) * 60 + (s ?? 0); };
let lid = 0;
const line = (mmss: string, who: Person | string, text: string) => ({ id: `l${++lid}`, at: t(mmss), speaker: typeof who === 'string' ? { name: who } : sp(who), text });

export function callNoteBody(): Omit<Note, 'id' | 'title' | 'startedAt' | 'duration' | 'meetingId' | 'keep' | 'excerpt' | 'openActions' | 'totalActions'> {
  return {
    kind: 'call',
    people: [PEOPLE.maya, PEOPLE.ben, PEOPLE.priya, PEOPLE.jon],
    audience: 'everyone',
    summary: 'Harbor’s legal team signed the data agreement, which clears the way for the pilot. Pilot data stays in Harbor’s region, with the notes service running in Harbor’s own cloud account. Harbor staff join from a link and install nothing. Kickoff is November 10, the data review November 24 and the go/no-go December 8.',
    decisions: ['Kickoff is November 10.', 'Pilot data stays in Harbor’s region.', 'Harbor staff join by link. Nothing to install.'],
    actions: [
      { id: 'a1', text: 'Send the kickoff invite', owner: sp(PEOPLE.maya), due: 'Today', done: false },
      { id: 'a2', text: 'Draft the go/no-go criteria', owner: sp(PEOPLE.jon), due: 'Nov 21', done: false },
      { id: 'a3', text: 'Add the data ownership question to the agreement', owner: sp(PEOPLE.priya), due: 'Nov 6', done: false },
      { id: 'a4', text: 'Confirm cloud account access with Harbor IT', owner: sp(PEOPLE.ben), due: 'Nov 6', done: false }
    ],
    chapters: [
      { at: t('00:08'), title: 'Data agreement', summary: 'Legal signed it last night.' },
      { at: t('04:12'), title: 'Where the data lives', summary: 'Harbor’s region, Harbor’s cloud account.' },
      { at: t('11:30'), title: 'Pilot timeline', summary: 'Shared on screen. Three dates agreed.' },
      { at: t('19:20'), title: 'Owners and next steps', summary: 'Four action items, one open question.' }
    ],
    screens: [{ at: t('11:30'), by: 'Maya', title: 'Pilot timeline', text: 'Kickoff Nov 10 · Data review Nov 24 · Go/no-go Dec 8. Owners: Maya (kickoff), Jon (criteria), Priya (agreement).' }],
    transcript: [
      line('00:08', PEOPLE.ben, 'Okay. Harbor’s legal team signed the data agreement last night.'),
      line('00:15', PEOPLE.priya, 'Great, so the only open question is where the pilot data lives.'),
      line('04:12', PEOPLE.maya, 'It stays in their region. The notes service runs in their own cloud account.'),
      line('05:50', PEOPLE.jon, 'Do their people need to install anything?'),
      line('06:05', PEOPLE.ben, 'No. They join from a link, same as we do.'),
      line('11:30', PEOPLE.maya, 'Let me share the timeline so we can lock dates.'),
      line('11:42', PEOPLE.maya, 'Kickoff on the tenth, data review on the twenty-fourth, go/no-go on December eighth.'),
      line('12:10', PEOPLE.priya, 'Let’s lock the kickoff for November tenth.'),
      line('12:16', PEOPLE.maya, 'Agreed. I’ll send the invite today.'),
      line('19:20', PEOPLE.jon, 'I’ll draft the go/no-go criteria before the data review.'),
      line('21:40', PEOPLE.ben, 'We should also ask them who owns the notes after the pilot.'),
      line('22:02', PEOPLE.priya, 'I’ll add that to the agreement as a question.'),
      line('23:15', PEOPLE.ben, 'And I’ll confirm cloud access with their IT this week.')
    ],
    suggestedQuestions: ['When is the go/no-go?', 'Does Harbor need to install anything?', 'Who owns the notes after the pilot?']
  };
}

export function roomNoteBody(): Omit<Note, 'id' | 'title' | 'startedAt' | 'duration' | 'meetingId' | 'keep' | 'excerpt' | 'openActions' | 'totalActions'> {
  return {
    kind: 'room',
    people: [PEOPLE.maya],
    audience: 'host',
    summary: 'A run-through of Thursday’s board update. Lead with runway: eighteen months at current burn. Hiring holds at four roles until the Harbor pilot results are in. Dana opens; Maya covers product and the pilot.',
    decisions: ['Lead with runway: 18 months at current burn.', 'Hiring holds at four roles until pilot results.'],
    actions: [
      { id: 'b1', text: 'Move runway to slide 2', owner: sp(PEOPLE.maya), due: 'Wed', done: false },
      { id: 'b2', text: 'Add the Harbor timeline after product', owner: sp(PEOPLE.maya), due: 'Wed', done: false },
      { id: 'b3', text: 'Send the final deck to the board', owner: sp(PEOPLE.dana), due: 'Thu 9:00', done: false }
    ],
    chapters: [
      { at: t('00:04'), title: 'Runway', summary: 'Open with the number.' },
      { at: t('03:40'), title: 'Hiring', summary: 'Four roles until the pilot reads out.' },
      { at: t('09:18'), title: 'Product and pilot', summary: 'Timeline goes after product.' },
      { at: t('14:30'), title: 'Who presents what', summary: 'Dana opens, Maya follows.' }
    ],
    screens: [],
    transcript: [
      line('00:04', 'Speaker 2', 'Let’s start with runway. That’s the first thing they’ll ask.'),
      line('00:11', 'Speaker 1', 'Eighteen months at current burn.'),
      line('00:15', 'Speaker 2', 'Say exactly that, then go straight to hiring.'),
      line('03:40', 'Speaker 1', 'We hold at four roles until the pilot results are in.'),
      line('03:52', 'Speaker 2', 'Good. Move runway up to slide two.'),
      line('09:18', 'Speaker 1', 'I’ll add the Harbor timeline after the product section.'),
      line('14:30', 'Speaker 2', 'I’ll open, you take product and the pilot.'),
      line('26:02', 'Speaker 2', 'I’ll send the final deck Thursday morning.')
    ],
    suggestedQuestions: ['What’s our runway?', 'What changes on the slides?', 'Who opens the meeting?']
  };
}

/** Canned answers keyed by the suggested question; free text is matched by keyword. */
export const ANSWERS: Record<string, string> = {
  'When is the go/no-go?': 'December 8. It was on the pilot timeline Maya shared {11:42}, and Jon is drafting the criteria before the data review on November 24 {19:20}.',
  'Does Harbor need to install anything?': 'No. Ben said Harbor staff join from a link, the same way the team does {06:05}.',
  'Who owns the notes after the pilot?': 'Still open. Ben raised it {21:40} and Priya is adding it to the agreement as a question {22:02}.',
  'What’s our runway?': 'Eighteen months at current burn {00:11}.',
  'What changes on the slides?': 'Runway moves to slide two {03:52}, and the Harbor timeline goes after the product section {09:18}.',
  'Who opens the meeting?': 'Dana opens, then you take product and the pilot {14:30}.'
};

/*
 * What the workspace stories share. The workspace is Vandelay's Product, as the stand-in has it (src/api/scenarios.ts):
 * Launch plan, Launch checklist, Research with Interview notes in it, and Pricing page copy, with Design beside it. The
 * call is Priya's Launch check-in, going on now (stories/calls/talk.ts). The words on the pages, in the notes and in the
 * transcript are the in-call workspace canvas's, said by the demo world's people.
 *
 * A page is drawn in the editor's own classes, without the editor. `useWorkspace` keeps what the app would (which page is
 * open, which folders, which menu, what's being named, the toasts), so a list and a document put together from the kit
 * answer what's pressed: rows open, folders twist, menus open and do what they say, and the toasts say so.
 */
import type { Person } from '@alcove/api';
import {
  Avatar, Icon, WsDoc, WsDocBy, WsDocHead, WsDocMenu, WsEmpty, WsFade, WsFollowBar, WsFollowUps, WsHistory, WsList, WsListHead, WsMovePicker,
  WsNewMenu, WsNotesPage, WsPage, WsPane, WsPersonCard, WsPresentPreview, WsPresenterView, WsPresentStrip, WsRenameRow, WsRow, WsRowMenu, WsScroll, WsSection, WsShareSheet,
  WsSpacePicker, WsSwitchSheet, WsTail, WsTemplates, WsTranscript, cn, wsToast,
  type IconName, type WsDecision, type WsFace, type WsFolderChoice, type WsFollowing, type WsFollowUp, type WsPop, type WsPoint, type WsSaid,
  type WsSave, type WsShareMatch, type WsShareRow, type WsSpaceChoice, type WsToastData, type WsVersion
} from '@alcove/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TEMPLATES } from '~/features/workspace/editor/templates';
import { did } from '../../../src/component';
import { AIKO, ANA, ART, DIEGO, JONAS, KOFI, LENA, MAYA, PRIYA, SAM } from '../../../src/world/people';

/* ---------- people and the call ---------- */

/** The first word of someone's name, which is what the workspace calls them. */
export const first = (p: { name: string }): string => p.name.split(' ')[0] ?? p.name;

/** The call these stories happen in: Priya's Launch check-in, which began at 16:00. Art, Kofi, Aiko and Maya are in it. */
export const CALL = { title: 'Launch check-in', organizer: PRIYA };

/** Someone in the call from outside the company, who can't open the workspace. */
export const GUEST = JONAS;

/* ---------- a page, in the editor's classes ---------- */

/** A line on a page, as the editor draws it. Without `text` it's empty, and `hint` is what it says while you're on it. */
export interface Line {
  kind: 'p' | 'h2' | 'ul' | 'ol' | 'todo' | 'quote' | 'callout';
  text?: ReactNode;
  done?: boolean | undefined;
  icon?: IconName | undefined;
  hint?: string | undefined;
}
const LINE_CLASS: Record<Line['kind'], string> = { p: 'is-p', h2: 'is-h2', ul: 'is-ul', ol: 'is-ol', todo: 'is-todo', quote: 'is-quote', callout: 'is-callout' };

/** Someone tagged in a line. */
export const Tag = ({ person }: { person: Person }) => <span className="wn"><span className="wn-f"><Avatar person={person} size={17} /></span><b>{first(person)}</b></span>;
/** A date in a line. */
export const Due = ({ day }: { day: string }) => <span className="wdt"><Icon name="cal" size={13} /><b>{day}</b></span>;

/** Lines in the editor's classes. Ticking a checklist line works. */
export function Lines({ lines }: { lines: readonly Line[] }) {
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set(lines.flatMap((l, i) => (l.done ? [i] : []))));
  const tick = (i: number) => setDone((now) => { const next = new Set(now); if (!next.delete(i)) next.add(i); return next; });
  let count = 0;
  return (
    <>
      {lines.map((l, i) => {
        count = l.kind === 'ol' ? count + 1 : 0;
        const ticked = done.has(i);
        return (
          <div key={i} className={cn('wb', LINE_CLASS[l.kind], ticked && 'is-done', l.text === undefined && l.hint && 'is-empty')} style={{ '--ind': 0 }}>
            {l.kind === 'ul' && <span className="wb-mk" aria-hidden="true" />}
            {l.kind === 'ol' && <span className="wb-n">{count}.</span>}
            {l.kind === 'todo' && <button type="button" className="wb-box" role="checkbox" aria-checked={ticked} aria-label="Done" onClick={() => tick(i)}><Icon name="check" size={13} /></button>}
            {l.kind === 'callout' && <span className="wb-ci"><Icon name={l.icon ?? 'bulb'} size={17} /></span>}
            <div className="wb-col"><div className="wb-t" data-ph={l.hint}>{l.text}</div></div>
          </div>
        );
      })}
    </>
  );
}

/** A document's page without the editor: its title, whose it is, its lines, and what goes under them (`after`). */
export function PageText({ title, by, edited, lines, after }: { title: string; by?: Person | undefined; edited?: string | undefined; lines: readonly Line[]; after?: ReactNode }) {
  return (
    <div className="ws-ed">
      <div className="ws-text">
        <h1 className="wd-title" data-ph="Untitled">{title}</h1>
        {by && <div className="wd-by-slot"><WsDocBy person={by} name={first(by)} edited={edited ?? 'Edited just now'} /></div>}
        <Lines lines={lines} />
      </div>
      {after}
    </div>
  );
}

/** The line a new page starts with, saying what to do while you're on it. */
export const FIRST_LINE: Line = { kind: 'p', hint: 'Press / for blocks, @ to tag someone' };

/** What each template starts a page with (the editor's templates.ts), the first empty line saying what it's for. */
export const TEMPLATE_LINES: ReadonlyMap<string, Line[]> = new Map<string, Line[]>([
  ['agenda', [{ kind: 'h2', text: 'From last time' }, { kind: 'todo', hint: 'To do' }, { kind: 'h2', text: 'Today' }, { kind: 'ol' }, { kind: 'h2', text: 'Notes' }, { kind: 'p' }]],
  ['decisions', [{ kind: 'h2', text: 'Decided' }, { kind: 'ul', hint: 'List' }, { kind: 'h2', text: 'Still open' }, { kind: 'todo' }]],
  ['retro', [{ kind: 'h2', text: 'Went well' }, { kind: 'ul', hint: 'List' }, { kind: 'h2', text: 'Could improve' }, { kind: 'ul' }, { kind: 'h2', text: 'Actions' }, { kind: 'todo' }]],
  ['brief', [{ kind: 'h2', text: 'Goal' }, { kind: 'p', hint: FIRST_LINE.hint }, { kind: 'h2', text: 'People' }, { kind: 'ul' }, { kind: 'h2', text: 'Dates' }, { kind: 'ul' }, { kind: 'h2', text: 'Risks' }, { kind: 'ul' }]]
]);

/* ---------- the documents ---------- */

/** What's on a document's page, and whose it is. */
export interface DocText { by: Person; edited: string; lines: Line[] }

const PLAN_INTRO: Line[] = [
  { kind: 'callout', icon: 'megaphone', text: <>Harbour launches on <b>Tue 24 Nov</b>. The press embargo lifts at 09:00 GMT.</> },
  { kind: 'h2', text: 'What we’re launching' },
  { kind: 'p', text: 'Harbour lets importers follow every container from the port to the warehouse, in one place. Pilot customers cut the time they spend chasing shipments by more than half.' }
];
const PLAN_MESSAGING: Line[] = [
  { kind: 'h2', text: 'Messaging' },
  { kind: 'ul', text: 'One view from port to warehouse' },
  { kind: 'ul', text: 'Customs paperwork filled in for you' }
];
const PLAN_QUESTIONS: Line[] = [
  { kind: 'h2', text: 'Open questions' },
  { kind: 'todo', text: <>Do we brief trade press before the 24th? <Tag person={PRIYA} /> <Due day="Fri 6 Nov" /></> },
  { kind: 'todo', text: <>Who signs off the final pricing? <Tag person={ART} /> <Due day="Tue 10 Nov" /></> }
];

/** Launch plan, one section at a time, as it's presented. */
export const SECTIONS: { name: string; lines: Line[] }[] = [
  { name: 'What we’re launching', lines: PLAN_INTRO },
  { name: 'Messaging', lines: PLAN_MESSAGING },
  { name: 'Open questions', lines: PLAN_QUESTIONS }
];

export const TEXT: ReadonlyMap<string, DocText> = new Map<string, DocText>([
  ['plan', { by: PRIYA, edited: 'Edited 2 h ago', lines: [...PLAN_INTRO, ...PLAN_MESSAGING, ...PLAN_QUESTIONS] }],
  ['checklist', {
    by: MAYA, edited: 'Edited 5 h ago', lines: [
      { kind: 'h2', text: 'Before the 24th' },
      { kind: 'todo', done: true, text: <>Pricing page copy approved <Tag person={KOFI} /></> },
      { kind: 'todo', text: <>Customer stories signed off <Tag person={AIKO} /></> },
      { kind: 'todo', text: <>Press kit uploaded <Tag person={PRIYA} /> <Due day="Fri 13 Nov" /></> },
      { kind: 'todo', text: <>Support replies written <Tag person={MAYA} /></> },
      { kind: 'h2', text: 'On the day' },
      { kind: 'todo', text: <>Embargo lifts, 09:00 GMT <Tag person={PRIYA} /></> },
      { kind: 'todo', text: <>Customer email goes out <Tag person={KOFI} /> <Due day="Tue 24 Nov" /></> }
    ]
  }],
  ['interviews', {
    by: LENA, edited: 'Edited Friday', lines: [
      { kind: 'p', text: 'Six importers, three countries, one question: what do you do when a container goes quiet?' },
      { kind: 'quote', text: 'I ring the port. Then I ring the port again.' },
      { kind: 'h2', text: 'What we heard' },
      { kind: 'ul', text: 'Nobody trusts the arrival date until it’s on the dock' },
      { kind: 'ul', text: 'Customs delays cost more than freight' }
    ]
  }],
  ['pricing', {
    by: LENA, edited: 'Edited yesterday', lines: [
      { kind: 'callout', icon: 'bulb', text: 'Legal reads this before it goes live.' },
      { kind: 'h2', text: 'Headline' },
      { kind: 'p', text: 'Every container, from the port to the warehouse, on one screen.' },
      { kind: 'h2', text: 'Plans' },
      { kind: 'ul', text: 'Starter, for up to 50 containers a month' },
      { kind: 'ul', text: 'Team, for every container and five people' },
      { kind: 'ul', text: 'Company, with single sign-on and someone to call' }
    ]
  }],
  ['empty-states', {
    by: KOFI, edited: 'Edited 8 h ago', lines: [
      { kind: 'p', text: 'Every list gets a designed empty state, never blank space.' },
      { kind: 'h2', text: 'Still to draw' },
      { kind: 'todo', text: <>Notes, before the first call <Tag person={AIKO} /></> },
      { kind: 'todo', text: <>Team, before anyone joins <Tag person={KOFI} /></> }
    ]
  }]
]);

/* ---------- the workspaces ---------- */

export type Kind = 'document' | 'folder';
/** Something in a workspace's list. `parent` is the folder it's in. */
export interface Item { id: string; name: string; kind: Kind; parent: string | null }

/** The workspaces Art can choose for a call, as the picker lists them. */
export const SPACES: WsSpaceChoice[] = [
  { id: 'ws-product', name: 'Product', sub: '6 people' },
  { id: 'ws-design', name: 'Design', sub: '4 people' }
];
/** The workspace a call gets when the organizer makes one: theirs, named for them. */
export const NEW_SPACE: WsSpaceChoice = { id: 'ws-new', name: 'Art’s workspace', sub: 'Just you', icon: 'lock' };

export const PRODUCT_ITEMS: Item[] = [
  { id: 'plan', name: 'Launch plan', kind: 'document', parent: null },
  { id: 'checklist', name: 'Launch checklist', kind: 'document', parent: null },
  { id: 'research', name: 'Research', kind: 'folder', parent: null },
  { id: 'interviews', name: 'Interview notes', kind: 'document', parent: 'research' },
  { id: 'pricing', name: 'Pricing page copy', kind: 'document', parent: null }
];
const ITEMS: ReadonlyMap<string, Item[]> = new Map([
  ['ws-product', PRODUCT_ITEMS],
  ['ws-design', [{ id: 'empty-states', name: 'Empty states', kind: 'document', parent: null }]]
]);
/** Who in the call can't open each workspace, by first name. */
const CANT_OPEN: ReadonlyMap<string, string[]> = new Map([['ws-design', ['Maya']], ['ws-new', ['Priya', 'Kofi', 'Aiko', 'Maya']]]);

/** The documents brought to the call, at the top of the list under This call. */
export const BROUGHT = ['plan', 'checklist'];
/** Who's in which document in the call, as their faces on its row and its head say. */
export const HERE: ReadonlyMap<string, Person[]> = new Map([['plan', [PRIYA, KOFI]], ['checklist', [AIKO]]]);

/** The call's own pages, at the top of the list. */
export const LIVE: { id: string; name: string; icon: IconName }[] = [
  { id: '$notes', name: 'Notes', icon: 'notes' },
  { id: '$followups', name: 'Follow-ups', icon: 'todos' },
  { id: '$transcript', name: 'Transcript', icon: 'transcript' }
];

/** Everyone at the company and outside it that the share field can find, who doesn't have the document yet. */
export const FINDABLE: Person[] = [LENA, SAM, DIEGO, JONAS, ANA];

/* ---------- the call's notes, follow-ups and transcript, twelve minutes in ---------- */

export const SUMMARY = 'Press timing is settled: trade press are briefed on the 20th and the embargo lifts on the 24th. The pricing page goes to legal today, and two pilot customers have agreed to be named.';
export const DECIDED: WsDecision[] = [
  { id: 'd1', text: 'The embargo lifts Tue 24 Nov at 09:00 GMT', at: '16:04' },
  { id: 'd2', text: 'The pricing page goes to legal today', at: '16:08' }
];
const opensLine = did('onSource');
export const FOLLOW_UPS: WsFollowUp[] = [
  { id: 'f1', text: 'Send the pricing page to legal', done: false, person: KOFI, name: 'Kofi', due: 'Today', source: 'Said at 16:08' },
  { id: 'f2', text: 'Book the trade press briefing', done: true, person: PRIYA, name: 'Priya', due: 'Fri 6 Nov', source: 'Said at 16:10' },
  { id: 'f3', text: 'Do we brief trade press before the 24th?', done: false, person: PRIYA, name: 'Priya', due: 'Fri 6 Nov', source: 'Launch plan', onSource: opensLine },
  { id: 'f4', text: 'Who signs off the final pricing?', done: false, person: ART, name: 'Art', due: 'Tue 10 Nov', source: 'Launch plan', onSource: opensLine },
  { id: 'f5', text: 'Press kit uploaded', done: false, person: PRIYA, name: 'Priya', due: 'Fri 13 Nov', source: 'Launch checklist', onSource: opensLine },
  { id: 'f6', text: 'Customer email goes out', done: false, person: KOFI, name: 'Kofi', due: 'Tue 24 Nov', source: 'Launch checklist', onSource: opensLine }
];
export const LINES: WsSaid[] = [
  { id: 'l1', person: ART, name: 'Art', at: '16:04', text: 'So the embargo lifts on the 24th at nine. Everyone happy with that?' },
  { id: 'l2', person: PRIYA, name: 'Priya', at: '16:04', text: 'Yes. Tuesday the 24th, 09:00 GMT.' },
  { id: 'l3', person: KOFI, name: 'Kofi', at: '16:08', text: 'The pricing page is ready, apart from legal. I’ll send it over today.' },
  { id: 'l4', person: PRIYA, name: 'Priya', at: '16:09', text: 'If we brief trade press on the 20th, the embargo still holds.' },
  { id: 'l5', person: KOFI, name: 'Kofi', at: '16:10', text: 'Legal needs the final copy by Friday or we miss the window.' },
  { id: 'l6', person: AIKO, name: 'Aiko', at: '16:11', text: 'Two pilot customers are happy to be named.' },
  { id: 'l7', person: ART, name: 'Art', at: '16:11', text: 'Let’s lead with the port-to-warehouse view.' }
];
/** What's being said right now. */
export const SPEAKING = { person: PRIYA, name: 'Priya', text: 'And the photos go into the press kit as well' };

/** Launch plan's history, newest first: now, this call, the call before, and back to when Priya made it. */
export const VERSIONS: (WsVersion & { when: string; lines: number })[] = [
  { id: 'v-now', name: 'Now', sub: 'Priya, Kofi and you', at: '16:12', when: '16:12 today', lines: 9 },
  { id: 'v-call', name: 'During this call', sub: 'Started at 16:00 · 3 people', at: 'Today', when: '16:00 today', lines: 8 },
  { id: 'v-last', name: 'Launch check-in', sub: 'Wed 28 Oct · 4 people', at: '28 Oct', when: 'Wed 28 Oct', lines: 6 },
  { id: 'v-edits', name: 'Priya’s edits', sub: 'Mon 26 Oct', at: '26 Oct', when: 'Mon 26 Oct', lines: 3 },
  { id: 'v-made', name: 'Created by Priya', sub: 'Thu 22 Oct', at: '22 Oct', when: 'Thu 22 Oct', lines: 1 }
];

/* ---------- toasts ---------- */

/** A toast on show, with the id the corner keys it by. */
export type Shown = Omit<WsToastData, 'ms'> & { id: number };

/**
 * Toasts that go by themselves after their time, as whoever shows them takes them away. Pressing a toast's action takes
 * it away too. `initial`: toasts already up when the story starts.
 */
export function useToasts(initial: readonly WsToastData[] = []) {
  const next = useRef(initial.length);
  const timers = useRef(new Set<number>());
  const drop = useCallback((id: number) => setToasts((now) => now.filter((t) => t.id !== id)), []);
  const shown = useCallback((toast: WsToastData, id: number): Shown => {
    const { ms: _ms, action, ...rest } = toast;
    return { ...rest, id, action: action && { label: action.label, onClick: () => { action.onClick(); drop(id); } } };
  }, [drop]);
  const later = useCallback((id: number, ms: number) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); drop(id); }, ms);
    timers.current.add(timer);
  }, [drop]);
  const [toasts, setToasts] = useState<Shown[]>(() => initial.map((t, i) => shown(t, i + 1)));
  useEffect(() => {
    initial.forEach((t, i) => later(i + 1, t.ms));
    const pending = timers.current;
    return () => { for (const t of pending) clearTimeout(t); pending.clear(); };
    // The toasts a story starts with are only ever its first ones.
  }, []);
  const say = useCallback((toast: WsToastData) => {
    next.current += 1;
    const id = next.current;
    setToasts((now) => [...now, shown(toast, id)].slice(-3));
    later(id, toast.ms);
  }, [shown, later]);
  return { toasts, say };
}

/* ---------- a workspace that answers ---------- */

/** What's on the page: a document or one of the call's pages, and which part of the list it was opened from. */
export interface At { id: string; area: 'pins' | 'tree' }
/** The popover that's open, where someone right-clicked, and whether Move to… or a switch has taken the menu's place. */
export interface Opened { key: string; at?: WsPoint | undefined; step?: 'move' | 'switch' | undefined; to?: string | undefined }
/** A row being named: an item, or a new folder (`id` null) in `parent`. */
export interface Naming { id: string | null; kind: Kind; parent: string | null }

const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };

/**
 * A workspace's state, kept as the app keeps it. `call`: it's the call's, with This call at the top of the list and the
 * documents brought to it. `organizer`: Art organizes the call, so he chooses its workspace (in Priya's Launch check-in
 * he doesn't). `start`: what's open first. `space`: which workspace.
 */
export function useWorkspace({ call, organizer = false, start = 'plan', space: startSpace = 'ws-product', opened: startOpened = null, presenting: startPresenting = false, onGo }: {
  call: boolean; organizer?: boolean | undefined; start?: string | undefined; space?: string | undefined;
  /** Art is presenting Launch plan when the story starts. */
  presenting?: boolean | undefined;
  /** A popover that's open when the story starts: `picker`, `new`, `share`, `present`, `more`, `menu:tree:plan`… */
  opened?: Opened | null | undefined;
  /** Something was opened from the list: following stops, and a phone's list or a peek goes away. */
  onGo?: ((id: string) => void) | undefined;
}) {
  const { toasts, say } = useToasts();
  const [spaces, setSpaces] = useState<WsSpaceChoice[]>(startSpace === NEW_SPACE.id ? [...SPACES, NEW_SPACE] : SPACES);
  const [space, setSpace] = useState(startSpace);
  const [items, setItems] = useState<Item[]>(ITEMS.get(startSpace) ?? []);
  const [texts, setTexts] = useState<ReadonlyMap<string, DocText>>(TEXT);
  const [trashed, setTrashed] = useState<ReadonlySet<string>>(new Set());
  const [folders, setFolders] = useState<ReadonlySet<string>>(new Set(['research']));
  const [at, setAt] = useState<At>({ id: start, area: call && (BROUGHT.includes(start) || start.startsWith('$')) ? 'pins' : 'tree' });
  const [brought, setBrought] = useState<string[]>(call && startSpace === 'ws-product' ? BROUGHT : []);
  const [opened, setOpened] = useState<Opened | null>(startOpened);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(startPresenting);
  const made = useRef(0);

  useEffect(() => {
    if (flash === null) return undefined;
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(t);
  }, [flash]);

  const shown = items.filter((i) => !trashed.has(i.id) && !(i.parent !== null && trashed.has(i.parent)));
  const itemOf = (id: string) => shown.find((i) => i.id === id);
  const nameOf = (id: string) => itemOf(id)?.name || 'Untitled';
  const spaceName = spaces.find((s) => s.id === space)?.name ?? 'Product';
  const above = (id: string): Item[] => {
    const out: Item[] = [];
    for (let p = itemOf(id)?.parent ?? null, guard = 0; p !== null && guard < 9; guard += 1) {
      const folder = itemOf(p);
      if (!folder) break;
      out.unshift(folder);
      p = folder.parent;
    }
    return out;
  };

  const pop = (key: string, content: ReactNode): WsPop => ({
    open: opened?.key === key, onOpenChange: (to) => setOpened(to ? { key } : null), content, at: opened?.key === key ? opened.at : undefined
  });
  const go = (id: string, area: At['area'] = 'tree') => { setAt({ id, area }); setOpened(null); setHistory(null); onGo?.(id); };
  const twist = (id: string) => setFolders((now) => toggled(now, id));
  const add = (kind: Kind, parent: string | null, name: string, after?: string): string => {
    made.current += 1;
    const id = `new-${made.current}`;
    const item: Item = { id, name, kind, parent };
    setItems((now) => {
      const i = after === undefined ? -1 : now.findIndex((x) => x.id === after);
      return i < 0 ? [...now, item] : [...now.slice(0, i + 1), item, ...now.slice(i + 1)];
    });
    if (parent !== null) setFolders((now) => new Set([...now, parent]));
    setFlash(id);
    return id;
  };
  const newDocument = (parent: string | null) => {
    const id = add('document', parent, '');
    setTexts((now) => new Map([...now, [id, { by: ART, edited: 'Edited just now', lines: [FIRST_LINE] }]]));
    go(id);
  };
  const newFolder = (parent: string | null) => {
    if (parent !== null) setFolders((now) => new Set([...now, parent]));
    setNaming({ id: null, kind: 'folder', parent });
    setOpened(null);
  };
  const rename = (id: string) => {
    const it = itemOf(id);
    if (it) setNaming({ id, kind: it.kind, parent: it.parent });
    setOpened(null);
  };
  const named = (name: string) => {
    const typed = name.trim();
    if (naming?.id) {
      const id = naming.id;
      if (typed) setItems((now) => now.map((i) => (i.id === id ? { ...i, name: typed } : i)));
    } else if (naming && typed) add('folder', naming.parent, typed);
    setNaming(null);
  };
  const duplicate = (id: string) => {
    const it = itemOf(id);
    setOpened(null);
    if (!it) return;
    const copy = add(it.kind, it.parent, `${it.name || 'Untitled'} copy`, it.id);
    const text = texts.get(id);
    if (text) setTexts((now) => new Map([...now, [copy, { ...text, by: ART, edited: 'Edited just now' }]]));
  };
  const place = (id: string, parent: string | null) => setItems((now) => now.map((i) => (i.id === id ? { ...i, parent } : i)));
  const moveTo = (id: string, parent: string | null) => {
    const was = itemOf(id)?.parent ?? null;
    place(id, parent);
    if (parent !== null) setFolders((now) => new Set([...now, parent]));
    setFlash(id);
    setOpened(null);
    say(wsToast.moved(parent === null ? spaceName : nameOf(parent), () => place(id, was)));
  };
  const toggleCall = (id: string) => {
    const bringing = !brought.includes(id);
    setBrought((now) => (bringing ? [...now, id] : now.filter((b) => b !== id)));
    setOpened(null);
    if (bringing) say(wsToast.broughtToCall(nameOf(id)));
  };
  const copyLink = () => { setOpened(null); say(wsToast.linkCopied()); };
  const exported = () => { setOpened(null); say(wsToast.exported()); };
  const trash = (id: string) => {
    const name = nameOf(id);
    setTrashed((now) => new Set([...now, id]));
    setOpened(null);
    if (at.id === id) {
      const next = shown.find((i) => i.kind === 'document' && i.id !== id && i.parent !== id);
      if (next) go(next.id);
    }
    say(wsToast.trashed(name, () => setTrashed((now) => { const left = new Set(now); left.delete(id); return left; })));
  };
  const fillFrom = (doc: string, template: string) => {
    const lines = TEMPLATE_LINES.get(template);
    if (lines) setTexts((now) => new Map([...now, [doc, { by: ART, edited: 'Edited just now', lines }]]));
  };
  const switchTo = (id: string) => {
    const was = space;
    setSpace(id);
    const next = ITEMS.get(id) ?? [];
    setItems(next);
    setTrashed(new Set());
    setBrought([]);
    setNaming(null);
    setOpened(null);
    setHistory(null);
    const firstDoc = next.find((i) => i.kind === 'document');
    setAt({ id: firstDoc?.id ?? '', area: 'tree' });
    if (call) say(wsToast.switched(spaces.find((s) => s.id === id)?.name ?? 'Product', () => switchBack(was)));
  };
  const switchBack = (id: string) => {
    setSpace(id);
    setItems(ITEMS.get(id) ?? []);
    setBrought(call && id === 'ws-product' ? BROUGHT : []);
    setAt({ id: (ITEMS.get(id) ?? []).find((i) => i.kind === 'document')?.id ?? '', area: 'tree' });
  };
  const newSpace = () => {
    setSpaces((now) => (now.some((s) => s.id === NEW_SPACE.id) ? now : [...now, NEW_SPACE]));
    setSpace(NEW_SPACE.id);
    setItems([]);
    setBrought([]);
    setOpened(null);
    setAt({ id: '', area: 'tree' });
    if (call) say(wsToast.newSpace(NEW_SPACE.name));
  };
  /** The workspace picker: in a call, choosing another asks first, in the picker's place. */
  const pick = (id: string) => {
    if (id === space) { setOpened(null); return; }
    if (call) setOpened({ key: 'picker', step: 'switch', to: id });
    else switchTo(id);
  };
  const picker = pop('picker', call && !organizer
    ? <WsSpacePicker spaces={spaces} current={space} canChoose={false} organizer={first(CALL.organizer)} onPick={() => setOpened(null)} onNew={() => setOpened(null)} />
    : opened?.key === 'picker' && opened.step === 'switch' && opened.to
    ? <WsSwitchSheet name={spaces.find((s) => s.id === opened.to)?.name ?? ''} current={spaceName} cantOpen={CANT_OPEN.get(opened.to) ?? []}
      onSwitch={() => { if (opened.to) switchTo(opened.to); }} onKeep={() => setOpened(null)} />
    : <WsSpacePicker spaces={spaces} current={space} canChoose {...(call ? {} : { heading: 'Workspaces' })} onPick={pick} onNew={newSpace} />);

  return {
    call, toasts, say, space, spaceName, shown, texts, folders, at, brought, opened, naming, flash, history, presenting,
    itemOf, nameOf, above, pop, picker, go, twist, newDocument, newFolder, rename, named, duplicate, moveTo, toggleCall, copyLink, exported, trash,
    fillFrom, switchTo, cancelNaming: () => setNaming(null), open: (o: Opened | null) => setOpened(o), setHistory, setPresenting
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

/** The folders something can move to: every folder but itself and what's in it, each with the folders it's in. */
function foldersFor(ws: Workspace, moving: string): WsFolderChoice[] {
  const out: WsFolderChoice[] = [];
  const walk = (parent: string | null) => {
    for (const it of ws.shown.filter((i) => i.parent === parent)) {
      if (it.kind !== 'folder' || it.id === moving) continue;
      const path = ws.above(it.id).map((f) => f.name).join(' / ');
      out.push({ id: it.id, name: it.name, path: path || undefined });
      walk(it.id);
    }
  };
  walk(null);
  return out;
}

/* ---------- the list ---------- */

/**
 * The list, as the call and the app put it together: the head, This call (in a call: Notes, Follow-ups, Transcript and the
 * documents brought to it), then Documents. `quiet`: notes are off. `onFollow`: someone's card says Follow.
 */
export function ListOf({ ws, quiet = false, onFind, onFollow }: { ws: Workspace; quiet?: boolean | undefined; onFind?: (() => void) | undefined; onFollow?: ((person: Person, where: string) => void) | undefined }) {
  const card = (person: Person, where: string, key: string) => ws.pop(key, (
    <WsPersonCard person={person} where={where} onFollow={() => { ws.open(null); onFollow?.(person, where); }} onStop={() => ws.open(null)}
      onGo={() => { const id = ws.shown.find((i) => i.name === where)?.id; if (id) ws.go(id); }} onTag={() => ws.open(null)} />
  ));
  const row = (it: Item, area: At['area'], depth: number): ReactNode => {
    const key = `${area}:${it.id}`;
    const folder = it.kind === 'folder';
    if (area === 'tree' && ws.naming?.id === it.id) {
      return <WsRenameRow key={key} name={it.name} kind={it.kind} depth={depth} placeholder={folder ? 'Name this folder' : 'Name this document'} onCommit={ws.named} onCancel={ws.cancelNaming} />;
    }
    const menuKey = `menu:${key}`;
    const moving = ws.opened?.key === menuKey && ws.opened.step === 'move';
    const faces = ws.call ? HERE.get(it.id) ?? [] : [];
    const face = faces[0];
    return (
      <WsRow key={key} id={it.id} name={it.name || 'Untitled'} kind={it.kind} depth={depth} area={area} open={ws.folders.has(it.id)}
        current={ws.at.id === it.id && ws.at.area === area} faces={faces} facesCard={face ? card(face, it.name, `faces:${key}`) : undefined}
        flash={ws.flash === it.id && area === 'tree'} onOpen={() => (folder ? ws.twist(it.id) : ws.go(it.id, area))} onTwist={folder ? () => ws.twist(it.id) : undefined}
        menu={ws.pop(menuKey, moving
          ? <WsMovePicker name={it.name || 'Untitled'} space={ws.spaceName} folders={foldersFor(ws, it.id)} onRoot={() => ws.moveTo(it.id, null)} onFolder={(f) => ws.moveTo(it.id, f)} />
          : <WsRowMenu folder={folder} brought={ws.call ? ws.brought.includes(it.id) : undefined} onRename={() => ws.rename(it.id)}
            onDuplicate={folder ? undefined : () => ws.duplicate(it.id)} onMove={() => ws.open({ key: menuKey, at: ws.opened?.at, step: 'move' })}
            onToggleCall={ws.call && !folder ? () => ws.toggleCall(it.id) : undefined} onCopyLink={folder ? undefined : ws.copyLink} onTrash={() => ws.trash(it.id)} />)}
        add={folder ? ws.pop(`add:${key}`, <WsNewMenu onDocument={() => ws.newDocument(it.id)} onFolder={() => ws.newFolder(it.id)} onUpload={() => ws.open(null)} />) : undefined}
        onRename={() => ws.rename(it.id)} onContextMenu={(e) => { e.preventDefault(); ws.open({ key: menuKey, at: { x: e.clientX, y: e.clientY } }); }} />
    );
  };
  const tree = (parent: string | null, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    if (ws.naming && ws.naming.id === null && ws.naming.parent === parent) {
      out.push(<WsRenameRow key={`draft:${parent ?? ''}`} name="" kind="folder" depth={depth} onCommit={ws.named} onCancel={ws.cancelNaming} />);
    }
    for (const it of ws.shown.filter((i) => i.parent === parent)) {
      out.push(row(it, 'tree', depth));
      if (it.kind === 'folder' && ws.folders.has(it.id)) out.push(...tree(it.id, depth + 1));
    }
    return out;
  };
  const open = FOLLOW_UPS.filter((f) => !f.done).length;
  const pins: ReactNode[] = ws.call ? [
    <WsSection key="sec:call" label="This call" area="pins" />,
    ...LIVE.map((l) => (
      <WsRow key={`pins:${l.id}`} id={l.id} name={l.name} kind="live" icon={l.icon} area="pins" quiet={quiet} current={ws.at.id === l.id}
        count={l.id === '$followups' ? open : 0} onBeside={l.id === '$followups' ? undefined : did('onBeside')} onOpen={() => ws.go(l.id, 'pins')} />
    )),
    ...ws.brought.flatMap((id) => { const it = ws.itemOf(id); return it ? [row(it, 'pins', 0)] : []; })
  ] : [];
  return (
    <WsList listKey={ws.space} empty={ws.shown.length === 0 && ws.naming === null ? 'yours' : false}
      head={<WsListHead name={ws.spaceName} picker={ws.picker} onFind={onFind ?? did('onFind')}
        create={ws.pop('new', <WsNewMenu onDocument={() => ws.newDocument(null)} onFolder={() => ws.newFolder(null)} onUpload={() => ws.open(null)} />)} />}>
      {pins}
      <WsSection key="sec:docs" label="Documents" />
      {tree(null, 0)}
    </WsList>
  );
}

/* ---------- the call's pages ---------- */

/** Notes, as the call writes them: ticking a follow-up works, and a time or an arrow says where it goes. */
export function NotesLive({ nothingYet = false, put = 'Launch plan' }: { nothingYet?: boolean | undefined; put?: string | null | undefined }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set(FOLLOW_UPS.filter((f) => f.done).map((f) => f.id)));
  const said = FOLLOW_UPS.filter((f) => f.source.startsWith('Said')).map((f) => ({ ...f, done: done.has(f.id) }));
  return (
    <WsNotesPage summary={nothingYet ? '' : SUMMARY} decided={nothingYet ? [] : DECIDED} followUps={nothingYet ? [] : said}
      allFollowUps={nothingYet ? 0 : FOLLOW_UPS.filter((f) => !done.has(f.id)).length} put={put ? { target: put, onPut: did('onPut') } : undefined}
      onTime={did('onTime')} onTick={(id) => setDone((now) => toggled(now, id))} onAll={did('onAll')} />
  );
}

/** Follow-ups: Everyone and Mine switch, ticking works, and the line at the end adds one. */
export function FollowUpsLive({ mine: startMine = false, rows: startRows = FOLLOW_UPS }: { mine?: boolean | undefined; rows?: WsFollowUp[] | undefined }) {
  const [mine, setMine] = useState(startMine);
  const [rows, setRows] = useState(startRows);
  const [draft, setDraft] = useState('');
  const mineOnly = rows.filter((r) => r.person === ART);
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setRows((now) => [...now, { id: `f-${now.length + 1}`, text, done: false, person: ART, name: 'Art', due: 'No date', source: 'Added by you' }]);
    setDraft('');
  };
  return (
    <WsFollowUps mine={mine} onMine={setMine} everyoneCount={rows.length} mineCount={mineOnly.length} rows={mine ? mineOnly : rows}
      onTick={(id) => setRows((now) => now.map((r) => (r.id === id ? { ...r, done: !r.done } : r)))} draft={draft} onDraft={setDraft} onAdd={add} />
  );
}

/** The transcript: finding narrows the lines as you type. */
export function TranscriptLive({ query: startQuery = '', lines = LINES, speaking = true, put = 'Launch plan' }: {
  query?: string | undefined; lines?: WsSaid[] | undefined; speaking?: boolean | undefined; put?: string | null | undefined;
}) {
  const [query, setQuery] = useState(startQuery);
  const words = query.trim().toLowerCase();
  const found = words ? lines.filter((l) => l.text.toLowerCase().includes(words) || l.name.toLowerCase().includes(words)) : lines;
  return <WsTranscript query={query} onQuery={setQuery} lines={found} now={speaking && !words ? SPEAKING : null} put={put ? { target: put, onPut: did('onPut') } : undefined} />;
}

/* ---------- a document ---------- */

/** Share, for a document: the workspace, who it's shared with (each with what they can do), who the field finds, and a guest in the call. */
export function ShareFor({ title, call, query: startQuery = '', restricted = false }: { title: string; call: boolean; query?: string | undefined; restricted?: boolean | undefined }) {
  const [query, setQuery] = useState(startQuery);
  const [added, setAdded] = useState<{ person: Person; role: 'Can edit' | 'Can read'; guest: boolean }[]>([{ person: LENA, role: 'Can read', guest: false }]);
  const [everyone, setEveryone] = useState(!restricted);
  const typed = query.trim().toLowerCase();
  const has = (p: Person) => added.some((a) => a.person === p);
  const found = (p: Person) => p.name.toLowerCase().split(' ').some((w) => w.startsWith(typed)) || p.email.startsWith(typed);
  const matches: WsShareMatch[] = typed ? FINDABLE.filter((p) => !has(p) && found(p)).map((p) => ({
    id: p.email, person: p, sub: p.email, onAdd: () => { setAdded((now) => [...now, { person: p, role: 'Can edit', guest: false }]); setQuery(''); }
  })) : [];
  const setRole = (p: Person, role: 'Can edit' | 'Can read') => setAdded((now) => now.map((a) => (a.person === p ? { ...a, role } : a)));
  const rows: WsShareRow[] = [
    {
      id: 'workspace', people: [PRIYA, KOFI, AIKO], name: 'Product', sub: everyone ? '6 people' : 'Only the people below',
      role: { label: everyone ? 'Can edit' : 'Can’t open', options: [{ label: 'Everyone in Product', onSelect: () => setEveryone(true) }, { label: 'Only people added here', onSelect: () => setEveryone(false) }] }
    },
    ...(everyone ? [] : [{ id: 'maker', people: [PRIYA], name: PRIYA.name, sub: 'Made this', role: { label: 'Can edit' } }]),
    ...added.map((a): WsShareRow => ({
      id: a.person.email, people: [a.person], name: a.person.name, sub: a.guest ? 'Guest in this call' : a.person.email,
      role: {
        label: a.role, options: [
          ...(a.guest ? [] : [{ label: 'Can edit', onSelect: () => setRole(a.person, 'Can edit') }, { label: 'Can read', onSelect: () => setRole(a.person, 'Can read') }]),
          { label: 'Remove', caution: true, onSelect: () => setAdded((now) => now.filter((x) => x.person !== a.person)) }
        ]
      }
    }))
  ];
  const guest = call && !has(GUEST) ? { person: GUEST, onRead: () => setAdded((now) => [...now, { person: GUEST, role: 'Can read', guest: true }]) } : null;
  return <WsShareSheet title={title} query={query} onQuery={setQuery} onAdd={() => matches[0]?.onAdd()} matches={matches} rows={rows} guest={guest} />;
}

/** Someone's card from their face at the top of a document: they're in it, so there's nowhere to go. */
function faceCard(ws: Workspace, person: Person, where: string, following: Person | null, onFollow: (p: Person, where: string) => void, onStop: () => void): WsFace {
  return {
    person,
    card: ws.pop(`face:${person.email}`, (
      <WsPersonCard person={person} where={where} followed={following === person}
        onFollow={() => { ws.open(null); onFollow(person, where); }} onStop={() => { ws.open(null); onStop(); }} onTag={() => ws.open(null)} />
    ))
  };
}

/**
 * The document side, as the call and the app put it together: the head, the bars, and the page (or one of the call's
 * pages), with History beside it when it's open. `following`: who you're following, for the bar and the faces.
 */
export function DocOf({ ws, save = 'saved', quiet = false, zen = false, onZen, following = null, onFollow, onStopFollowing, onToggleList, bars, strip }: {
  ws: Workspace; save?: WsSave | undefined; quiet?: boolean | undefined; zen?: boolean | undefined; onZen?: (() => void) | undefined;
  following?: WsFollowing | null | undefined; onFollow?: ((person: Person, where: string) => void) | undefined; onStopFollowing?: (() => void) | undefined;
  onToggleList: () => void;
  /** Bars under the head: offline, gone, read only. */
  bars?: ReactNode;
  /** Someone's presenting and you're working on your own: their strip takes the head's place. */
  strip?: ReactNode;
}) {
  const stop = onStopFollowing ?? did('onStop');
  const follow = onFollow ?? did('onFollow');
  const live = LIVE.find((l) => l.id === ws.at.id);
  const zenFor = ws.call ? { zen, onZen: onZen ?? did('onZen') } : {};
  if (live) {
    return (
      <WsDoc>
        <WsDocHead crumbs={[CALL.title, live.name]} save={quiet ? 'quiet' : 'live'} onToggleList={onToggleList} {...zenFor} />
        <WsFollowBar following={following} onStop={stop} />
        <WsScroll onWheel={following ? stop : undefined}>
          <WsFade id={live.id}>{live.id === '$notes' ? <NotesLive /> : live.id === '$followups' ? <FollowUpsLive /> : <TranscriptLive />}</WsFade>
        </WsScroll>
      </WsDoc>
    );
  }
  const item = ws.itemOf(ws.at.id);
  if (!item) {
    return (
      <WsDoc>
        <WsDocHead crumbs={[ws.spaceName]} save="quiet" onToggleList={onToggleList} {...zenFor} />
        <WsEmpty space={ws.spaceName} onDocument={() => ws.newDocument(null)} onFolder={() => ws.newFolder(null)} />
      </WsDoc>
    );
  }
  const name = item.name || 'Untitled';
  const text = ws.texts.get(item.id);
  const version = VERSIONS.find((v) => v.id === ws.history);
  const lines = text ? (version && item.id === 'plan' ? text.lines.slice(0, version.lines) : text.lines) : [FIRST_LINE];
  const blank = !text || text.lines.every((l) => l.text === undefined);
  const faces = ws.call ? (HERE.get(item.id) ?? []).map((p) => faceCard(ws, p, name, following?.person === p ? p : null, follow, stop)) : [];
  const moving = ws.opened?.key === 'more' && ws.opened.step === 'move';
  return (
    <>
      <WsDoc>
        {strip ?? <WsDocHead crumbs={[ws.spaceName, ...ws.above(item.id).map((f) => f.name), name]} save={save} faces={faces} onToggleList={onToggleList}
          share={ws.pop('share', <ShareFor title={`Share ${name}`} call={ws.call} />)}
          present={ws.call ? ws.pop('present', <WsPresentPreview name={name} sections={item.id === 'plan' ? SECTIONS.length : 1} onStart={() => { ws.open(null); ws.setPresenting(true); }} />) : undefined}
          more={ws.pop('more', moving
            ? <WsMovePicker name={name} space={ws.spaceName} folders={foldersFor(ws, item.id)} onRoot={() => ws.moveTo(item.id, null)} onFolder={(f) => ws.moveTo(item.id, f)} />
            : <WsDocMenu onShare={() => ws.open({ key: 'share' })} onPresent={ws.call ? () => ws.open({ key: 'present' }) : undefined}
              onHistory={() => { ws.open(null); ws.setHistory(VERSIONS[0]?.id ?? null); }} onDuplicate={() => ws.duplicate(item.id)}
              onMove={() => ws.open({ key: 'more', step: 'move' })} onCopyLink={ws.copyLink} onExport={ws.exported} onTrash={() => ws.trash(item.id)} />)}
          {...zenFor} />}
        <WsFollowBar following={following} onStop={stop} />
        {bars}
        <WsScroll onWheel={following ? stop : undefined}>
          <WsFade id={`${item.id}:${ws.history ?? ''}:${blank ? 'blank' : 'written'}`}>
            <WsPage>
              <PageText title={item.name} by={text?.by ?? ART} edited={text?.edited} lines={lines}
                after={blank ? <WsTemplates templates={TEMPLATES} onPick={(t) => ws.fillFrom(item.id, t)} /> : <WsTail onClick={did('onTail')} />} />
            </WsPage>
          </WsFade>
        </WsScroll>
      </WsDoc>
      {ws.history !== null && (
        <WsHistory versions={VERSIONS} selected={ws.history} onSelect={ws.setHistory} onClose={() => ws.setHistory(null)}
          onRestore={() => { const v = VERSIONS.find((x) => x.id === ws.history); ws.setHistory(null); if (v) ws.say(wsToast.restoredVersion(v.when, did('onUndo'))); }} />
      )}
    </>
  );
}

/* ---------- presenting ---------- */

/** One section of Launch plan, as everyone sees it: the title over the first. */
export function SectionText({ at }: { at: number }) {
  const section = SECTIONS[at] ?? { name: 'Launch plan', lines: [] };
  return <div className="ws-ed"><div className="ws-text">{at === 0 && <h1 className="wd-title">Launch plan</h1>}<Lines lines={section.lines} /></div></div>;
}

/**
 * Launch plan, presented: what the audience reads (`mine` false), with the strip that lets them work on their own, or
 * the presenter's view, with Back, Next, their notes and Stop presenting beside it. Back and Next move a section.
 */
export function Presentation({ mine, at: startAt = 0, onStop, onAway }: { mine: boolean; at?: number | undefined; onStop?: (() => void) | undefined; onAway?: (() => void) | undefined }) {
  const [at, setAt] = useState(startAt);
  const [notes, setNotes] = useState('Thank Aiko for the pilot numbers. Mention the 20th if legal agrees.');
  const total = SECTIONS.length;
  return (
    <WsPane reading label="Launch plan, presented">
      <WsDoc>
        {mine
          ? <WsPresentStrip mine name="Launch plan" at={at + 1} total={total} />
          : <WsPresentStrip name="Launch plan" presenter={PRIYA} by={first(PRIYA)} away={false} onToggle={onAway ?? did('onToggle')} />}
        <WsScroll>
          <WsFade id={String(at)}><WsPage><SectionText at={at} /></WsPage></WsFade>
        </WsScroll>
      </WsDoc>
      {mine && (
        <WsPresenterView at={at + 1} total={total} part={SECTIONS[at]?.name ?? 'Launch plan'} next={SECTIONS[at + 1]?.name ?? null} notes={notes} onNotes={setNotes}
          onBack={() => setAt((n) => Math.max(0, n - 1))} onNext={() => setAt((n) => Math.min(total - 1, n + 1))} onStop={onStop ?? did('onStop')} />
      )}
    </WsPane>
  );
}

/* ---------- made-up photos ---------- */

const scene = (sky: string, ground: string, shapes: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#F6D8B8"/></linearGradient></defs><rect width="300" height="200" fill="url(#s)"/><rect y="132" width="300" height="68" fill="${ground}"/>${shapes}</svg>`
)}`;
/** Photos already in the workspace, drawn: the port at dawn, the stacks, the loading dock. */
export const PHOTOS: { id: string; src: string; label: string }[] = [
  { id: 'p1', label: 'The port at dawn', src: scene('#7C8CC9', '#2F3A6B', '<circle cx="220" cy="120" r="22" fill="#FFD9A0"/><rect x="40" y="96" width="14" height="40" fill="#1D2546"/><rect x="34" y="88" width="70" height="8" fill="#1D2546"/>') },
  { id: 'p2', label: 'Containers, bay 14', src: scene('#9AA6D8', '#3A3F5C', '<rect x="30" y="100" width="70" height="32" fill="#C0587A"/><rect x="104" y="100" width="70" height="32" fill="#4A6BD6"/><rect x="66" y="68" width="70" height="32" fill="#E09A3E"/><rect x="178" y="100" width="70" height="32" fill="#6A4FC9"/>') },
  { id: 'p3', label: 'The loading dock', src: scene('#B9A6D6', '#4B4560', '<rect x="60" y="70" width="180" height="62" fill="#2E2A40"/><rect x="84" y="88" width="56" height="44" fill="#F3B85A"/><rect x="160" y="88" width="56" height="44" fill="#F3B85A"/>') }
];

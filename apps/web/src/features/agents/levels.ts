/*
 * When an agent asks to use your Alcove, each part of it is one level you can lower, not a list of boxes to tick: Notes
 * (off, read, read and edit), Calls (off, see, see and book) and Calendar (off, see). Sharing and deleting notes are their
 * own row, two switches that start off. Only the parts the agent asked for are there, and a level gives only the scopes it
 * asked for, so nothing here can give an agent more than its request.
 */
import { AGENT_SCOPES, type AgentScope } from '@alcove/api';
import type { AgentLevel, AgentLevelRow, AgentSwitch, IconName } from '@alcove/ui';
import { capital } from '~/lib/words';

type Area = 'notes' | 'calls' | 'calendar';
interface Level extends AgentLevel { scopes: readonly AgentScope[] }
const AREAS: readonly { id: Area; name: string; icon: IconName; levels: readonly Level[] }[] = [
  {
    id: 'notes', name: 'Notes', icon: 'notes', levels: [
      { id: 'off', title: 'Off', detail: 'It can’t see your notes', scopes: [] },
      { id: 'read', title: 'Read', detail: 'Find notes, read transcripts, ask questions', scopes: ['notes:read'] },
      { id: 'edit', title: 'Read and edit', detail: 'Also propose decisions, add follow-ups and questions, fix a transcript', scopes: ['notes:read', 'notes:write'] }
    ]
  },
  {
    id: 'calls', name: 'Calls', icon: 'video', levels: [
      { id: 'off', title: 'Off', detail: 'It can’t see your calls', scopes: [] },
      { id: 'see', title: 'See', detail: 'Past and coming calls, and people to invite', scopes: ['meetings:read'] },
      { id: 'book', title: 'See and book', detail: 'Also book, move and cancel calls. Your calendar sends the invitations.', scopes: ['meetings:read', 'meetings:write'] }
    ]
  },
  {
    id: 'calendar', name: 'Calendar', icon: 'cal', levels: [
      { id: 'off', title: 'Off', detail: 'It can’t see your calendar', scopes: [] },
      { id: 'see', title: 'See', detail: 'Your meetings, and when people are free', scopes: ['calendar:read'] }
    ]
  }
];
const EXTRA: readonly { id: 'notes:share' | 'notes:delete'; title: string; detail: string; word: string }[] = [
  { id: 'notes:share', title: 'Share notes', detail: 'Give people notes you’re allowed to share', word: 'share' },
  { id: 'notes:delete', title: 'Delete notes', detail: 'Delete notes, or take shared ones out of yours', word: 'delete' }
];
const EXTRA_ROW = 'extra';

/** What's chosen: a level for each part, by its row, and each switch that's on. */
export interface Choice { levels: Readonly<Record<string, string>>; on: readonly AgentScope[] }

/** A level is offered when the scope it adds was asked for; Off always is. */
const offered = (levels: readonly Level[], asked: readonly AgentScope[]): Level[] => levels.filter((l) => {
  const adds = l.scopes.at(-1);
  return adds === undefined || asked.includes(adds);
});

/** Everything it asked for, as the question starts: each part at its highest level, the switches off. */
export function choiceFor(asked: readonly AgentScope[]): Choice {
  const levels: Record<string, string> = {};
  for (const area of AREAS) {
    const top = offered(area.levels, asked).at(-1);
    if (top && top.scopes.length) levels[area.id] = top.id;
  }
  return { levels, on: [] };
}

/** The scopes a choice gives, only ever ones that were asked for, in the order they're shown. */
export function scopesOf(choice: Choice, asked: readonly AgentScope[]): AgentScope[] {
  const chosen = new Set<AgentScope>(choice.on);
  for (const area of AREAS) for (const s of area.levels.find((l) => l.id === choice.levels[area.id])?.scopes ?? []) chosen.add(s);
  return AGENT_SCOPES.filter((s) => chosen.has(s) && asked.includes(s));
}

/** The rows of the question: a part of Alcove it asked for each, then sharing and deleting when it asked for either. */
export function rowsOf(choice: Choice, asked: readonly AgentScope[]): AgentLevelRow[] {
  const rows: AgentLevelRow[] = [];
  for (const area of AREAS) {
    const levels = offered(area.levels, asked);
    if (levels.length < 2) continue;
    const chosen = levels.find((l) => l.id === choice.levels[area.id]) ?? levels[0];
    rows.push({ kind: 'levels', id: area.id, icon: area.icon, name: area.name, value: chosen?.title ?? 'Off', off: !chosen?.scopes.length, levels, chosen: chosen?.id ?? 'off' });
  }
  const extra = EXTRA.filter((x) => asked.includes(x.id));
  if (extra.length) {
    const on = extra.filter((x) => choice.on.includes(x.id));
    const said = on.map((x) => x.word).join(' and ');
    const switches: AgentSwitch[] = extra.map((x) => ({ id: x.id, title: x.title, detail: x.detail, on: choice.on.includes(x.id) }));
    rows.push({ kind: 'switches', id: EXTRA_ROW, icon: 'share', name: extra.length > 1 ? 'Share or delete notes' : extra[0]?.title ?? 'Share or delete notes', value: said ? capital(said) : 'Off', off: !on.length, switches });
  }
  return rows;
}

/** A level picked in a row. */
export const picked = (choice: Choice, row: string, level: string): Choice => ({ ...choice, levels: { ...choice.levels, [row]: level } });
/** A switch turned on or off. */
export function switched(choice: Choice, id: string, on: boolean): Choice {
  const scope = EXTRA.find((x) => x.id === id)?.id;
  if (!scope) return choice;
  return { ...choice, on: on ? [...choice.on.filter((s) => s !== scope), scope] : choice.on.filter((s) => s !== scope) };
}

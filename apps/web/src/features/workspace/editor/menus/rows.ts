/* What `/` offers, in order. `alias`: other words that find it. `hint`: the typed shortcut. */
import type { IconName } from '@alcove/ui';
import type { BlockKind } from '../types';

export type SlashId = BlockKind | 'divider' | 'table' | 'photo' | 'video' | 'file' | 'doclink' | 'board' | 'decided' | 'followups' | 'moment';

/** `makes`: it makes something in the workspace, so it's only offered to someone who can. */
export interface SlashItem { id: SlashId; name: string; icon: IconName; hint?: string; alias: string; rec?: boolean; picks?: boolean; makes?: boolean }
export interface SlashGroup { title: string; call?: boolean; items: SlashItem[] }

export const SLASH: SlashGroup[] = [
  {
    title: 'Write',
    items: [
      { id: 'paragraph', name: 'Text', icon: 'para', alias: 'paragraph plain' },
      { id: 'h1', name: 'Heading 1', icon: 'h1', hint: '#', alias: 'title big' },
      { id: 'h2', name: 'Heading 2', icon: 'h2', hint: '##', alias: 'section subtitle' },
      { id: 'h3', name: 'Heading 3', icon: 'h3', hint: '###', alias: 'small' },
      { id: 'bullet', name: 'Bulleted list', icon: 'list', hint: '-', alias: 'bullet unordered' },
      { id: 'numbered', name: 'Numbered list', icon: 'listOrdered', hint: '1.', alias: 'ordered number' },
      { id: 'todo', name: 'Checklist', icon: 'todo', hint: '[]', alias: 'todo task check tick' },
      { id: 'toggle', name: 'Toggle', icon: 'toggle', alias: 'fold collapse' },
      { id: 'quote', name: 'Quote', icon: 'quote', hint: '>', alias: 'blockquote' },
      { id: 'callout', name: 'Callout', icon: 'bulb', alias: 'note highlight box' },
      { id: 'divider', name: 'Divider', icon: 'minus', hint: '---', alias: 'line rule separator' },
      { id: 'table', name: 'Table', icon: 'table', alias: 'grid rows' },
      { id: 'code', name: 'Code', icon: 'code', alias: 'snippet' }
    ]
  },
  {
    title: 'Add',
    items: [
      { id: 'photo', name: 'Photos', icon: 'image', alias: 'image picture upload', picks: true },
      { id: 'video', name: 'Video', icon: 'film', alias: 'film movie', picks: true },
      { id: 'file', name: 'File', icon: 'clip', alias: 'attachment upload pdf', picks: true },
      { id: 'doclink', name: 'Link to a document', icon: 'link2', alias: 'page reference' },
      { id: 'board', name: 'Board', icon: 'presentation', alias: 'whiteboard sticky', makes: true }
    ]
  },
  {
    title: 'From the call',
    call: true,
    items: [
      { id: 'decided', name: 'Decided so far', icon: 'circleCheck', rec: true, alias: 'decisions notes live' },
      { id: 'followups', name: 'Follow-ups so far', icon: 'listChecks', rec: true, alias: 'actions tasks notes live' },
      { id: 'moment', name: 'Quote what was said', icon: 'textQuote', rec: true, alias: 'transcript moment line' }
    ]
  }
];

/**
 * The items a typed word finds, under their headings. What's only in a call isn't offered outside one, what needs files chosen
 * isn't offered where nothing can choose them (`canPick`), and what makes something isn't offered where nothing can (`canMake`).
 */
export function slashGroups(query: string, inCall: boolean, canPick: boolean, canMake: boolean): SlashGroup[] {
  const q = query.toLowerCase();
  return SLASH
    .filter((g) => inCall || !g.call)
    .map((g) => ({ ...g, items: g.items.filter((s) => (canPick || !s.picks) && (canMake || !s.makes) && (!q || s.name.toLowerCase().includes(q) || s.alias.includes(q))) }))
    .filter((g) => g.items.length > 0);
}

/** The kinds Turn into offers, in order. */
export const TURN: { kind: BlockKind; icon: IconName; label: string }[] = [
  { kind: 'paragraph', icon: 'para', label: 'Text' },
  { kind: 'h1', icon: 'h1', label: 'Heading 1' },
  { kind: 'h2', icon: 'h2', label: 'Heading 2' },
  { kind: 'h3', icon: 'h3', label: 'Heading 3' },
  { kind: 'bullet', icon: 'list', label: 'Bulleted list' },
  { kind: 'numbered', icon: 'listOrdered', label: 'Numbered list' },
  { kind: 'todo', icon: 'todo', label: 'Checklist' },
  { kind: 'quote', icon: 'quote', label: 'Quote' }
];

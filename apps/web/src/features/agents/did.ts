/*
 * What each thing an agent can do in Alcove reads as, in a sentence after its name: "booked" a call, "read" a note,
 * "looked through your notes". Reading is quiet; a booked call takes the colour of time, a follow-up horizon, a decision
 * rose. Alcove keeps only which tool, the note or call it touched and how many it found, so that's all a sentence says.
 */
import type { AgentTool } from '@alcove/api';
import type { AgentDidTone, IconName } from '@alcove/ui';

/**
 * `verb` comes before what it's about (`about`, a note or a call, a link to it), or is the whole sentence. `counts` names
 * what it counted, one and many ("3 notes"), for the tools Alcove counts for (listing notes, what's waiting, calls, people
 * and the calendar); `sub` is a second line it always has.
 */
export interface Said { icon: IconName; tone: AgentDidTone; verb: string; about?: 'note' | 'call' | undefined; counts?: readonly [string, string] | undefined; sub?: string | undefined }

const quiet = (icon: IconName, verb: string, more: Partial<Said> = {}): Said => ({ icon, tone: 'quiet', verb, ...more });

export const SAID: Record<AgentTool, Said> = {
  list_notes: quiet('search', 'looked through your notes', { counts: ['note', 'notes'] }),
  get_note: quiet('book', 'read', { about: 'note' }),
  ask_note: quiet('ask', 'asked about', { about: 'note' }),
  ask_notes: quiet('ask', 'asked about your notes'),
  get_inbox: quiet('todos', 'read what’s waiting on you', { counts: ['thing', 'things'] }),
  get_personal_notes: quiet('notesPen', 'read your own notes on', { about: 'note' }),
  propose_decision: { icon: 'badgeCheck', tone: 'decision', verb: 'proposed a decision in', about: 'note', sub: 'For you to confirm' },
  update_decision: { icon: 'badgeCheck', tone: 'decision', verb: 'changed a decision in', about: 'note' },
  propose_action: { icon: 'circleCheck', tone: 'follow', verb: 'added a follow-up to', about: 'note' },
  update_action: { icon: 'circleCheck', tone: 'follow', verb: 'changed a follow-up in', about: 'note' },
  update_question: quiet('ask', 'changed an open question in', { about: 'note' }),
  correct_transcript: quiet('pen', 'fixed the transcript of', { about: 'note' }),
  rewrite_note: quiet('pen', 'rewrote', { about: 'note' }),
  add_personal_note: quiet('notesPen', 'added to your own notes on', { about: 'note' }),
  edit_personal_note: quiet('notesPen', 'edited your own notes on', { about: 'note' }),
  remove_personal_note: quiet('notesPen', 'took something out of your own notes on', { about: 'note' }),
  share_note: quiet('shareNodes', 'shared', { about: 'note' }),
  delete_note: quiet('trash', 'deleted', { about: 'note' }),
  list_meetings: quiet('list', 'listed your calls', { counts: ['call', 'calls'] }),
  get_meeting: quiet('cal', 'looked at', { about: 'call' }),
  find_people: quiet('people', 'looked for people', { counts: ['person', 'people'] }),
  schedule_call: { icon: 'calCheck', tone: 'time', verb: 'booked', about: 'call' },
  update_call: { icon: 'calClock', tone: 'time', verb: 'changed', about: 'call' },
  cancel_call: quiet('cal', 'cancelled', { about: 'call' }),
  answer_call: quiet('mail', 'answered the invitation to', { about: 'call' }),
  schedule_next_call: { icon: 'calCheck', tone: 'time', verb: 'booked the next', about: 'call' },
  start_call: { icon: 'video', tone: 'time', verb: 'started', about: 'call' },
  get_calendar: quiet('cal', 'read your calendar', { counts: ['event', 'events'] }),
  get_availability: quiet('clock', 'checked when people are free')
};

/** What it's about once it's gone, or was never named: "deleted a note", "cancelled a call". */
export const GONE: Record<'note' | 'call', string> = { note: 'a note', call: 'a call' };
/** Tools whose note or call is gone because of what they did: nothing more to say about it. */
export const ENDS_IT: ReadonlySet<AgentTool> = new Set(['delete_note', 'cancel_call']);

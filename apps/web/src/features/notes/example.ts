/*
 * The example note, before you have notes of your own: the call from the welcome screen,
 * written out in full. It isn't stored anywhere; asking about it answers from what's on the page.
 */
import type { AnswerPart, Note, NoteEvidence, Person } from '@alcove/api';
import { CAST } from './cast';

const cast = (k: keyof typeof CAST): Person => ({ id: `example-${k}`, name: CAST[k].name, email: `${k}@example.com`, portrait: CAST[k].portrait });

/** What backs something in the example: a line someone said in the call. */
const said = (id: string, at: number, who: Person, text: string): NoteEvidence => ({ moments: [{ kind: 'line', id, at, speaker: { name: who.name, person: who }, text, against: false, corrected: false }], flags: [] });

export function exampleNote(me: Person): Note {
  const theo = cast('theo');
  const priya = cast('priya');
  const kofi = cast('kofi');
  const started = new Date();
  started.setHours(9, 30, 0, 0);
  return {
    id: 'example', kind: 'call', status: 'ready', title: 'Weekly product call', startedAt: started.toISOString(), duration: 24 * 60,
    people: [me, theo, priya, kofi], excerpt: 'Sign-ups are back up, and the launch moves to the 18th.', openActions: 1, totalActions: 1,
    recipients: [{ person: me, role: 'organizer' }, { person: theo, role: 'invited' }, { person: priya, role: 'invited' }, { person: kofi, role: 'invited' }],
    groupShares: [],
    summary: 'Sign-ups are back up since Tuesday’s fix, so the launch moves to the 18th. Kofi sends the new screens by Wednesday.',
    decisions: [{
      id: 'launch', text: 'The launch moves to the 18th.', at: 252, state: 'confirmed', lines: ['l1'], against: [], disputes: [], evidence: said('l1', 252, theo, 'Then the 18th it is. Everyone good with that?'),
      changes: [{ by: { id: null, name: theo.name, email: theo.email, as: 'invited' }, at: started.toISOString(), what: 'confirmed' }]
    }],
    questions: [{ id: 'press', text: 'Do we tell the press before the 18th?', at: 281, state: 'open', lines: ['l2'], against: [], evidence: said('l2', 281, priya, 'Do we tell the press before the 18th?'), changes: [] }],
    actions: [{
      id: 'screens', text: 'Send the new screens', owner: { name: kofi.name, person: kofi }, takenOn: true, due: 'Wed', at: 302, done: false, lines: ['l3'], against: [],
      evidence: said('l3', 302, kofi, 'I’ll send the new screens by Wednesday.'),
      changes: [{ by: { id: null, name: kofi.name, email: kofi.email, as: 'invited' }, at: started.toISOString(), what: 'took-on' }]
    }],
    gaps: [],
    chapters: [
      { at: 0, title: 'Sign-ups', summary: 'Back up since the fix.' },
      { at: 210, title: 'The launch date', summary: 'Moves to the 18th.' },
      { at: 300, title: 'New screens', summary: 'Kofi, by Wednesday.' }
    ],
    screens: [], transcript: [], rooms: [], additions: [], writtenAt: started.toISOString(), writingAgain: false, audio: [], kept: { transcript: true, recording: true }, inference: [],
    suggestedQuestions: ['What did we decide?', 'What do I need to do?', 'Draft a follow-up']
  };
}

const ANSWERS: [RegExp, string, number[]][] = [
  [/decid/i, 'One thing. The launch moves to the 18th.', [252]],
  [/\b(i|me|my)\b/i, 'Nothing for you from this call. Kofi sends the new screens by Wednesday.', [302]],
  [/email|follow/i, 'Hi all, thanks for today. The launch moves to the 18th. Next up: Kofi sends the new screens by Wednesday. Shout if I missed anything.', []]
];

export async function* askExample(question: string): AsyncIterable<AnswerPart> {
  await new Promise((r) => setTimeout(r, 450));
  const hit = ANSWERS.find(([re]) => re.test(question));
  const cites = hit ? hit[2] : [0];
  yield { type: 'text', text: hit ? hit[1] : 'From the call: sign-ups are back up since Tuesday’s fix.' };
  for (const at of cites) yield { type: 'cite', noteId: 'example', at };
}

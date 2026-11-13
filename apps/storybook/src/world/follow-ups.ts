/** One checklist and its AI proposals, shared by call and saved-note stories. Everyone is made up. */
import { ACCEPTED_FOLLOW_UP, type FollowUpTarget, type LiveFollowUp } from '@alcove/api';
import type { World } from './world';
import { writeNote } from './build';
import { iso } from './clock';
import { ART, KOFI, PRIYA } from './people';

export const FOLLOW_UP_NOTE = 'n-follow-up-review';
export const FOLLOW_UP_TASK: LiveFollowUp = {
  ...ACCEPTED_FOLLOW_UP, id: 'follow-up-checklist', revision: 'checklist-v1', text: 'Send the launch checklist',
  owner: KOFI.name, ownerPerson: KOFI, due: 'Friday', done: false, evidence: []
};
export const FOLLOW_UP_TARGET: FollowUpTarget = {
  id: FOLLOW_UP_TASK.id, revision: FOLLOW_UP_TASK.revision, text: FOLLOW_UP_TASK.text, owner: KOFI.email, due: 'Friday'
};
export const FOLLOW_UP_NEW: LiveFollowUp = {
  ...ACCEPTED_FOLLOW_UP, review: 'suggested', id: 'fu-follow-up-source-new', revision: 'new-v1', text: 'Draft the support handover',
  owner: ART.name, ownerPerson: ART, due: 'Tomorrow', done: false, evidence: [{ kind: 'transcript', lineId: 'follow-up-source-new', said: 60 }]
};
export const FOLLOW_UP_CHANGE: LiveFollowUp = {
  ...ACCEPTED_FOLLOW_UP, review: 'suggested', id: 'follow-up-change', revision: 'change-v1', changeOf: FOLLOW_UP_TASK.id, target: FOLLOW_UP_TARGET,
  text: 'Send the reviewed launch checklist', owner: KOFI.name, ownerPerson: KOFI, due: 'Monday', done: false,
  evidence: [{ kind: 'transcript', lineId: 'follow-up-source-change', said: 120 }]
};
export const FOLLOW_UP_ROWS = [FOLLOW_UP_TASK, FOLLOW_UP_NEW, FOLLOW_UP_CHANGE];

/** Saved notes keep actual tasks and pending proposals separate, including changes to an actual task. */
export function withFollowUpProposals(w: World): void {
  const n = writeNote({
    id: FOLLOW_UP_NOTE, title: 'Launch follow-ups', startedAt: iso(0, 14, 0), minutes: 20, organizer: ART, invited: [KOFI, PRIYA],
    excerpt: 'The checklist is ready, and support needs a handover.',
    summary: 'The launch checklist is ready. Support needs a handover before the rollout.',
    said: [
      { id: 'follow-up-source-new', at: '01:00', who: PRIYA, text: 'Art could draft the support handover for tomorrow.' },
      { id: 'follow-up-source-change', at: '02:00', who: KOFI, text: 'Let’s send the reviewed checklist on Monday instead of Friday.' }
    ],
    actions: [{ id: FOLLOW_UP_TASK.id, revision: FOLLOW_UP_TASK.revision, text: FOLLOW_UP_TASK.text, owner: KOFI, due: 'Friday', takenOn: true }],
    suggestions: [
      { id: FOLLOW_UP_NEW.id, revision: FOLLOW_UP_NEW.revision, text: FOLLOW_UP_NEW.text, owner: ART, due: 'Tomorrow', at: '01:00' },
      { id: FOLLOW_UP_CHANGE.id, revision: FOLLOW_UP_CHANGE.revision, text: FOLLOW_UP_CHANGE.text, owner: KOFI, due: 'Monday', at: '02:00', target: FOLLOW_UP_TARGET }
    ]
  });
  w.notes.unshift(n);
}

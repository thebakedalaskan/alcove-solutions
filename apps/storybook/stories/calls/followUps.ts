/** The same actual task and proposals before and after the call. */
import type { CallScript } from '../../src/api/script';
import { line } from '../../src/api/script';
import { FOLLOW_UP_ROWS } from '../../src/world/follow-ups';
import { KOFI, PRIYA } from '../../src/world/people';

export const FOLLOW_UP_SCRIPT = {
  here: [{ who: PRIYA }, { who: KOFI }], since: 180, followUps: FOLLOW_UP_ROWS,
  summary: 'The launch checklist is ready. Support needs a handover before the rollout.',
  earlier: [
    line(PRIYA, 'Art could draft the support handover for tomorrow.', { id: 'follow-up-source-new' }),
    line(KOFI, 'Let’s send the reviewed checklist on Monday instead of Friday.', { id: 'follow-up-source-change' })
  ]
} satisfies CallScript;

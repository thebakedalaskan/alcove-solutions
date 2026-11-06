/*
 * The workspace in a call (user-flows 6): the call's home, with its folder of live Notes, Follow-ups and Transcript; the
 * organizer's picker and switching; following someone, a tag and a comment; Find and History; presenting and Play for
 * everyone; someone who can open nothing in it, and asking to see it; a follow-up added by hand; and the toasts. Everyone
 * else's browser is the script's: where they are in the workspace, what they present and play, and who asks.
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { asksToSee, at, goesTo, leaves, movesPresenting, plays, presents, tagsYou, type CallScript, type Present } from '../../src/api/script';
import { inCall, phone, type InCall, type StoryCall } from '../../src/call';
import { iso } from '../../src/world/clock';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import {
  addWalkthrough, AIKO, CHECKLIST_DOC, FILM, KOFI, LAUNCH_REVIEW, PLAN, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, SAM, THEO, WALKTHROUGH
} from './talk';

const meta = { title: 'Calls/Workspace', ...pages } satisfies Meta<PageArgs>;
export default meta;

type Play = NonNullable<PageStory['play']>;
type Step = Parameters<Play>[0];

const REVIEWERS: Present[] = [{ who: PRIYA }, { who: KOFI }, { who: AIKO }];
/**
 * The conversation, a minute and a half in with notes on: the empty states are decided and handed out, so the live notes
 * have been written already, and pricing is talked through as the story plays.
 */
const TALK = { since: 100, earlier: REVIEW_TALK.slice(0, 7), talk: { lines: REVIEW_TALK.slice(7), from: 3, every: 5 }, summary: REVIEW_SUMMARY };

/** Opens the workspace from the dock. */
async function openWorkspace({ canvas, userEvent, step }: Step): Promise<void> {
  await step('Press Workspace in the dock. The first time, the call settles its home', async () => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Workspace/ }, { timeout: 10000 }));
  });
}
/** Opens one of the call's own pages from its folder. */
const openPage = (name: string): Play => async (c) => {
  await openWorkspace(c);
  await c.step(`Open ${name} in the call’s folder`, async () => {
    // Its row, with a count beside it when there's something in it.
    const [row] = await c.canvas.findAllByRole('button', { name: new RegExp(`^${name}\\s?(\\d+)?$`) }, { timeout: 8000 });
    if (row) await c.userEvent.click(row);
  });
};
/** Opens the picker at the top of the list: the organizer's workspaces, with this call's home marked. */
const openPicker = (home: string): Play => async (c) => {
  await openWorkspace(c);
  await c.step('Press the workspace’s name at the top of the list', async () => {
    // The call's folder is named the same: the name at the top comes first.
    const [top] = await c.canvas.findAllByRole('button', { name: home }, { timeout: 8000 });
    if (top) await c.userEvent.click(top);
  });
};
/** Picks Design in the picker: it asks first. */
const pickDesign = (home: string): Play => async (c) => {
  await openPicker(home)(c);
  await c.step('Pick Design. The question says who can’t open it, and that the notes still go to the home', async () => {
    await c.userEvent.click(await screen.findByRole('menuitemradio', { name: /^Design(?! review)/ }, { timeout: 5000 }));
  });
};

/* ---------- the call's home ---------- */

/** The design review's first Workspace: a new home named after the call and the day, with the call's folder in it. */
export const OnItsHome = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openWorkspace });
export const OnItsHomePhone = phone(OnItsHome);

/** The organizer's picker: their workspaces, the call's home marked "This call's home", and New workspace. */
export const ThePicker = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, { play: openPicker('Design review · 4 Nov') });
export const ThePickerPhone = phone(ThePicker);

/** Switching asks once: Sam came in with the link and can't open Design, and the notes still go to the home. */
export const SwitchQuestion = inCall(
  { scenario: 'call-soon', call: REVIEW, script: { here: [...REVIEWERS, { who: SAM, guest: true }] } },
  { play: pickDesign('Design review · 4 Nov') }
);
export const SwitchQuestionPhone = phone(SwitchQuestion);

/** Switched: everyone views Design, and the toast says the notes still go to the home, with Back. */
export const Switched = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [...REVIEWERS, { who: SAM, guest: true }] } }, {
  play: async (c) => {
    await pickDesign('Design review · 4 Nov')(c);
    await c.step('Switch to Design. Everyone views it at once', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Switch to Design' }, { timeout: 5000 }));
    });
  }
});
export const SwitchedPhone = phone(Switched);

/* ---------- the call's folder ---------- */

/** The call's live notes, as a page in its folder, written again as people talk. */
export const FolderNotes = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openPage('Notes') });
export const FolderNotesPhone = phone(FolderNotes);
/** The call's follow-ups, ticked here for everyone who gets the notes. */
export const FolderFollowUps = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openPage('Follow-ups') });
export const FolderFollowUpsPhone = phone(FolderFollowUps);
/** The transcript, as it's said. */
export const FolderTranscript = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openPage('Transcript') });
export const FolderTranscriptPhone = phone(FolderTranscript);

/** A follow-up nobody said, added by hand: yours, for everyone who gets the notes. */
export const AddFollowUp = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await openPage('Follow-ups')(c);
    await c.step('Write one nobody said, and press Enter. It’s yours, ticked like the rest', async () => {
      const field = await c.canvas.findByRole('textbox', { name: 'Add a follow-up' }, { timeout: 8000 });
      await c.userEvent.type(field, 'Book the room for the launch retro{Enter}');
    });
  }
});
export const AddFollowUpPhone = phone(AddFollowUp);

/* ---------- working together ---------- */

/**
 * The launch review, its home Product, chosen when it was scheduled: the launch plan brought to the call, and Priya and
 * Kofi in it, Kofi typing. What a story's own script says goes over this.
 */
const reviewing = (script: CallScript = {}, then?: () => void): InCall => ({
  scenario: 'busy', call: LAUNCH_REVIEW, ...(then ? { then } : {}),
  script: { here: REVIEWERS, ...TALK, workspace: { brought: [PLAN], where: [{ who: PRIYA, document: PLAN }, { who: KOFI, document: PLAN, typing: true }] }, ...script }
});

/** Following Priya, from her tile: you go where she goes, to the launch checklist, with the bar that says so. */
export const Following = inCall(reviewing({ cues: at(10, goesTo(PRIYA, CHECKLIST_DOC)) }), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Follow Priya from her tile: its button, or its options on a phone. When she opens the launch checklist, so do you', async () => {
      await c.canvas.findByRole('button', { name: 'More for this document' }, { timeout: 8000 });
      const [tile] = c.canvas.queryAllByRole('button', { name: 'Follow Priya' });
      if (tile) { await c.userEvent.click(tile); return; }
      const arch = await c.canvas.findByRole('group', { name: /^Priya\. Enter for options/ }, { timeout: 5000 });
      arch.focus();
      await c.userEvent.keyboard('{Enter}');
      await c.userEvent.click(await screen.findByRole('button', { name: /^Follow Priya/ }, { timeout: 5000 }));
    });
  }
});
export const FollowingPhone = phone(Following);

/** Kofi tags you in the launch checklist while you're in the plan: the toast says so, with Go there. */
export const Tagged = inCall(reviewing({ cues: at(9, tagsYou(KOFI, CHECKLIST_DOC)) }), { play: openWorkspace });
export const TaggedPhone = phone(Tagged);

/** A comment on the plan's date: select the words, Comment, and say something. The thread stays open beside them. */
export const Comment = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Drag over “Wednesday 18 November” on the page', async () => {
      const words = 'Wednesday 18 November';
      const line = await c.canvas.findByText(/The launch moves to/, {}, { timeout: 8000 });
      const from = line.textContent?.indexOf(words) ?? 0;
      await c.userEvent.pointer([{ keys: '[MouseLeft>]', target: line, offset: from }, { offset: from + words.length }, { keys: '[/MouseLeft]' }]);
    });
    await c.step('Press Comment on the bar over the words', async () => {
      // A plain click: the comment box loads the first time it opens, and React's test checks would call that a mistake.
      (await screen.findByRole('button', { name: 'Comment' }, { timeout: 5000 })).click();
    });
    await c.step('Write it, and send it. The thread stays open beside the words', async () => {
      const field = await screen.findByRole('textbox', { name: 'Comment' }, { timeout: 5000 });
      await c.userEvent.type(field, 'Support needs a day’s notice before this.');
      // A plain click again: sending opens the thread, which loads as it opens.
      (await screen.findByRole('button', { name: 'Send' })).click();
    });
  }
});
export const CommentPhone = phone(Comment);

/** Find, from the magnifier: any document, or any line in one, from words already in this tab. */
export const Find = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press the magnifier at the top of the list', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Find in this workspace' }, { timeout: 8000 }));
    });
    await c.step('Type “checklist”', async () => {
      await c.userEvent.keyboard('checklist');
    });
  }
});
export const FindPhone = phone(Find);

/** History, from ⋯ on the plan: what it said, grouped by call. */
export const History = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press ⋯ at the top of the plan', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'More for this document' }, { timeout: 8000 }));
    });
    await c.step('Open History', async () => {
      await c.userEvent.click(await screen.findByRole('menuitem', { name: /^History/ }, { timeout: 5000 }));
    });
  }
});
export const HistoryPhone = phone(History);

/* ---------- presenting and playing ---------- */

/** You present the plan: Present, then the button that says how many sections. Everyone sees it a section at a time. */
export const Presenting = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press Present at the top of the plan, or in its ⋯ on a phone', async () => {
      const more = await c.canvas.findByRole('button', { name: 'More for this document' }, { timeout: 8000 });
      // It comes once the page knows its sections; a phone has it in ⋯ instead.
      const [present] = await c.canvas.findAllByRole('button', { name: 'Present' }, { timeout: 2000 }).catch(() => []);
      if (present) { await c.userEvent.click(present); return; }
      await c.userEvent.click(more);
      await c.userEvent.click(await screen.findByRole('menuitem', { name: /^Present/ }, { timeout: 5000 }));
    });
    await c.step('Present it. Everyone in the call sees it, one section at a time', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: /^Present \d+ section/ }, { timeout: 5000 }));
    });
  }
});
export const PresentingPhone = phone(Presenting);

/** Priya presents the plan: the workspace opens for it by itself, and she moves it on to the next section. */
export const Watching = inCall(reviewing({ cues: [...at(2, presents(PRIYA, PLAN)), ...at(6, movesPresenting(1))] }));
export const WatchingPhone = phone(Watching);

/** Priya leaves while she's presenting: it ends, and the toast says why. */
export const PresenterLeft = inCall(reviewing({ cues: [...at(2, presents(PRIYA, PLAN)), ...at(9, leaves(PRIYA))] }));
export const PresenterLeftPhone = phone(PresenterLeft);

/** Aiko plays the onboarding film for everyone: it plays in its block, and the bar above the dock says who started it. */
export const PlayForEveryone = inCall(reviewing({ workspace: { brought: [WALKTHROUGH], where: [{ who: AIKO, document: WALKTHROUGH }] }, cues: at(4, plays(AIKO, WALKTHROUGH, FILM)) }, addWalkthrough), { play: openWorkspace });
export const PlayForEveryonePhone = phone(PlayForEveryone);

/* ---------- someone who can open nothing ---------- */

/** Priya's call with Harbourline, which Art isn't signed in for: he comes in with the link, by name, and is let in. */
const HARBOURLINE: StoryCall = { id: 'm-guest', title: 'Harbourline intro', startsAt: iso(0, 16, 5), minutes: 30, code: 'hbr-intr-gst', organizer: PRIYA, guests: [KOFI], status: 'live' };

/** A guest with the link: the workspace is private to them, with the call's own pages and Ask Priya. */
export const Private = inCall({
  scenario: 'signed-out', call: HARBOURLINE,
  script: { here: [{ who: PRIYA, organizer: true }, { who: KOFI }], cues: at(0.5, { do: 'let-in' }), ...TALK }
}, {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Ask Priya. It names nothing, and opens by itself once she shares something', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Ask Priya' }, { timeout: 8000 }));
    });
  }
});
export const PrivatePhone = phone(Private);

/** Theo, with the link, asks to see the workspace: the organizer's card offers the document in front of them, or not now. */
export const AskCard = inCall(reviewing({ here: [...REVIEWERS, { who: THEO, guest: true }], cues: at(4, asksToSee(THEO)) }), { play: openWorkspace });
export const AskCardPhone = phone(AskCard);

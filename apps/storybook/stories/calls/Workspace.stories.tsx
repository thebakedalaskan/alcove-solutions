/*
 * The workspace in a call (user-flows 6): the call's workspace, with its folder of live Notes, Follow-ups and Transcript, open on
 * your stage just for you; a call with none yet, which its organizer makes or picks and everyone else waits for; the organizer's
 * Switch workspace, in its name's menu, and switching; deleting it, for its admins; following someone, a tag and a comment;
 * Find and History; presenting it, with everyone following, and Play for everyone; someone who can open nothing in it, and
 * asking to see it; a follow-up added by hand; and the toasts. Everyone else's browser is the script's: where they are in the
 * workspace, what they present and play, and who asks.
 */
import { DEFAULT_NOTES_CHOICES, type CallSession } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen, waitFor, within } from 'storybook/test';
import { asksToSee, at, goesTo, leaves, opensPage, plays, presentsWorkspace, tagsYou, type CallScript, type Line, type Present } from '../../src/api/script';
import { current } from '../../src/api/state';
import { inCall, light, phone, reach, type InCall, type StoryCall } from '../../src/call';
import { iso } from '../../src/world/clock';
import { ART } from '../../src/world/people';
import { caretAtEnd, pages, type PageArgs, type PageStory } from '../../src/page';
import { frameMenu, frameOf, shareMenu } from './plays';
import {
  addWalkthrough, AIKO, CHECK_IN, CHECK_IN_SUMMARY, CHECK_IN_TALK, CHECKLIST_DOC, FILM, KOFI, LAUNCH_REVIEW, MAYA, PLAN, PRIYA, REVIEW, REVIEW_SUMMARY, REVIEW_TALK, SAM, THEO,
  WALKTHROUGH
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

/** Opens the workspace: Workspace at the top right, or in More on a phone. The first time, the call's folder goes into it. */
async function openWorkspace(c: Step): Promise<void> {
  await reach('Workspace')(c);
}
/**
 * A row of the workspace's list, on your stage: looked for afresh each time, as the workspace draws itself again once the call
 * has put its folder in it.
 */
const rowIn = (name: RegExp) => waitFor(() => {
  const [row] = within(screen.getByRole('region', { name: 'Workspace' })).getAllByRole('button', { name });
  if (!row) throw new Error('Its row isn’t there yet.');
  return row;
}, { timeout: 8000 });
/** Opens one of the call's own pages from its folder. */
const openPage = (name: string): Play => async (c) => {
  await openWorkspace(c);
  await c.step(`Open ${name} in the call’s folder`, async () => {
    // Its row, with a count beside it when there's something in it.
    await c.userEvent.click(await rowIn(new RegExp(`^${name}\\s?(\\d+)?$`)));
  });
};
/** Opens Switch workspace, from the workspace's name on its frame: the organizer's workspaces, with the call's ticked. */
const openPicker = (space: string): Play => async (c) => {
  await openWorkspace(c);
  await c.step('Press the workspace’s name on its frame, then Switch workspace', async () => {
    await frameMenu(c, space);
    await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Switch workspace' }, { timeout: 5000 }));
  });
};
/** The design review's workspace, made for it as it was scheduled. */
const REVIEW_SPACE = 'Design review';
/**
 * The organizer's workspaces come in a moment after the picker opens, and a menu takes no press until its rows have been
 * still for a moment (WsMenu), so what's under the pointer is what someone aimed at: a person's press comes later anyway.
 */
const settle = () => new Promise<void>((done) => { setTimeout(done, 500); });
/** Picks Design in the picker: it asks first. */
const pickDesign = (space: string): Play => async (c) => {
  await openPicker(space)(c);
  await c.step('Pick Design. The question says who can’t open it, and that the call’s notes go there from now on', async () => {
    const design = await screen.findByRole('menuitemradio', { name: /^Design(?! review)/ }, { timeout: 5000 });
    await settle();
    await c.userEvent.click(design);
  });
};

/* ---------- the call's workspace ---------- */

/** The design review's first Workspace: the one Art made for it as he scheduled it, with the call's folder put in it. */
export const InItsWorkspace = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openWorkspace });
export const InItsWorkspacePhone = phone(InItsWorkspace);

/* ---------- a call with no workspace yet ---------- */

/** Scheduled with no workspace: Workspace says so, and Art makes one, or picks one of his. The call's own pages are in the list. */
export const NoWorkspaceYet = inCall({ scenario: 'no-workspace', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, { play: openWorkspace });
export const NoWorkspaceYetPhone = phone(NoWorkspaceYet);
export const NoWorkspaceYetLight = light(NoWorkspaceYet);
/** Pick one of yours: Art's workspaces he can make things in. Picking one asks first, and says who can't open it. */
export const NoWorkspacePickOne = inCall({ scenario: 'no-workspace', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press Pick one of yours. Art’s workspaces open under it', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Pick one of yours' }, { timeout: 8000 }));
    });
    await c.step('Pick Product. Use Product for this call? The call’s notes and transcript go there from now on', async () => {
      const product = await screen.findByRole('menuitemradio', { name: /^Product/ }, { timeout: 8000 });
      await settle();
      await c.userEvent.click(product);
    });
  }
});
export const NoWorkspacePickOnePhone = phone(NoWorkspacePickOne);
/** New workspace, from the empty Workspace: one for the call, with everyone invited in it, open on a blank document. */
export const NoWorkspaceMakeOne = inCall({ scenario: 'no-workspace', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press New workspace. It’s the call’s, named after it, and the toast says the notes go there', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'New workspace' }, { timeout: 8000 }));
      await screen.findByText(/^New workspace, Design review\. Everyone invited is in it/, {}, { timeout: 15000 });
    });
  }
});
/** A board needs somewhere to be kept: Board's picker says so over New, and the team's boards still open. */
export const NoWorkspaceBoard = inCall({ scenario: 'no-workspace', call: REVIEW, script: { here: REVIEWERS } }, { play: reach('Board') });
/** Priya's check-in, scheduled with no workspace, for Art, invited: Priya chooses it, and it opens for him once she has. */
export const NoWorkspaceInvited = inCall({ scenario: 'busy', call: { ...CHECK_IN, workspaceId: null }, script: { here: [{ who: KOFI }, { who: AIKO }] } }, { play: openWorkspace });
export const NoWorkspaceInvitedPhone = phone(NoWorkspaceInvited);
/** Share, with no workspace yet: The workspace says Priya chooses it, for Art, invited. */
export const NoWorkspaceShare = inCall({ scenario: 'busy', call: { ...CHECK_IN, workspaceId: null }, script: { here: [{ who: KOFI }, { who: AIKO }] } }, { play: async (c) => { await shareMenu(c); } });

/* ---------- deleting it ---------- */

/** Delete workspace, for its admin, in the frame's menu: it asks first, in the menu's place. */
export const DeleteAsk = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press the workspace’s name on its frame, then Delete workspace. It asks first', async () => {
      await frameMenu(c, REVIEW_SPACE);
      await c.userEvent.click(await screen.findByRole('menuitem', { name: 'Delete workspace' }, { timeout: 5000 }));
    });
  }
});
export const DeleteAskPhone = phone(DeleteAsk);
/** Deleted: it goes for everyone, its stream ends, and the call has no workspace, so Art can make or pick another. */
export const Deleted = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await DeleteAsk.play?.(c);
    await c.step('Delete forever. The call has no workspace now', async () => {
      await c.userEvent.click(await screen.findByRole('button', { name: 'Delete forever' }, { timeout: 5000 }));
      await c.canvas.findByText('This call has no workspace yet', {}, { timeout: 8000 });
    });
  }
});
/** On your own with the workspace open: the link for anyone to ask to join stays on the stage, as it does without the workspace, clear of the list. */
export const JustYou = inCall({
  scenario: 'on-their-own',
  call: { id: 'm-alone', title: 'Contract review', startsAt: iso(0, 16, 10), minutes: 30, code: 'ctr-revw-ana', guests: [] }
}, { play: openWorkspace });
export const JustYouPhone = phone(JustYou);

/** Switch workspace, the organizer's: their workspaces they can make things in, the call's ticked, and New workspace. */
export const ThePicker = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, { play: openPicker(REVIEW_SPACE) });
export const ThePickerPhone = phone(ThePicker);

/** Switching asks once: Sam came in with the link and can't open Design, and the call's notes go there from now on. */
export const SwitchQuestion = inCall(
  { scenario: 'call-soon', call: REVIEW, script: { here: [...REVIEWERS, { who: SAM, guest: true }] } },
  { play: pickDesign(REVIEW_SPACE) }
);
export const SwitchQuestionPhone = phone(SwitchQuestion);

/** Switched: Design is the call's for everyone, and the toast says its notes go there, with Back. */
export const Switched = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [...REVIEWERS, { who: SAM, guest: true }] } }, {
  play: async (c) => {
    await pickDesign(REVIEW_SPACE)(c);
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

/** A follow-up nobody said, added by hand with an optional owner and date, for everyone who gets the notes. */
export const AddFollowUp = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS, ...TALK } }, {
  play: async (c) => {
    await openPage('Follow-ups')(c);
    await c.step('Add one nobody said, with a date and nobody assigned yet', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Add a follow-up' }, { timeout: 8000 }));
      await c.userEvent.type(await c.canvas.findByRole('textbox', { name: 'What needs doing' }), 'Book the room for the launch retro');
      await c.userEvent.type(await c.canvas.findByRole('textbox', { name: 'Due' }), 'Friday');
      await c.userEvent.click(c.canvas.getByRole('button', { name: 'Add' }));
    });
  }
});
export const AddFollowUpPhone = phone(AddFollowUp);

/* ---------- working together ---------- */

/**
 * The launch review, its workspace Product, picked when it was scheduled: the launch plan brought to the call, and Priya and
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

/**
 * Hear it, during the call: what was said a moment ago, quoted into the plan as Quote what was said does, plays from the
 * call's own recording, for anyone in the call who was there for it, a guest included. After the call, it's for people with
 * the notes. The quote is the call's newest line, put at the end of the plan as you come in.
 */
function quoteTheLatest(session: CallSession): void {
  const s = session.getSnapshot();
  const line = s.transcript.at(-1);
  const page = current().pages[PLAN];
  if (!line || !s.notes.noteId || !page) return;
  page.blocks = [...page.blocks.filter((b) => b.type !== 'moment'), {
    type: 'moment', attrs: { person: line.speaker?.person?.id ?? null, name: line.speaker?.name ?? '', at: new Date(Date.now() - 60_000).toISOString(), text: line.text, line: line.id, note: s.notes.noteId }
  }];
}
const hearIt: Play = async (c) => {
  await openWorkspace(c);
  await c.step('Press Hear it on the quote at the end of the plan. It says it’s working until the sound starts', async () => {
    const hear = await c.canvas.findByRole('button', { name: 'Hear it' }, { timeout: 10000 });
    hear.scrollIntoView({ block: 'center' });
    await c.userEvent.click(hear);
  });
};
/** What Hear it says on the quote, once it has said it. */
const says = (words: string): Play => async (c) => {
  await hearIt(c);
  await c.step(`It says: “${words}”`, async () => { await c.canvas.findByText(words, {}, { timeout: 5000 }); });
};
export const HearIt = inCall({ ...reviewing(), then: quoteTheLatest }, { play: hearIt });
export const HearItPhone = phone(HearIt);
/** Still fetching the line: the button turns while the recording comes, and plays once it has. */
export const HearItFetching = inCall({ ...reviewing({ hear: 'waits' }), then: quoteTheLatest }, { play: hearIt, name: 'Hear it, fetching' });
/** The line's piece of the recording hasn't gone up yet: it says so, and pressing again a few seconds later plays it. */
export const HearItNotYet = inCall({ ...reviewing({ hear: 'not-yet' }), then: quoteTheLatest }, {
  name: 'Hear it, not in the recording yet',
  play: async (c) => {
    await says('Not in the recording yet. Try again in a few seconds.')(c);
    await c.step('Press Hear it again. The piece has gone up now, so it plays', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Hear it' }));
    });
  }
});
export const HearItNotYetPhone = phone(HearItNotYet);
/** Priya's launch review, going on now, with Product its workspace and Art on its invite. */
const PRIYAS_REVIEW: StoryCall = { id: 'm-priyas-review', title: 'Launch review', startsAt: iso(0, 16, 10), minutes: 45, code: 'lch-revw-pri', organizer: PRIYA, guests: [ART, KOFI, AIKO], workspaceId: 'ws-product', status: 'live' };
/** The same call with Art not on its invite: on a browser he isn't signed in on, he comes in with the link, as a guest. */
const PRIYAS_REVIEW_BY_LINK: StoryCall = { ...PRIYAS_REVIEW, id: 'm-priyas-review-link', code: 'lch-revw-lnk', guests: [KOFI, AIKO] };
/** What Priya says once the guest is in, which she quotes into the plan. */
const SAID_ONCE_IN: Line & { id: string } = { id: 'line-review-notice', who: PRIYA, text: 'Support needs a day’s notice before the launch moves.' };
/** Product as a guest Priya let see the launch plan has it: the plan and nothing else, under no name. */
function onlyThePlan(): void {
  const w = current();
  w.workspaces = w.workspaces.map((s) => (s.id === 'ws-product' ? { ...s, name: null, role: null, people: null, items: s.items.filter((i) => i.id === PLAN).map((i) => ({ ...i, parent: null })) } : s));
}
/** Priya's quote of what she said once the guest was in, at the end of the plan, as Quote what was said puts it there. */
function quoteSaidOnceIn(session: CallSession): void {
  const note = session.getSnapshot().notes.noteId;
  const page = current().pages[PLAN];
  if (!note || !page) return;
  page.blocks = [...page.blocks.filter((b) => b.type !== 'moment'), {
    type: 'moment', attrs: { person: PRIYA.id, name: PRIYA.name, at: new Date().toISOString(), text: SAID_ONCE_IN.text, line: SAID_ONCE_IN.id, note }
  }];
}
/**
 * A guest with the link hears only the pieces of the recording they were there for, whole: on a line they came in part way
 * through the piece of, it says so in place of Hear it. Priya let the guest see the launch plan, where she quoted the line.
 */
export const HearItNotThere = inCall({
  scenario: 'signed-out', call: PRIYAS_REVIEW_BY_LINK,
  script: {
    here: [{ who: PRIYA, organizer: true }, { who: KOFI }], since: 100, cues: at(0.3, { do: 'let-in' }), talk: { lines: [SAID_ONCE_IN], from: 1.5 },
    workspace: { brought: [PLAN], yours: [PLAN] }, hear: 'not-found'
  },
  then: (session) => { onlyThePlan(); quoteSaidOnceIn(session); }
}, { play: says('You can only hear what you were there for.'), name: 'Hear it, not there for it' });
/**
 * Someone invited (or the organizer, or whoever hosts) hears all of the recording that plays, so a part of it that can't be
 * played says just that, in place of Hear it.
 */
export const HearItCantPlay = inCall({
  ...reviewing({ here: [{ who: PRIYA, organizer: true }, { who: KOFI }, { who: AIKO }], hear: 'not-found' }), call: PRIYAS_REVIEW, then: quoteTheLatest
}, { play: says('This part of the recording can’t be played.'), name: 'Hear it, can’t be played' });
/** Audio this browser can't play: it says so in place of Hear it. */
export const HearItUnplayable = inCall({ ...reviewing({ hear: 'unplayable' }), then: quoteTheLatest }, { play: says('This browser couldn’t play it.'), name: 'Hear it, can’t play here' });
/** A call that doesn't keep its recording: a quote of it says so, and offers no Hear it. */
export const HearItUnkept = inCall({ ...reviewing(), call: { ...LAUNCH_REVIEW, choices: { ...DEFAULT_NOTES_CHOICES, keepRecording: false } }, then: quoteTheLatest }, {
  name: 'Hear it, no recording kept',
  play: async (c) => {
    await openWorkspace(c);
    await c.step('The quote at the end of the plan says the call doesn’t keep its recording', async () => {
      (await c.canvas.findByText('This call doesn’t keep its recording.', {}, { timeout: 10000 })).scrollIntoView({ block: 'center' });
    });
  }
});

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

/** `/` in the plan, in the call: From the call comes first, its three rows in view, then Write and Add. */
export const SlashMenu = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Go to the end of “What goes out”, start a line under it, and type /', async () => {
      const line = await c.canvas.findByText('What goes out', {}, { timeout: 8000 });
      await c.userEvent.click(line);
      caretAtEnd(line);
      await c.userEvent.keyboard('{Enter}/');
      await screen.findByRole('listbox', { name: 'Blocks' }, { timeout: 5000 });
    });
  }
});
export const SlashMenuLight = light(SlashMenu);
export const SlashMenuPhone = phone(SlashMenu);

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

/** You press Present on the workspace's frame: everyone follows you, wherever you go in it, and can unfollow to work alongside you. */
export const Presenting = inCall(reviewing(), {
  play: async (c) => {
    await openWorkspace(c);
    await c.step('Press Present on its frame: everyone follows you', async () => {
      await c.userEvent.click(await within(await frameOf('Product')).findByRole('button', { name: 'Present' }, { timeout: 8000 }));
      await screen.findByText('Everyone follows you in the workspace. They can unfollow to work alongside you.', {}, { timeout: 8000 });
    });
  }
});
export const PresentingPhone = phone(Presenting);

/** Priya presents the workspace: it takes your stage, you follow her into the plan, and its bar says so, with Unfollow. */
export const Watching = inCall(reviewing({ cues: at(6, presentsWorkspace(PRIYA)) }), {
  play: async (c) => {
    await c.step('Priya presents the workspace: you follow her', async () => {
      await screen.findByText('Priya is presenting the workspace, and you’re following.', {}, { timeout: 20000 });
    });
  }
});
export const WatchingPhone = phone(Watching);

/**
 * Priya leaves while she's presenting the workspace: the call says it ended as she goes, so it ends at once, and the toast says
 * why. What you had open stays, just for you.
 */
export const PresenterLeft = inCall(reviewing({ cues: [...at(6, presentsWorkspace(PRIYA)), ...at(12, leaves(PRIYA))] }), {
  play: async (c) => {
    await c.step('Priya presents the workspace, then leaves: it ends, and you’re told why', async () => {
      await screen.findByText('Priya left the call, so the presentation ended', {}, { timeout: 25000 });
    });
    await c.step('What you had open stays, just for you', async () => { await screen.findByText('Open just for you', {}, { timeout: 5000 }); });
  }
});
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

/* ---------- following onto the call's pages, and stopping ---------- */

/** Follows Priya from her tile: its button, or its options on a phone. */
const followPriya: Play = async (c) => {
  await openWorkspace(c);
  await c.step('Follow Priya from her tile: its button, or its options on a phone', async () => {
    await c.canvas.findByRole('button', { name: 'More for this document' }, { timeout: 8000 });
    const [tile] = c.canvas.queryAllByRole('button', { name: 'Follow Priya' });
    if (tile) { await c.userEvent.click(tile); return; }
    const arch = await c.canvas.findByRole('group', { name: /^Priya\. Enter for options/ }, { timeout: 5000 });
    arch.focus();
    await c.userEvent.keyboard('{Enter}');
    await c.userEvent.click(await screen.findByRole('button', { name: /^Follow Priya/ }, { timeout: 5000 }));
  });
};
/** Following Priya onto the call's own pages: she opens its Notes, then its Transcript, and you go too, the bar naming each. */
export const FollowingOntoTheCallsPages = inCall(reviewing({ cues: [...at(10, opensPage(PRIYA, 'notes')), ...at(16, opensPage(PRIYA, 'transcript'))] }), {
  play: async (c) => {
    await followPriya(c);
    await c.step('Priya opens the call’s Notes: you go too, and the bar says where she is', async () => {
      await c.canvas.findByText('Notes', { selector: '.wd-follow .w' }, { timeout: 15000 });
    });
    await c.step('Then its Transcript, and you go there too', async () => {
      await c.canvas.findByText('Transcript', { selector: '.wd-follow .w' }, { timeout: 15000 });
    });
  }
});
export const FollowingOntoTheCallsPagesPhone = phone(FollowingOntoTheCallsPages);

/** Stop following on the bar: you stay where you are, and the toast offers Follow again. */
export const StoppedFollowing = inCall(reviewing(), {
  play: async (c) => {
    await followPriya(c);
    await c.step('Press Stop following on the bar. You stay, and the toast offers Follow again', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: /^Stop following/ }, { timeout: 8000 }));
    });
  }
});
export const StoppedFollowingPhone = phone(StoppedFollowing);

/* ---------- notes turned off ---------- */

const CHECKING_IN: Present[] = [{ who: KOFI }, { who: AIKO }, { who: MAYA }];
/**
 * Priya turns notes off at her check-in once some are written: the call's Notes keep what was written, say they're off, and
 * offer to ask her for them back. You ask: it says so, with Take back your ask.
 */
export const NotesTurnedOff = inCall({
  scenario: 'busy', call: { ...CHECK_IN, code: 'lch-chck-wso' },
  script: {
    here: CHECKING_IN, since: 100, earlier: CHECK_IN_TALK.slice(0, 5), talk: { lines: CHECK_IN_TALK.slice(5), from: 2, every: 5 }, summary: CHECK_IN_SUMMARY,
    cues: at(6, { do: 'notes', mode: 'off' })
  }
}, {
  play: async (c) => {
    await openPage('Notes')(c);
    await c.step('When Priya turns notes off, the page says so and offers to ask her. Ask', async () => {
      await c.userEvent.click(await c.canvas.findByRole('button', { name: 'Ask Priya for notes' }, { timeout: 15000 }));
    });
  }
});
export const NotesTurnedOffPhone = phone(NotesTurnedOff);

/* ---------- a workspace made in the call, and a name twice ---------- */

/** New workspace, from the picker: one for the call, with everyone invited in it to edit, and it's the call's, its notes with it. */
export const NewWorkspace = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS } }, {
  play: async (c) => {
    await openPicker(REVIEW_SPACE)(c);
    await c.step('Press New workspace. Everyone invited is in it, and the toast says the call’s notes go there', async () => {
      await screen.findByRole('menuitemradio', { name: /^Product/ }, { timeout: 8000 });
      await settle();
      await c.userEvent.click(await screen.findByRole('menuitem', { name: /^New workspace/ }, { timeout: 5000 }));
      await screen.findByText(/^New workspace, Design review\. Everyone invited is in it/, {}, { timeout: 15000 });
    });
  }
});
export const NewWorkspacePhone = phone(NewWorkspace);

/** An earlier design review today, at 9:00, with a workspace made for it: named as this call's is. */
function earlierReview(): void {
  const at = iso(0, 9, 0);
  current().workspaces.push({ id: 'ws-review-early', name: 'Design review', role: 'admin', people: 4, items: [], createdAt: at, call: { title: 'Design review', at } });
}
/** The picker when this call's workspace and an earlier one share a name: each says when its call started. */
export const ThePickerSameNameTwice = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: REVIEWERS }, then: earlierReview }, { play: openPicker(REVIEW_SPACE) });
export const ThePickerSameNameTwicePhone = phone(ThePickerSameNameTwice);

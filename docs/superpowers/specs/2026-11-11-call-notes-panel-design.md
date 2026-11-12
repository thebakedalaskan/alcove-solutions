# Notes in the call, rethought

The call's Notes panel was confusing and busy. It said its state three times (a Notes on chip, "Written as people talk",
"Writing as people talk") and kept its controls behind ⋯. It boxed a hiccup that fixes itself, drew decisions as ticked
boxes like to-dos, put Everyone 0 · Mine 0 and "Nothing to do yet" beside a count of suggestions, explained Yours in a
paragraph, and repeated the top bar's shield in a footer. The canvas is [docs/design/canvas/notes](../../design/canvas/notes/README.md);
this says what it decided.

## The panel

Notes, at the top right (and in More on a phone), opens the panel on your side, as before.

- **Head:** Notes, then **the pill**, then Open (an icon button, ↗, "Open in the workspace, just for you") and ×. No subtitle and
  no bookmark here.
- **The pill** says the state in a word and opens **what's captured** (below), the same card the sign in the top bar opens:
  **Live** with a rec dot while notes are on; **Paused** (pause icon); **Pausing…** while the organizer's pause is on its way;
  **Unavailable** in caution (alert icon) when the browser taking the notes can't capture; **Off** (a hollow ring); and, for
  the organizer while notes are off and people have asked, **2 asked** in rose. In a breakout room it says the room's state.
- **Tabs:** Notes, Transcript, Ask and **Yours** (only for someone with an account: a guest has no Yours). Words with a line
  under the one you're on (the kit's own tabs), not a segmented control.
- **The bar,** under the tabs on Notes and Transcript, appears only when capture isn't simply live, says what it means and
  carries the one thing to do about it. Its cases:
  - paused: "Paused at 16:12. Nothing new is written until you resume." with **Resume** (filled) for the organizer; anyone
    else reads "Priya paused notes at 16:12…" with **Ask to resume**, then **Take back your ask** once they've asked;
  - off after notes were on: "Notes are off. What was written is kept." with **Turn on** for the organizer; anyone else reads
    "Priya turned notes off. What was written is kept." with **Ask for notes**;
  - off with asks, for the organizer, in rose: the askers' faces, "Kofi and Aiko asked for notes.", **Not now** (says not now to
    each ask) and **Turn on**;
  - unavailable, in caution: whose browser can't hear and that notes pick up when it can (a breakout room's wording when in one),
    and likewise while it records but can't listen, on every tab, unless this browser's own problem already says why;
  - the host in a breakout room while notes are on, and a breakout room the organizer paused;
  - this browser's own problems (the recording couldn't upload, the microphone isn't heard, a share can't reach the notes), in
    caution, one bar each.
- **A hiccup is a word, not a box.** The notes not being updated just now (`liveNotes.error`) turns the summary's freshness
  caution: "Not updated since 16:12", with "Alcove tries again on its own" as its title.

## The Notes tab

From last time (a call in a series) folds at the top as before. Then, in this order:

1. **Summary**, three lines with **Show all**. At its heading's right, its freshness: "Writing" with dots while notes are on,
   "As of 16:12" otherwise, caution when stale, and `Unencrypted` when the call's model isn't in a secure enclave.
   A guest's notes say "Written from what was said while you were here." above it.
2. **Decided**, the heading in rose with its count: a rose diamond, the words, the time of day as a quiet button that opens the
   transcript there, and the arrow that adds it to the document you were last in. "Nothing decided yet." when empty.
3. **Follow-ups**, the heading in horizon with its count and **+** (add one): the checklist, then what the call suggests (below).
4. **From the rooms,** once breakout rooms have been held.

No "Writing as people talk" line at the foot, no "Updated from N lines", no footer: each was said elsewhere.

Empty states: **Listening** ("Decisions, follow-ups and a summary come in here as people talk."), the first notes not written
yet (while Alcove tries again), and **Writing the first
notes**; **Notes are off** with **Turn on notes** (the organizer), **Ask for notes** (anyone else), "You asked Priya for notes"
with **Take back your ask**, and "Priya said not now" after a decline; **Notes are paused**, **Nothing is being captured** and
a breakout room's own, each as today but in the panel's type.

## Follow-ups in the panel

- Each accepted follow-up is a row: a horizon box anyone permitted ticks (a guest's is disabled), the words, under them the
  owner's face and name and the due date as a small chip, and at the right the time it was said (opens the transcript) with
  edit and the arrow on hover. Editing opens the form in place.
- **+** in the heading opens the add form in place, as Add a follow-up did.
- **What the call suggests sits under the checklist**, under a dashed "Suggested from the call" rule: each a row with a
  dashed box, its words in ink-2, owner and due, its time, **Add** and × (Dismiss). A suggested change to a follow-up shows the
  current words struck through under the new ones and says **Apply** instead of Add. Two show, then "N more suggested".
- The review rules hold, inline: rows never move or change under your pointer or keyboard. While the pointer is over the
  suggestions or focus is in them, the rows shown stay as they were, and what arrives waits behind "N more suggested". A
  decision goes with the revision you saw; a suggestion that changed says "Changed since you saw it" and shows its new words;
  one someone else reviewed says so. Someone who can read it but not change it sees no buttons.
- No Everyone/Mine filter and no "Nothing to do yet" beside suggestions: "Nothing to do yet." shows only when there are
  neither follow-ups nor suggestions.
- The workspace's Follow-ups page and the note after the call keep their count and review batch, unchanged.

## Yours and the foot

- **Yours** is a tab: what you wrote, marked and kept, oldest first, as `OwnEntries` draws it; empty, "Only you see what's
  here" and one line on what goes in, and before notes have been on, that they start when notes do.
- **The foot**, on every tab but Ask, while you can keep your own notes and the call has notes: **Note to self** (a pen at its
  left and "Only you" with a lock at its right until you type; Enter keeps it in Yours and a toast says so, with Open), and
  beside it **the bookmark**, "Mark this moment, only you" (B).
- Mark this moment's toast and a line's bookmark's toast open **Yours**.

## Transcript and Ask

- Transcript: the bar as above in place of its notices; no footer. Lines, bookmarks, quoting and the moment view as today.
- Ask: no "Only you see this" box (the Only you chip and the composer say it); the caution about a model outside a secure
  enclave stays. Its composer keeps its chips, range, scope and Catch me up.

## What's captured

One card, opened by the pill and by the sign at the top left, with what's yours to press:

- The sign in the state's colour and when it changed ("Since 16:02", "By you at 16:12").
- One sentence on what's captured now (today's sentence, rooms and degraded capture included), then who may change it for
  anyone else: "Only Priya can pause or turn them off."
- Asks: for the organizer, the askers' faces and "Kofi and Aiko asked for notes." in rose; for someone who asked, "You asked
  Priya." with **Take back your ask**; after a decline, "Priya said not now at 16:08.".
- Actions: the organizer's **Pause notes** and **Turn off** while on, **Resume notes** (filled) and **Turn off** while paused,
  **Turn on notes** (filled) while off, **Pause notes here** or **Resume notes here** in a breakout room; anyone else's **Ask for
  notes** (filled) while off or paused.
- Facts, a hairline row each: how they're written (confidential compute, or caution with `Unencrypted` outside a secure
  enclave), who gets them (with faces for the organizer), shared screens when they're read, and for the organizer, outside a
  breakout room, **Notes written by** with the model picker.
- **Open the notes**, at its foot, only when it opened from the sign and Notes isn't open.

The four capture parts (recording, transcript, AI notes, shared screens) are no longer listed one by one: the sentence says what
isn't working, in words.

## The notes model

The prompts that write live notes, the notes after the call and the full summary leave out small talk: greetings, how people
are, the weather, weekends and plans that have nothing to do with the meeting, and talk about the call itself. It's never a
decision, question, suggestion, follow-up or chapter, and the summary leaves it out (a meeting that was only small talk gets one
sentence that says so).

## Not changing

The wire, the server's notes and stored records, the note after the call, the workspace's Follow-ups page, Chat and People.
Live notes still sort "Suggested, not agreed" and "Still open"; the panel still doesn't show them (Ask's Catch me up does).

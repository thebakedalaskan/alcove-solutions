# Search, rethought

The design was approved as drawn on the "Search, rethought" canvas (claude.ai artifact B23LCGNNJKRE99t8QBvb32). Its boards
are copied into `docs/design/canvas/` as `Search.dc.html` and `StepsSearch.dc.html` by this change. Where this document and
the canvas differ, this document is right.

## Why

People found search confusing. Typing a keyword into Search or ask (⌘K) only listed calls, two calls with the same name
looked identical, and nothing said why a call matched. Three causes, in the code:

- The server already returns the matching lines with each note (`NoteFound.said`, `saidCount`), but the palette
  (`apps/web/src/features/shell/Palette.tsx`) shows only the title and meta.
- `foundIn` (`apps/api/src/features/notes/service.ts`) never matches who spoke, so a name only finds calls where
  someone said it out loud.
- Enter asks the notes model unless you arrow down first, and the filled Ask button is the brightest thing in view.

It also looked see-through: the scrim is night at 42% with a 3px blur, and the field at the top right is ink at 8% over the
sky.

## What it does

The palette is a window over the page, opaque, with a hairline and a deep shadow. The page behind is dimmed, never
blurred. On a wide screen it has two panes: the list, and a preview of what's lit beside it.

- **The line** sits on the window itself, not as a pill inside it: a magnifier, an optional person token, the input,
  `esc`. On a phone the window takes the screen and `esc` becomes **Cancel**. When Ask is lit the magnifier becomes the
  Ask mark, in `sun-text`. Placeholder: "Search everything said, or ask a question"; with a person token, "Search what
  Maya said".
- **Before you type:** People (the five people you have most calls with, as arches; pressing one makes them the token),
  then Recent notes (five). The newest note is lit, and its preview shows.
- **Typing** (two letters or more, or a token) lists, in order:
  1. **Ask "…"**: always first while something is typed. Lit by itself when what's typed reads as a question
     (`searchOf().question`); otherwise it shows `Tab`.
  2. **People** whose names have the words (each word starts one of their names), up to three: arch, name with the
     match marked, their title and "4 calls together". Enter on one makes them the token.
  3. **What was said** · "9 moments in 4 calls": the calls newest first, each a head (its sky and title, its day), then
     its moments in time order: the speaker's arch and name, **Decision** (rose) or **Follow-up** (horizon) when the line
     is what one rests on, the words with the match marked (a long line starts just before the match), and the time chip.
     The first call shows up to three moments and the others two (three each when there are only two calls); "N more in
     Team standup" opens the rest of that call in place. A question titles this group "Moments with these words".
     With a token and nothing typed, it's "What Maya said".
  4. **Notes** that have the words only in their title, summary, decisions or follow-ups (no line of what was said), five
     at most.
  5. **See all 9 moments in Notes** (or "Open these in Notes" when nothing is hidden), attached to the end of the list.
     With a token it's **Calls with Maya in Notes**, with no count: Notes lists the notes you both have, not only her lines.
- **The lit row** starts on Ask for a question and on the first thing found otherwise. ↑ and ↓ move it, the pointer
  moves it, Enter does it. Tab asks about what's typed. Escape closes (from an answer it goes back to the results first).
  Backspace on an empty line takes the token off. ⌘K closes it again.
- **The preview** follows the lit row:
  - A moment: the call's title, when and how long, its people; the decision or follow-up made there, if any, with Confirm
    and It wasn't decided for a decision still waiting; then the transcript around it (one line before, the line lit, three
    after, the words marked); pinned at its foot, **Open at 3:15 ↵** (the one filled button) and **Play from 3:15** when
    the note has audio.
  - A person: their arch, name and title, "4 calls together, most recently today", Latest from Maya (three lines, with
    the call and time), and **What Maya said ↵** and **Calls with Maya**.
  - A note: title, meta, people, summary, the 1 to confirm / 2 follow-ups chips, **Open notes ↵**.
  - Ask: the question, one line ("The answer reads all 11 of your notes, and points to the moments it comes from."),
    **Ask ↵/Tab**.
  - See all: the words, what was found, **See all in Notes ↵**. With a token: the words (or "Calls with Maya"), that Notes
    lists the notes you both have, **Calls with Maya ↵**.
- **Asking** replaces the list with the answer: ← Results, the answer beside the Ask mark ("Reading your notes" with
  dots while it's written), then "From your notes · 4 moments" and the cited moments as moment rows under their calls. The
  preview shows the lit moment. Editing the line goes back to results; Escape too.
- **The foot**: what's private on the left: "Only you can see what you search." with a lock, or, while Ask is lit or an
  answer shows, "Answers are written in confidential compute, from your notes only." with the sealed shield in `sun-text`
  (the existing outside-an-enclave caution wording and `Unencrypted` badge when the chosen model is outside one). The keys
  on the right: ↑ ↓ Move, ↵ Open/Ask/Pick/Show/See all, Tab Ask (while something's typed and Ask isn't lit), esc
  Close/Back. A phone shows no keys.
- **States**: loading keeps the last list, dimmed (`is-stale`), or dots when there's none; nothing matches ("Nothing
  matches “cake”" / "Search looked through the names, titles, summaries, decisions, follow-ups and everything said in all 11
  of your notes.") with Ask lit above it; the first day ("Nothing to search yet" / "After your first call with notes on,
  everything said in it can be found here: who said it, and when."); a failed search (caution: "The search didn’t go
  through" / "Try again, or ask instead." with Try again); offline ("You’re offline" / "Search needs a connection. It works
  again as soon as you’re back."). Empty, offline and first-day windows are the narrow window with no preview.
- **Widths**: the window is 1000px wide and 640px tall (never taller than the space under the top margin). Under 1100px it's
  680px with the list alone. At 860px and under it's the whole screen.
- **The way in**: Search or ask at the top right is a solid field (`surface-raised` with a `line` hairline), its ⌘K on
  `sunk`. The phone's top bar keeps its magnifier.
- **Pin a note** opens the same window, narrow, with its own line (the pin icon), rows and foot, behaving as today.
- **See all** opens Notes with the same words in its line, and `#with=<address>` when there's a token. **Calls with Maya**
  opens Notes with `#with=`.

## The contract (`packages/api`)

Wire only; nothing stored changes, so there's no migration and older records read as before.

- `src/search.ts`
  - `namesIn(name: string, terms: string[]): number`: how many of the words start one of the words of a name (two
    letters at least, case-insensitive).
  - `termsSaid(line: { text: string; speaker?: { name: string } | undefined }, terms: string[]): number`: how many of the
    words are in the line's words or start a word of its speaker's name. Server, stand-in and app all use it.
- `src/notes/schema.ts`: `NoteSaidSchema` gains `made: z.enum(['decision', 'follow-up']).optional()`: the line is what a
  decision or follow-up in the notes rests on (its `lines`).
- `src/notes/wire.ts`: `NoteSearchBodySchema = z.object({ kind: NoteKindSchema.optional(), text: z.string().max(MAX_SEARCH_TEXT).optional(), by: EmailParamSchema.optional() })`,
  exported, and used by the route. `MAX_SEARCH_TEXT` (200) and `MAX_QUESTION` (500) are the contract's, for the app's lines
  as much as the server's bodies, and `NotePlayParamSchema` reads the note page's `play`.
- `src/notes/api.ts`: `list(query?: { kind?; text?; by?: string | undefined })`. `by` is someone's address: only the lines
  they said count, and only notes with one are found.

## The server (`apps/api/src/features/notes`)

- `foundIn(l, search, by)`:
  - A note has a word when it's in its title, summary, decisions, follow-ups or anything said, or starts a word of the name
    of someone who spoke in it (`namesIn` over the speakers).
  - Lines found: `termsSaid(line, terms)` > 0, best first, then time. With `by`, only lines whose
    `speaker.person.email` is that address (case-insensitive); with `by` and no words, all of them, in time order; with `by`
    a note matches only through such a line.
  - `made` on each line found: `'decision'` when a decision that isn't rejected rests on it, else `'follow-up'` when a
    follow-up does; breakout rooms' lines against their room's entries.
  - `SAID_SHOWN` goes from 4 to 10, so the palette can open a call's other moments in place.
- The route parses `NoteSearchBodySchema`. Search words and addresses travel in the body, never the URL or a log line.
- Integration tests, in the notes feature's own suites, through the real API: a name finds the lines that person said when
  nobody said the name; `by` returns only that person's lines, across notes; `by` finds nothing in a note you don't have
  (someone else's, cross-owner); `made` marks the line a decision and a follow-up rest on; a decision's words find a note.

## The client and the stand-in

- `packages/api-http/src/notes/api.ts` sends `by` in the body.
- `apps/storybook/src/api/standin.ts`'s `found()` does what the server does (speaker names, `by`, `made`, ten lines).

## The kit (`packages/ui`)

`components/palette.tsx`, stateless, exported from the package; styles in `styles/palette.css` (prefix `pal-`, which
moves out of `shell.css`). The app renders each row's own element (a `Link`, or a `div` with `role="option"`) with
`className={paletteRow(kind, active)}` and puts one of the row parts inside it, so rows stay real links.

```ts
paletteRow(kind: 'ask' | 'person' | 'moment' | 'note' | 'more' | 'all', active: boolean): string
PaletteLine({ ask?, token?, onCancel, children })                   // children: <input className="pal-in" …>
PaletteToken({ person, name, onClear, clearLabel })
PaletteBody({ preview?, children })                                // two panes when there's a preview, from 1100px
PaletteGroup({ label, count?, children })                           // role="group", labelled by its label
PaletteAskLine({ text, keyLabel })
PalettePersonLine({ person, name, meta })                          // name: ReactNode (marked)
PaletteCallHead({ cover, room?, title, meta })
PaletteMomentLine({ person?, name, made?, time, children })         // children: the words, marked
PaletteNoteLine({ cover, room?, title, meta })
PaletteMoreLine({ children }) / PaletteAllLine({ children })
PalettePeople({ label, people: { person, first, onPick }[] })
PalettePreview({ actions?, children })                              // scrolls; actions pinned at its foot
PalettePreviewHead({ title, meta, people? })
PaletteMade({ kind, text, state, children? })                       // children: actions
PaletteExcerpt({ children }) / PaletteExcerptLine({ time, person?, name, lit?, children })
PaletteAskPreview({ question, children })
PalettePersonPreview({ person, title, meta, saidLabel, said: { key, call, time, text }[] })
PaletteAnswer({ reading?, children }) / PaletteBack({ onClick, children })
PaletteFoot({ sealed?, children, keys?: { keys: string[]; label: string }[] })
```

- Nothing to list is the kit's `EmptyState`, its `art` the palette's dashed arch around an icon (`pal-none-arch`), with
  `className="pal-none"` (`is-caution` for a search that didn't go through); `palette.css` sizes it for the window.
- `Sheet` takes `overlayClassName`, so the palette's scrim is its own (`pal-scrim`: solid night at about 86% in dark,
  about 55% in light, no blur) while other sheets and modals keep theirs.
- `.top-find` becomes solid in `shell.css`.
- Colours from the tokens only: the lit row on `sunk`, marks on `sun-soft`/`sun-text`, Decision in `rose`, Follow-up in
  `horizon`, the lit excerpt line warm, the time chip as the app's moment chip. Hanken Grotesk throughout; no Newsreader.
- Component stories for every part, in both themes.

## The app (`apps/web`)

- `features/shell/Palette.tsx` keeps the window and its two modes; `features/shell/palette/` holds the rest:
  `rows.ts` (pure: rows, the selectable keys and the lit default from what's typed, the token, what was found, your
  notes and your team; not `results.ts`, which a case-insensitive disk would confuse with `Results.tsx`), `Results.tsx`,
  `Preview.tsx`, `Answered.tsx`, `PinNotes.tsx` and `keepInView.ts`.
- `lib/queries.ts`: `q.notes(kind?, text?, by?)`, with `by` in the key.
- People come from `peopleIn(all notes, me)` and `q.team()`, matched with `namesIn`, you left out.
- The moment preview reads `q.note(id)` for the transcript and its entries; Confirm and It wasn't decided use
  `useUpdateDecision`, as Notes' preview does. A person's preview reads `q.notes(undefined, undefined, email)`.
- The answer uses `useAnswer`, and cited lines come from `q.note`, through `citedOf` in `palette/rows.ts`. `Sources`, which
  only the workspace's Ask uses, moves to `features/workspace/Sources.tsx`, its styles to `workspace.css` (`wv-src`).
- Open at links with `inNote(at, room)`. Play from adds `play` to the note route's search (`validateSearch`), and
  `useOpenAt` starts playing there.
- See all navigates to `/notes` with the words in history state (never the URL) and `#with=` for a token; Notes puts them
  in its line as it opens.
- Offline from `useOnline()`. No search words, addresses or answers in any log line.

## Storybook

- Components: every palette part (rows, preview kinds, made tiles, foot variants, empty states), both themes.
- Pages/Search or ask: before typing; a name; someone's words (the token); narrowed with a word; a word; a decision's line
  lit; a question; asking; answered; nothing matches; failed; offline; first day; phone; Pin a note (as today).
- Journeys, numbered as user-flows.md › 2: find what someone said, search a word and open the moment, see all in Notes,
  ask a question and open a cited moment.

## Docs

`docs/product/user-flows.md` › 2 (the palette), `docs/design/pages.md` (the frame and the palette),
`docs/engineering/notes-and-inference.md` (search), `AGENTS.md` (the components and `styles/palette.css`), and the canvas
boards in `docs/design/canvas/`.

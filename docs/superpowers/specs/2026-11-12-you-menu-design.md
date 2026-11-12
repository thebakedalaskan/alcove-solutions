# Your menu, at the top right

The design for what your face at the top right of every page opens, decided 12 November 2026. The canvas it was drawn on is
copied in at [docs/design/canvas/you-menu](../../design/canvas/you-menu/README.md): `account.css` has the measurements and
`account.js` every state and journey. Where this document and the canvas differ, this document wins.

## Why

Your face at the top right (and in the phone's top bar) is a link straight to Settings. That's a big jump for a small
press, and it leaves no quick way to the things people reach for from any page: being left alone for a while, the theme,
signing out. Every big app puts these behind your face in a small menu. Alcove's is drawn in its own evening.

## The menu

Pressing your face opens a popover under it, aligned to its right edge, with a caret pointing at it (`Popover` with
`align="end"` and `caret`). It holds, top to bottom:

1. **You, standing on the horizon in the last of the light:** Settings' own moment in small. A rounded window (16px
   radius, about 98px tall) inside the popover's 6px padding: the `settings` moment's sky above a 22px band of its sea,
   a soft glow at the horizon behind you, the horizon's rim, your 40px arch standing on it with three short lines of light
   under it on the water (as Settings' band draws under you), and beside you your name (15px semibold) and address (13px,
   `ink-2`), each clamped to one line.
2. **Pause notifications** (bell icon, a chevron at its end). Pressing it opens three choices in place under it, the
   chevron turning: **For 30 minutes**, **For 1 hour** and **Until tomorrow**, each with the time it ends in a column of
   its own at the row's end (`16:42`, `17:12`, `9:00`). Picking one pauses and closes the choices. Paused, the row reads
   **Paused until 17:12** (or **Paused until tomorrow 9:00**), its bell crossed out in `sun-text`, with **Resume** at its
   end, which ends the pause at once.
3. **Theme**: three small evenings at the row's end, **System**, **Light** and **Dark**, as Settings › You › Appearance draws
   them (`ThemePreview`), small and without their names underneath (the name is the tooltip and the label). The one in use
   is ringed in `sun`. Choosing one changes the whole page at once and is kept in this browser, as in Settings. The menu
   stays open.
4. A hairline.
5. **Settings** (gear): opens Settings, and the menu closes.
6. **Take the tour** (compass): the tour of Home, as Settings' **Take the tour** starts it (`arrival.askTour()`).
7. A hairline.
8. **Sign out**.

Rows are 40px, 12px radius, an 18px icon in `ink-2`, the words in 14.5px medium `ink`, and whatever ends them in a fixed
column at the right. The popover is 312px wide, `surface-raised`, 22px radius, with the kit's popover ring and shadow.
Nothing in it is filled at rest. It opens with the kit's popover motion and nothing else moves.

**Your face** while the menu is open keeps a thin ring in `line-control` around its arch, and a hover ring before that. While
notifications are paused it carries a small bell (crossed out) on its lower right corner, all the time the pause lasts, on
every page, with the tooltip **Notifications paused until 17:12**. Its label says the same after your name.

On Settings your face isn't at the top right, as now: you're standing on the horizon there, with **Take the tour** and
**Sign out** beside you.

## Sign out

With nothing on this device that would be lost, **Sign out** signs out at once and lands on the welcome page, as Settings'
does. Otherwise the menu asks in place, in the words Settings' sky uses (`features/settings/SignOut.tsx`: `deletes()` and
`staying()`): what signing out deletes, what staying does, and, when something written hasn't reached Alcove, that copying
takes only your own words. Then, stacked full width: **Stay signed in** (the filled one, focused; **Escape** too, which goes
back to the menu's rows), **Copy what you wrote** (only when something written is waiting) and **Sign out and delete
them** (`caution` words on a quiet ring), which says **Signing out** with a spinner while it goes. Your name and address
stay at the menu's top, so it's clear whose account it is. The logic is Settings' own, shared, not copied: one hook decides
what's waiting, copies, and signs out; Settings' sky and the menu are two ways of showing it. Everything Settings' sign
out does (every other tab hears it, offline says so, only this account's recordings count) holds for the menu's too.

## Pause notifications

While paused, nothing reaches you by the browser or by sound:

- no browser notifications, of any kind;
- no sounds;
- except, as quiet mode keeps them, your own microphone going on and off, and requests to join a call you host (both its
  sound and its browser notification), since someone is waiting at the door.

What shows on the page still shows: a ring's card, a call's chat, toasts. The pause belongs to the account, so it holds on
every device signed in, and it ends by itself at its time, with nothing to press; the bell leaves your face then. **Until
tomorrow** ends at 9:00 tomorrow, in this computer's time zone.

### Stored

`Preferences` gains `notificationsPausedUntil`: an ISO date-time with its offset, of at most 40 characters
(`z.iso.datetime({ offset: true }).max(40)`), or null when nothing is paused. A date-time takes any number of fractions of a
second, and the bound comes with the field: added to a stored schema later, it would stop profiles that hold a longer value
from opening. In `PreferencesSchema` it's `.nullable().default(null)`, so a profile written before it existed reads as not
paused, and is written with it the next time preferences are saved. `PreferencesPatchSchema` takes the same field without
its default (`.removeDefault()`, so nullable and bounded as it's stored, then `.partial()`, as `model` is), so a patch that
leaves it out changes nothing, `null` resumes, and a longer value is refused. The server keeps whatever time it's given (a
time already past means nothing is paused). No migration: preferences live in the sealed profile.

## On a phone

At 860px and narrower your face is in the top bar, and the same menu rises from the bottom as a sheet (the kit's `Sheet`),
with a grab handle, rows 50px tall and the theme's evenings a little larger. Everything else is the same.

## Keyboard and screen readers

Your face is a button with `aria-haspopup="dialog"` and `aria-expanded`, labelled with your name and **your menu** (and the
pause, while there is one). Enter or Space opens the menu, focus goes to its first row, **↓** and **↑** move between its rows
(the pause's choices and the three evenings included), Enter presses (Space too, on everything but Settings, which is a
link), and **Escape** closes what's open one step at a time, through the popover's or sheet's own `onEscapeKeyDown`: the
pause's choices shut, the sign-out question goes back to the rows, then the menu closes, focus going back to your face. The evenings are a group
labelled **Theme**, each a pressed-or-not button named System, Light or Dark.

## The kit

New, in `packages/ui/src/components/you.tsx`, stateless, its classes `ym-` in `packages/ui/src/styles/you.css` (imported
from `styles.css` beside `shell.css`), on the existing tokens only:

```tsx
/** Your face at the top right, and in the phone's top bar: the button that opens your menu. While `until` is set it carries a small crossed-out bell, and its label and tooltip say until when. */
export const YouButton: ForwardRefExoticComponent<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
  person: AvatarPerson; size?: number | undefined; until?: string | null | undefined;
} & RefAttributes<HTMLButtonElement>>;

/** Your menu: you on the horizon in the last of the light, then `children` (its rows). Arrow keys move between its rows. `sheet` sizes it for the phone's sheet. */
export function YouMenu(props: { person: AvatarPerson; children: ReactNode; sheet?: boolean | undefined }): JSX.Element;

/** One row: an icon, its words, and what ends it. `expanded` (Pause notifications while its choices are open) lights it and turns its chevron. */
export const YouRow: ForwardRefExoticComponent<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName; label: ReactNode; end?: ReactNode | undefined; expanded?: boolean | undefined;
} & RefAttributes<HTMLButtonElement>>;

/** A row that goes somewhere (Settings): the app's own router link, given the row's class, contents and `data-ym-row`. */
export function YouLink(props: { icon: IconName; label: ReactNode; link: (props: YouLinkProps) => ReactNode }): JSX.Element;

/** A hairline between the menu's groups of rows. */
export function YouRule(): JSX.Element;

/** Pause notifications: closed; its choices open in place under it; or paused until `until` (as said: "17:12", "tomorrow 9:00"), with Resume. */
export function YouPause(props: {
  until: string | null; open: boolean; onOpenChange: (open: boolean) => void;
  choices: readonly { id: string; label: string; ends: string }[];
  onPause: (id: string) => void; onResume: () => void; pending?: boolean | undefined;
}): JSX.Element;

/** Theme: the three small evenings, as Settings draws them, small and unnamed. */
export function YouTheme(props: { theme: ThemeChoice; onChange: (theme: ThemeChoice) => void }): JSX.Element;

/** Sign out, asking in place: what it deletes (`says`), the lines under it, Stay signed in (focused), Copy what you wrote (`onCopy`, when given) and the way out. */
export function YouAsk(props: {
  says: string; lines: readonly string[]; signOutLabel: string;
  onStay: () => void; onSignOut: () => void; onCopy?: (() => void) | undefined;
  copying?: boolean | undefined; pending?: boolean | undefined;
}): JSX.Element;
```

The kit's `Popover` gains `onEscapeKeyDown`, as `Sheet` has it. `THEMES` (system, light, dark) is exported from
`theme.tsx`, and `ThemeChoice` comes from it. `ThemePreview` gains `small?: boolean | undefined`: the window alone, about 40 by 26 (46 by 30 in a sheet), its name as
`aria-label` and tooltip instead of underneath, the same ring when pressed. The icon map gains `sunMoon` (Lucide `SunMoon`).
Component stories for each part, in Storybook's settings group, in both themes; `AGENTS.md`'s component list names them.

## The app

- `apps/web/src/features/shell/YouMenu.tsx` composes the menu from the session, preferences, theme, tour and sign out, as
  `YourFace`, which shows it in a `Popover` or, at 860px and narrower, a `Sheet`. `TopActions.tsx`, `TabBar.tsx`'s
  `PhoneTop` and a workspace's bar render it in place of today's `Link` to Settings. It closes on Settings (a plain click
  on its link) and on the tour, and stays open on the theme and pausing. `features/shell/pause.ts` holds the menu's side of
  pausing (`usePause`, its choices and how their ends are said), and `lib/notification-pause.ts` only what the gates share.
- `features/settings/SignOut.tsx` splits its decision from its look: a hook that both Settings' sky and the menu use.
- Pausing and resuming are a preference change in the same ordered queue as the others (`lib/queries.ts`, beside
  `usePins`), optimistic, saying a refusal with a toast and putting the row back.
- What delivers browser notifications and plays sounds checks the pause, at the one place each decides, with the two
  exceptions above, and starts again by itself when the time passes.
- The ⌘, shortcut on the canvas isn't built: browsers keep it for their own settings.

## Storybook

- The stand-in keeps `notificationsPausedUntil` (null in every scenario) and changes it as the server does.
- Page stories: Home with the menu open; paused (the bell on your face, and the menu saying until when); Sign out asking
  with recordings on this device; on a phone, the sheet.
- Journeys, in section 2 of `docs/product/user-flows.md` after its last one: open your menu and go to Settings; pause
  notifications for an hour, then resume; change the theme; sign out when recordings haven't uploaded; on a phone.

## Docs

`docs/product/user-flows.md` (sections 2 and 11), `docs/design/pages.md` (the frame's top right), `AGENTS.md` (the kit's
list), and the canvas copied into `docs/design/canvas/you-menu/` with a README.

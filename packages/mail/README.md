# @alcove/mail

The emails Alcove sends, each built from plain data into what a send takes: a subject, the HTML, a plain-text part, and
the pictures the HTML shows, attached inline. No I/O, so the API sends exactly what Storybook shows
(`apps/storybook/stories/emails/`). The design is `docs/superpowers/specs/2026-11-14-team-invitations-design.md` › 5.

- `src/invitation.ts`: `invitationEmail(input)`, the invitation to join a team, and `InvitationEmailInput`.
- `src/look.ts`: how every email looks. The evening at the top, one card on the page's ground, people in arches, the one
  filled button and a quiet foot; by day, and by night for mail that's dark.
- `src/email.ts`: `Email` and `InlineImage`, and `escapeHtml` and `oneLine`, which everyone's own words go through.
- `src/images.ts`: the pictures, base64. Generated: don't edit it.
- `assets/`: the same pictures as PNGs, and `scripts/draw-images.mjs`, which draws them.

## Sending one

```ts
const email = invitationEmail({ from, team, link, expiresInDays, stopLink });
// email.subject, email.html, email.text, and email.inline: each an attachment with its content ID
```

Who it's to and from, Reply-To and `List-Unsubscribe` are the sender's. Every picture in `inline` goes as an inline
attachment with its `contentId`, which the HTML shows as `cid:<contentId>`, so opening the email fetches nothing.

## How they hold up in mail apps

Tables and inline styles, so the day version is whole where a mail app drops `<style>` (Gmail does in places). A
`<style>` holds only what has to be a media query: a phone's width, and dark mail (`prefers-color-scheme`, which Apple
Mail and iOS Mail follow), where the night's colours and the evening by night take over. No web fonts: Newsreader and
Hanken Grotesk for whoever has them, then each system's nearest. Outlook on Windows gets square corners, side-by-side
arches and a padded button. The HTML is about 12 KB, far under Gmail's 102 KB clip; the pictures travel beside it.

## Drawing the pictures again

```
pnpm --filter @alcove/mail images
```

It draws the Team page's evening with the app's own `packages/ui/src/evening/horizon.css` and the logo in its own
typeface, at twice the size shown, in Google Chrome headless and muted (`CHROME=/path/to/chrome` for another), then
writes `assets/*.png` and `src/images.ts`. Draw them again when the evening's colours or the logo change.

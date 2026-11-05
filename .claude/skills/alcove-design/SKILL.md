---
name: alcove-design
description: Use when designing, mocking up or restyling anything in Alcove (a new page, a flow, how a component looks, a design canvas or artifact, the scene behind a page) or when turning a design into code. Points to the design principles, each page's design, the canvas kit and how to build a design without losing features.
---

# Designing for Alcove

Everything you need is in `docs/design/`. Read it in this order before you design anything:

1. `docs/design/principles.md`: One evening, the seven principles, colour, type, icons, layout, motion, copy, the product
   rules that shape screens, and what design reviews have taught us.
2. `docs/design/pages.md`: how Home, Notes, a note, a series, Team, Record and Settings are each designed.
3. `docs/design/canvas.md`: how to make a design canvas from the kit in `docs/design/canvas/`, with page boards and journey
   boards, how to check it, and how to publish as you go.
4. `docs/design/building.md`: how a canvas becomes a page in the app.
5. `apps/storybook/README.md`: Storybook, the record of what's built. Every foundation, component, page and journey, as the
   app renders them, on made-up data (`pnpm storybook`).

## The short version

- Every page in the frame is a moment of one evening; a call is always night. The sky is only as tall as the page is one
  action. The page's one job sits on the sky, in the middle, and everything else sits on the water.
- One filled button per view, in `sun`. Colour means one thing each: `rose` a decision, `horizon` a follow-up or information,
  `sun-text` time and warmth, `rec` notes being taken or recording, `caution` a problem. No green.
- No boxes scattered about. Use hairlines, space, and row actions in fixed columns. The logo appears once.
- Say each fact once, in sentence case. Newsreader for page titles and heroes only; Hanken Grotesk for everything else; IBM
  Plex Mono only for code and hashes.
- People appear in arches. The camera appears only on the join screen and in a call. Never build a stacked modal form.
- Motion is quiet: transform and opacity only, long cycles, and a still picture with reduced motion.
- Show the journeys, not just the screens: one row per journey, numbered frames from the click to the result.
- Check dark and light, at 390, 1024, 1440 and 1920 to 2000 wide, the first-day state, and every popover, before you show
  anything.
- Start every canvas from `docs/design/canvas/`, never from blank. The canvas is for what isn't built yet; to see a page as
  it is now, open its stories in Storybook.
- A change to a page or a component changes its Storybook stories in the same pull request: the page's scenarios and its
  journeys. The canvas's boards don't have to follow.
- Demo data uses made-up people only. Never write a real person's name, the user's included.

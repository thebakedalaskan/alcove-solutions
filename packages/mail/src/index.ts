/*
 * The emails Alcove sends (docs/superpowers/specs/2026-11-14-team-invitations-design.md › 5): each built from plain data into
 * what Resend's API takes, with no I/O, so the API sends it and Storybook shows the very same thing.
 */
export { type Email, type InlineImage } from './email';
export { type InvitationEmailInput, type InvitationPerson, invitationEmail } from './invitation';

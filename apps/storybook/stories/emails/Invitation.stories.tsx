/*
 * The invitation email (design › 5): the very HTML the API sends, from @alcove/mail's invitationEmail, in frames 600px and
 * 375px wide, by day and by night, its pictures shown from the inline attachments it carries. By night is a dark mail app:
 * the email's own dark styles, applied whatever this browser prefers, as by day they're left off. Above the frames, what an
 * inbox shows of it; under them, its plain-text part. Change who invited, the team or the links in Controls.
 */
import { invitationEmail, type Email, type InvitationEmailInput } from '@alcove/mail';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

/** The email's dark styles: what a mail app applies when it's dark. */
const DARK_MAIL = /@media\s*\(prefers-color-scheme:\s*dark\)/g;
/** The blank space an email puts after its preheader, so an inbox's preview stops there. */
const HUSH = new RegExp(`[${String.fromCodePoint(0x2007, 0x34f)}]`, 'g');

/** The HTML as a mail app shows it: each `cid:` picture in place, dark or not as asked, whatever this browser prefers. */
function asShown(email: Email, dark: boolean): string {
  const html = email.inline.reduce((h, p) => h.split(`cid:${p.contentId}`).join(`data:${p.contentType};base64,${p.content}`), email.html);
  return html.replace(DARK_MAIL, dark ? '@media all' : '@media not all');
}

/** What an inbox shows after the subject: the email's hidden first line. */
function preheaderOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.querySelector('[role="article"] > div')?.textContent ?? '').replace(HUSH, '').trim();
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
/** A base64 file's size. */
const fileSize = (base64: string): number => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);

/** The email in a frame as wide as a mail app gives it, as tall as it is. */
function Frame({ email, width, dark, label }: { email: Email; width: number; dark: boolean; label: string }) {
  const [height, setHeight] = useState(900);
  return (
    <figure className="m-0 grid content-start gap-2">
      <figcaption className="text-xs font-medium text-ink-3">{label}</figcaption>
      <iframe
        title={`${email.subject}: ${label}`}
        srcDoc={asShown(email, dark)}
        width={width}
        height={height}
        className="block rounded-[var(--radius-md)] border-0 shadow-1"
        style={{ width, height, colorScheme: dark ? 'dark' : 'light' }}
        onLoad={(e) => setHeight(e.currentTarget.contentDocument?.body.scrollHeight ?? height)}
      />
    </figure>
  );
}

/** Everything the email carries: what an inbox shows, the email by day and by night at both widths, and its text. */
function Sheet({ input }: { input: InvitationEmailInput }) {
  const email = invitationEmail(input);
  const pictures = email.inline.map((p) => `${p.filename} ${kb(fileSize(p.content))}`).join(' · ');
  return (
    <div className="grid gap-8 p-8 max-[700px]:p-4">
      <header className="grid max-w-[1000px] gap-1 rounded-[var(--radius-md)] bg-surface px-5 py-4 shadow-1">
        <span className="ac-label text-ink">{email.subject}</span>
        <span className="ac-body-s text-ink-2">{preheaderOf(email.html)}</span>
        <span className="pt-1 text-xs font-medium text-ink-3">HTML {kb(new TextEncoder().encode(email.html).length)} · inline: {pictures}</span>
      </header>
      <section className="flex flex-wrap items-start gap-6" aria-label="By day">
        <Frame email={email} width={600} dark={false} label="600px, by day" />
        <Frame email={email} width={375} dark={false} label="375px, by day" />
      </section>
      <section className="flex flex-wrap items-start gap-6" aria-label="By night">
        <Frame email={email} width={600} dark label="600px, by night" />
        <Frame email={email} width={375} dark label="375px, by night" />
      </section>
      <section className="grid max-w-[1000px] gap-2" aria-label="Plain text">
        <span className="text-xs font-medium text-ink-3">Plain text</span>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface px-5 py-4 font-mono text-[12.5px]/[19px] text-ink-2 shadow-1">{email.text}</pre>
      </section>
    </div>
  );
}

const SAM = { name: 'Sam Kowalski', email: 'sam@vandelay.industries' };
const LINK = 'https://alcove.solutions/invite#Jx7pQ2vK9mWbR4tYc8NfLhD3sGzA6eUo1iXq5wTn0Vk';
const STOP = 'https://alcove.solutions/stop-email#c2FtQHZhbmRlbGF5LmluZHVzdHJpZXM.k3Hq9ZpW2';

const meta = {
  title: 'Emails/Invitation',
  parameters: { layout: 'fullscreen' },
  args: {
    from: SAM,
    team: { name: 'Vandelay', people: 6, faces: [{ name: 'Sam Kowalski' }, { name: 'Priya Raman' }, { name: 'Ken Morales' }, { name: 'Maya Chen' }] },
    link: LINK,
    expiresInDays: 30,
    stopLink: STOP
  },
  argTypes: {
    from: { control: 'object' },
    team: { control: 'object' },
    link: { control: 'text' },
    expiresInDays: { control: { type: 'number', min: 1, step: 1 } },
    stopLink: { control: 'text' }
  },
  render: (args) => <Sheet input={args} />
} satisfies Meta<InvitationEmailInput>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Sam invites someone to a team of six: Sam, Priya, Ken and Maya in their arches, and the others counted. */
export const ATeamOfSix: Story = { name: 'A team of six' };

/** Sam's first invitation made the team, so Sam is alone on it. */
export const JustWhoeverInvited: Story = {
  name: 'Just whoever invited',
  args: { team: { name: 'Vandelay', people: 1, faces: [{ name: 'Sam Kowalski' }] } }
};

/** A long team name, and a long name and address: the heading and the subject say the name whole, the button cuts it short. */
export const ALongTeamName: Story = {
  name: 'A long team name',
  args: {
    from: { name: 'Bartholomew Featherstonehaugh-Montgomery', email: 'bartholomew.featherstonehaugh-montgomery@vandelay-industries.example' },
    team: {
      name: 'Vandelay Industries Latex, Import and Export: Northeast Regional Sales and Partnerships',
      people: 23,
      faces: [{ name: 'Bartholomew Featherstonehaugh-Montgomery' }, { name: 'Priya Raman' }, { name: 'Kofi Asante' }, { name: 'Aiko Tanaka' }]
    }
  }
};

/** Names with <b> and & in them, as someone typed them: every word shows as it was typed, never as markup. */
export const NamesWithMarkup: Story = {
  name: 'Names with <b> and &',
  args: {
    from: { name: '<b>Sam</b> & Co', email: 'sam+<b>@vandelay.industries' },
    team: { name: 'R&D <b>Lab</b> & "Friends"', people: 3, faces: [{ name: '<b>Sam</b> & Co' }, { name: 'Priya & Ken' }, { name: '<i>Lena</i>' }] }
  }
};

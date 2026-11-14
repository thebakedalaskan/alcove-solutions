/*
 * Alcove's look as an email can carry it (design › 5.3): the evening at the top, one card on the page's ground, people in
 * arches, the one filled button and a quiet foot; by day, and by night for mail that's dark. Tables and inline styles, so
 * it holds in every mail app, and a <style> only for what has to be a media query (a phone's width, dark mail): where one
 * is dropped, the email is still whole by day. No web fonts, since loading one is a fetch: Newsreader and Hanken Grotesk
 * for whoever has them, then each system's nearest. Everything given here as HTML is escaped already.
 */
import { escapeHtml, type InlineImage } from './email';
import { EVENING, EVENING_NIGHT, type Picture } from './images';

/** Alcove's colours (packages/ui/src/styles.css), by day and by night. */
const DAY = {
  ground: '#F3F7FC', surface: '#FCFDFE', line: '#D9E1E9', ink: '#12223F', ink2: '#394967', ink3: '#55667F', sun: '#153166', onSun: '#FEFAF1',
  /** A quiet well, as the app's AgentWell: the ink at 6% on the card. */
  well: '#EDF0F4',
  shadow: '0 2px 6px rgba(18,34,63,0.05),0 18px 40px -18px rgba(18,34,63,0.28)'
} as const;
const NIGHT = {
  ground: '#0F1F38', surface: '#172944', line: '#283A54', ink: '#F7F3EB', ink2: '#BFCAD7', ink3: '#94A5B7', sun: '#F6E8CC', onSun: '#0E1E35',
  well: '#24344E',
  shadow: '0 2px 6px rgba(0,0,0,0.3),0 18px 40px -18px rgba(0,0,0,0.7)'
} as const;
/** The evening's sky halfway up, under its picture: what mail that shows no pictures shows there. */
const SKY = { day: '#B9C9EA', night: '#1D2A4C' } as const;
/**
 * Someone in an arch, as the app draws someone without a portrait: their initial on one of the portraits' pale colours,
 * pale in both themes, as portraits are.
 */
const ARCH = { fills: ['#E9DBFA', '#F8D6E4', '#FFE1C4', '#D5DEFF'], ink: '#394967' } as const;

const SERIF = "Newsreader,'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";
const SANS = "'Hanken Grotesk',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** What changes on a phone: the 16px gutter, and a little less room around the words. A 600px pane keeps the card as it is. */
const PHONE = `
@media (max-width: 480px) {
  .a-gutter { padding: 16px 16px 32px !important; }
  .a-in { padding: 30px 24px 34px !important; }
  .a-h { font-size: 26px !important; line-height: 32px !important; }
  .a-foot { padding: 22px 8px 0 !important; }
}`;

/** Dark mail takes the night's colours, and the evening by night. */
const DARK = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .a-body, .a-bg { background-color: ${NIGHT.ground} !important; }
  .a-sky { background-color: ${SKY.night} !important; }
  .a-box { box-shadow: ${NIGHT.shadow} !important; }
  .a-card { background-color: ${NIGHT.surface} !important; border-color: ${NIGHT.line} !important; }
  .a-well { background-color: ${NIGHT.well} !important; }
  .a-ink { color: ${NIGHT.ink} !important; }
  .a-ink2 { color: ${NIGHT.ink2} !important; }
  .a-ink3 { color: ${NIGHT.ink3} !important; }
  .a-btn { background-color: ${NIGHT.sun} !important; }
  .a-btn-a { color: ${NIGHT.onSun} !important; }
  .a-ring { border-color: ${NIGHT.surface} !important; }
  .a-day { display: none !important; }
  .a-night { display: block !important; max-height: none !important; overflow: visible !important; }
}`;

const DAY_ID = 'evening@alcove.solutions';
const NIGHT_ID = 'evening-night@alcove.solutions';
const attached = (p: Picture, contentId: string): InlineImage => ({ contentId, filename: p.filename, contentType: 'image/png', content: p.content });

/** The pictures every email attaches inline for its evening: by day, and by night. */
export const pictures = (): InlineImage[] => [attached(EVENING, DAY_ID), attached(EVENING_NIGHT, NIGHT_ID)];

/** The evening at the top of the card, Alcove's logo at its top left: by day, and by night where the mail is dark. */
function evening(): string {
  const w = EVENING.width / 2;
  const h = EVENING.height / 2;
  const img = (id: string, className: string) => `<img class="${className}" src="cid:${id}" width="${w}" height="${h}" alt="Alcove" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:22px 22px 0 0;-ms-interpolation-mode:bicubic;font-family:${SANS};font-size:16px;font-weight:600;line-height:20px;color:${DAY.ink};">`;
  return `${img(DAY_ID, 'a-day')}<!--[if !mso]><!--><div class="a-night" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${img(NIGHT_ID, '')}</div><!--<![endif]-->`;
}

/** The card's heading, in the display face. */
export const heading = (html: string): string =>
  `<h1 class="a-ink a-h" style="margin:0;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:400;letter-spacing:-0.01em;color:${DAY.ink};mso-line-height-rule:exactly;text-wrap:balance;overflow-wrap:anywhere;word-break:break-word;">${html}</h1>`;

/** A line of the card, `above` px under what comes before it. */
export const line = (html: string, above: number): string =>
  `<p class="a-ink2" style="margin:${above}px auto 0;max-width:420px;font-family:${SANS};font-size:16px;line-height:24px;color:${DAY.ink2};mso-line-height-rule:exactly;text-wrap:balance;overflow-wrap:anywhere;word-break:break-word;">${html}</p>`;

/** Small print, in the card or its foot, `above` px under what comes before it. */
export const small = (html: string, above: number): string =>
  `<p class="a-ink3" style="margin:${above}px auto 0;max-width:440px;font-family:${SANS};font-size:13px;line-height:20px;color:${DAY.ink3};mso-line-height-rule:exactly;text-wrap:pretty;overflow-wrap:anywhere;word-break:break-word;">${html}</p>`;

/** A link in small print, in the colour of its words. */
export const quietLink = (href: string, html: string): string =>
  `<a class="a-ink3" href="${href}" target="_blank" style="color:${DAY.ink3};text-decoration:underline;">${html}</a>`;

/**
 * A link written out whole in a quiet well, as the app shows an address to copy, for where a button doesn't work: it breaks
 * anywhere rather than run past the edge, and stays quieter than the button it stands in for.
 */
export const writtenLink = (href: string, above: number): string =>
  `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:440px;margin:${above}px auto 0;border-collapse:separate;">
<tr><td class="a-well" align="center" bgcolor="${DAY.well}" style="padding:10px 14px;border-radius:11px;background-color:${DAY.well};text-align:center;"><a class="a-ink2" href="${href}" target="_blank" style="font-family:${SANS};font-size:13px;line-height:19px;color:${DAY.ink2};text-decoration:none;word-break:break-all;overflow-wrap:anywhere;mso-line-height-rule:exactly;">${href}</a></td></tr>
</table>`;

/** The one filled button: `sun` with `on-sun` words, as the app's primary button, `above` px under what's before it. */
export function button(href: string, html: string, above: number): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:${above}px auto 0;border-collapse:separate;">
<tr><td class="a-btn" align="center" bgcolor="${DAY.sun}" style="border-radius:25px;background-color:${DAY.sun};mso-padding-alt:15px 30px;">
<a class="a-btn-a" href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;border-radius:25px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${DAY.onSun};text-decoration:none;mso-line-height-rule:exactly;">${html}</a>
</td></tr>
</table>`;
}

/** The first letter (or digit) of a name, for its arch: "(Sam)" is S. */
const initial = (name: string): string => (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? Array.from(name.trim())[0] ?? '').toLocaleUpperCase('en');

/**
 * People in arches, as the app's Faces draws them: each initial in a pale arch with a rounded top and a square foot, each
 * arch a little over the last, ringed in the card's colour. Words beside them say who, so they're hidden from screen
 * readers. Outlook on Windows lays them side by side, square, in a table of its own.
 */
export function arches(names: readonly string[], above: number): string {
  const shown = names.slice(0, 4);
  if (!shown.length) return '';
  const fill = (i: number): string => ARCH.fills[i % ARCH.fills.length] ?? ARCH.fills[0];
  const modern = shown.map((name, i) => `<span class="a-ring" style="display:inline-block;vertical-align:top;width:40px;height:43px;${i ? 'margin-left:-10px;' : ''}border:2px solid ${DAY.surface};border-radius:22px 22px 0 0;background-color:${fill(i)};text-align:center;font-family:${SERIF};font-size:19px;line-height:49px;font-weight:400;color:${ARCH.ink};mso-line-height-rule:exactly;">${escapeHtml(initial(name))}</span>`).join('');
  const outlook = shown.map((name, i) => `${i ? '<td width="4" style="width:4px;font-size:0;line-height:0;">&nbsp;</td>' : ''}<td width="40" height="43" align="center" valign="middle" bgcolor="${fill(i)}" style="width:40px;height:43px;font-family:Georgia,serif;font-size:19px;color:${ARCH.ink};">${escapeHtml(initial(name))}</td>`).join('');
  return `<!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:${above}px auto 0;"><tr>${outlook}</tr></table><![endif]-->
<!--[if !mso]><!--><div aria-hidden="true" style="margin:${above}px 0 0;font-size:0;line-height:0;text-align:center;">${modern}</div><!--<![endif]-->`;
}

/** What an email says around its card. Every part is HTML, escaped already, but for the title and preheader, which are text. */
export interface Page {
  /** What the email's window is called: its subject. */
  title: string;
  /** What an inbox shows after the subject: hidden in the email itself. */
  preheader: string;
  /** What the card says, under the evening. */
  card: string;
  /** The foot, under the card. */
  foot: string;
}

/** An email's whole HTML: the evening, its card and its foot, on the page's ground, 560px wide and the width of a phone. */
export function page({ title, preheader, card, foot }: Page): string {
  const t = escapeHtml(title);
  /* After the preheader, blank space, so an inbox's preview doesn't run on into the card's words. */
  const hush = '&#8199;&#847;'.repeat(64);
  return `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${t}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${PHONE}
</style>
<style>${DARK}
</style>
</head>
<body class="a-body" style="margin:0;padding:0;width:100%;background-color:${DAY.ground};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div role="article" aria-roledescription="email" aria-label="${t}" lang="en" dir="ltr">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${DAY.ground};">${escapeHtml(preheader)}${hush}</div>
<table role="presentation" class="a-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${DAY.ground}" style="width:100%;background-color:${DAY.ground};">
<tr><td class="a-gutter" align="center" style="padding:40px 20px 48px;">
<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:separate;">
<tr><td>
<table role="presentation" class="a-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-radius:22px;box-shadow:${DAY.shadow};">
<tr><td class="a-sky" bgcolor="${SKY.day}" style="background-color:${SKY.day};border-radius:22px 22px 0 0;line-height:0;font-size:0;">${evening()}</td></tr>
<tr><td class="a-card a-in" align="center" bgcolor="${DAY.surface}" style="padding:36px 48px 40px;background-color:${DAY.surface};border:1px solid ${DAY.line};border-top:0;border-radius:0 0 22px 22px;text-align:center;">
${card}
</td></tr>
</table>
</td></tr>
<tr><td class="a-foot" align="center" style="padding:26px 32px 0;text-align:center;">
${foot}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
}

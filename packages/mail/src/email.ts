/** A picture the HTML shows by `cid:<contentId>`, attached inline, so nothing is fetched from a server when it's opened. */
export interface InlineImage {
  contentId: string;
  filename: string;
  contentType: 'image/png';
  /** The file, base64. */
  content: string;
}

/** An email ready to send: its subject, both bodies and its inline pictures. Who it's to and from is the sender's. */
export interface Email {
  subject: string;
  html: string;
  text: string;
  inline: InlineImage[];
}

/** Text made safe inside HTML: every name and team in an email is someone's own words. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Someone's words as one line, for a subject and anywhere else an email says them: whatever they typed can't add a line, a
 * control character, or a direction override that reorders the words around it.
 */
export const oneLine = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();

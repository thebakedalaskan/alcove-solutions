/* What a document's Yjs parts are called, and a block's ID. Nothing here loads ProseMirror. */

/** The root fragment that holds the title and the blocks. */
export const FRAGMENT = 'content';
/** The root map of comment threads. */
export const COMMENTS = 'comments';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A block's stable ID. Random, so two browsers can never make the same one. */
export function newBlockId(): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(12))) out += ID_ALPHABET.charAt(b % ID_ALPHABET.length);
  return out;
}

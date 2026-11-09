import { z } from '../shared/zod';
import { CallIdentity } from './wire';

/** Selected UTF-16 spans refer to authenticated connections; display names are never matched on receipt. */
export const CallChatMentionSchema = z.object({ identity: CallIdentity, start: z.number().int().nonnegative(), end: z.number().int().positive() });
export type CallChatMention = z.infer<typeof CallChatMentionSchema>;

export function validChatMentions({ text, mentions }: { text: string; mentions: readonly CallChatMention[] }): boolean {
  let until = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < until || mention.end <= mention.start + 1 || mention.end > text.length || text[mention.start] !== '@' || /\s$/u.test(text.slice(mention.start, mention.end))) return false;
    until = mention.end;
  }
  return true;
}

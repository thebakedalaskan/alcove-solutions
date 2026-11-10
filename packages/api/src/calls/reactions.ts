import { AlcoveApiError } from '../errors';
import { z } from '../shared/zod';
// Types only, so this file never loads the session's module: the session and private messages import the schema from here.
import type { CallChatMessage, CallCrypto } from './session';

/** The emoji someone can react to a chat message with, by name: the wire never carries a glyph. */
export const CallReactionSchema = z.enum(['thumbs-up', 'thumbs-down', 'heart', 'smile', 'laugh', 'wow', 'sad', 'party']);
export type CallReaction = z.infer<typeof CallReactionSchema>;
export const CALL_REACTIONS = CallReactionSchema.options;
/** One emoji on a chat message, and who reacted with it (identities, in the order they did), first-reacted first. */
export interface CallChatReaction { reaction: CallReaction; by: string[] }

/**
 * An emoji someone sends rising over the call (React, in the dock). It travels as marks do, on its own topic, sealed with
 * the sender's media key, says which of the bundled emoji and nothing else, and is never stored: whoever's there sees it.
 */
export const CALL_REACT_TOPIC = 'react/1' as const;

/** The largest such message a browser reads, and how many a sender can say in a burst and then each second: enough to spam. */
export const CALL_REACT_LIMITS = { bytes: 64, burst: 24, perSecond: 8 } as const;

export const CallReactMessageSchema = z.object({ r: CallReactionSchema });

export type CallReactMessage = z.infer<typeof CallReactMessageSchema>;

/**
 * Reactions with `who`'s one turned on or off: who reacted stays in the order they did, emoji stay in the order they were
 * first used, and an emoji nobody's left on goes. Turning on what's on, or off what isn't, changes nothing.
 */
export function toggledReaction(reactions: readonly CallChatReaction[], reaction: CallReaction, who: string, on: boolean): CallChatReaction[] {
  const r = reactions.find((x) => x.reaction === reaction);
  if ((r?.by.includes(who) ?? false) === on) return [...reactions];
  if (!on) return reactions.map((x) => (x === r ? { ...x, by: x.by.filter((b) => b !== who) } : x)).filter((x) => x.by.length > 0);
  return r ? reactions.map((x) => (x === r ? { ...x, by: [...x.by, who] } : x)) : [...reactions, { reaction, by: [who] }];
}

/**
 * Chat with `who`'s reaction on one message turned on or off (`toggledReaction`). Only a message in `place` (the part of
 * the call the reaction was sent in) can take it.
 */
export function withReaction(chat: CallChatMessage[], target: string, place: string, reaction: CallReaction, who: string, on: boolean): CallChatMessage[] {
  return chat.map((m) => {
    if (m.id !== target || m.place !== place) return m;
    if ((m.reactions.find((x) => x.reaction === reaction)?.by.includes(who) ?? false) === on) return m;
    return { ...m, reactions: toggledReaction(m.reactions, reaction, who, on) };
  });
}

/**
 * The message you can react to from `place`, or why you can't: only once you're in, and only to a message of the part
 * of the call you're in that's in the log (one of yours still on its way has no place there yet, so nothing can point at it).
 */
export function reactionTarget(crypto: Pick<CallCrypto, 'status' | 'chat'>, place: string, messageId: string): CallChatMessage {
  if (crypto.status === 'moving') throw new AlcoveApiError('conflict', 'You’re moving to another room. React once you’re there.');
  if (crypto.status !== 'in') throw new AlcoveApiError('forbidden', 'Wait until the host lets you in.');
  const target = crypto.chat.find((m) => m.id === messageId && m.place === place);
  if (!target || target.sending || target.failed) throw new AlcoveApiError('not-found', 'That message isn’t here any more.');
  return target;
}

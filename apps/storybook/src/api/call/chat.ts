/*
 * Chat in the part of the call you're in: sending (and the failures a script asks for), retrying, reading and reacting.
 * Data between browsers goes nowhere: nobody else's browser is in the call.
 */
import { AlcoveApiError, CallChatTextSchema, reactionTarget, withReaction, type CallChatMention, type CallReaction } from '@alcove/api';
import { nextId } from '../state';
import { CallWithNotes } from './notes';

export abstract class CallWithChat extends CallWithNotes {
  private chatFailures = 0;

  sendChat(text: string, mentions: readonly CallChatMention[] = [], thread: import('@alcove/api').CallChatThread | null = null, broadcast = false): Promise<void> {
    const leading = text.length - text.trimStart().length;
    const parsed = CallChatTextSchema.safeParse({ text: text.trim(), mentions: mentions.map((m) => ({ ...m, start: m.start - leading, end: m.end - leading })), thread, broadcast, at: this.getSnapshot().elapsed });
    const now = this.crypto.getSnapshot();
    if (!parsed.success || parsed.data.mentions.some((m) => !now.members.includes(m.identity))) return Promise.reject(new AlcoveApiError('invalid', 'Choose people who are in this part of the call.'));
    if (parsed.data.thread) {
      const target = now.chat.find((m) => m.id === parsed.data.thread?.replyTo && m.place === now.place && !m.failed && !m.sending);
      if (!target || (target.thread?.root ?? target.id) !== parsed.data.thread.root) return Promise.reject(new AlcoveApiError('not-found', 'That conversation isn’t available in this room.'));
    }
    const failed = this.chatFailures < (this.script.chatFailures ?? 0);
    if (failed) this.chatFailures++;
    this.crypto.update((c) => ({ ...c, chat: [...c.chat, { id: nextId('chat'), from: this.me.id, isMe: true, text: parsed.data.text, mentions: parsed.data.mentions, thread: parsed.data.thread, broadcast: parsed.data.broadcast, at: parsed.data.at, place: c.place, sending: false, failed, reactions: [] }] }));
    return Promise.resolve();
  }
  retryChat(messageId: string): Promise<void> {
    const message = this.crypto.getSnapshot().chat.find((m) => m.id === messageId && m.failed);
    if (!message || message.place !== this.crypto.getSnapshot().place) return Promise.reject(new AlcoveApiError('conflict', 'Return to the original conversation before retrying this message.'));
    this.crypto.update((c) => ({ ...c, chat: c.chat.map((m) => m.id === messageId ? { ...m, failed: false } : m) }));
    return Promise.resolve();
  }
  readChat(ids: readonly string[]): Promise<void> {
    const readable = this.crypto.getSnapshot().chat.filter((m) => ids.includes(m.id)).map((m) => m.id);
    this.change((s) => ({ ...s, chatRead: [...new Set([...s.chatRead, ...readable])].slice(-200) }));
    return Promise.resolve();
  }
  /** Yours on a message, on or off: the same rules as the real call's. */
  react(messageId: string, reaction: CallReaction, on: boolean): Promise<void> {
    try { reactionTarget(this.crypto.getSnapshot(), this.crypto.getSnapshot().place, messageId); }
    catch (e) { return Promise.reject(e); }
    this.crypto.update((c) => ({ ...c, chat: withReaction(c.chat, messageId, c.place, reaction, this.me.id, on) }));
    return Promise.resolve();
  }
  /** Data between browsers goes nowhere here: nobody else's browser is in the call. */
  sealData(_topic: string, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> { return Promise.resolve(new Uint8Array(payload)); }
  openData(_topic: string, _from: string, sealed: Uint8Array): Promise<Uint8Array | null> { return Promise.resolve(sealed); }
}

/*
 * Chat, in your side: the conversations as tabs along the top (Everyone, the room's Questions, and a tab for each private
 * conversation), + to start a private one with someone here, and what the chosen tab shows. Which tab is chosen is the
 * call screen's, so a tile, a row in People or a notification can open a conversation; drafts live above the panel's mounts.
 */
import { type CallCrypto, type CallSession, type CallState, type DirectMessagesState, type Person } from '@alcove/api';
import { ChatTabs, IconButton, PickList, Popover, type ChatTabItem, type PickRow } from '@alcove/ui';
import { useId, useMemo, useState } from 'react';
import { callName, fold } from '~/lib/people';
import { hm } from '~/lib/time';
import { type ActionJump } from './actionFocus';
import { type ChatDraft } from './ChatMentions';
import { ChatQuestions, newQuestionDraft, type QuestionDraft } from './ChatQuestions';
import { ChatView } from './ChatView';
import { PrivateConversation, privateAudienceKey, privateConversations, privateNames, privateUnread, type PrivateAudience } from './PrivateChat';
import { type ReplyJump } from '../session/replyAlerts';

/** Which conversation Chat shows. */
export type ChatTab = { kind: 'room' } | { kind: 'questions' } | { kind: 'private'; audience: PrivateAudience };

/** Session memory only, above the panel's mounts: each room's and each private conversation's drafts, the private ones you opened, and each room's question. */
export interface ChatMemory { room: Map<string, ChatDraft>; private: Map<string, ChatDraft>; opened: Map<string, PrivateAudience>; questions: Map<string, QuestionDraft> }
export const newChatMemory = (): ChatMemory => ({ room: new Map(), private: new Map(), opened: new Map(), questions: new Map() });

function kept<T>(map: Map<string, T>, key: string, made: () => T): T {
  const was = map.get(key);
  if (was) return was;
  const now = made();
  map.set(key, now);
  return now;
}

export function ChatPanel({ session, state, crypto, direct, memory, tab, onTab, who, placeName, here, visible, jump, questionJump, questionsReady, roomUnread, unreadMentions, onRead }: {
  session: CallSession; state: CallState; crypto: CallCrypto; direct: DirectMessagesState; memory: ChatMemory;
  tab: ChatTab; onTab: (tab: ChatTab) => void; who: (identity: string) => Person; placeName: (place: string) => string;
  /** The room you're in while rooms are open. */
  here: string | null;
  /** Whether what Chat shows can be read now: the call is on this screen, nothing covers it, and the window has focus. */
  visible: boolean;
  /** A message to go to, from an alert or a notification. */
  jump?: ReplyJump | undefined;
  /** A question to go to. */
  questionJump?: ActionJump | undefined;
  /** The room's questions are the room you're in. */
  questionsReady: boolean;
  /** Messages in Everyone, the room's conversation, that you haven't read: the call screen counts them for Chat's button too. */
  roomUnread: readonly string[];
  unreadMentions: readonly string[]; onRead: (ids: readonly string[]) => void;
}) {
  const me = session.ticket.identity;
  const place = crypto.place;
  const generation = state.generation;
  const panel = useId();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  if (tab.kind === 'private') memory.opened.set(privateAudienceKey(tab.audience), tab.audience);
  // One you opened and never wrote in stays for this room only; one with messages stays to read.
  const conversations = useMemo(() => privateConversations(direct, me, [...memory.opened.values()]
    .filter((a) => (a.place === place && a.generation === generation) || (tab.kind === 'private' && privateAudienceKey(a) === privateAudienceKey(tab.audience)))), [direct, me, memory.opened.size, tab, place, generation]);
  const names = useMemo(() => privateNames(conversations, direct.peers, who), [conversations, direct.peers, who]);
  const unread = useMemo(() => privateUnread(direct, me), [direct, me]);
  const available = (a: PrivateAudience) => direct.ready && a.place === place && a.generation === generation && direct.peers.includes(a.identity);
  const when = (at: number) => hm(new Date(Date.parse(state.startedAt) + at * 1000));
  const selected = tab.kind === 'private' ? privateAudienceKey(tab.audience) : tab.kind;
  const roomNew = roomUnread.length > 0;
  const open = questionsReady ? state.attention.questions.filter((q) => q.status === 'open').length : 0;
  const tabs: ChatTabItem[] = [
    { key: 'room', label: 'Everyone', dot: tab.kind !== 'room' && roomNew, name: here ? `Everyone in ${here}${roomNew ? ', new messages' : ''}` : `Everyone${roomNew ? ', new messages' : ''}` },
    { key: 'questions', label: 'Questions', icon: 'ask', count: open, name: `Questions, ${open} open` },
    ...conversations.map((a): ChatTabItem => {
      const key = privateAudienceKey(a);
      const n = unread.get(key) ?? 0;
      const name = names.get(a.identity);
      const reachable = available(a);
      return { key, label: name?.short ?? callName(who(a.identity)), lock: true, dot: n > 0 && key !== selected, muted: !reachable,
        name: `${name?.full ?? who(a.identity).name}, private${n ? `, ${n} new` : ''}${reachable ? '' : ', unavailable'}` };
    })
  ];
  const choose = (key: string) => {
    if (key === 'room' || key === 'questions') { onTab({ kind: key }); return; }
    const audience = conversations.find((a) => privateAudienceKey(a) === key);
    if (audience) onTab({ kind: 'private', audience });
  };
  const startWith = (identity: string) => {
    const audience = { identity, place, generation };
    memory.opened.set(privateAudienceKey(audience), audience);
    setAdding(false); setQuery('');
    onTab({ kind: 'private', audience });
  };
  // People you can write to privately: everyone here whose private key this browser has checked.
  const typed = fold(query.trim());
  const rows: PickRow[] = direct.peers.map((identity) => ({ identity, person: who(identity) }))
    .filter(({ person }) => !typed || fold(`${person.name} ${person.email}`).includes(typed))
    .sort((a, b) => a.person.name.localeCompare(b.person.name))
    .map(({ identity, person }) => ({ key: identity, name: person.name || 'Guest', sub: person.email || 'Guest', person }));
  const privateNew = [...unread.values()].reduce((a, b) => a + b, 0);
  const label = tab.kind === 'room' ? 'Everyone' : tab.kind === 'questions' ? 'Questions' : `Private conversation with ${names.get(tab.audience.identity)?.full ?? who(tab.audience.identity).name}`;
  const add = (
    <Popover open={adding} onOpenChange={(o) => { setAdding(o); if (!o) setQuery(''); }} label="Message someone privately" align="end" className="tp-pop is-list" tip="Message someone privately"
      anchor={<IconButton icon="plus" size={17} label="Message someone privately" title={undefined} className="ch-add" />}>
      <PickList label="Find someone in this call" placeholder="Find someone in this call" query={query} onQuery={setQuery} rows={rows}
        none={direct.peers.length ? 'Nobody here by that name.' : direct.ready ? 'Nobody else here can get private messages yet.' : 'Private messages start once your place in the call is checked.'}
        onPress={(r) => startWith(r.key)} />
    </Popover>
  );
  return (
    <>
      <ChatTabs label="Conversations" tabs={tabs} value={selected} onChange={choose} panel={panel} end={add} />
      <span className="sr-only" role="status" aria-live="polite">{privateNew && tab.kind !== 'private' ? `${privateNew} unread private ${privateNew === 1 ? 'message' : 'messages'}.` : ''}</span>
      <div className="ch-pane" role="tabpanel" id={panel} aria-label={label}>
        {tab.kind === 'room' && (
          <ChatView key={place} jump={jump} visible={visible} chat={crypto.chat} missed={crypto.missedChat} ready={crypto.status === 'in'} moving={crypto.status === 'moving'}
            here={here} placeName={placeName} who={who} place={place} me={me} draft={kept(memory.room, place, () => ({ text: '' }))} when={when}
            mentionPeople={state.participants.filter((person) => crypto.members.includes(person.id)).map((person) => ({ identity: person.id, person: person.person }))}
            unreadMentionIds={unreadMentions} readIds={state.chatRead} onRead={onRead}
            onSend={(t, mentions, thread, broadcast) => session.sendChat(t, mentions, thread, broadcast)} onRetry={(id) => session.retryChat(id)} onReact={(id, r, on) => session.react(id, r, on)}
            onPrivate={(identity) => (direct.peers.includes(identity) ? () => startWith(identity) : undefined)} />
        )}
        {tab.kind === 'questions' && <ChatQuestions key={state.attention.place} session={session} state={state} ready={questionsReady} jump={questionJump}
          draft={kept(memory.questions, state.attention.place, newQuestionDraft)} />}
        {tab.kind === 'private' && (
          <PrivateConversation key={selected} session={session} state={direct} audience={tab.audience} place={place} generation={generation}
            draft={kept(memory.private, selected, () => ({ text: '' }))} who={who} name={names.get(tab.audience.identity)?.full ?? who(tab.audience.identity).name}
            visible={visible} jump={jump} when={when} />
        )}
      </div>
    </>
  );
}

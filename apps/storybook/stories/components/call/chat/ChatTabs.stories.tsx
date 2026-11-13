/*
 * Chat's conversations, as tabs along the top: Everyone, the room's Questions with how many are open, and a tab for each
 * private conversation, with a lock and a dot when something's new. + at the end starts a private one. Arrow keys move
 * between them.
 */
import { ChatLock, ChatTabs, ChatThreadHead, IconButton, type ChatTabItem } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box, Stack, did } from '../../../../src/component';

const TABS: ChatTabItem[] = [
  { key: 'room', label: 'Everyone' },
  { key: 'questions', label: 'Questions', icon: 'ask', count: 2, name: 'Questions, 2 open' },
  { key: 'priya', label: 'Priya', lock: true, dot: true, name: 'Priya Raman, private, 1 new' },
  { key: 'kofi', label: 'Kofi', lock: true, name: 'Kofi Asante, private' }
];

function Tabs({ tabs, start }: { tabs: ChatTabItem[]; start: string }) {
  const [value, setValue] = useState(start);
  return <ChatTabs label="Conversations" tabs={tabs} value={value} onChange={(key) => { did('onChange')(key); setValue(key); }} panel="chat-tabs-demo"
    end={<IconButton icon="plus" size={17} label="Message someone privately" className="ch-add" onClick={did('start a private conversation')} />} />;
}

const meta = { title: 'Components/In a call/Chat/ChatTabs', component: ChatTabs } satisfies Meta<typeof ChatTabs>;
export default meta;
type Story = StoryObj<typeof meta>;
const args = { label: 'Conversations', tabs: TABS, value: 'room', panel: 'chat-tabs-demo', onChange: did('onChange') };

export const Conversations: Story = { args, render: () => <Box width="min(360px, 100%)" height="auto"><Tabs tabs={TABS} start="room" /></Box> };
export const PrivateOne: Story = { args, render: () => <Box width="min(360px, 100%)" height="auto"><Stack><Tabs tabs={TABS} start="priya" /><ChatLock>Only you and Priya can read this.</ChatLock></Stack></Box> };
/** Someone who left: their conversation stays to read, quieter. */
export const SomeoneLeft: Story = { args, render: () => <Box width="min(360px, 100%)" height="auto"><Tabs tabs={[...TABS.slice(0, 2), { key: 'kofi', label: 'Kofi', lock: true, muted: true, name: 'Kofi Asante, private, unavailable' }]} start="room" /></Box> };
/** More conversations than fit: the tabs scroll, and + stays at the end. */
export const Many: Story = { args, render: () => <Box width="min(320px, 100%)" height="auto"><Tabs start="room" tabs={[...TABS, ...['Aiko', 'Maya', 'Diego', 'Lena'].map((n): ChatTabItem => ({ key: n, label: n, lock: true }))]} /></Box> };
export const ThreadHead: Story = { args, render: () => <Box width="min(360px, 100%)" height="auto"><ChatThreadHead sub="In Everyone · 3 people" onBack={did('back')} /></Box> };

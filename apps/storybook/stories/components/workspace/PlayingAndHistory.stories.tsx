/*
 * Playing a video for everyone in a call, a page that swaps in place, and a document's history. A video played for everyone
 * has a bar over the dock (WsPlayBar), with the controls for whoever started it and a volume that's yours alone. Opening
 * another document swaps the page in place (WsFade). History (WsHistory) sits beside the page, newest first; pressing a
 * version shows it, and Restore brings it back.
 */
import { Button, WsDoc, WsDocHead, WsFade, WsHistory, WsPage, WsPane, WsPlayBar, WsScroll, WsToasts, wsToast, type WsPlaying } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ComponentProps } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, Stack, did } from '../../../src/component';
import { AIKO } from '../../../src/world/people';
import { DocOf, ListOf, PageText, TEXT, VERSIONS, first, pathOf, useToasts, useWorkspace } from './parts';

const meta = {
  title: 'Components/Workspace/Playing and history',
  component: WsPlayBar,
  subcomponents: { WsFade, WsHistory },
  parameters: { layout: 'padded' }
} satisfies Meta<typeof WsPlayBar>;
export default meta;

/* ---------- swapping in place ---------- */

/** The documents the fade goes through, by their IDs in the workspace. */
const PAGES = [{ id: 'plan', name: 'Launch plan' }, { id: 'checklist', name: 'Launch checklist' }, { id: 'pricing', name: 'Pricing page copy' }];
/** Opening another document changes the id, and what's inside cross-fades (240 ms). */
const fading: StoryObj<typeof WsFade>['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsFade>>();
  const at = Math.max(0, PAGES.findIndex((p) => p.id === args.id));
  const page = PAGES[at] ?? { id: 'plan', name: 'Launch plan' };
  const next = PAGES[(at + 1) % PAGES.length] ?? page;
  const text = TEXT.get(page.id);
  return (
    <Stack>
      <Button size="sm" iconRight="right" onClick={() => update({ id: next.id })}>Open {next.name}</Button>
      <Box width="100%" height={420}>
        <WsPane>
          <WsDoc>
            <WsScroll>
              <WsFade id={page.id}><WsPage><PageText title={page.name} by={text?.by} edited={text?.edited} lines={text?.lines ?? []} /></WsPage></WsFade>
            </WsScroll>
          </WsDoc>
        </WsPane>
      </Box>
    </Stack>
  );
};
export const Fade: StoryObj<typeof WsFade> = {
  name: 'Fade', args: { id: 'plan', children: null },
  argTypes: { children: { table: { disable: true } }, id: { control: 'inline-radio', options: PAGES.map((p) => p.id) } }, render: fading
};

/* ---------- playing a video for everyone ---------- */

const LENGTH = 90;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const FILM: WsPlaying = { title: 'Harbour launch film', mine: true, by: 'Art', canControl: true, on: true, at: clock(42), progress: 42 / LENGTH, volume: 0.8 };

/**
 * The bar over the dock, under the workspace in a call. It runs while it plays; whoever started it, or the organizer, can
 * pause it, move it along or stop it for everyone, and the volume is yours alone. Once it's stopped, the button plays it again.
 */
function Playing(args: ComponentProps<typeof WsPlayBar>) {
  const [playing, setPlaying] = useState(args.playing);
  const ws = useWorkspace({ call: true });
  const on = playing?.on ?? false;
  useEffect(() => {
    if (!on) return undefined;
    const t = window.setInterval(() => setPlaying((p) => {
      if (!p) return p;
      const s = Math.min(LENGTH, Math.round(p.progress * LENGTH) + 1);
      return { ...p, at: clock(s), progress: s / LENGTH, on: s < LENGTH };
    }), 1000);
    return () => clearInterval(t);
  }, [on]);
  return (
    <Stack>
      {playing === null && <Button size="sm" icon="play" onClick={() => setPlaying({ ...FILM, at: clock(0), progress: 0 })}>Play Harbour launch film for everyone</Button>}
      <Box width="100%" height={560}><WsPane><ListOf ws={ws} /><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box>
      <WsPlayBar playing={playing} onToggle={() => { args.onToggle(); setPlaying((p) => p && { ...p, on: !p.on }); }}
        onSeek={(progress) => { args.onSeek(progress); setPlaying((p) => p && { ...p, progress, at: clock(Math.round(progress * LENGTH)) }); }}
        onStop={() => { args.onStop(); setPlaying(null); }} onVolume={(volume) => { args.onVolume(volume); setPlaying((p) => p && { ...p, volume }); }} />
    </Stack>
  );
}
type PlayStory = StoryObj<typeof WsPlayBar>;
const PLAY = { playing: FILM, onToggle: did('onToggle'), onSeek: did('onSeek'), onStop: did('onStop'), onVolume: did('onVolume') };
const playTypes: PlayStory['argTypes'] = { playing: { control: 'object' } };
export const PlayYours: PlayStory = { name: 'Play bar: yours, playing', args: PLAY, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };
export const PlayPaused: PlayStory = { name: 'Play bar: yours, paused', args: { ...PLAY, playing: { ...FILM, on: false } }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };
/** Aiko started it: the bar says so, and there's nothing to press but your own volume. */
export const PlayTheirs: PlayStory = {
  name: 'Play bar: someone else’s', args: { ...PLAY, playing: { ...FILM, mine: false, by: first(AIKO) } }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} />
};
/** Stopped, or nothing playing: the bar drops away. */
export const PlayGone: PlayStory = { name: 'Play bar: gone', args: { ...PLAY, playing: null }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };

/* ---------- history ---------- */

/** History beside Launch plan: a version shows on the page as you press it; Restore and Close put it away. */
function History(args: ComponentProps<typeof WsHistory> & { update: (next: Partial<ComponentProps<typeof WsHistory>>) => void }) {
  const [open, setOpen] = useState(true);
  const { toasts, say } = useToasts();
  const plan = TEXT.get('plan');
  const version = VERSIONS.find((v) => v.id === args.selected);
  const close = () => { setOpen(false); args.update({ selected: VERSIONS[0]?.id ?? '' }); };
  return (
    <Stack>
      {!open && <Button size="sm" icon="history" onClick={() => setOpen(true)}>History</Button>}
      <Box width="100%" height={560}>
        <WsPane>
          <WsDoc>
            <WsDocHead crumbs={pathOf('Product', 'Launch plan')} save="saved" onToggleList={did('onToggleList')} />
            <WsScroll>
              <WsFade id={args.selected}>
                <WsPage>
                  <PageText title="Launch plan" by={plan?.by} edited={plan?.edited} lines={(plan?.lines ?? []).slice(0, version?.lines ?? 9)} />
                </WsPage>
              </WsFade>
            </WsScroll>
          </WsDoc>
          {open && (
            <WsHistory versions={args.versions} selected={args.selected} onSelect={(id) => { args.onSelect(id); args.update({ selected: id }); }}
              onRestore={() => { args.onRestore?.(); close(); if (version) say(wsToast.restoredVersion(version.when, did('onUndo'))); }} onClose={() => { args.onClose(); close(); }} />
          )}
        </WsPane>
      </Box>
      <WsToasts toasts={toasts} />
    </Stack>
  );
}
const history: StoryObj<typeof WsHistory>['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsHistory>>();
  return <History {...args} update={update} />;
};
const HISTORY = { versions: VERSIONS, selected: 'v-now', onSelect: did('onSelect'), onRestore: did('onRestore'), onClose: did('onClose') };
const historyTypes: StoryObj<typeof WsHistory>['argTypes'] = { versions: { control: false }, selected: { control: 'inline-radio', options: VERSIONS.map((v) => v.id) } };
/** Grouped by call, newest first. The first is now, so it has no Restore. */
export const HistoryNow: StoryObj<typeof WsHistory> = { name: 'History: versions', args: HISTORY, argTypes: historyTypes, render: history };
/** The last check-in's version, on the page, with Restore. */
export const HistoryPast: StoryObj<typeof WsHistory> = { name: 'History: a past version, with Restore', args: { ...HISTORY, selected: 'v-last' }, argTypes: historyTypes, render: history };

/*
 * Your view of a call, which changes your screen only and is never sent anywhere.
 *
 * - How you like to see calls (`CallViewPrefs`: Auto, speaker or grid, how much room shared screens get, where you see
 *   yourself) is remembered in this browser for your account, for every call.
 * - How you arranged this call (`CallLayout`: who you pinned, the order you put people in, who you made bigger, which
 *   shares you see big) lasts for this call only: it's kept in this tab, so a reload keeps it, and it's deleted when
 *   you leave. It names people by their seat in the call, which is random and means nothing anywhere else.
 *
 * Neither holds a name or anything said or shared. The layout engine (stageLayout.ts) turns both into the stage.
 */
import {
  CALL_LAYOUT_MAX, CALL_SHARE_ROOM, CALL_SHARE_SPLIT, CallLayoutSchema, CallViewPrefsSchema, type CallLayout, type CallViewMode, type CallViewPrefs, type SelfView, type StageCorner
} from '@alcove/api';
import { useCallback, useRef, useState } from 'react';
import { log } from '~/lib/log';

const vlog = log.child({ component: 'call-view' });

export const DEFAULT_PREFS: CallViewPrefs = { mode: 'auto', ratio: CALL_SHARE_ROOM.start, self: 'grid', corner: 'bottom-right' };
export const EMPTY_LAYOUT: CallLayout = { pins: [], order: [], arrived: [], big: [], shares: [], split: CALL_SHARE_SPLIT.start };
const clamp = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));

/* Preferences by account (its opaque owner ID); a browser without an account has one set of its own. */
const prefsKey = (account: string | null) => (account ? `alcove.callView.${account}` : 'alcove.callView');
const layoutKey = (callId: string) => `alcove.callLayout.${callId}`;

function readPrefs(account: string | null): CallViewPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(account));
    if (!raw) return DEFAULT_PREFS;
    const r = CallViewPrefsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
function readLayout(callId: string): CallLayout {
  try {
    const raw = sessionStorage.getItem(layoutKey(callId));
    if (!raw) return EMPTY_LAYOUT;
    const r = CallLayoutSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}
/** The account is gone: so is how it liked to see calls in this browser. */
export function forgetView(account: string) {
  try { localStorage.removeItem(prefsKey(account)); } catch (e) { vlog.debug('view not forgotten', { err: e }); }
}
function keep(store: 'local' | 'session', key: string, value: unknown) {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch (e) { vlog.debug('view not remembered', { store, err: e }); }
}

/** You changed the layout from what Auto gives: the top bar offers a way back. Where you see yourself is a standing choice, not part of it. */
export const isCustom = (p: CallViewPrefs, l: CallLayout) => p.mode !== 'auto' || Math.abs(p.ratio - DEFAULT_PREFS.ratio) > 0.001
  || l.pins.length > 0 || l.order.length > 0 || l.big.length > 0 || l.shares.length > 0 || Math.abs(l.split - EMPTY_LAYOUT.split) > 0.001;

/** Ready-made layouts, by role rather than by person, so they fit any call. */
export type Preset = 'equal' | 'presenter';
export const PRESETS: { id: Preset; label: string; detail: string }[] = [
  { id: 'equal', label: 'Everyone equal', detail: 'Grid, nobody pinned or bigger, you with everyone' },
  { id: 'presenter', label: 'Presenter and me', detail: 'Whoever shares or talks, big; you in a corner' }
];
function presetOf(id: Preset, p: CallViewPrefs, l: CallLayout): { prefs: CallViewPrefs; layout: CallLayout } {
  const cleared: CallLayout = { ...l, pins: [], big: [], shares: [], split: EMPTY_LAYOUT.split };
  return id === 'equal'
    ? { prefs: { ...p, mode: 'grid', self: 'grid' }, layout: cleared }
    : { prefs: { ...p, mode: 'speaker', self: 'corner', ratio: 0.78 }, layout: cleared };
}
/** The preset your view is in right now, if any. */
export function presetNow(p: CallViewPrefs, l: CallLayout): Preset | null {
  const plain = !l.pins.length && !l.big.length && !l.shares.length;
  if (plain && p.mode === 'grid' && p.self === 'grid') return 'equal';
  if (plain && p.mode === 'speaker' && p.self === 'corner' && Math.abs(p.ratio - 0.78) < 0.001) return 'presenter';
  return null;
}

/** A view to go back to: Undo after a reset or a preset. */
export interface ViewSnapshot { prefs: CallViewPrefs; layout: CallLayout }

/** The shares big now, in the order they came to be: any the layout put there (first to start, first), then your picks. */
function picked(l: CallLayout, big: string[]): string[] {
  const chosen = l.shares.filter((s) => s.show === 'big' && big.includes(s.id)).map((s) => s.id);
  return [...big.filter((s) => !chosen.includes(s)), ...chosen];
}
/** Your choices about shares with these big and the rest as they were: the ones you made tiles stay tiles. */
function sharesWith(l: CallLayout, big: string[], tile: string | null): CallLayout['shares'] {
  const tiles = l.shares.filter((s) => s.show === 'tile' && s.id !== tile && !big.includes(s.id));
  return [...tiles, ...(tile ? [{ id: tile, show: 'tile' as const }] : []), ...big.map((id) => ({ id, show: 'big' as const }))].slice(-CALL_LAYOUT_MAX.shares);
}

/**
 * Your view of the call `callId`. `account` is your account's owner ID, null without an account, or undefined while
 * that isn't known yet (nothing is remembered until it is).
 */
export function useCallView(callId: string, account: string | null | undefined) {
  const [prefs, setPrefs] = useState<CallViewPrefs>(() => (account === undefined ? DEFAULT_PREFS : readPrefs(account)));
  const [prefsFor, setPrefsFor] = useState(account);
  if (account !== prefsFor) { setPrefsFor(account); setPrefs(account === undefined ? DEFAULT_PREFS : readPrefs(account)); }
  const [layout, setLayout] = useState<CallLayout>(() => readLayout(callId));
  const [layoutFor, setLayoutFor] = useState(callId);
  if (callId !== layoutFor) { setLayoutFor(callId); setLayout(readLayout(callId)); }

  const updatePrefs = useCallback((fn: (p: CallViewPrefs) => CallViewPrefs) => {
    setPrefs((p) => { const next = fn(p); if (account !== undefined) keep('local', prefsKey(account), next); return next; });
  }, [account]);
  // Once you've left the call, nothing writes its arrangement back.
  const forgotten = useRef(false);
  const updateLayout = useCallback((fn: (l: CallLayout) => CallLayout) => {
    setLayout((l) => { const next = fn(l); if (next !== l && !forgotten.current) keep('session', layoutKey(callId), next); return next; });
  }, [callId]);
  /** Leaving the call forgets how you arranged it, for good: later changes on the way out aren't kept either. */
  const forget = useCallback(() => {
    forgotten.current = true;
    try { sessionStorage.removeItem(layoutKey(callId)); } catch (e) { vlog.debug('call layout not forgotten', { err: e }); }
  }, [callId]);
  /** Remembers the order people first came in, by seat, so someone coming back keeps their place. */
  const arrive = useCallback((seats: string[]) => updateLayout((l) => {
    const fresh = seats.filter((s) => !l.arrived.includes(s));
    return fresh.length ? { ...l, arrived: [...l.arrived, ...fresh].slice(-CALL_LAYOUT_MAX.arrived) } : l;
  }), [updateLayout]);
  /** Shares that stopped aren't anyone's choice any more. */
  const endShares = useCallback((ended: string[]) => updateLayout((l) => (l.shares.some((s) => ended.includes(s.id)) ? { ...l, shares: l.shares.filter((s) => !ended.includes(s.id)) } : l)), [updateLayout]);

  return {
    arrive, endShares, forget,
    prefs, layout,
    setMode: (mode: CallViewMode) => updatePrefs((p) => ({ ...p, mode })),
    setRatio: (ratio: number) => updatePrefs((p) => ({ ...p, ratio: clamp(ratio, CALL_SHARE_ROOM) })),
    setSelf: (self: SelfView) => updatePrefs((p) => ({ ...p, self })),
    setCorner: (corner: StageCorner) => updatePrefs((p) => ({ ...p, corner })),
    /**
     * Pins someone (by seat), or unpins them. With every pin taken, the oldest pin of someone who isn't in the call
     * (`here`: the seats in the call now) makes room. False when all of them are here.
     */
    togglePin: (seat: string, here: ReadonlySet<string>): boolean => {
      const pins = layout.pins;
      if (pins.includes(seat)) { updateLayout((l) => ({ ...l, pins: l.pins.filter((s) => s !== seat) })); return true; }
      const gone = pins.length >= CALL_LAYOUT_MAX.pins ? pins.find((s) => !here.has(s)) : undefined;
      if (pins.length >= CALL_LAYOUT_MAX.pins && gone === undefined) return false;
      updateLayout((l) => ({ ...l, pins: [...l.pins.filter((s) => s !== gone), seat].slice(-CALL_LAYOUT_MAX.pins) }));
      return true;
    },
    setPins: (pins: string[]) => updateLayout((l) => ({ ...l, pins: pins.slice(0, CALL_LAYOUT_MAX.pins) })),
    setOrder: (order: string[]) => updateLayout((l) => ({ ...l, order: order.slice(0, CALL_LAYOUT_MAX.order) })),
    setBig: (seat: string, big: boolean) => updateLayout((l) => ({ ...l, big: big ? [...new Set([...l.big, seat])].slice(-CALL_LAYOUT_MAX.big) : l.big.filter((s) => s !== seat) })),
    /**
     * Shows a share big, after the ones big now (`big`, which become your choice too). The stage shows the latest of them
     * that fit: beside what's big, or in place of the one that's been big longest. Kept whole, so a stage that grows
     * (the panel closing) shows them again.
     */
    showShare: (id: string, big: string[]) => updateLayout((l) => ({ ...l, shares: sharesWith(l, [...picked(l, big).filter((s) => s !== id), id], null) })),
    /** Shows a share as a tile: the others big now stay big, and nothing takes its place, now or when another share starts. */
    hideShare: (id: string, big: string[]) => updateLayout((l) => ({ ...l, shares: sharesWith(l, picked(l, big).filter((s) => s !== id), id) })),
    setSplit: (split: number) => updateLayout((l) => ({ ...l, split: clamp(split, CALL_SHARE_SPLIT) })),
    /** Back to Auto: nobody pinned, the call's order and sizes. Where you see yourself stays as it is. */
    reset: (): ViewSnapshot => {
      const was = { prefs, layout };
      updatePrefs((p) => ({ ...p, mode: DEFAULT_PREFS.mode, ratio: DEFAULT_PREFS.ratio }));
      updateLayout((l) => ({ ...EMPTY_LAYOUT, arrived: l.arrived }));
      return was;
    },
    preset: (id: Preset): ViewSnapshot => {
      const was = { prefs, layout };
      const next = presetOf(id, prefs, layout);
      updatePrefs(() => next.prefs);
      updateLayout(() => next.layout);
      return was;
    },
    restore: (v: ViewSnapshot) => { updatePrefs(() => v.prefs); updateLayout((l) => ({ ...v.layout, arrived: l.arrived })); }
  };
}
export type CallView = ReturnType<typeof useCallView>;

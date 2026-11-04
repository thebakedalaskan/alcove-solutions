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
import { CallLayoutSchema, CallViewPrefsSchema, type CallLayout, type CallViewMode, type CallViewPrefs, type SelfView, type StageCorner } from '@alcove/api';
import { useCallback, useState } from 'react';
import { log } from '~/lib/log';

const vlog = log.child({ component: 'call-view' });

export const DEFAULT_PREFS: CallViewPrefs = { mode: 'auto', ratio: 0.66, self: 'grid', corner: 'bottom-right' };
export const EMPTY_LAYOUT: CallLayout = { pins: [], order: [], arrived: [], big: [], shares: [], split: 0.5 };
/** Pin up to this many people. */
export const MAX_PINS = 6;

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
function keep(store: 'local' | 'session', key: string, value: unknown) {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch (e) { vlog.debug('view not remembered', { store, err: e }); }
}
/** Leaving the call forgets how you arranged it. */
export function forgetCallLayout(callId: string) {
  try { sessionStorage.removeItem(layoutKey(callId)); } catch (e) { vlog.debug('call layout not forgotten', { err: e }); }
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
  const updateLayout = useCallback((fn: (l: CallLayout) => CallLayout) => {
    setLayout((l) => { const next = fn(l); if (next !== l) keep('session', layoutKey(callId), next); return next; });
  }, [callId]);
  /** Remembers the order people first came in, by seat, so someone coming back keeps their place. */
  const arrive = useCallback((seats: string[]) => updateLayout((l) => {
    const fresh = seats.filter((s) => !l.arrived.includes(s));
    return fresh.length ? { ...l, arrived: [...l.arrived, ...fresh].slice(-400) } : l;
  }), [updateLayout]);
  /** Shares that have stopped aren't anyone's choice any more. */
  const dropShares = useCallback((live: string[]) => updateLayout((l) => (l.shares.every((s) => live.includes(s.id)) ? l : { ...l, shares: l.shares.filter((s) => live.includes(s.id)) })), [updateLayout]);

  return {
    arrive, dropShares,
    prefs, layout,
    setMode: (mode: CallViewMode) => updatePrefs((p) => ({ ...p, mode })),
    setRatio: (ratio: number) => updatePrefs((p) => ({ ...p, ratio: Math.max(0.42, Math.min(0.8, ratio)) })),
    setSelf: (self: SelfView) => updatePrefs((p) => ({ ...p, self })),
    setCorner: (corner: StageCorner) => updatePrefs((p) => ({ ...p, corner })),
    /** Pins someone (by seat), or unpins them. False when MAX_PINS are pinned already. */
    togglePin: (seat: string): boolean => {
      if (!layout.pins.includes(seat) && layout.pins.length >= MAX_PINS) return false;
      updateLayout((l) => ({ ...l, pins: l.pins.includes(seat) ? l.pins.filter((s) => s !== seat) : [...l.pins, seat] }));
      return true;
    },
    setPins: (pins: string[]) => updateLayout((l) => ({ ...l, pins: pins.slice(0, MAX_PINS) })),
    setOrder: (order: string[]) => updateLayout((l) => ({ ...l, order: order.slice(0, 200) })),
    setBig: (seat: string, big: boolean) => updateLayout((l) => ({ ...l, big: big ? [...new Set([...l.big, seat])] : l.big.filter((s) => s !== seat) })),
    /** How you see one share: big, as a tile, or (null) as the layout puts it. */
    setShare: (id: string, show: 'big' | 'tile' | null) => updateLayout((l) => ({ ...l, shares: [...l.shares.filter((s) => s.id !== id), ...(show ? [{ id, show }] : [])] })),
    setSplit: (split: number) => updateLayout((l) => ({ ...l, split: Math.max(0.25, Math.min(0.75, split)) })),
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

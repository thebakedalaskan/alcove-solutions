/*
 * Settings save as each control changes. The change shows at once; once it's kept, the row says Saved for a moment,
 * just left of the control (and screen readers hear it). A change the server refuses goes back, and a toast says why,
 * with Copy reference.
 */
import type { Preferences } from '@alcove/api';
import { SettingRow, Switch, useToast, type SettingRowProps } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { accountQueries, usePreferences } from '~/features/account/queries';
import { toastFailure } from '~/lib/failed';
import { withPreferenceChange, type PreferenceChange } from '~/lib/queryWrites';

const SAVED_MS = 2200;

export type SaveState = 'saving' | 'saved' | 'failed';
interface Save { ticket: number; state: SaveState }
/** Each row speaks only for its latest requested choice, even across separate useSave callers. */
const Saved = createContext<{ rows: ReadonlyMap<string, Save>; begin: (name: string) => number; end: (name: string, ticket: number, saved: boolean) => boolean; done: (name: string) => void }>({ rows: new Map(), begin: () => 0, end: () => false, done: () => {} });

export function SavedProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<ReadonlyMap<string, Save>>(new Map());
  const sequence = useRef(0);
  const latest = useRef(new Map<string, number>());
  useEffect(() => {
    if (![...rows.values()].some((row) => row.state === 'saved')) return;
    const t = setTimeout(() => setRows((was) => new Map([...was].filter(([, row]) => row.state !== 'saved'))), SAVED_MS);
    return () => clearTimeout(t);
  }, [rows]);
  const begin = useCallback((name: string) => { const ticket = ++sequence.current; latest.current.set(name, ticket); setRows((was) => new Map(was).set(name, { ticket, state: 'saving' })); return ticket; }, []);
  const end = useCallback((name: string, ticket: number, saved: boolean) => {
    if (latest.current.get(name) !== ticket) return false;
    setRows((was) => new Map(was).set(name, { ticket, state: saved ? 'saved' : 'failed' }));
    return true;
  }, []);
  const done = useCallback((name: string) => { const ticket = ++sequence.current; latest.current.set(name, ticket); setRows((was) => new Map(was).set(name, { ticket, state: 'saved' })); }, []);
  return (
    <Saved.Provider value={{ rows, begin, end, done }}>
      {children}
      <p className="sr-only" role="status">{[...rows].map(([name, row]) => `${name}: ${row.state === 'saving' ? 'saving' : row.state === 'saved' ? 'saved' : 'couldn’t confirm'}`).join('. ')}</p>
    </Saved.Provider>
  );
}

/** Says a setting kept only in this browser (a device, say) is saved. */
export const useSaved = () => useContext(Saved).done;

/** What a setting named `name` says about its latest change, for something that isn't a row of its own (a line of a table). */
export function useSaveState(): (name: string) => SaveState | undefined {
  const { rows } = useContext(Saved);
  return (name) => rows.get(name)?.state;
}

/**
 * Runs `write` as the latest change to the setting named `name`, which says Saving… until it's answered, then Saved for a
 * moment, or Couldn't confirm (and screen readers hear each). Only the latest change to a name speaks for it: its refusal
 * rejects, for whoever asked to say why, and an older one that was overtaken settles quietly.
 */
export function useSaving() {
  const { begin, end } = useContext(Saved);
  return async (name: string, write: () => Promise<unknown>): Promise<void> => {
    const ticket = begin(name);
    try { await write(); }
    catch (e) {
      if (end(name, ticket, false)) throw e;
      return;
    }
    end(name, ticket, true);
  };
}

/**
 * Saves a change to preferences under the setting's `name`. A change that depends on the others (the notifications go
 * together) is worked out from the preferences as they are when it's made, so quick changes build on one another.
 */
export function useSave() {
  const qc = useQueryClient();
  const write = usePreferences();
  const toast = useToast();
  const saving = useSaving();
  const { rows } = useContext(Saved);
  return (name: string, change: PreferenceChange | ((now: Preferences) => PreferenceChange)) => {
    const now = qc.getQueryData(accountQueries.prefs().queryKey);
    if (!now) return;
    const patch = typeof change === 'function' ? change(now) : change;
    // The choice already made, picked again: nothing to save.
    if (JSON.stringify(withPreferenceChange(now, patch)) === JSON.stringify(withPreferenceChange(now, {})) && rows.get(name)?.state !== 'failed') return;
    void saving(name, () => write.mutateAsync(patch)).catch((e: unknown) => toastFailure(toast, e));
  };
}

/** A row that says so for a moment once a change to the setting it names is kept. `saying` is what it says, when that's more than Saved. */
export function Setting({ label, saying = 'Saved', ...row }: Omit<SettingRowProps, 'label' | 'saved'> & { label: string; saying?: string | undefined; ref?: Ref<HTMLDivElement> | undefined }) {
  const { rows } = useContext(Saved);
  const state = rows.get(label)?.state;
  return <SettingRow {...row} label={label} aria-busy={state === 'saving'} saveState={state} saved={state === 'saved' ? saying : undefined} />;
}

/** A setting that's on or off. Pressing its words turns it too. `sub`: nested under the connection above it. */
export function SwitchSetting({ label, help, checked, disabled = false, sub = false, onChange }: { label: string; help?: ReactNode; checked: boolean; disabled?: boolean | undefined; sub?: boolean | undefined; onChange: (on: boolean) => void }) {
  return (
    <Setting label={label} help={help} off={disabled} sub={sub} onLabel={disabled ? undefined : () => onChange(!checked)}
      control={<Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />} />
  );
}

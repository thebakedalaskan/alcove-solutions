/*
 * Settings save as each control changes. The change shows at once; once it's kept, the row says Saved for a moment,
 * just left of the control (and screen readers hear it). A change the server refuses goes back, and a toast says why.
 */
import { errorCode, errorMessage, type Patch, type Preferences } from '@alcove/api';
import { SettingRow, Switch, useToast, type SettingRowProps } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type Ref } from 'react';
import { q, usePreferences } from '~/lib/queries';

const SAVED_MS = 2200;

/** The setting saved last, for a moment, by its name. */
const Saved = createContext<{ saved: string | null; done: (name: string) => void }>({ saved: null, done: () => {} });

export function SavedProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<{ name: string; n: number } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), SAVED_MS);
    return () => clearTimeout(t);
  }, [saved]);
  const done = useCallback((name: string) => setSaved((s) => ({ name, n: (s?.n ?? 0) + 1 })), []);
  return (
    <Saved.Provider value={{ saved: saved?.name ?? null, done }}>
      {children}
      <p className="sr-only" role="status">{saved ? `${saved.name}: saved` : ''}</p>
    </Saved.Provider>
  );
}

/** Says a setting kept only in this browser (a device, say) is saved. */
export const useSaved = () => useContext(Saved).done;

/** Why a change went back, naming it. */
const refused = (e: unknown, name: string) => (errorCode(e) === 'network' ? `Couldn’t reach Alcove, so ${name} is back as it was.` : `${errorMessage(e)} ${name} is back as it was.`);

/**
 * Saves a change to preferences under the setting's `name`. A change that depends on the others (the notifications go
 * together) is worked out from the preferences as they are when it's made, so quick changes build on one another.
 */
export function useSave() {
  const qc = useQueryClient();
  const write = usePreferences();
  const toast = useToast();
  const { done } = useContext(Saved);
  return (name: string, change: Patch<Preferences> | ((now: Preferences) => Patch<Preferences>)) => {
    const now = qc.getQueryData(q.prefs().queryKey);
    if (!now) return;
    const patch = typeof change === 'function' ? change(now) : change;
    // The choice already made, picked again: nothing to save.
    if (JSON.stringify({ ...now, ...patch }) === JSON.stringify(now)) return;
    write.mutateAsync(patch).then(() => done(name), (e: unknown) => toast(refused(e, name), { icon: 'x' }));
  };
}

/** A row that says so for a moment once a change to the setting it names is kept. `saying` is what it says, when that's more than Saved. */
export function Setting({ label, saying = 'Saved', ...row }: Omit<SettingRowProps, 'label' | 'saved'> & { label: string; saying?: string | undefined; ref?: Ref<HTMLDivElement> | undefined }) {
  const { saved } = useContext(Saved);
  return <SettingRow {...row} label={label} saved={saved === label ? saying : undefined} />;
}

/** A setting that's on or off. Pressing its words turns it too. */
export function SwitchSetting({ label, help, checked, disabled = false, onChange }: { label: string; help?: ReactNode; checked: boolean; disabled?: boolean | undefined; onChange: (on: boolean) => void }) {
  return (
    <Setting label={label} help={help} off={disabled} onLabel={disabled ? undefined : () => onChange(!checked)}
      control={<Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />} />
  );
}

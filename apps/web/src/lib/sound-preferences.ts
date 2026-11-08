/** Signed-in choices live in the sealed profile. Guests keep validated playback choices in this browser. */
import { DEFAULT_SOUND_PREFERENCES, SoundPreferencesSchema, errorMessage, type SoundPreferences } from '@alcove/api';
import { useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { log } from './log';
import { q, usePreferences } from './queries';

const KEY = 'alcove.guest.sounds';
const slog = log.child({ component: 'sound-preferences' });
function readGuest(): SoundPreferences {
  try {
    const parsed = SoundPreferencesSchema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
    return parsed.success ? parsed.data : DEFAULT_SOUND_PREFERENCES;
  } catch { return DEFAULT_SOUND_PREFERENCES; }
}
export function useSoundPreferences() {
  const sessionQuery = useQuery(q.session());
  const session = sessionQuery.data;
  const prefs = useQuery({ ...q.prefs(), enabled: Boolean(session) });
  const qc = useQueryClient();
  const save = usePreferences();
  const toast = useToast();
  const [guest, setGuest] = useState(readGuest);
  useEffect(() => {
    const changed = () => setGuest(readGuest());
    addEventListener('storage', changed);
    addEventListener('alcove-guest-sounds', changed);
    return () => { removeEventListener('storage', changed); removeEventListener('alcove-guest-sounds', changed); };
  }, []);
  const update = (patch: Partial<SoundPreferences>) => {
    if (sessionQuery.isPending || sessionQuery.isError) return;
    if (session) {
      const now = qc.getQueryData(q.prefs().queryKey);
      if (!now) return;
      save.mutate({ sounds: { ...now.sounds, ...patch } }, { onError: (e) => toast(`Couldn’t save sounds. ${errorMessage(e)}`, { icon: 'x' }) });
    } else {
      const next = SoundPreferencesSchema.parse({ ...readGuest(), ...patch });
      setGuest(next);
      try { localStorage.setItem(KEY, JSON.stringify(next)); dispatchEvent(new Event('alcove-guest-sounds')); }
      catch (e) { slog.debug('guest sound preference stays in this tab', { err: e }); }
    }
  };
  return { prefs: session ? prefs.data?.sounds ?? DEFAULT_SOUND_PREFERENCES : guest, update, ready: !sessionQuery.isPending && !sessionQuery.isError && (!session || Boolean(prefs.data)) };
}

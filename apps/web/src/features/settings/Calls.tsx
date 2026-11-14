/*
 * Calls and notes: whether new calls have notes, the language they're written in and the AI model that writes them; then
 * recording in the room, with what waits on this device to upload. Each control saves as it changes (save.tsx).
 */
import type { NotesLanguage, NotesSetting, Preferences } from '@alcove/api';
import { Icon, Segmented, Select, SettingRow, SettingsGroup, SettingsPanel, type SelectOption } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { uploads } from '~/features/record/uploads';
import { isUnencrypted, modelOf, modelOptions, modelValue, useAiModels } from '~/features/notes/models';
import { useLive } from '~/lib/live';
import { plural, sizeLabel } from '~/lib/words';
import { Setting, SwitchSetting, useSave } from './save';

const LANGUAGES: SelectOption<NotesLanguage>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }, { value: 'ko', label: 'Korean' }, { value: 'hi', label: 'Hindi' }, { value: 'ar', label: 'Arabic' }
];

export function CallsGroup({ prefs }: { prefs: Preferences }) {
  const save = useSave();
  const models = useAiModels();
  // A model outside a secure enclave carries its Unencrypted badge, in the list and on the choice, and the row says what that means.
  const unencrypted = isUnencrypted(models.data, prefs.model);
  const kept = useLive(uploads);
  const waiting = kept.list.length;
  const bytes = kept.list.reduce((all, k) => all + k.bytes, 0);
  return (
    <SettingsGroup id="calls" title="Calls and notes">
      <SettingsPanel title="Notes">
        <Setting label="Notes for new calls" help="Everyone invited gets them. You can change it for each call."
          control={<Segmented<NotesSetting> label="Notes for new calls" value={prefs.notesDefault} onChange={(v) => save('Notes for new calls', { notesDefault: v })}
            options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />} />
        <Setting label="Language" saying="Saved for new notes"
          control={<Select<NotesLanguage> label="Notes language" value={prefs.notesLanguage} options={LANGUAGES} onChange={(v) => save('Language', { notesLanguage: v })} />} />
        <Setting label="AI model" problem={unencrypted}
          help={unencrypted ? 'Outside a secure enclave, so Alcove can’t guarantee your notes stay private.' : 'Writes your notes and answers questions. You can change it for a call or a note.'}
          control={<Select<string> label="AI model" value={modelValue(prefs.model)} options={modelOptions(models.data, prefs.model)}
            align="end" onChange={(v) => save('AI model', { model: modelOf(v) })} />} />
      </SettingsPanel>
      <SettingsPanel id="recording" title="Recording in the room">
        <SwitchSetting label="Record without a connection" help="Kept on this device, encrypted, until you’re back online."
          checked={prefs.recordOffline} onChange={(on) => save('Record without a connection', { recordOffline: on })} />
        {/* Only while something waits here to upload. Record lists each, with how it stands. */}
        {waiting > 0 && (
          <SettingRow label="On this device" help={`${plural(waiting, 'recording')}, ${sizeLabel(bytes)}, waiting to upload.`}
            control={<Link to="/record" className="set-go">See {waiting === 1 ? 'it' : 'them'}<Icon name="right" size={14} /></Link>} />
        )}
      </SettingsPanel>
    </SettingsGroup>
  );
}

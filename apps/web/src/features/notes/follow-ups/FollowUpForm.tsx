import { errorMessage } from '@alcove/api';
import { FollowUpEditor, Notice, type FollowUpValues } from '@alcove/ui';
import { useState } from 'react';

/** The draft is a person's edit, never a mirror of changing call state. A failed save keeps it. */
export function FollowUpForm({ initial, people, onSave, onDone, saveLabel }: {
  initial: FollowUpValues; people: readonly { email: string; name: string }[];
  onSave: (value: FollowUpValues) => Promise<unknown>; onDone: () => void; saveLabel?: string | undefined;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy || !value.text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ text: value.text.replace(/\s+/g, ' ').trim(), owner: value.owner, due: value.due?.trim() || null });
      onDone();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <><FollowUpEditor value={value} onChange={setValue} people={people} onSave={() => { void save(); }} onCancel={onDone} busy={busy} saveLabel={saveLabel} />{error && <Notice tone="caution">{error}</Notice>}</>;
}

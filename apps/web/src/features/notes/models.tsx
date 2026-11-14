/*
 * The AI models that write the notes after transcription, and choosing one: your default in Settings, the organizer's for a
 * call, and again when a note is written over. The default is always a choice (null on the wire); the others are the
 * models the API lists (`useAiModels`). A model that isn't private is called outside a secure enclave and says so.
 */
import type { AiModels, Note } from '@alcove/api';
import { Unencrypted, type SelectOption } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { accountQueries } from '~/features/account/queries';
import { api } from '~/lib/api';
import { noteKeys } from './queryKeys';

/**
 * The models to choose from for a call's notes or as your default, and the default one. They change rarely.
 */
export function useAiModels(enabled = true) {
  return useQuery({ queryKey: noteKeys.visionModels, queryFn: () => api.models.list(), staleTime: 10 * 60_000, enabled });
}

/** The default model, as a `Select` value: model IDs are never empty. */
export const DEFAULT_MODEL = '';

/** The choices, the default first. A chosen model the API no longer lists stays shown by its ID, so the choice never looks blank. */
export function modelOptions(models: AiModels | undefined, current: string | null): SelectOption<string>[] {
  if (!models) {
    return [{ value: DEFAULT_MODEL, label: 'Default model' }, ...(current !== null ? [{ value: current, label: current }] : [])];
  }
  const listed = models.models.filter((m) => m.id !== models.default.id)
    .map((m) => ({ value: m.id, label: m.name, tag: m.private ? undefined : <Unencrypted compact /> }));
  const missing = current !== null && !models.models.some((m) => m.id === current) ? [{ value: current, label: current }] : [];
  return [{ value: DEFAULT_MODEL, label: models.default.name, note: '(default)', tag: models.default.private ? undefined : <Unencrypted compact /> }, ...listed, ...missing];
}
/** A `Select` value as the model to send: null for the default. */
export const modelOf = (value: string): string | null => (value === DEFAULT_MODEL ? null : value);
/** A model to send as a `Select` value. */
export const modelValue = (model: string | null): string => model ?? DEFAULT_MODEL;
/** Whether the chosen model (null: the default) is called outside a secure enclave. */
export function isUnencrypted(models: AiModels | undefined, current: string | null): boolean {
  if (!models) return false;
  const m = current === null ? models.default : models.models.find((x) => x.id === current);
  return m !== undefined && !m.private;
}

/** Whether your own chosen model (the one a call you organize starts with) is called outside a secure enclave. */
export function useMyModelUnencrypted(): boolean {
  const models = useAiModels();
  const prefs = useQuery(accountQueries.prefs()).data;
  return isUnencrypted(models.data, prefs?.model ?? null);
}

/** What unencrypted models did for a note, as a person reads it: "Written by Qwen, unencrypted". Empty when none did. */
export function unencryptedLine(unencrypted: Note['unencrypted'], models: AiModels | undefined): string {
  const nameOf = (id: string) => models?.models.find((m) => m.id === id)?.name ?? id;
  const by = (task: 'notes' | 'screens') => [...new Set(unencrypted.filter((u) => u.task === task).map((u) => nameOf(u.model)))];
  const parts = [
    ...(by('notes').length ? [`Written by ${by('notes').join(' and ')}`] : []),
    ...(by('screens').length ? [`screens read by ${by('screens').join(' and ')}`] : [])
  ];
  const line = parts.join(', ');
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}, unencrypted` : '';
}

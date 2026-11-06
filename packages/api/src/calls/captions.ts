import { z } from '../shared/zod';
/* ---------- captions ---------- */

/** Languages captions can be translated into. Each person picks their own; nobody else's captions change. */
export const CaptionLanguageSchema = z.enum(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh']);

export type CaptionLanguage = z.infer<typeof CaptionLanguageSchema>;

/** Each caption language, named in itself and in English. */
export const CAPTION_LANGUAGES: readonly { code: CaptionLanguage; name: string; english: string }[] = [
  { code: 'en', name: 'English', english: 'English' }, { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' }, { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pt', name: 'Português', english: 'Portuguese' }, { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'ja', name: '日本語', english: 'Japanese' }, { code: 'zh', name: '中文', english: 'Chinese' }
];

/*
 * NEAR AI Cloud (I01). Configured from NEAR_AI_API_KEY but not called yet: transcription and
 * note writing will use it. Kept behind this module so the key never reaches other code paths.
 */
import type { Config } from './config';

export interface Inference { configured: boolean; baseUrl: string }
export const inference = (cfg: Config): Inference => ({ configured: !!cfg.NEAR_AI_API_KEY, baseUrl: cfg.NEAR_AI_BASE_URL });

import { z } from '../shared/zod';
import { isFeatureFlagName } from './names';

/**
 * The flags on for whoever asks. A name this build doesn't know is dropped, not refused, so a flag retired here but still
 * sent by an older API changes nothing.
 */
export const FeatureFlagsSchema = z.object({ on: z.array(z.string()).transform((names) => names.filter(isFeatureFlagName)) });

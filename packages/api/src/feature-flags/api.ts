import { type FeatureFlagName } from './names';
export interface FeatureFlagsApi {
  /** The flags on for whoever asks: signed in, everything on for them; signed out, only what's on for everyone. */
  on(): Promise<FeatureFlagName[]>;
}

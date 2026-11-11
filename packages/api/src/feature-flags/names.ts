/*
 * Every feature flag there is (docs: engineering/feature-flags.md). A flag only switches something on: for everyone, for
 * hand-picked groups, for individual people, in any combination. The database can only turn on a name listed here, so a
 * check against a name that isn't here doesn't compile, and deleting a name finds every check that used it.
 */
export const FEATURE_FLAGS = {
  'call.bandwidthReduction': 'Calls download less: small camera tiles at 180p, cameras’ 720p at 1 Mbps and microphones as speech.',
  'call.screenShareQuality': 'Shared screens stay sharp and move more smoothly: up to 30 fps, one full-size VP9 copy (VP8 while anyone can’t decode VP9).'
} as const satisfies Record<string, string>;
export type FeatureFlagName = keyof typeof FEATURE_FLAGS;
export const isFeatureFlagName = (name: string): name is FeatureFlagName => Object.hasOwn(FEATURE_FLAGS, name);
export const FEATURE_FLAG_NAMES: FeatureFlagName[] = Object.keys(FEATURE_FLAGS).filter(isFeatureFlagName);

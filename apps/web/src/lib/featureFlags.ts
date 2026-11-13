/*
 * The feature flags on for whoever's here, which any feature may wait on (docs/engineering/feature-flags.md). They belong to
 * no one feature, so they live here, beside the API client they're read through.
 */
import type { FeatureFlagName } from '@alcove/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const featureFlagsKey = ['feature-flags'] as const;

/** The feature flags on for whoever's here. Signing in or out clears the cache, so they're asked again for the new session. */
export const featureFlagsQuery = () => queryOptions({ queryKey: featureFlagsKey, queryFn: () => api.featureFlags.on(), staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true });

/**
 * Whether a feature flag is on for whoever's here: undefined until the server has said, so a flagged page or control waits
 * rather than showing and then vanishing (docs: engineering/feature-flags.md). If it can't say, the flag is off, so nothing
 * waits for good; the next refresh asks again. The server checks it too.
 */
export function useFeatureFlag(name: FeatureFlagName): boolean | undefined {
  const { data, isError } = useQuery(featureFlagsQuery());
  if (data) return data.includes(name);
  return isError ? false : undefined;
}

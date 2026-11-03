import type { Meeting } from '@alcove/api';
import { createContext, useContext } from 'react';

/** Opens the composer from anywhere inside the app shell: for a new call, or to change `meeting`. */
export const ComposerContext = createContext<(meeting?: Meeting) => void>(() => {});
export const useOpenComposer = () => useContext(ComposerContext);

/** Calls scheduled moments ago, so their row on Home can say so once. */
export const freshCalls = new Set<string>();

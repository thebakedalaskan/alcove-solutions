import { createContext, useContext } from 'react';

/** Opens the new-call composer from anywhere inside the app shell. */
export const ComposerContext = createContext<() => void>(() => {});
export const useOpenComposer = () => useContext(ComposerContext);

/** Calls scheduled moments ago, so their row on Home can say so once. */
export const freshCalls = new Set<string>();

/*
 * Calls scheduled or moved moments ago: scheduling (and scheduling the next call of a series) adds them, and the row that
 * shows one says so once, on Calls or Home.
 */
/** Calls scheduled moments ago, so their row can say so once: "Just scheduled". */
export const freshCalls = new Set<string>();
/** Calls moved moments ago, so their row can say so once: "Moved". */
export const movedCalls = new Set<string>();
